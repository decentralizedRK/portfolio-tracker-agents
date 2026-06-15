#!/usr/bin/env python3
"""
Corporate action tracker — runs daily at 8:30 AM IST on trading days.

Fetches for portfolio + a curated watchlist:
  - Recent / upcoming dividends
  - Stock splits
  - Earnings calendar

Writes data/corporate_actions.json and sends a Telegram summary.
"""

import logging
import os
import sys
from datetime import datetime, timedelta

from _common import DATA_DIR, display, save_json, notify, setup_logging

import yfinance as yf

from src.exchange_calendar import IST
from src.portfolio import load as load_portfolio

log = logging.getLogger(__name__)

CA_PATH = os.path.join(DATA_DIR, "corporate_actions.json")

# High-profile stocks to track for corporate actions outside portfolio
WATCHLIST = [
    "ZOMATO.NS",     "PAYTM.NS",      "HDFCBANK.NS",   "ICICIBANK.NS",
    "HINDUNILVR.NS", "BAJFINANCE.NS", "WIPRO.NS",      "INFY.NS",
    "TCS.NS",        "TATASTEEL.NS",  "ADANIGREEN.NS", "NTPC.NS",
    "IRFC.NS",       "RVNL.NS",       "POLYCAB.NS",    "NYKAA.NS",
]


def _safe_tz(series):
    """Make index timezone-aware (UTC) so we can compare with now."""
    if series is None or series.empty:
        return series
    if series.index.tz is None:
        series.index = series.index.tz_localize("UTC")
    return series


def fetch_actions(ticker: str) -> dict:
    result = {"dividends": [], "splits": [], "calendar": {}, "error": None}
    try:
        t = yf.Ticker(ticker)

        div = _safe_tz(t.dividends)
        if div is not None and not div.empty:
            cutoff = datetime.now(tz=div.index.tz) - timedelta(days=180)
            recent = div[div.index >= cutoff]
            result["dividends"] = [
                {"date": str(d.date()), "amount": round(float(v), 4)}
                for d, v in recent.items()
                if float(v) > 0
            ]

        splits = _safe_tz(t.splits)
        if splits is not None and not splits.empty:
            cutoff = datetime.now(tz=splits.index.tz) - timedelta(days=365)
            recent = splits[splits.index >= cutoff]
            result["splits"] = [
                {"date": str(d.date()), "ratio": str(v)}
                for d, v in recent.items()
            ]

        try:
            cal = t.calendar
            if cal is not None and not cal.empty:
                result["calendar"] = {k: str(v) for k, v in cal.items() if v is not None}
        except Exception:
            pass

    except Exception as e:
        result["error"] = str(e)
        log.warning("Corp action fetch failed for %s: %s", ticker, e)

    return result


def _upcoming_events(ticker: str, actions: dict) -> list:
    events = []
    for div in actions.get("dividends", []):
        events.append({
            "ticker":  ticker,
            "display": display(ticker),
            "type":    "Dividend",
            "date":    div["date"],
            "detail":  f"₹{div['amount']:.2f}/share",
        })
    for split in actions.get("splits", []):
        events.append({
            "ticker":  ticker,
            "display": display(ticker),
            "type":    "Stock Split",
            "date":    split["date"],
            "detail":  f"{split['ratio']} ratio",
        })
    cal = actions.get("calendar", {})
    for key in ("Earnings Date", "Ex-Dividend Date"):
        if key in cal:
            events.append({
                "ticker":  ticker,
                "display": display(ticker),
                "type":    key,
                "date":    cal[key],
                "detail":  "",
            })
    return events


def _format_telegram(data: dict, date_str: str) -> str:
    lines = [f"🏢 *CORPORATE ACTIONS | {date_str}*", ""]

    highlights = data.get("highlights", [])
    if highlights:
        for ev in highlights[:10]:
            portfolio_tag = " 📂" if ev.get("in_portfolio") else ""
            detail = f" — {ev['detail']}" if ev["detail"] else ""
            lines.append(
                f"• *{ev['display']}*{portfolio_tag} | {ev['type']}{detail} ({ev['date']})"
            )
    else:
        lines.append("No recent corporate actions found in last 180 days.")

    lines += [
        "",
        "_📂 = your portfolio_",
        "_Sources: yfinance · Data may be delayed_",
    ]
    return "\n".join(lines)[:4096]


def run() -> None:
    holdings = load_portfolio()
    now_ist  = datetime.now(IST)
    date_str = now_ist.strftime("%d %b %Y")
    log.info("Running corporate action agent for %s", date_str)

    portfolio_tickers = [h["ticker"] for h in holdings]
    all_tickers       = portfolio_tickers + [t for t in WATCHLIST if t not in portfolio_tickers]

    actions_map: dict = {}
    for ticker in all_tickers:
        actions_map[ticker] = fetch_actions(ticker)

    all_events = []
    for ticker, actions in actions_map.items():
        for ev in _upcoming_events(ticker, actions):
            ev["in_portfolio"] = ticker in portfolio_tickers
            all_events.append(ev)

    all_events.sort(key=lambda x: x["date"], reverse=True)

    data = {
        "date":              date_str,
        "timestamp":         now_ist.isoformat(),
        "portfolio_actions": {t: actions_map[t] for t in portfolio_tickers if t in actions_map},
        "watchlist_actions": {t: actions_map[t] for t in WATCHLIST if t in actions_map},
        "highlights":        all_events[:15],
    }

    save_json(CA_PATH, data, default=str)
    log.info("Saved corporate actions → %s", CA_PATH)

    notify(_format_telegram(data, date_str))


if __name__ == "__main__":
    setup_logging()
    run()
