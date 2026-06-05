import logging
import os
from typing import Dict, Any

import requests
import yaml

log = logging.getLogger(__name__)

_CONFIG_PATH = os.path.join(os.path.dirname(__file__), "..", "config.yaml")


def _load_config() -> Dict:
    with open(_CONFIG_PATH) as f:
        return yaml.safe_load(f)


def _bot_token() -> str:
    return os.environ.get("TELEGRAM_BOT_TOKEN") or _load_config().get("telegram", {}).get("bot_token", "")


def _chat_id() -> str:
    return os.environ.get("TELEGRAM_CHAT_ID") or _load_config().get("telegram", {}).get("chat_id", "")


def send_telegram(message: str) -> bool:
    token = _bot_token()
    chat  = _chat_id()

    if not token or not chat:
        log.error("Telegram not configured — set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID")
        return False

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    for attempt in range(2):
        try:
            resp = requests.post(url, json={
                "chat_id":    chat,
                "text":       message[:4096],
                "parse_mode": "Markdown",
            }, timeout=10)
            if resp.status_code == 200:
                log.info("Telegram alert sent successfully")
                return True
            log.warning("Telegram returned HTTP %d: %s", resp.status_code, resp.text[:200])
        except requests.RequestException as e:
            log.warning("Telegram send attempt %d failed: %s", attempt + 1, e)

    return False


def send_console(message: str) -> None:
    print("\n" + "=" * 60)
    print(message)
    print("=" * 60 + "\n")


def format_alert(
    ticker: str,
    exchange: str,
    currency: str,
    current_price: float,
    avg_buy_price: float,
    pct_change: float,
    band: int,
    analysis: Dict[str, Any],
) -> str:
    sym = "₹" if currency == "INR" else "$"
    next_band = band - 5
    next_price = avg_buy_price * (1 + next_band / 100)

    rsi_line = (
        f"RSI(14)  : {analysis['rsi']} — {analysis['rsi_signal']}"
        if analysis.get("rsi") is not None else "RSI(14)  : N/A"
    )

    s50, s200 = analysis.get("sma50"), analysis.get("sma200")
    if s50 and s200:
        trend_line = f"Trend    : {analysis['trend']} (50MA {sym}{s50:,.2f} & 200MA {sym}{s200:,.2f})"
    elif s50:
        trend_line = f"Trend    : {analysis['trend']} (50MA {sym}{s50:,.2f})"
    else:
        trend_line = f"Trend    : {analysis['trend']}"

    lines = [
        f"🔴 *ALERT | {ticker} | {exchange}*",
        f"Crossed *{band}% band*",
        "",
        f"Price    : `{sym}{current_price:,.2f}`",
        f"Avg Cost : `{sym}{avg_buy_price:,.2f}`",
        f"Change   : *{pct_change:.2f}%*",
        "",
        rsi_line,
        f"MACD     : {analysis['macd_signal']}",
        trend_line,
        f"BB       : {analysis['bb_signal']}",
    ]

    if analysis.get("support") is not None:
        lines.append(f"Support  : {sym}{analysis['support']:,.2f} (52-wk low)")

    lines += ["", f"Next alert at {next_band}% (`{sym}{next_price:,.2f}`)"]

    return "\n".join(lines)


def dispatch(message: str) -> None:
    config = _load_config()
    notifs = config.get("notifications", {})

    if notifs.get("console", True):
        send_console(message)

    if notifs.get("telegram", True):
        send_telegram(message)
