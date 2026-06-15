#!/usr/bin/env python3
"""
Portfolio value update agent.
Run hourly during NSE trading hours (09:15–15:30 IST) on NSE working days.

Sends Telegram with:
  - Total invested vs current value + overall %
  - Day's top runners (biggest % gainers)
  - Day's top draggers (biggest % losers)

Also writes data/portfolio_snapshot.json for the dashboard.
"""

import logging
import os
import sys
from datetime import datetime

from _common import DATA_DIR, display, save_json, notify, setup_logging

from src.exchange_calendar import is_open, IST
from src.portfolio import load as load_portfolio
from src.price_fetcher import get_price, get_prev_close

log = logging.getLogger(__name__)

SNAPSHOT_PATH = os.path.join(DATA_DIR, "portfolio_snapshot.json")


def build_snapshot(holdings: list) -> list:
    results = []
    for h in holdings:
        ticker = h["ticker"]
        price  = get_price(ticker)
        if price is None:
            log.warning("No price for %s — skipped", ticker)
            continue
        prev_close     = get_prev_close(ticker)
        day_change_pct = round((price - prev_close) / prev_close * 100, 2) if prev_close else None
        invested = h["qty"] * h["avg_buy_price"]
        current  = h["qty"] * price
        pnl      = current - invested
        pct      = (price - h["avg_buy_price"]) / h["avg_buy_price"] * 100
        results.append({
            "ticker":          ticker,
            "display":         display(ticker),
            "qty":             h["qty"],
            "avg_buy_price":   round(h["avg_buy_price"], 2),
            "current_price":   round(price, 2),
            "prev_close":      round(prev_close, 2) if prev_close else None,
            "day_change_pct":  day_change_pct,
            "invested":        round(invested, 2),
            "current_value":   round(current, 2),
            "pnl":             round(pnl, 2),
            "pnl_pct":         round(pct, 2),
            "currency":        h.get("currency", "INR"),
        })
    return results


def format_message(snapshot: list, ts: str) -> str:
    total_invested = sum(h["invested"] for h in snapshot)
    total_current  = sum(h["current_value"] for h in snapshot)
    total_pnl      = total_current - total_invested
    total_pct      = (total_pnl / total_invested * 100) if total_invested else 0

    emoji    = "📈" if total_pct >= 0 else "📉"
    pnl_sign = "+" if total_pnl >= 0 else ""

    by_pct   = sorted(snapshot, key=lambda x: x["pnl_pct"], reverse=True)
    runners  = [h for h in by_pct if h["pnl_pct"] > 0][:5]
    draggers = [h for h in by_pct if h["pnl_pct"] < 0][-5:][::-1]

    lines = [
        f"{emoji} *PORTFOLIO UPDATE | {ts}*",
        "",
        f"Invested : `₹{total_invested:>13,.0f}`",
        f"Current  : `₹{total_current:>13,.0f}`",
        f"P&L      : `{pnl_sign}₹{total_pnl:>12,.0f}` (*{'+' if total_pct >= 0 else ''}{total_pct:.2f}%*)",
        f"Stocks   : {len(snapshot)} tracked",
    ]

    if runners:
        lines += ["", "🚀 *Top Runners*"]
        for h in runners:
            lines.append(f"`{h['display']:<14}` *+{h['pnl_pct']:.1f}%*  ₹{h['current_price']:,.1f}")

    if draggers:
        lines += ["", "🔻 *Top Draggers*"]
        for h in draggers:
            lines.append(f"`{h['display']:<14}` *{h['pnl_pct']:.1f}%*  ₹{h['current_price']:,.1f}")

    return "\n".join(lines)


def run(force: bool = False) -> None:
    if not force and not is_open("NSE"):
        log.info("NSE is closed — skipping portfolio update")
        return

    holdings = load_portfolio()
    now_ist  = datetime.now(IST)
    ts       = now_ist.strftime("%d %b %Y %H:%M IST")
    log.info("Running portfolio update at %s", ts)

    snapshot = build_snapshot(holdings)
    if not snapshot:
        log.error("No price data fetched — aborting")
        return

    total_invested = sum(h["invested"] for h in snapshot)
    total_current  = sum(h["current_value"] for h in snapshot)
    total_pnl      = total_current - total_invested
    total_pct      = (total_pnl / total_invested * 100) if total_invested else 0
    by_pct         = sorted(snapshot, key=lambda x: x["pnl_pct"], reverse=True)

    data = {
        "timestamp":      now_ist.isoformat(),
        "total_invested": round(total_invested, 2),
        "total_current":  round(total_current,  2),
        "total_pnl":      round(total_pnl,      2),
        "total_pnl_pct":  round(total_pct,      2),
        "holdings":       snapshot,
        "runners":        [h for h in by_pct if h["pnl_pct"] > 0][:5],
        "draggers":       [h for h in by_pct if h["pnl_pct"] < 0][-5:][::-1],
    }

    save_json(SNAPSHOT_PATH, data)
    log.info("Saved snapshot → %s", SNAPSHOT_PATH)

    notify(format_message(snapshot, ts))


if __name__ == "__main__":
    setup_logging()
    run(force="--force" in sys.argv)
