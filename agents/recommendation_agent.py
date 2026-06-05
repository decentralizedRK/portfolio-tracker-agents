#!/usr/bin/env python3
"""
Recommendation agent — runs weekly (Monday 8:30 AM IST).

For a 10-year / 5-10x horizon it evaluates each holding on:
  • Technical momentum  (RSI, MACD, MA trend)
  • Price vs cost basis (deep value zone vs profit-booking zone)
  • Bollinger Band position

Produces a scored action label per stock and writes
data/recommendations.json + sends a Telegram summary.
"""

import json
import logging
import os
import sys
from datetime import datetime
from logging.handlers import RotatingFileHandler

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv()

from src.exchange_calendar import IST
from src.portfolio import load as load_portfolio
from src.price_fetcher import get_price
from src.technical_analyzer import analyze
from src.notifier import send_telegram, send_console

log = logging.getLogger(__name__)

DATA_DIR  = os.path.join(os.path.dirname(__file__), "..", "data")
RECS_PATH = os.path.join(DATA_DIR, "recommendations.json")

# Sector tags for each ticker (manually curated for messaging)
SECTOR_MAP = {
    "ADANIENT.NS":   "Conglomerate / Infra",
    "BEL.NS":        "Defence Electronics",
    "CAMS.NS":       "Fintech / Mutual Fund Infra",
    "CGPOWER.NS":    "Power / Industrial",
    "COFORGE.NS":    "IT Services",
    "CYIENT.NS":     "Engineering IT",
    "DATAPATTNS.NS": "Defence Electronics",
    "DELHIVERY.NS":  "Logistics / E-Commerce",
    "EIDPARRY.NS":   "Sugar / Agro",
    "GEOJITFSL.NS":  "Broking / Wealth Mgmt",
    "IDFCFIRSTB.NS": "Banking / NBFC",
    "IEX.NS":        "Power Exchange",
    "KAYNES.NS":     "Electronics / EMS",
    "OLAELEC.NS":    "EV / Two-Wheelers",
    "PARAS.NS":      "Defence & Space",
    "PVRINOX.NS":    "Entertainment / Multiplex",
    "RAYMONDLSL.NS": "Real Estate / Lifestyle",
    "RELIANCE.NS":   "Energy / Retail / Telecom",
    "SPMLINFRA.NS":  "Infra / Water",
    "TMCV.NS":       "Commercial Vehicles",
    "TMPV.NS":       "Passenger Vehicles",
    "RECLTD.NS":     "Power Finance",
    "SHAKTIPUMP.NS": "Solar Pumps / Water",
    "TATACAPITAL.NS":"NBFC / Tata Group",
    "BANDHANBNK.NS": "Banking / Microfinance",
    "TEJASNET.NS":   "Telecom Networking",
    "CONTROLPR.NS":  "Power Electronics",
    "MOSCHIP.NS":    "Semiconductors / Chips",
    "SWIGGY.NS":     "Quick Commerce / Food Tech",
}


def _score(ta: dict, current_price: float, avg_buy: float) -> tuple[int, list]:
    score   = 0
    signals = []

    # RSI
    rsi = ta.get("rsi")
    if rsi is not None:
        if rsi < 30:
            score += 2
            signals.append(f"RSI {rsi} — deeply oversold, high reward zone")
        elif rsi < 45:
            score += 1
            signals.append(f"RSI {rsi} — recovering, watch for reversal")
        elif rsi > 70:
            score -= 1
            signals.append(f"RSI {rsi} — overbought, wait for pullback")

    # MACD
    macd = ta.get("macd_signal", "")
    if "Bullish crossover" in macd:
        score += 2; signals.append("MACD bullish crossover — strong buy signal")
    elif "Bullish" in macd:
        score += 1; signals.append("MACD bullish — momentum building")
    elif "Bearish crossover" in macd:
        score -= 2; signals.append("MACD bearish crossover — caution")
    elif "Bearish" in macd:
        score -= 1; signals.append("MACD bearish — weak momentum")

    # MA trend
    trend = ta.get("trend", "")
    if trend == "UPTREND":
        score += 2; signals.append("Price above 50MA & 200MA — UPTREND intact")
    elif trend == "DOWNTREND":
        score -= 2; signals.append("Price below 50MA & 200MA — DOWNTREND")
    elif trend == "SIDEWAYS":
        signals.append("SIDEWAYS — accumulation possible")

    # Bollinger Bands
    bb = ta.get("bb_signal", "")
    if "Below lower" in bb:
        score += 1; signals.append("Near lower Bollinger Band — oversold extension")
    elif "Above upper" in bb:
        score -= 1; signals.append("Near upper Bollinger Band — overbought")

    # Distance from cost basis (10-year lens)
    pct = (current_price - avg_buy) / avg_buy * 100
    if pct < -40:
        score += 2; signals.append(f"Down {pct:.0f}% from cost — deep value, review thesis")
    elif pct < -20:
        score += 1; signals.append(f"Down {pct:.0f}% from cost — discounted entry zone")
    elif pct > 100:
        score -= 1; signals.append(f"Up {pct:.0f}% from cost — consider partial booking at 2x+")
    elif pct > 200:
        score -= 2; signals.append(f"Up {pct:.0f}% from cost — strong booking candidate")

    return score, signals


def _action(score: int) -> str:
    if score >= 4:   return "STRONG ACCUMULATE"
    if score >= 2:   return "ACCUMULATE ON DIPS"
    if score >= 0:   return "HOLD"
    if score >= -2:  return "HOLD / MONITOR CLOSELY"
    return "REVIEW INVESTMENT THESIS"


def _action_emoji(action: str) -> str:
    return {
        "STRONG ACCUMULATE":       "🟢",
        "ACCUMULATE ON DIPS":      "🔵",
        "HOLD":                    "⚪",
        "HOLD / MONITOR CLOSELY":  "🟡",
        "REVIEW INVESTMENT THESIS":"🔴",
    }.get(action, "⚪")


def run() -> None:
    holdings = load_portfolio()
    now_ist  = datetime.now(IST)
    ts       = now_ist.strftime("%d %b %Y %H:%M IST")
    log.info("Running recommendation agent at %s", ts)

    recs = []
    for h in holdings:
        ticker = h["ticker"]
        price  = get_price(ticker)
        if price is None:
            log.warning("No price for %s — skipped", ticker)
            continue

        ta             = analyze(ticker)
        score, signals = _score(ta, price, h["avg_buy_price"])
        invested       = h["qty"] * h["avg_buy_price"]
        current_val    = h["qty"] * price
        action         = _action(score)

        recs.append({
            "ticker":         ticker,
            "display":        ticker.replace(".NS", "").replace(".BO", ""),
            "sector":         SECTOR_MAP.get(ticker, "—"),
            "qty":            h["qty"],
            "avg_buy_price":  h["avg_buy_price"],
            "current_price":  round(price, 2),
            "pnl_pct":        round((price - h["avg_buy_price"]) / h["avg_buy_price"] * 100, 2),
            "invested":       round(invested, 2),
            "current_value":  round(current_val, 2),
            "momentum_score": score,
            "action":         action,
            "action_emoji":   _action_emoji(action),
            "signals":        signals,
            "rsi":            ta.get("rsi"),
            "trend":          ta.get("trend"),
            "macd":           ta.get("macd_signal"),
        })

    recs.sort(key=lambda x: x["momentum_score"], reverse=True)

    total_invested  = sum(r["invested"]      for r in recs)
    total_current   = sum(r["current_value"] for r in recs)

    data = {
        "timestamp":       now_ist.isoformat(),
        "total_invested":  round(total_invested, 2),
        "total_current":   round(total_current, 2),
        "recommendations": recs,
        "top_buys":        [r for r in recs if "ACCUMULATE" in r["action"]][:5],
        "review_list":     [r for r in recs if "REVIEW" in r["action"]],
        "investment_note": (
            "Long-term view (10yr horizon): focus on business quality, not short-term price. "
            "Use dips as accumulation opportunities for high-conviction holdings. "
            "Technical signals are secondary to fundamental thesis."
        ),
    }

    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = RECS_PATH + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, RECS_PATH)
    log.info("Saved recommendations → %s", RECS_PATH)

    msg = _format_telegram(data, ts)
    send_console(msg)
    send_telegram(msg)


def _format_telegram(data: dict, ts: str) -> str:
    lines = [f"💡 *WEEKLY RECOMMENDATIONS | {ts}*", ""]

    top_buys = data.get("top_buys", [])
    if top_buys:
        lines.append("✅ *Accumulate on Dips*")
        for r in top_buys[:5]:
            lines.append(
                f"{r['action_emoji']} *{r['display']}* ({r['sector']})"
            )
            lines.append(f"  Score: {r['momentum_score']:+d} | {r['trend'] or 'N/A'} | P&L: {r['pnl_pct']:+.1f}%")
            for sig in r["signals"][:2]:
                lines.append(f"  _{sig}_")
        lines.append("")

    review_list = data.get("review_list", [])
    if review_list:
        lines.append("⚠️ *Review Thesis*")
        for r in review_list[:5]:
            lines.append(
                f"🔴 *{r['display']}* — {r['pnl_pct']:+.1f}% | {r['trend'] or 'N/A'} | {r['sector']}"
            )
        lines.append("")

    lines += [
        "─────────────────────────",
        "_📌 10-yr lens: Dips = opportunity, not panic._",
        "_Validate technicals with business fundamentals._",
        "_This is not SEBI-registered financial advice._",
    ]

    return "\n".join(lines)[:4096]


if __name__ == "__main__":
    _log_file = RotatingFileHandler("agent.log", maxBytes=10 * 1024 * 1024, backupCount=3)
    _log_file.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s: %(message)s",
        handlers=[logging.StreamHandler(), _log_file],
    )
    run()
