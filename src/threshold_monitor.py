import json
import logging
import math
import os
from typing import Tuple

log = logging.getLogger(__name__)

STATE_PATH = os.path.join(os.path.dirname(__file__), "..", "alert_state.json")
THRESHOLD_STEP = 5


def load_state() -> dict:
    try:
        with open(STATE_PATH) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_state(state: dict) -> None:
    tmp = STATE_PATH + ".tmp"
    with open(tmp, "w") as f:
        json.dump(state, f, indent=2)
    os.replace(tmp, STATE_PATH)


def reset_ticker(ticker: str) -> None:
    state = load_state()
    state.pop(ticker, None)
    save_state(state)


def reset_all() -> None:
    save_state({})


def check(ticker: str, current_price: float, avg_buy_price: float) -> Tuple[bool, int, float]:
    """
    Returns (should_alert, band, pct_change).
    band is the 5% step just crossed (e.g. -10 means the -10% threshold was breached).
    Alerts only on downside, once per band per day.
    """
    pct_change = (current_price - avg_buy_price) / avg_buy_price * 100
    band = math.floor(pct_change / THRESHOLD_STEP) * THRESHOLD_STEP

    if band >= 0:
        return False, band, pct_change

    state = load_state()
    last_band = state.get(ticker, 0)

    if band < last_band:
        state[ticker] = band
        save_state(state)
        log.info("%s crossed %d%% band (%.2f%% from cost basis)", ticker, band, pct_change)
        return True, band, pct_change

    return False, band, pct_change
