import pytest
import src.threshold_monitor as tm


@pytest.fixture(autouse=True)
def temp_state(tmp_path, monkeypatch):
    monkeypatch.setattr(tm, "STATE_PATH", str(tmp_path / "alert_state.json"))


def test_no_alert_when_price_above_cost():
    should_alert, _, _ = tm.check("AAPL", 110, 100)
    assert not should_alert


def test_no_alert_at_zero_change():
    should_alert, _, _ = tm.check("AAPL", 100, 100)
    assert not should_alert


def test_alert_at_5pct_drop():
    should_alert, band, _ = tm.check("AAPL", 94, 100)
    assert should_alert
    assert band == -5


def test_alert_at_exactly_10pct():
    should_alert, band, _ = tm.check("AAPL", 90, 100)
    assert should_alert
    assert band == -10


def test_no_repeat_alert_same_band():
    tm.check("AAPL", 94, 100)           # crosses -5%
    should_alert, _, _ = tm.check("AAPL", 93, 100)   # still in -5% band
    assert not should_alert


def test_alert_fires_on_next_band():
    tm.check("AAPL", 94, 100)           # -5% band
    should_alert, band, _ = tm.check("AAPL", 89, 100)  # crosses -10% band
    assert should_alert
    assert band == -10


def test_reset_ticker_rearms_alert():
    tm.check("AAPL", 94, 100)
    tm.reset_ticker("AAPL")
    should_alert, _, _ = tm.check("AAPL", 94, 100)
    assert should_alert


def test_reset_all_rearms_all():
    tm.check("AAPL", 94, 100)
    tm.check("TSLA", 85, 100)
    tm.reset_all()
    a1, _, _ = tm.check("AAPL", 94, 100)
    a2, _, _ = tm.check("TSLA", 85, 100)
    assert a1 and a2


def test_band_floors_correctly():
    _, band, _ = tm.check("AAPL", 87, 100)   # -13% → floor(-13/5)*5 = -15
    assert band == -15


def test_pct_change_accuracy():
    _, _, pct = tm.check("RELIANCE", 2520, 2800)
    assert abs(pct - (-10.0)) < 0.01


def test_independent_tickers_tracked_separately():
    tm.check("AAPL", 94, 100)    # AAPL at -5%
    should_alert, band, _ = tm.check("TSLA", 94, 100)  # TSLA first check — should alert
    assert should_alert
    assert band == -5
