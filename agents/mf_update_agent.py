#!/usr/bin/env python3
"""
Mutual Fund NAV update agent.
Runs daily at 8:30 PM IST (after AMFI publishes end-of-day NAVs at ~8 PM).

- Reads fund list from mf_portfolio.json
- Fetches latest NAV from mfapi.in (free, no key required)
- Writes data/mf_snapshot.json for the dashboard

AMFI publishes NAVs for all schemes by ~8 PM IST on every business day.
"""

import json
import logging
import os
import sys
import time
from datetime import datetime
from logging.handlers import RotatingFileHandler

import requests

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv()

from src.exchange_calendar import IST
from src.notifier import send_telegram, send_console

log = logging.getLogger(__name__)

ROOT          = os.path.join(os.path.dirname(__file__), "..")
MF_PATH       = os.path.join(ROOT, "mf_portfolio.json")
DATA_DIR      = os.path.join(ROOT, "data")
SNAPSHOT_PATH = os.path.join(DATA_DIR, "mf_snapshot.json")

MFAPI_BASE = "https://api.mfapi.in/mf"
AMFI_URL   = "https://portal.amfiindia.com/spages/NAVAll.txt"
TIMEOUT    = 15
RETRY      = 1

_amfi_cache: dict = {}   # isin → nav, loaded once per run


def load_mf_portfolio() -> list:
    with open(MF_PATH) as f:
        return json.load(f).get("funds", [])


def _load_amfi() -> dict:
    """Download AMFI NAVAll.txt and build an ISIN→NAV map. Cached per run."""
    if _amfi_cache:
        return _amfi_cache
    log.info("Fetching AMFI NAVAll.txt for ISIN-based lookup…")
    try:
        r = requests.get(AMFI_URL, timeout=30)
        r.raise_for_status()
        for line in r.text.splitlines():
            parts = line.split(";")
            if len(parts) < 6:
                continue
            # columns: SchemeCode ; ISIN-Growth ; ISIN-DivReinvest ; Name ; NAV ; Date
            isin_growth = parts[1].strip()
            isin_reinv  = parts[2].strip()
            nav_str     = parts[4].strip()
            try:
                nav = float(nav_str)
            except ValueError:
                continue
            if isin_growth:
                _amfi_cache[isin_growth] = nav
            if isin_reinv:
                _amfi_cache[isin_reinv] = nav
    except Exception as e:
        log.error("Failed to fetch AMFI NAVAll.txt: %s", e)
    return _amfi_cache


def fetch_nav(scheme_code: str):
    """Fetch latest NAV. Uses mfapi.in for numeric codes, AMFI file for ISINs."""
    # ISIN-based lookup (starts with INF or ISIN format)
    if not scheme_code.isdigit():
        nav = _load_amfi().get(scheme_code)
        if nav:
            return nav
        log.error("ISIN %s not found in AMFI NAVAll.txt", scheme_code)
        return None

    # Numeric scheme code → mfapi.in
    url = f"{MFAPI_BASE}/{scheme_code}"
    for attempt in range(RETRY + 1):
        try:
            r = requests.get(url, timeout=TIMEOUT)
            r.raise_for_status()
            data = r.json()
            if data.get("status") == "SUCCESS" and data.get("data"):
                return float(data["data"][0]["nav"])
            log.warning("Unexpected mfapi response for %s: %s", scheme_code, data.get("status"))
            return None
        except Exception as e:
            if attempt < RETRY:
                time.sleep(2)
            else:
                log.error("fetch_nav failed for %s: %s", scheme_code, e)
                return None
    return None


def build_snapshot(funds: list) -> list:
    results = []
    for f in funds:
        scheme_code = str(f.get("scheme_code", ""))
        nav         = fetch_nav(scheme_code)
        if nav is None:
            log.warning("No NAV for scheme %s (%s) — skipped", scheme_code, f.get("name"))
            continue

        units    = float(f.get("units", 0))
        avg_nav  = float(f.get("avg_nav", 0))
        invested = round(units * avg_nav, 2)
        current  = round(units * nav, 2)
        pnl      = round(current - invested, 2)
        pct      = round((nav - avg_nav) / avg_nav * 100, 2) if avg_nav else 0.0

        results.append({
            "scheme_code":  scheme_code,
            "name":         f.get("name", ""),
            "units":        round(units, 3),
            "avg_nav":      round(avg_nav, 4),
            "current_nav":  round(nav, 4),
            "invested":     invested,
            "current_value": current,
            "pnl":          pnl,
            "pnl_pct":      pct,
            "sip_amount":   f.get("sip_amount", 0),
            "sip_date":     f.get("sip_date", 1),
        })
        sign = "+" if pct >= 0 else ""
        log.info("%-12s  NAV ₹%8.4f  %s%+.2f%%", scheme_code, nav, sign, pct)

    return results


def format_message(snapshot: list, ts: str) -> str:
    if not snapshot:
        return f"🏦 *MF UPDATE | {ts}*\n\nNo fund data available."

    total_invested = sum(f["invested"] for f in snapshot)
    total_current  = sum(f["current_value"] for f in snapshot)
    total_pnl      = total_current - total_invested
    total_pct      = (total_pnl / total_invested * 100) if total_invested else 0
    sign           = "+" if total_pnl >= 0 else ""
    emoji          = "📈" if total_pct >= 0 else "📉"

    lines = [
        f"{emoji} *MF UPDATE | {ts}*",
        "",
        f"Invested : `₹{total_invested:>13,.0f}`",
        f"Current  : `₹{total_current:>13,.0f}`",
        f"P&L      : `{sign}₹{total_pnl:>12,.0f}` (*{'+' if total_pct >= 0 else ''}{total_pct:.2f}%*)",
        f"Funds    : {len(snapshot)} tracked",
        "",
    ]
    for f in sorted(snapshot, key=lambda x: x["pnl_pct"], reverse=True):
        short = f["name"][:22] if len(f["name"]) > 22 else f["name"]
        sign2 = "+" if f["pnl_pct"] >= 0 else ""
        lines.append(f"`{short:<22}` {sign2}{f['pnl_pct']:.2f}%  NAV ₹{f['current_nav']:.2f}")

    return "\n".join(lines)


def run() -> None:
    funds = load_mf_portfolio()
    if not funds:
        log.info("No funds in mf_portfolio.json — nothing to do")
        return

    now_ist = datetime.now(IST)
    ts      = now_ist.strftime("%d %b %Y %H:%M IST")
    log.info("Running MF update at %s for %d fund(s)", ts, len(funds))

    snapshot = build_snapshot(funds)

    total_invested = sum(f["invested"] for f in snapshot)
    total_current  = sum(f["current_value"] for f in snapshot)
    total_pnl      = total_current - total_invested
    total_pct      = (total_pnl / total_invested * 100) if total_invested else 0

    data = {
        "timestamp":     now_ist.isoformat(),
        "total_invested": round(total_invested, 2),
        "total_current":  round(total_current, 2),
        "total_pnl":      round(total_pnl, 2),
        "total_pnl_pct":  round(total_pct, 2),
        "funds":          snapshot,
    }

    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = SNAPSHOT_PATH + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, SNAPSHOT_PATH)
    log.info("Saved MF snapshot → %s", SNAPSHOT_PATH)

    msg = format_message(snapshot, ts)
    send_console(msg)
    send_telegram(msg)


if __name__ == "__main__":
    _log_file = RotatingFileHandler("agent.log", maxBytes=10 * 1024 * 1024, backupCount=3)
    _log_file.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s: %(message)s",
        handlers=[logging.StreamHandler(), _log_file],
    )
    run()
