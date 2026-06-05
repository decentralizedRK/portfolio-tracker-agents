import logging
from datetime import datetime, time, timedelta

import pytz
import pandas_market_calendars as mcal

log = logging.getLogger(__name__)

_TZ = {
    "NSE":    pytz.timezone("Asia/Kolkata"),
    "BSE":    pytz.timezone("Asia/Kolkata"),
    "NYSE":   pytz.timezone("America/New_York"),
    "NASDAQ": pytz.timezone("America/New_York"),
}

_HOURS = {
    "NSE":    (time(9, 15),  time(15, 30)),
    "BSE":    (time(9, 15),  time(15, 30)),
    "NYSE":   (time(9, 30),  time(16, 0)),
    "NASDAQ": (time(9, 30),  time(16, 0)),
}

# pandas_market_calendars identifiers
_CAL_ID = {
    "NSE":    "XBOM",
    "BSE":    "XBOM",
    "NYSE":   "NYSE",
    "NASDAQ": "NYSE",
}

IST = pytz.timezone("Asia/Kolkata")


def _calendar(exchange: str):
    return mcal.get_calendar(_CAL_ID[exchange])


def is_open(exchange: str) -> bool:
    exchange = exchange.upper()
    tz = _TZ[exchange]
    open_t, close_t = _HOURS[exchange]
    now = datetime.now(tz)
    today_str = now.strftime("%Y-%m-%d")

    try:
        schedule = _calendar(exchange).schedule(start_date=today_str, end_date=today_str)
        if schedule.empty:
            return False
    except Exception as e:
        log.warning("Holiday calendar check failed for %s (%s) — falling back to weekday check", exchange, e)
        if now.weekday() >= 5:
            return False

    return open_t <= now.time() <= close_t


def next_open_ist(exchange: str) -> str:
    """Return next market open time as a human-readable IST string."""
    exchange = exchange.upper()
    tz = _TZ[exchange]
    open_t, _ = _HOURS[exchange]
    now = datetime.now(tz)

    candidate = now.replace(hour=open_t.hour, minute=open_t.minute, second=0, microsecond=0)
    if now.time() >= open_t:
        candidate += timedelta(days=1)

    for _ in range(10):
        day_str = candidate.strftime("%Y-%m-%d")
        try:
            schedule = _calendar(exchange).schedule(start_date=day_str, end_date=day_str)
            if not schedule.empty:
                break
        except Exception:
            if candidate.weekday() < 5:
                break
        candidate += timedelta(days=1)

    return candidate.astimezone(IST).strftime("%d %b %Y %H:%M IST")


def exchange_for_ticker(ticker: str) -> str:
    if ticker.endswith(".NS"):
        return "NSE"
    if ticker.endswith(".BO"):
        return "BSE"
    return "NYSE"
