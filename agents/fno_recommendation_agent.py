#!/usr/bin/env python3
"""
F&O Recommendation Agent — runs weekly (Monday 8:30 AM IST, same slot as portfolio).

Reads watchlists/{largecap,midcap,smallcap}.json produced by
watchlists/scripts/build_fno_watchlists.py and scores each stock on
pure technical momentum (no cost-basis adjustment — we don't own these).

Produces data/fno_recommendations.json + sends a Telegram summary.
"""

import json
import logging
import os
from datetime import datetime
from pathlib import Path

import yfinance as yf

from _common import DATA_DIR, save_json, notify, setup_logging

from src.exchange_calendar import IST
from src.technical_analyzer import analyze

log = logging.getLogger(__name__)

OUTPUT_PATH  = os.path.join(DATA_DIR, "fno_recommendations.json")
WATCHLISTS_DIR = Path(__file__).resolve().parent.parent / "watchlists"

TIERS = ["largecap", "midcap", "smallcap"]


# ── Market data (price + day/week change) ─────────────────────────────────────

def _get_market_data(ticker: str) -> tuple[float, float, float]:
    """Return (current_price, day_change_pct, week_change_pct).
    Uses fast_info for prev_close + short history for week change.
    """
    try:
        t     = yf.Ticker(ticker)
        fi    = t.fast_info
        price = float(getattr(fi, "last_price",      None) or 0)
        prev  = float(getattr(fi, "previous_close",  None) or 0)

        day_pct = round((price - prev) / prev * 100, 2) if prev and price else 0.0

        week_pct = 0.0
        hist = t.history(period="8d")
        if not hist.empty and len(hist) >= 6:
            week_close = float(hist["Close"].iloc[-6])
            if week_close:
                week_pct = round((price - week_close) / week_close * 100, 2)

        return price, day_pct, week_pct
    except Exception as e:
        log.debug("market data failed for %s: %s", ticker, e)
        return 0.0, 0.0, 0.0


# ── Scoring (pure TA — no cost-basis component) ───────────────────────────────

def _score(ta: dict) -> tuple[int, list[str]]:
    score   = 0
    signals = []

    rsi = ta.get("rsi")
    if rsi is not None:
        if rsi < 30:
            score += 2; signals.append(f"RSI {rsi} — deeply oversold, high reward zone")
        elif rsi < 45:
            score += 1; signals.append(f"RSI {rsi} — recovering, watch for reversal")
        elif rsi > 70:
            score -= 1; signals.append(f"RSI {rsi} — overbought, wait for pullback")

    macd = ta.get("macd_signal", "")
    if "Bullish crossover" in macd:
        score += 2; signals.append("MACD bullish crossover — strong buy signal")
    elif "Bullish" in macd:
        score += 1; signals.append("MACD bullish — momentum building")
    elif "Bearish crossover" in macd:
        score -= 2; signals.append("MACD bearish crossover — caution")
    elif "Bearish" in macd:
        score -= 1; signals.append("MACD bearish — weak momentum")

    trend = ta.get("trend", "")
    if trend == "UPTREND":
        score += 2; signals.append("Price above 50MA & 200MA — UPTREND intact")
    elif trend == "DOWNTREND":
        score -= 2; signals.append("Price below 50MA & 200MA — DOWNTREND")
    elif trend == "SIDEWAYS":
        signals.append("SIDEWAYS — possible accumulation zone")

    bb = ta.get("bb_signal", "")
    if "Below lower" in bb:
        score += 1; signals.append("Near lower Bollinger Band — oversold extension")
    elif "Above upper" in bb:
        score -= 1; signals.append("Near upper Bollinger Band — overbought")

    return score, signals


def _action(score: int) -> str:
    if score >= 4:   return "STRONG BUY SIGNAL"
    if score >= 2:   return "BUY ON DIP"
    if score >= 0:   return "NEUTRAL"
    if score >= -2:  return "WATCH / AVOID"
    return "BEARISH — AVOID"


def _action_emoji(action: str) -> str:
    return {
        "STRONG BUY SIGNAL": "🟢",
        "BUY ON DIP":        "🔵",
        "NEUTRAL":           "⚪",
        "WATCH / AVOID":     "🟡",
        "BEARISH — AVOID":   "🔴",
    }.get(action, "⚪")


# ── Load watchlist tier ───────────────────────────────────────────────────────

def _load_tier(tier: str) -> list[dict]:
    path = WATCHLISTS_DIR / f"{tier}.json"
    if not path.exists():
        log.warning("Watchlist file not found: %s", path)
        return []
    with open(path) as f:
        data = json.load(f)
    return data.get("stocks", [])


# ── Process one tier ──────────────────────────────────────────────────────────

def _process_tier(tier: str, stocks: list[dict]) -> list[dict]:
    results = []
    total   = len(stocks)
    for i, stock in enumerate(stocks, 1):
        ticker  = stock["nse_ticker"]   # e.g. RELIANCE.NS
        symbol  = stock["symbol"]
        mcap_cr = stock.get("market_cap_crore", 0)

        price, day_pct, week_pct = _get_market_data(ticker)
        if not price:
            log.warning("[%s] %d/%d No price for %s — skipped", tier, i, total, ticker)
            continue

        ta             = analyze(ticker)
        score, signals = _score(ta)
        action         = _action(score)

        results.append({
            "ticker":           ticker,
            "symbol":           symbol,
            "tradingview":      stock.get("tradingview", f"NSE:{symbol}"),
            "tier":             tier,
            "market_cap_crore": mcap_cr,
            "mcap_rank":        stock.get("mcap_rank", 0),
            "current_price":    round(price, 2),
            "day_change_pct":   day_pct,
            "week_change_pct":  week_pct,
            "momentum_score":   score,
            "action":           action,
            "action_emoji":     _action_emoji(action),
            "signals":          signals,
            "rsi":              ta.get("rsi"),
            "trend":            ta.get("trend"),
            "macd":             ta.get("macd_signal"),
            "sma50":            ta.get("sma50"),
            "sma200":           ta.get("sma200"),
            "support":          ta.get("support"),
        })
        log.info("[%s] %d/%d %s → score %+d | day %+.1f%% | week %+.1f%% (%s)",
                 tier, i, total, symbol, score, day_pct, week_pct, action)

    results.sort(key=lambda x: x["momentum_score"], reverse=True)
    return results


# ── Telegram summary ──────────────────────────────────────────────────────────

def _format_telegram(all_tiers: dict, ts: str) -> str:
    lines = [f"📊 *F&O TECHNICAL SCAN | {ts}*", ""]

    for tier in TIERS:
        tier_data  = all_tiers.get(tier, {})
        stocks     = tier_data.get("stocks", [])
        top_buys   = [s for s in stocks if "BUY" in s["action"]][:3]
        bearish    = [s for s in stocks if "BEARISH" in s["action"]][:2]

        label = tier.upper()
        if top_buys:
            lines.append(f"*{label} — Top Buys*")
            for s in top_buys:
                lines.append(f"{s['action_emoji']} *{s['symbol']}* | {s['trend'] or 'N/A'} | RSI {s['rsi'] or '–'}")
                for sig in s["signals"][:1]:
                    lines.append(f"  _{sig}_")
            lines.append("")

        if bearish:
            lines.append(f"*{label} — Bearish*")
            for s in bearish:
                lines.append(f"🔴 *{s['symbol']}* | {s['trend'] or 'N/A'} | score {s['momentum_score']:+d}")
            lines.append("")

    lines += [
        "─────────────────────────",
        "_📌 F&O scan — technical signals only. Not SEBI-registered advice._",
    ]
    return "\n".join(lines)[:4096]


# ── Main ──────────────────────────────────────────────────────────────────────

def run() -> None:
    now_ist = datetime.now(IST)
    ts      = now_ist.strftime("%d %b %Y %H:%M IST")
    log.info("Running F&O recommendation agent at %s", ts)

    all_tiers: dict = {}

    for tier in TIERS:
        stocks = _load_tier(tier)
        log.info("Processing %s: %d stocks", tier, len(stocks))
        processed      = _process_tier(tier, stocks)
        all_tiers[tier] = {
            "tier":         tier,
            "count":        len(processed),
            "top_buys":     [s for s in processed if "BUY"     in s["action"]][:10],
            "bearish":      [s for s in processed if "BEARISH" in s["action"]],
            "stocks":       processed,
        }

    data = {
        "timestamp": now_ist.isoformat(),
        "tiers":     all_tiers,
        "generated_at": ts,
    }

    save_json(OUTPUT_PATH, data)
    log.info("Saved F&O recommendations → %s", OUTPUT_PATH)

    notify(_format_telegram(all_tiers, ts))


if __name__ == "__main__":
    setup_logging()
    run()
