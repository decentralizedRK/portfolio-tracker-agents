import logging
from typing import Dict, Any

import ta

from .price_fetcher import get_history

log = logging.getLogger(__name__)

_EMPTY = {
    "rsi": None,
    "rsi_signal": "N/A",
    "macd_signal": "N/A",
    "sma50": None,
    "sma200": None,
    "trend": "N/A",
    "bb_signal": "N/A",
    "support": None,
    "bars": 0,
}


def analyze(ticker: str) -> Dict[str, Any]:
    """Return technical indicators for the given ticker."""
    hist = get_history(ticker, period="1y")

    if hist is None or len(hist) < 50:
        bars = 0 if hist is None else len(hist)
        log.warning("Insufficient history for %s (%d bars) — skipping indicators", ticker, bars)
        return {**_EMPTY, "bars": bars}

    result = {**_EMPTY, "bars": len(hist)}
    close = hist["Close"]

    # RSI
    try:
        rsi_series = ta.momentum.RSIIndicator(close, window=14).rsi()
        if not rsi_series.dropna().empty:
            rsi = round(float(rsi_series.iloc[-1]), 1)
            result["rsi"] = rsi
            result["rsi_signal"] = (
                "OVERSOLD" if rsi < 30 else "OVERBOUGHT" if rsi > 70 else "neutral"
            )
    except Exception as e:
        log.warning("RSI calculation failed for %s: %s", ticker, e)

    # MACD
    try:
        macd_ind = ta.trend.MACD(close, window_slow=26, window_fast=12, window_sign=9)
        macd_line   = macd_ind.macd()
        signal_line = macd_ind.macd_signal()
        if not macd_line.dropna().empty:
            m_now, m_prev = macd_line.iloc[-1], macd_line.iloc[-2]
            s_now, s_prev = signal_line.iloc[-1], signal_line.iloc[-2]
            if m_prev <= s_prev and m_now > s_now:
                result["macd_signal"] = "Bullish crossover"
            elif m_prev >= s_prev and m_now < s_now:
                result["macd_signal"] = "Bearish crossover"
            elif m_now > s_now:
                result["macd_signal"] = "Bullish (above signal)"
            else:
                result["macd_signal"] = "Bearish (below signal)"
    except Exception as e:
        log.warning("MACD calculation failed for %s: %s", ticker, e)

    # SMA 50
    try:
        sma50 = ta.trend.SMAIndicator(close, window=50).sma_indicator()
        if not sma50.dropna().empty:
            result["sma50"] = round(float(sma50.iloc[-1]), 2)
    except Exception as e:
        log.warning("SMA50 failed for %s: %s", ticker, e)

    # SMA 200
    if len(close) >= 200:
        try:
            sma200 = ta.trend.SMAIndicator(close, window=200).sma_indicator()
            if not sma200.dropna().empty:
                result["sma200"] = round(float(sma200.iloc[-1]), 2)
        except Exception as e:
            log.warning("SMA200 failed for %s: %s", ticker, e)

    # Trend from MA alignment
    price = float(close.iloc[-1])
    s50, s200 = result["sma50"], result["sma200"]
    if s50 and s200:
        result["trend"] = (
            "UPTREND"   if price > s50 > s200 else
            "DOWNTREND" if price < s50 < s200 else
            "SIDEWAYS"
        )
    elif s50:
        result["trend"] = "UPTREND" if price > s50 else "DOWNTREND"

    # Bollinger Bands
    try:
        bb = ta.volatility.BollingerBands(close, window=20, window_dev=2)
        lower = float(bb.bollinger_lband().iloc[-1])
        upper = float(bb.bollinger_hband().iloc[-1])
        result["bb_signal"] = (
            "Below lower band (oversold extension)" if price < lower else
            "Above upper band (overbought extension)" if price > upper else
            "Inside bands"
        )
    except Exception as e:
        log.warning("Bollinger Bands failed for %s: %s", ticker, e)

    # Support: 52-week low
    result["support"] = round(float(close.min()), 2)

    return result
