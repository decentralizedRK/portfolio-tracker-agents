import json
import os
from typing import List, Dict

PORTFOLIO_PATH = os.path.join(os.path.dirname(__file__), "..", "portfolio.json")

_REQUIRED_FIELDS = {"ticker", "qty", "avg_buy_price", "currency"}
_VALID_CURRENCIES = {"INR", "USD"}


def load() -> List[Dict]:
    with open(PORTFOLIO_PATH) as f:
        data = json.load(f)
    holdings = data.get("holdings", [])
    valid = []
    for h in holdings:
        missing = _REQUIRED_FIELDS - h.keys()
        if missing:
            raise ValueError(f"Holding {h} missing fields: {missing}")
        if h["currency"] not in _VALID_CURRENCIES:
            raise ValueError(f"Invalid currency '{h['currency']}' for {h['ticker']}")
        if h["avg_buy_price"] <= 0:
            raise ValueError(f"avg_buy_price must be > 0 for {h['ticker']}")
        if h["qty"] > 0:
            valid.append(h)
    return valid


def save(holdings: List[Dict]) -> None:
    with open(PORTFOLIO_PATH, "w") as f:
        json.dump({"holdings": holdings}, f, indent=2)


def add_holding(ticker: str, qty: float, avg_buy_price: float) -> None:
    ticker = ticker.upper()
    currency = "INR" if ticker.endswith((".NS", ".BO")) else "USD"
    holdings = load()
    for h in holdings:
        if h["ticker"] == ticker:
            h["qty"] = qty
            h["avg_buy_price"] = avg_buy_price
            save(holdings)
            return
    holdings.append({
        "ticker": ticker,
        "qty": qty,
        "avg_buy_price": avg_buy_price,
        "currency": currency,
    })
    save(holdings)


def remove_holding(ticker: str) -> bool:
    ticker = ticker.upper()
    holdings = load()
    new_holdings = [h for h in holdings if h["ticker"] != ticker]
    if len(new_holdings) == len(holdings):
        return False
    save(new_holdings)
    return True
