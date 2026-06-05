from unittest.mock import patch, MagicMock
import src.notifier as notifier

_ANALYSIS = {
    "rsi": 29.8,
    "rsi_signal": "OVERSOLD",
    "macd_signal": "Bearish crossover",
    "sma50": 2640.0,
    "sma200": 2710.0,
    "trend": "DOWNTREND",
    "bb_signal": "Below lower band (oversold extension)",
    "support": 2480.0,
    "bars": 200,
}


def _make_alert(**kwargs):
    defaults = dict(
        ticker="RELIANCE.NS",
        exchange="NSE",
        currency="INR",
        current_price=2516.80,
        avg_buy_price=2800.00,
        pct_change=-10.11,
        band=-10,
        analysis=_ANALYSIS,
    )
    return notifier.format_alert(**{**defaults, **kwargs})


def test_format_alert_contains_ticker():
    assert "RELIANCE.NS" in _make_alert()


def test_format_alert_inr_symbol():
    assert "₹" in _make_alert()


def test_format_alert_usd_symbol():
    msg = _make_alert(ticker="TSLA", exchange="NASDAQ", currency="USD",
                      current_price=187.2, avg_buy_price=220.0, pct_change=-14.91, band=-15)
    assert "$" in msg
    assert "₹" not in msg


def test_format_alert_shows_band():
    assert "-10%" in _make_alert()


def test_format_alert_shows_rsi():
    assert "29.8" in _make_alert()
    assert "OVERSOLD" in _make_alert()


def test_format_alert_next_band():
    assert "Next alert at -15%" in _make_alert()


def test_format_alert_under_4096_chars():
    assert len(_make_alert()) <= 4096


def test_format_alert_no_rsi_when_none():
    analysis = {**_ANALYSIS, "rsi": None, "rsi_signal": "N/A"}
    msg = _make_alert(analysis=analysis)
    assert "N/A" in msg


@patch("src.notifier.requests.post")
def test_send_telegram_success(mock_post):
    mock_post.return_value = MagicMock(status_code=200)

    with patch("src.notifier._bot_token", return_value="tok"), \
         patch("src.notifier._chat_id", return_value="123"):
        assert notifier.send_telegram("hello") is True


@patch("src.notifier.requests.post")
def test_send_telegram_retries_on_failure(mock_post):
    mock_post.return_value = MagicMock(status_code=500, text="error")

    with patch("src.notifier._bot_token", return_value="tok"), \
         patch("src.notifier._chat_id", return_value="123"):
        result = notifier.send_telegram("hello")

    assert result is False
    assert mock_post.call_count == 2   # retried once


def test_send_telegram_returns_false_with_no_config():
    with patch("src.notifier._bot_token", return_value=""), \
         patch("src.notifier._chat_id", return_value=""):
        assert notifier.send_telegram("hello") is False
