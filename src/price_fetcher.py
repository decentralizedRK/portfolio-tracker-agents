import logging
import time as time_module
from typing import Optional

import yfinance as yf

log = logging.getLogger(__name__)


def _fetch_yfinance(ticker: str) -> Optional[float]:
    try:
        t = yf.Ticker(ticker)
        price = t.fast_info.get("last_price") or t.fast_info.get("lastPrice")
        if price and float(price) > 0:
            return float(price)
    except Exception as e:
        log.warning("yfinance fetch failed for %s: %s", ticker, e)
    return None


def _fetch_tvdatafeed(ticker: str) -> Optional[float]:
    try:
        from tvdatafeed import TvDatafeed, Interval

        if ticker.endswith(".NS"):
            symbol, exchange = ticker[:-3], "NSE"
        elif ticker.endswith(".BO"):
            symbol, exchange = ticker[:-3], "BSE"
        else:
            symbol, exchange = ticker, "NASDAQ"

        tv = TvDatafeed()
        data = tv.get_hist(symbol, exchange, interval=Interval.in_1_minute, n_bars=1)
        if data is not None and not data.empty:
            return float(data["close"].iloc[-1])
    except Exception as e:
        log.warning("tvdatafeed fetch failed for %s: %s", ticker, e)
    return None


def get_price(ticker: str) -> Optional[float]:
    """Fetch latest price. Tries yfinance first, falls back to tvdatafeed."""
    price = _fetch_yfinance(ticker)
    if price is not None:
        log.debug("yfinance price for %s: %.2f", ticker, price)
        return price

    log.info("yfinance failed for %s — trying tvdatafeed", ticker)
    time_module.sleep(1)
    price = _fetch_tvdatafeed(ticker)
    if price is not None:
        log.debug("tvdatafeed price for %s: %.2f", ticker, price)
        return price

    log.error("All price sources failed for %s", ticker)
    return None


def get_history(ticker: str, period: str = "1y") -> Optional[object]:
    """Fetch daily OHLCV history for indicator calculations."""
    try:
        hist = yf.Ticker(ticker).history(period=period)
        if not hist.empty:
            return hist
    except Exception as e:
        log.warning("yfinance history failed for %s: %s", ticker, e)
    return None
