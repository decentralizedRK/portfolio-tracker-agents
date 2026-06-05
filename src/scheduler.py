import logging
import os
import time
from datetime import datetime

import pytz
import yaml

from .exchange_calendar import is_open, next_open_ist, exchange_for_ticker
from .price_fetcher import get_price
from .threshold_monitor import check as check_threshold
from .technical_analyzer import analyze
from .notifier import format_alert, dispatch
from . import portfolio as portfolio_module

log = logging.getLogger(__name__)

IST = pytz.timezone("Asia/Kolkata")

_CONFIG_PATH = os.path.join(os.path.dirname(__file__), "..", "config.yaml")


def _load_config() -> dict:
    with open(_CONFIG_PATH) as f:
        return yaml.safe_load(f)


def _check_holding(holding: dict) -> None:
    ticker   = holding["ticker"]
    exchange = exchange_for_ticker(ticker)

    if not is_open(exchange):
        log.debug("%s market is closed — skipping %s", exchange, ticker)
        return

    price = get_price(ticker)
    if price is None:
        log.warning("Could not fetch price for %s", ticker)
        return

    avg_price = holding["avg_buy_price"]
    currency  = holding["currency"]

    should_alert, band, pct_change = check_threshold(ticker, price, avg_price)

    if should_alert:
        log.info("Alert triggered: %s band=%d%% pct=%.2f%%", ticker, band, pct_change)
        analysis = analyze(ticker)
        message  = format_alert(ticker, exchange, currency, price, avg_price, pct_change, band, analysis)
        dispatch(message)


def run_once() -> None:
    holdings = portfolio_module.load()
    for holding in holdings:
        try:
            _check_holding(holding)
        except Exception as e:
            log.error("Error checking %s: %s", holding.get("ticker"), e, exc_info=True)


def run() -> None:
    config   = _load_config()
    interval = config.get("scheduler", {}).get("interval_minutes", 5) * 60

    log.info("Stock monitor started — polling every %d min", interval // 60)

    while True:
        now_ist = datetime.now(IST).strftime("%H:%M IST")
        nse_open  = is_open("NSE")
        nyse_open = is_open("NYSE")

        if nse_open or nyse_open:
            open_markets = [m for m, o in [("NSE", nse_open), ("NYSE", nyse_open)] if o]
            log.info("[%s] Open markets: %s — running checks", now_ist, ", ".join(open_markets))
            run_once()
        else:
            log.info(
                "[%s] All markets closed. Next: NSE @ %s | NYSE @ %s",
                now_ist, next_open_ist("NSE"), next_open_ist("NYSE"),
            )

        time.sleep(interval)
