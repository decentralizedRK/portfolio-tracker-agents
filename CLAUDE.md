# Stock Technical Analysis Agent — Indian & US Markets

## Overview

This agent monitors a personal stock portfolio across **Indian (NSE/BSE)** and **US (NYSE/NASDAQ)** exchanges. It performs technical analysis and fires a **Telegram alert** every time a holding drops below a new 5% threshold from the user's average buy price (−5%, −10%, −15%, …). Prices are shown in ₹ for Indian stocks and $ for US stocks.

---

## Goals

1. Track the user's portfolio with exchange-aware tickers and currencies (INR / USD).
2. Fetch live prices from Yahoo Finance (`yfinance`) and TradingView (`tvdatafeed`) — no paid API required.
3. Detect each new 5% downside band crossed and alert exactly once per band per trading day.
4. Attach a technical analysis snapshot (RSI, MACD, MAs, Bollinger Bands, support level) to every alert.
5. Deliver alerts to **Telegram** using the free Bot API (create a bot in 60 seconds via @BotFather — no approval, no fees).
6. Respect each exchange's market hours and holiday calendar before polling.

---

## Exchange Reference

| Exchange | Country | Ticker Suffix | Currency | Market Hours (local) | IST Equivalent |
|----------|---------|---------------|----------|----------------------|----------------|
| NSE      | India   | `.NS`         | INR (₹)  | 09:15 – 15:30        | 09:15 – 15:30 IST |
| BSE      | India   | `.BO`         | INR (₹)  | 09:15 – 15:30        | 09:15 – 15:30 IST |
| NYSE     | US      | *(none)*      | USD ($)  | 09:30 – 16:00 ET     | 19:00 – 01:30 IST |
| NASDAQ   | US      | *(none)*      | USD ($)  | 09:30 – 16:00 ET     | 19:00 – 01:30 IST |

---

## Architecture

```
portfolio.json
     │
     ▼
exchange_calendar.py    ← is NSE / NYSE open right now? (pytz + pandas_market_calendars)
     │
     ▼
price_fetcher.py        ← yfinance primary, tvdatafeed fallback
     │                     .NS/.BO → NSE/BSE path | no suffix → US path
     ▼
threshold_monitor.py    ← % drop from avg_buy_price, 5% band detection
     │                     persists state to alert_state.json
     ▼
technical_analyzer.py   ← RSI(14), MACD(12/26/9), SMA50/200, Bollinger Bands, support
     │
     ▼
notifier.py             ← Telegram Bot API + console fallback
     │
     ▼
scheduler.py            ← dual-market polling loop (NSE hours + NYSE hours)
```

---

## Portfolio Format

`portfolio.json` — user maintains this file:

```json
{
  "holdings": [
    { "ticker": "RELIANCE.NS", "qty": 15, "avg_buy_price": 2800.00, "currency": "INR" },
    { "ticker": "TCS.NS",      "qty": 10, "avg_buy_price": 3500.00, "currency": "INR" },
    { "ticker": "HDFCBANK.NS", "qty": 20, "avg_buy_price": 1650.00, "currency": "INR" },
    { "ticker": "INFY.BO",     "qty":  8, "avg_buy_price": 1400.00, "currency": "INR" },
    { "ticker": "AAPL",        "qty": 10, "avg_buy_price": 185.50,  "currency": "USD" },
    { "ticker": "TSLA",        "qty":  5, "avg_buy_price": 220.00,  "currency": "USD" },
    { "ticker": "NVDA",        "qty":  3, "avg_buy_price": 480.00,  "currency": "USD" }
  ]
}
```

**Ticker rules:**
- NSE stocks → `.NS` suffix (e.g., `WIPRO.NS`, `BAJFINANCE.NS`, `NIFTY50.NS`)
- BSE stocks → `.BO` suffix (e.g., `INFY.BO`, `SBIN.BO`)
- Nifty 50 index → `^NSEI` | Sensex → `^BSESN`
- US stocks → no suffix (`AAPL`, `MSFT`, `GOOGL`, `AMZN`)
- S&P 500 → `^GSPC` | NASDAQ Composite → `^IXIC`

Never mix INR and USD in the same calculation. Currency is always determined by the `currency` field.

---

## Data Sources

### Primary — Yahoo Finance (`yfinance`)
Covers both NSE/BSE (`.NS`/`.BO`) and US tickers natively. No API key required.

```python
import yfinance as yf

ticker = yf.Ticker("RELIANCE.NS")
price  = ticker.fast_info["last_price"]      # live delayed price in INR
hist   = ticker.history(period="1y")         # daily OHLCV for indicators

ticker = yf.Ticker("AAPL")
price  = ticker.fast_info["last_price"]      # live delayed price in USD
```

### Secondary — TradingView (`tvdatafeed`)
Unofficial Python wrapper around TradingView's public data API. No key for delayed data.

```python
from tvdatafeed import TvDatafeed, Interval
tv = TvDatafeed()  # anonymous — 15-min delayed

# Indian stock on NSE
data = tv.get_hist("RELIANCE", "NSE",    interval=Interval.in_5_minute, n_bars=200)
# Indian stock on BSE
data = tv.get_hist("INFY",     "BSE",    interval=Interval.in_5_minute, n_bars=200)
# US stock
data = tv.get_hist("AAPL",     "NASDAQ", interval=Interval.in_5_minute, n_bars=200)
data = tv.get_hist("JPM",      "NYSE",   interval=Interval.in_5_minute, n_bars=200)
```

### Indian-Specific Sources
| Library | Purpose |
|---------|---------|
| `nsepython` | NSE official JSON endpoints — live quotes, F&O data, holiday list |
| `jugaad-trader` | NSE/BSE live quotes without auth |

### Fallback Chain
```
yfinance  →  tvdatafeed  →  nsepython (Indian) / Alpha Vantage free tier (US)
```

---

## Telegram Alerts via Bot API

Telegram's Bot API is completely free, has no rate-limit fees, and works without any business account approval. Messages support Markdown formatting.

### One-Time Setup (user does this once)
1. Open Telegram and search for **@BotFather**.
2. Send `/newbot`, follow the prompts, and copy the **bot token** (format: `<BOT_ID>:<ALPHANUMERIC_SECRET>`).
3. Start a chat with your new bot, then visit:
   `https://api.telegram.org/bot<TOKEN>/getUpdates`
   Send any message to the bot first, then refresh — copy your **chat\_id** from the JSON response.
4. Store both in `.env`:
   ```
   TELEGRAM_BOT_TOKEN=<your_bot_token_here>
   TELEGRAM_CHAT_ID=<your_chat_id_here>
   ```

### API Call

```python
import requests

def send_telegram(bot_token: str, chat_id: str, message: str) -> bool:
    url  = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    resp = requests.post(url, json={
        "chat_id":    chat_id,
        "text":       message,
        "parse_mode": "Markdown",   # bold *text*, monospace `code`
    }, timeout=10)
    return resp.status_code == 200
```

- Messages support up to 4096 characters with Markdown.
- No rate-limit fees; free tier allows ~30 messages/second — well above this agent's needs.
- The agent sends one Telegram message per alert (never batches multiple alerts into one message — each ticker gets its own notification).

---

## `config.yaml`

```yaml
scheduler:
  interval_minutes: 5
  extended_hours: false        # US pre-market / after-hours alerts (opt-in)
  markets:
    NSE:
      timezone: Asia/Kolkata
      open:  "09:15"
      close: "15:30"
    NYSE:
      timezone: America/New_York
      open:  "09:30"
      close: "16:00"

telegram:
  bot_token: ""                # or set TELEGRAM_BOT_TOKEN env var
  chat_id: ""                  # your personal chat ID, or set TELEGRAM_CHAT_ID env var

notifications:
  console: true                # always on
  telegram: true               # primary alert channel
  desktop: false               # macOS: terminal-notifier | Linux: notify-send
```

All secrets must be in environment variables, not hardcoded:
```bash
export TELEGRAM_BOT_TOKEN="<your_bot_token_here>"
export TELEGRAM_CHAT_ID="<your_chat_id_here>"
```

---

## Alert / Signal Logic

```python
import math

THRESHOLD_STEP = 5  # percent

for holding in portfolio:
    pct_change = (current_price - avg_buy_price) / avg_buy_price * 100

    # Which 5% downside band? e.g. -11.3% → band -10
    band = math.floor(pct_change / THRESHOLD_STEP) * THRESHOLD_STEP

    if band < 0 and band < last_alerted_band.get(ticker, 0):
        fire_alert(ticker, current_price, pct_change, band)
        last_alerted_band[ticker] = band
```

- Fires **once per band per trading day** — never on every poll.
- `alert_state.json` persists bands across restarts; resets at each market open.
- Upside recovery does NOT reset bands — user runs `python main.py --reset TICKER` to re-arm.

---

## Technical Analysis on Alert

Computed from **daily OHLCV** (last 200 bars from yfinance) using `pandas_ta`:

| Indicator | Parameters | Shown in alert |
|-----------|------------|----------------|
| RSI | 14-period | Value + `oversold` / `neutral` / `overbought` |
| MACD | 12 / 26 / 9 | `Bullish crossover` / `Bearish crossover` / `Flat` |
| SMA | 50-day, 200-day | Price position vs. each MA + Golden/Death cross |
| Bollinger Bands | 20-period, 2σ | `Below lower band` / `Inside` / `Above upper band` |
| Support | 52-week low + pivot lows | Nearest level in INR or USD |
| Trend | MA alignment | `UPTREND` / `DOWNTREND` / `SIDEWAYS` |

```python
import pandas_ta as ta

df["rsi"]    = ta.rsi(df["Close"], length=14)
macd         = ta.macd(df["Close"], fast=12, slow=26, signal=9)
df["sma50"]  = ta.sma(df["Close"], length=50)
df["sma200"] = ta.sma(df["Close"], length=200)
bb           = ta.bbands(df["Close"], length=20, std=2)
```

Require ≥ 200 bars of history; log a warning and skip indicators if data is shorter.

---

## Project Structure

```
My-First-Agent/
├── CLAUDE.md
├── config.yaml                   # scheduler, Telegram, notification settings
├── portfolio.json                # user holdings (edit manually or via CLI)
├── alert_state.json              # auto-generated; persists 5% band state
├── requirements.txt
├── .env                          # TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (never commit)
├── main.py                       # CLI entrypoint
├── src/
│   ├── exchange_calendar.py      # NSE & NYSE market hours + holiday calendars
│   ├── price_fetcher.py          # yfinance + tvdatafeed, routes by ticker suffix
│   ├── threshold_monitor.py      # 5% band detection + alert_state persistence
│   ├── technical_analyzer.py     # all indicator logic (pandas_ta only)
│   ├── notifier.py               # Telegram Bot API + console dispatcher
│   ├── portfolio.py              # portfolio.json loader + validator
│   └── scheduler.py             # dual-market polling loop (IST day + IST evening)
└── tests/
    ├── test_threshold.py         # band detection logic (required before implementing)
    ├── test_calendar.py          # market hours + holiday checks
    ├── test_fetcher.py           # price fetcher with mocked HTTP
    └── test_notifier.py          # Telegram message formatting
```

---

## Requirements

```
yfinance>=0.2.40
tvdatafeed>=2.0.0
nsepython>=2.9
pandas>=2.0.0
pandas-ta>=0.3.14b
pandas-market-calendars>=4.3.0
pytz>=2024.1
requests>=2.31.0
schedule>=1.2.0
pyyaml>=6.0.1
python-dotenv>=1.0.0
```

---

## CLI Usage

```bash
# Install
pip install -r requirements.txt

# One-time Telegram setup check (sends a test message to your chat)
python main.py --test-telegram

# Run continuous monitoring (auto-detects NSE / NYSE market hours)
python main.py

# Single check — print current P&L and band status without alerts
python main.py --status

# Add a holding
python main.py --add RELIANCE.NS --qty 15 --avg-price 2800
python main.py --add AAPL --qty 10 --avg-price 185.50

# Remove a holding
python main.py --remove TCS.NS

# Reset alert bands for one ticker (re-arms from current price)
python main.py --reset TSLA

# Reset all bands (new trading day)
python main.py --reset-all
```

---

## Scheduler Behavior

The agent runs a **dual-market loop**:

| Session | Market | Active Window (IST) |
|---------|--------|---------------------|
| Day | NSE / BSE | 09:15 – 15:30 |
| Evening | NYSE / NASDAQ | 19:00 – 01:30 (next day) |

- Polls every `interval_minutes` (default 5) within each active window.
- Between sessions: sleeps and logs `"market closed — next open: NSE at 09:15 IST"`.
- NSE holidays fetched via `nsepython.nse_holidays()` at startup.
- NYSE holidays fetched via `pandas_market_calendars.get_calendar("NYSE").schedule(...)`.

---

## Example Telegram Alert Messages

Telegram supports Markdown — use `*bold*` for headers and `` `monospace` `` for prices.

### Indian Stock (NSE)
```
🔴 *ALERT | RELIANCE.NS | NSE*
Crossed *-10% band* | 11:42 IST

Price    : `₹2,516.80`
Avg Cost : `₹2,800.00`
Change   : *-10.11%*

RSI(14)  : 29.8 — OVERSOLD
MACD     : Bearish crossover
Trend    : DOWNTREND (below 50MA ₹2,640 & 200MA ₹2,710)
Support  : ₹2,480 (52-wk pivot low)

Next alert at -15% (`₹2,380`)
```

### US Stock (NASDAQ)
```
🔴 *ALERT | TSLA | NASDAQ*
Crossed *-15% band* | 02:15 IST (13:45 ET)

Price    : `$187.20`
Avg Cost : `$220.00`
Change   : *-14.91%*

RSI(14)  : 34.2 — approaching oversold
MACD     : Bearish, no crossover yet
Trend    : DOWNTREND (below 50MA $198 & 200MA $205)
Support  : $182 (52-wk low)

Next alert at -20% (`$176`)
```

---

## Implementation Rules for Claude

- Route all fetching by ticker suffix: `.NS`/`.BO` → Indian path; no suffix → US path.
- Display ₹ for INR and $ for USD at output boundaries only; store as plain `float` internally.
- Never mix INR and USD in a single calculation.
- Check `exchange_calendar.py` before every poll — skip fetch and alerts if market is closed (unless `extended_hours: true`).
- Use `pytz` for all timezone conversions. Store timestamps as UTC internally; convert to IST at display time only.
- Write `alert_state.json` atomically: write to `alert_state.json.tmp` then `os.replace(...)`.
- All HTTP calls (yfinance, Telegram Bot API) must have a 10-second timeout and one retry before failing.
- Telegram messages must be under 4096 characters with `parse_mode: Markdown`. Truncate technical summary if needed; never truncate price/band info.
- Use only `pandas_ta` for indicators — do not introduce `ta-lib` (requires native C build).
- Log every price fetch, band check, and Telegram send to `agent.log` (rotating, 10 MB max, 3 backups).
- Never commit `.env` or `config.yaml` with real secrets. `.gitignore` must exclude both.
- Tests required before implementation: `test_threshold.py` (band detection) and `test_calendar.py` (market hours).
