#!/usr/bin/env python3
"""
News agent — runs at 8:00 AM IST on trading days.

Fetches and consolidates:
  1. Latest news for each portfolio holding (yfinance)
  2. Indian market / sector headlines (RSS feeds)
  3. Momentum watchlist — potential high-growth stocks

Writes data/news_digest.json and sends a Telegram summary.
"""

import json
import logging
import os
import sys
from datetime import datetime
from logging.handlers import RotatingFileHandler

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv()

import yfinance as yf

from src.exchange_calendar import IST
from src.portfolio import load as load_portfolio
from src.notifier import send_telegram, send_console

log = logging.getLogger(__name__)

DATA_DIR  = os.path.join(os.path.dirname(__file__), "..", "data")
NEWS_PATH = os.path.join(DATA_DIR, "news_digest.json")

RSS_FEEDS = {
    "Economic Times": "https://economictimes.indiatimes.com/markets/rss.cms",
    "Business Std":   "https://www.business-standard.com/rss/markets-106.rss",
    "Moneycontrol":   "https://www.moneycontrol.com/rss/latestnews.xml",
    "Livemint":       "https://www.livemint.com/rss/markets",
}

# Stocks to watch for potential 5-10x opportunities (outside portfolio)
MOMENTUM_WATCHLIST = [
    "ZOMATO.NS",     # quick commerce / food tech
    "POLYCAB.NS",    # cables, EVs infra
    "IRFC.NS",       # infra financing (govt-backed)
    "RVNL.NS",       # railway infra
    "RAILTEL.NS",    # digital railway infra
    "ADANIGREEN.NS", # renewables
    "TATAPOWER.NS",  # power + EV charging
    "NYKAA.NS",      # beauty e-commerce
    "SUPREMEIND.NS", # plastics / pipes
    "MAPMYINDIA.NS", # geospatial / maps tech
    "TANLA.NS",      # CPaaS / telecom
    "HAPPSTMNDS.NS", # digital engineering
]


def _hours_ago(ts: int) -> float:
    return (datetime.now().timestamp() - ts) / 3600


def _display(ticker: str) -> str:
    return ticker.replace(".NS", "").replace(".BO", "")


def fetch_ticker_news(ticker: str, max_items: int = 3, max_age_hours: int = 48) -> list:
    try:
        news = yf.Ticker(ticker).news or []
        fresh = [
            {
                "title":     n.get("title", ""),
                "publisher": n.get("publisher", ""),
                "link":      n.get("link", ""),
                "age_h":     round(_hours_ago(n.get("providerPublishTime", 0)), 1),
            }
            for n in news
            if _hours_ago(n.get("providerPublishTime", 0)) <= max_age_hours
        ]
        return fresh[:max_items]
    except Exception as e:
        log.warning("News fetch failed for %s: %s", ticker, e)
        return []


def fetch_rss(max_per_feed: int = 6) -> list:
    try:
        import feedparser
    except ImportError:
        log.warning("feedparser not installed — skipping RSS. Add it to requirements.txt")
        return []

    headlines = []
    for source, url in RSS_FEEDS.items():
        try:
            feed = feedparser.parse(url)
            for entry in feed.entries[:max_per_feed]:
                headlines.append({
                    "source":  source,
                    "title":   entry.get("title", "").strip(),
                    "link":    entry.get("link", ""),
                    "summary": entry.get("summary", "")[:200],
                })
        except Exception as e:
            log.warning("RSS failed [%s]: %s", source, e)

    return headlines


def _sentiment_tag(title: str) -> str:
    title_l = title.lower()
    positive_words = ["surge", "gain", "profit", "record", "growth", "rally", "rise",
                      "order", "win", "approved", "positive", "strong", "beat", "up"]
    negative_words = ["fall", "drop", "loss", "decline", "weak", "miss", "down",
                      "concern", "fraud", "risk", "cut", "dip", "crash", "trouble"]
    pos = sum(1 for w in positive_words if w in title_l)
    neg = sum(1 for w in negative_words if w in title_l)
    if pos > neg:
        return "🟢"
    if neg > pos:
        return "🔴"
    return "⚪"


def run() -> None:
    holdings = load_portfolio()
    now_ist  = datetime.now(IST)
    date_str = now_ist.strftime("%d %b %Y")
    log.info("Running news agent for %s", date_str)

    # Per-holding news
    holding_news: dict = {}
    for h in holdings:
        ticker = h["ticker"]
        items  = fetch_ticker_news(ticker)
        if items:
            holding_news[ticker] = items

    # Momentum watchlist news
    momentum_news: dict = {}
    for ticker in MOMENTUM_WATCHLIST:
        items = fetch_ticker_news(ticker, max_items=2)
        if items:
            momentum_news[ticker] = items

    # Market headlines via RSS
    market_headlines = fetch_rss()

    digest = {
        "date":             date_str,
        "timestamp":        now_ist.isoformat(),
        "holding_news":     holding_news,
        "momentum_news":    momentum_news,
        "market_headlines": market_headlines,
    }

    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = NEWS_PATH + ".tmp"
    with open(tmp, "w") as f:
        json.dump(digest, f, indent=2, default=str)
    os.replace(tmp, NEWS_PATH)
    log.info("Saved news digest → %s", NEWS_PATH)

    msg = _format_telegram(digest, date_str)
    send_console(msg)
    send_telegram(msg)


def _format_telegram(digest: dict, date_str: str) -> str:
    parts = [f"📰 *MORNING MARKET DIGEST | {date_str}*"]

    # Holding-specific news (max 8 stocks, 1 item each)
    if digest["holding_news"]:
        parts.append("\n📦 *Your Portfolio*")
        for ticker, items in list(digest["holding_news"].items())[:8]:
            for item in items[:1]:
                tag   = _sentiment_tag(item["title"])
                title = item["title"][:90]
                parts.append(f"{tag} *{_display(ticker)}*: {title}")

    # Market headlines
    if digest["market_headlines"]:
        parts.append("\n📊 *Market Headlines*")
        for h in digest["market_headlines"][:5]:
            tag   = _sentiment_tag(h["title"])
            title = h["title"][:85]
            parts.append(f"{tag} {title} _({h['source']})_")

    # Momentum watchlist
    if digest["momentum_news"]:
        parts.append("\n⚡ *5-10x Watchlist*")
        for ticker, items in list(digest["momentum_news"].items())[:6]:
            for item in items[:1]:
                tag   = _sentiment_tag(item["title"])
                title = item["title"][:80]
                parts.append(f"{tag} *{_display(ticker)}*: {title}")

    parts.append("\n_Run `python main.py --status` for live P&L_")
    return "\n".join(parts)[:4096]


if __name__ == "__main__":
    _log_file = RotatingFileHandler("agent.log", maxBytes=10 * 1024 * 1024, backupCount=3)
    _log_file.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s: %(message)s",
        handlers=[logging.StreamHandler(), _log_file],
    )
    run()
