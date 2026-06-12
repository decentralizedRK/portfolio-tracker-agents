# Portfolio Tracker

A personal investment dashboard for tracking Indian stocks and mutual funds — live prices, P&L, news, recommendations, corporate actions, and daily/weekly performance trends. No app to install, no subscription fees.

---

## What It Does

| Feature | Details |
|---------|---------|
| **Live Holdings** | Tracks stocks (NSE/BSE) and mutual funds with real-time P&L vs your average buy price |
| **Daily Prices** | Auto-updated hourly on weekdays via GitHub Actions — no manual refresh needed |
| **Morning News** | Every weekday morning: news for each stock you hold + market headlines |
| **Recommendations** | Weekly buy/hold/review signals based on RSI, MACD, moving averages, and Bollinger Bands |
| **Corporate Actions** | Upcoming and past dividends, stock splits, and earnings for your portfolio |
| **MF NAV Tracking** | Mutual fund NAVs updated daily at 8:30 PM IST (after AMFI publishes) with SIP auto-recording |
| **Performance Charts** | Daily, weekly, and monthly P&L change tracking — builds up your portfolio history over time |
| **Login & Cloud Sync** | Sign in with Google or email to save your portfolio to the cloud — access from any device |

---

## Dashboard

The dashboard is a static web page hosted on **GitHub Pages** — no server, no infrastructure.

It has six tabs:

- **Holdings** — Full stock and mutual fund table with invested value, current value, and P&L %. Top runners and draggers of the day. Interactive P&L bar chart.
- **News** — Stock-specific news for your holdings, market headlines, and a momentum watchlist.
- **Recommendations** — Weekly AI-generated action labels: `STRONG ACCUMULATE`, `ACCUMULATE ON DIPS`, `HOLD`, `HOLD/MONITOR CLOSELY`, `REVIEW INVESTMENT THESIS`.
- **Corporate Actions** — Upcoming dividends, splits, and earnings results for your portfolio stocks.
- **Performance** — Portfolio value over time (1W / 1M / 3M / 6M / 1Y), with daily, weekly, and monthly change cards. Requires login.
- **Add** — Add stocks or mutual funds by typing in details manually or pasting a broker screenshot into an AI (Claude/ChatGPT) to extract the data automatically.

---

## Adding Your Portfolio

### Stocks

1. Open the **Add** tab → **Add Stock**
2. Type in the ticker, quantity, and average buy price
3. **Logged in?** Click **Save to Portfolio** — done instantly
4. **Not logged in?** Click **Generate JSON** and paste the snippet into `portfolio.json`

Tickers follow Yahoo Finance format:
- NSE stocks → add `.NS` (e.g. `RELIANCE.NS`, `HDFCBANK.NS`)
- BSE stocks → add `.BO` (e.g. `INFY.BO`)
- US stocks → no suffix (e.g. `AAPL`, `NVDA`)

### Mutual Funds

1. Open **Add** → **Add Mutual Fund**
2. Fill in fund name, scheme code (from [mfapi.in](https://www.mfapi.in)), units, and average NAV
3. **Logged in?** Click **Save to Portfolio**
4. **Not logged in?** Use Generate JSON → paste into `mf_portfolio.json`

> **Pro tip:** Don't know your exact ticker or average price? Take a screenshot from your broker app (Zerodha, Groww, Upstox, Angel One) and paste it into Claude.ai or ChatGPT using the prompt shown in the Add tab. It extracts the data automatically.

---

## Login & Multi-User Support

The dashboard supports multiple users via **Firebase Authentication**. Each user's portfolio is stored privately in Firestore — no one else can see your holdings.

**Sign in options:**
- Google (one click)
- Email + password

**Once logged in:**
- Your holdings sync across devices
- The Performance tab starts building your daily history
- You can add and remove holdings directly from the dashboard — no file editing needed

---

## How Data Stays Fresh (GitHub Actions)

Five automated workflows run on schedule — no server required:

| Workflow | Schedule | What it does |
|----------|----------|--------------|
| Portfolio Update | Hourly, weekdays 9:15 AM – 3:30 PM IST | Fetches live prices, writes snapshot, sends Telegram alert |
| Morning News | 8:00 AM IST, weekdays | News for each holding + market headlines |
| Corporate Actions | 8:35 AM IST, weekdays | Dividends, splits, earnings from yfinance |
| Weekly Recommendations | Monday 8:30 AM IST | Technical analysis signals for every holding |
| MF NAV Update | 8:30 PM IST, weekdays | Fetches end-of-day NAVs from AMFI, auto-records SIPs |

Every workflow commits its output to the repo — GitHub Pages then auto-deploys the dashboard within minutes.

---

## Telegram Alerts

The portfolio update agent sends a Telegram message when a holding drops through a new 5% band below your average buy price (−5%, −10%, −15%, …). Each alert includes:

- Current price vs average cost
- RSI, MACD, trend, Bollinger Bands
- Nearest support level
- Next alert threshold

Alerts fire **once per band per trading day** — not on every price tick.

**Setup:** Create a bot via [@BotFather](https://t.me/BotFather) on Telegram, then add your bot token and chat ID as GitHub Actions secrets (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`).

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Dashboard | Static HTML + Tailwind CSS + Chart.js — hosted on GitHub Pages |
| Auth & Database | Firebase Authentication + Firestore (free Spark plan) |
| Price Data | yfinance (Yahoo Finance) |
| MF NAV Data | [mfapi.in](https://www.mfapi.in) + AMFI |
| Automation | GitHub Actions (free for public repos) |
| Alerts | Telegram Bot API (free) |
| Technical Analysis | `ta` Python library (RSI, MACD, Bollinger Bands, SMA) |

---

## Firebase Setup (for Login)

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → create a project
2. Enable **Authentication** → Google + Email/Password providers
3. Create a **Firestore Database** → choose `asia-south1 (Mumbai)` → start in test mode
4. Apply the security rules from `firestore.rules` (Firestore → Rules tab → Publish)
5. Go to Project Settings → Your apps → Add Web app → copy the config object
6. Paste into `docs/js/firebase-config.js` and set `FIREBASE_CONFIGURED = true`
7. Commit and push

Without Firebase configured, the dashboard works in read-only public mode — all price data and analysis is still visible, just no login or personal portfolio sync.

---

## Local Development

```bash
# Install Python dependencies
pip install -r requirements.txt

# Run a one-time portfolio status check
python main.py --status

# Start continuous monitoring (respects NSE/NYSE market hours)
python main.py

# Test Telegram alert
python main.py --test-telegram

# Manually trigger any agent
python agents/portfolio_update_agent.py --force
python agents/news_agent.py
python agents/mf_update_agent.py
```

---

*Data via yfinance and mfapi.in · Not financial advice*
