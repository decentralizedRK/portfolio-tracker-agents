#!/usr/bin/env python3
"""
Mutual Fund NAV update agent.
Runs daily at 8:30 PM IST (after AMFI publishes end-of-day NAVs at ~8 PM).

- Reads fund list from mf_portfolio.json
- Fetches latest NAV from mfapi.in (free, no key required)
- On SIP dates: records new units at that day's NAV, updates avg_nav in mf_portfolio.json
- Writes data/mf_snapshot.json for the dashboard
"""

import json
import logging
import os
import sys
import time
from datetime import datetime, timedelta
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


# ── Portfolio I/O ────────────────────────────────────────────────────────────

def load_mf_portfolio() -> list:
    with open(MF_PATH) as f:
        return json.load(f).get("funds", [])


def save_mf_portfolio(funds: list) -> None:
    """Write updated fund list back to mf_portfolio.json atomically."""
    tmp = MF_PATH + ".tmp"
    with open(tmp, "w") as f:
        json.dump({"funds": funds}, f, indent=2)
    os.replace(tmp, MF_PATH)
    log.info("Saved updated mf_portfolio.json")


# ── NAV Fetching ─────────────────────────────────────────────────────────────

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
    if not scheme_code.isdigit():
        nav = _load_amfi().get(scheme_code)
        if nav:
            return nav
        log.error("ISIN %s not found in AMFI NAVAll.txt", scheme_code)
        return None

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


def fetch_all_navs(funds: list) -> dict:
    """Fetch NAV for every fund. Returns {scheme_code: nav}."""
    navs = {}
    for f in funds:
        code = str(f.get("scheme_code", ""))
        nav  = fetch_nav(code)
        if nav is not None:
            navs[code] = nav
    return navs


# ── SIP Recording ────────────────────────────────────────────────────────────

def should_record_sip(fund: dict, today_ist: datetime) -> bool:
    """
    Return True if this fund's monthly SIP should be recorded today.

    The agent runs Mon-Fri only. A 3-day lookback catches SIP dates that
    fell on Saturday or Sunday (e.g. SIP date=1st, 1st is Saturday →
    record on Monday the 3rd).
    """
    sip_amount = fund.get("sip_amount", 0)
    sip_date   = fund.get("sip_date")
    if not sip_amount or not sip_date:
        return False

    # Already recorded this calendar month?
    last = fund.get("last_sip_recorded", "")
    if last:
        try:
            last_dt = datetime.strptime(last, "%Y-%m-%d")
            if last_dt.year == today_ist.year and last_dt.month == today_ist.month:
                log.debug(
                    "SIP already recorded this month for %s (last: %s)",
                    fund.get("name", ""), last,
                )
                return False
        except ValueError:
            pass

    # Check today and the 2 preceding days (weekend fallback)
    for delta in range(3):
        candidate = today_ist - timedelta(days=delta)
        if candidate.day == sip_date:
            return True

    return False


def record_sip(fund: dict, nav: float, today_ist: datetime) -> dict:
    """
    Add this month's SIP allocation to the fund in-place.
    Returns a summary dict for logging / Telegram.
    """
    sip_amount  = float(fund["sip_amount"])
    old_units   = float(fund["units"])
    old_avg_nav = float(fund["avg_nav"])

    new_units      = sip_amount / nav
    total_units    = old_units + new_units
    total_invested = old_units * old_avg_nav + sip_amount
    new_avg_nav    = total_invested / total_units

    fund["units"]             = round(total_units, 3)
    fund["avg_nav"]           = round(new_avg_nav, 4)
    fund["last_sip_recorded"] = today_ist.strftime("%Y-%m-%d")

    log.info(
        "SIP recorded: %s  +%.3f units @ ₹%.4f  (₹%.0f)  new avg_nav ₹%.4f",
        fund.get("name", ""), new_units, nav, sip_amount, new_avg_nav,
    )

    return {
        "name":        fund["name"],
        "sip_amount":  sip_amount,
        "new_units":   round(new_units, 3),
        "nav":         nav,
        "new_avg_nav": round(new_avg_nav, 4),
    }


# ── Snapshot ─────────────────────────────────────────────────────────────────

def build_snapshot_from_navs(funds: list, navs: dict) -> list:
    """Compute P&L snapshot using pre-fetched NAVs."""
    results = []
    for f in funds:
        code = str(f.get("scheme_code", ""))
        nav  = navs.get(code)
        if nav is None:
            log.warning("No NAV for scheme %s (%s) — skipped", code, f.get("name"))
            continue

        units    = float(f.get("units", 0))
        avg_nav  = float(f.get("avg_nav", 0))
        invested = round(units * avg_nav, 2)
        current  = round(units * nav, 2)
        pnl      = round(current - invested, 2)
        pct      = round((nav - avg_nav) / avg_nav * 100, 2) if avg_nav else 0.0

        results.append({
            "scheme_code":   code,
            "name":          f.get("name", ""),
            "units":         round(units, 3),
            "avg_nav":       round(avg_nav, 4),
            "current_nav":   round(nav, 4),
            "invested":      invested,
            "current_value": current,
            "pnl":           pnl,
            "pnl_pct":       pct,
            "sip_amount":    f.get("sip_amount", 0),
            "sip_date":      f.get("sip_date", 1),
            "last_sip_recorded": f.get("last_sip_recorded", ""),
        })
        sign = "+" if pct >= 0 else ""
        log.info("%-12s  NAV ₹%8.4f  %s%+.2f%%", code, nav, sign, pct)

    return results


# ── Telegram Message ─────────────────────────────────────────────────────────

def format_message(snapshot: list, ts: str, sip_events: list) -> str:
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
        f"P&L      : `{sign}₹{abs(total_pnl):>12,.0f}` (*{'+' if total_pct >= 0 else ''}{total_pct:.2f}%*)",
        f"Funds    : {len(snapshot)} tracked",
        "",
    ]

    for f in sorted(snapshot, key=lambda x: x["pnl_pct"], reverse=True):
        short = f["name"][:22] if len(f["name"]) > 22 else f["name"]
        s2    = "+" if f["pnl_pct"] >= 0 else ""
        lines.append(f"`{short:<22}` {s2}{f['pnl_pct']:.2f}%  NAV ₹{f['current_nav']:.2f}")

    if sip_events:
        total_sip = sum(e["sip_amount"] for e in sip_events)
        lines += ["", f"📅 *SIP EXECUTED — ₹{total_sip:,.0f} invested today*"]
        for e in sip_events:
            short = e["name"][:28] if len(e["name"]) > 28 else e["name"]
            lines.append(
                f"`{short}` +{e['new_units']:,.3f} units @ ₹{e['nav']:.4f}  "
                f"(₹{e['sip_amount']:,.0f})"
            )

    return "\n".join(lines)


# ── Main ─────────────────────────────────────────────────────────────────────

def run() -> None:
    funds = load_mf_portfolio()
    if not funds:
        log.info("No funds in mf_portfolio.json — nothing to do")
        return

    now_ist = datetime.now(IST)
    ts      = now_ist.strftime("%d %b %Y %H:%M IST")
    log.info("Running MF update at %s for %d fund(s)", ts, len(funds))

    # 1. Fetch all NAVs (single pass — AMFI cache shared)
    navs = fetch_all_navs(funds)

    # 2. Record SIPs if today is a SIP date
    sip_events   = []
    sip_recorded = False
    for fund in funds:
        code = str(fund.get("scheme_code", ""))
        nav  = navs.get(code)
        if nav and should_record_sip(fund, now_ist):
            event = record_sip(fund, nav, now_ist)
            sip_events.append(event)
            sip_recorded = True

    # 3. If SIPs were recorded, persist updated units/avg_nav back to mf_portfolio.json
    if sip_recorded:
        save_mf_portfolio(funds)
        log.info("%d SIP(s) recorded and saved to mf_portfolio.json", len(sip_events))

    # 4. Build snapshot using (possibly updated) fund data
    snapshot = build_snapshot_from_navs(funds, navs)

    # 5. Compute portfolio totals
    total_invested = sum(f["invested"] for f in snapshot)
    total_current  = sum(f["current_value"] for f in snapshot)
    total_pnl      = total_current - total_invested
    total_pct      = (total_pnl / total_invested * 100) if total_invested else 0

    data = {
        "timestamp":         now_ist.isoformat(),
        "total_invested":    round(total_invested, 2),
        "total_current":     round(total_current, 2),
        "total_pnl":         round(total_pnl, 2),
        "total_pnl_pct":     round(total_pct, 2),
        "sip_recorded_today": len(sip_events),
        "funds":             snapshot,
    }

    # 6. Write snapshot atomically
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = SNAPSHOT_PATH + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, SNAPSHOT_PATH)
    log.info("Saved MF snapshot → %s", SNAPSHOT_PATH)

    # 7. Send notifications
    msg = format_message(snapshot, ts, sip_events)
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
