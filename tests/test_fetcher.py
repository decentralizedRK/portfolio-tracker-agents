from unittest.mock import patch, MagicMock
import src.price_fetcher as fetcher


def test_yfinance_returns_price():
    mock_ticker = MagicMock()
    mock_ticker.fast_info = {"last_price": 2500.75}

    with patch("src.price_fetcher.yf.Ticker", return_value=mock_ticker):
        price = fetcher._fetch_yfinance("RELIANCE.NS")

    assert price == 2500.75


def test_yfinance_returns_none_for_zero():
    mock_ticker = MagicMock()
    mock_ticker.fast_info = {"last_price": 0}

    with patch("src.price_fetcher.yf.Ticker", return_value=mock_ticker):
        price = fetcher._fetch_yfinance("RELIANCE.NS")

    assert price is None


def test_yfinance_returns_none_on_exception():
    with patch("src.price_fetcher.yf.Ticker", side_effect=Exception("network error")):
        price = fetcher._fetch_yfinance("AAPL")

    assert price is None


def test_get_price_uses_yfinance_first():
    with patch("src.price_fetcher._fetch_yfinance", return_value=185.5) as mock_yf, \
         patch("src.price_fetcher._fetch_tvdatafeed") as mock_tv:
        price = fetcher.get_price("AAPL")

    assert price == 185.5
    mock_tv.assert_not_called()


def test_get_price_falls_back_to_tvdatafeed():
    with patch("src.price_fetcher._fetch_yfinance", return_value=None), \
         patch("src.price_fetcher._fetch_tvdatafeed", return_value=185.5), \
         patch("src.price_fetcher.time_module.sleep"):
        price = fetcher.get_price("AAPL")

    assert price == 185.5


def test_get_price_returns_none_when_all_fail():
    with patch("src.price_fetcher._fetch_yfinance", return_value=None), \
         patch("src.price_fetcher._fetch_tvdatafeed", return_value=None), \
         patch("src.price_fetcher.time_module.sleep"):
        price = fetcher.get_price("AAPL")

    assert price is None
