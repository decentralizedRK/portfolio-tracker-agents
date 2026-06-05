from unittest.mock import patch, MagicMock
from datetime import time

import pandas as pd
import src.exchange_calendar as cal


def test_ticker_suffix_nse():
    assert cal.exchange_for_ticker("RELIANCE.NS") == "NSE"


def test_ticker_suffix_bse():
    assert cal.exchange_for_ticker("INFY.BO") == "BSE"


def test_ticker_no_suffix_is_nyse():
    assert cal.exchange_for_ticker("AAPL") == "NYSE"
    assert cal.exchange_for_ticker("TSLA") == "NYSE"
    assert cal.exchange_for_ticker("NVDA") == "NYSE"


@patch("src.exchange_calendar._calendar")
def test_is_open_returns_false_on_holiday(mock_cal):
    instance = MagicMock()
    instance.schedule.return_value = pd.DataFrame()   # empty → holiday
    mock_cal.return_value = instance

    with patch("src.exchange_calendar.datetime") as mock_dt:
        now = MagicMock()
        now.time.return_value = time(11, 0)
        now.strftime.return_value = "2024-01-15"
        mock_dt.now.return_value = now

        assert not cal.is_open("NSE")


@patch("src.exchange_calendar._calendar")
def test_is_open_returns_false_before_market_open(mock_cal):
    instance = MagicMock()
    instance.schedule.return_value = pd.DataFrame({"open": [1]})  # trading day
    mock_cal.return_value = instance

    with patch("src.exchange_calendar.datetime") as mock_dt:
        now = MagicMock()
        now.time.return_value = time(8, 0)   # before NSE open (09:15)
        now.strftime.return_value = "2024-01-15"
        mock_dt.now.return_value = now

        assert not cal.is_open("NSE")


@patch("src.exchange_calendar._calendar")
def test_is_open_returns_false_after_market_close(mock_cal):
    instance = MagicMock()
    instance.schedule.return_value = pd.DataFrame({"open": [1]})
    mock_cal.return_value = instance

    with patch("src.exchange_calendar.datetime") as mock_dt:
        now = MagicMock()
        now.time.return_value = time(16, 30)  # after NSE close (15:30)
        now.strftime.return_value = "2024-01-15"
        mock_dt.now.return_value = now

        assert not cal.is_open("NSE")


@patch("src.exchange_calendar._calendar")
def test_is_open_returns_true_during_hours(mock_cal):
    instance = MagicMock()
    instance.schedule.return_value = pd.DataFrame({"open": [1]})
    mock_cal.return_value = instance

    with patch("src.exchange_calendar.datetime") as mock_dt:
        now = MagicMock()
        now.time.return_value = time(11, 0)   # during NSE hours
        now.strftime.return_value = "2024-01-15"
        mock_dt.now.return_value = now

        assert cal.is_open("NSE")
