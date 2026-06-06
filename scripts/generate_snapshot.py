#!/usr/bin/env python3
"""Fetch live prices for all holdings and write portfolio_snapshot.json + docs/data/."""

import json
import os
import sys
from datetime import datetime
import pytz

ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, ROOT)

import yfinance as yf

IST = pytz.timezone("Asia/Kolkata")

PORTFOLIO_PATH = os.path.join(ROOT, "portfolio.json")
DATA_DIR       = os.path.join(ROOT, "data")
DOCS_DATA_DIR  = os.path.join(ROOT, "docs", "data")


def load_portfolio():
    with open(PORTFOLIO_PATH) as f:
        return json.load(f)["holdings"]


def get_price(ticker):
    try:
        info = yf.Ticker(ticker).fast_info
        price = info.get("last_price") or info.get("previousClose")
        return float(price) if price else None
    except Exception as e:
        print(f"  WARN {ticker}: {e}")
        return None


def display(ticker):
    return ticker.replace(".NS", "").replace(".BO", "")


def main():
    holdings = load_portfolio()
    now_ist  = datetime.now(IST)
    ts       = now_ist.isoformat()
    print(f"Fetching prices for {len(holdings)} holdings at {now_ist.strftime('%d %b %Y %H:%M IST')}...")

    results = []
    for h in holdings:
        ticker = h["ticker"]
        price  = get_price(ticker)
        if price is None:
            print(f"  SKIP {ticker} — no price")
            continue
        invested = h["qty"] * h["avg_buy_price"]
        current  = h["qty"] * price
        pnl      = current - invested
        pct      = (price - h["avg_buy_price"]) / h["avg_buy_price"] * 100
        results.append({
            "ticker":        ticker,
            "display":       display(ticker),
            "qty":           h["qty"],
            "avg_buy_price": round(h["avg_buy_price"], 2),
            "current_price": round(price, 2),
            "invested":      round(invested, 2),
            "current_value": round(current, 2),
            "pnl":           round(pnl, 2),
            "pnl_pct":       round(pct, 2),
            "currency":      h.get("currency", "INR"),
        })
        sign = "+" if pct >= 0 else ""
        print(f"  {ticker:<20} ₹{price:>8,.2f}  {sign}{pct:.2f}%")

    if not results:
        print("ERROR: no prices fetched")
        sys.exit(1)

    total_invested = sum(h["invested"] for h in results)
    total_current  = sum(h["current_value"] for h in results)
    total_pnl      = total_current - total_invested
    total_pct      = (total_pnl / total_invested * 100) if total_invested else 0
    by_pct         = sorted(results, key=lambda x: x["pnl_pct"], reverse=True)

    snapshot = {
        "timestamp":      ts,
        "total_invested": round(total_invested, 2),
        "total_current":  round(total_current,  2),
        "total_pnl":      round(total_pnl,      2),
        "total_pnl_pct":  round(total_pct,      2),
        "holdings":       results,
        "runners":        [h for h in by_pct if h["pnl_pct"] > 0][:5],
        "draggers":       [h for h in reversed(by_pct) if h["pnl_pct"] < 0][:5],
    }

    for out_dir in [DATA_DIR, DOCS_DATA_DIR]:
        os.makedirs(out_dir, exist_ok=True)
        path = os.path.join(out_dir, "portfolio_snapshot.json")
        tmp  = path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(snapshot, f, indent=2)
        os.replace(tmp, path)
        print(f"Saved → {path}")

    pnl_sign = "+" if total_pnl >= 0 else ""
    print(f"\nTotal Invested : ₹{total_invested:,.0f}")
    print(f"Current Value  : ₹{total_current:,.0f}")
    print(f"P&L            : {pnl_sign}₹{total_pnl:,.0f}  ({pnl_sign}{total_pct:.2f}%)")
    print(f"Holdings       : {len(results)}")


if __name__ == "__main__":
    main()
