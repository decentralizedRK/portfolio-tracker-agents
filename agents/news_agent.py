#!/usr/bin/env python3
"""
News agent — runs at 8:00 AM IST on trading days.

Fetches and consolidates:
  1. Latest news for each portfolio holding (yfinance)
  2. Indian market / sector headlines (RSS feeds)
  3. Momentum watchlist — potential high-growth stocks

Writes data/news_digest.json and sends a Telegram summary.
"""

import logging
import os
import sys
from datetime import datetime

from _common import DATA_DIR, display, save_json, notify, setup_logging

import yfinance as yf

from src.exchange_calendar import IST
from src.portfolio import load as load_portfolio

log = logging.getLogger(__name__)

NEWS_PATH = os.path.join(DATA_DIR, "news_digest.json")

RSS_FEEDS = {
    "Economic Times": "https://economictimes.indiatimes.com/markets/rss.cms",
    "Business Std":   "https://www.business-standard.com/rss/markets-106.rss",
    "Livemint":       "https://www.livemint.com/rss/markets",
    "Moneycontrol":   "https://www.moneycontrol.com/rss/latestnews.xml",
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


def _entry_age_hours(entry) -> float | None:
    """Return age of an RSS entry in hours, or None if no publish date."""
    import calendar
    pt = entry.get("published_parsed") or entry.get("updated_parsed")
    if pt:
        return (datetime.now().timestamp() - calendar.timegm(pt)) / 3600
    return None


def fetch_ticker_news(ticker: str, max_items: int = 3, max_age_hours: int = 120) -> list:
    """Try yfinance news first, fall back to Google News RSS."""
    # 1. yfinance
    try:
        news = yf.Ticker(ticker).news or []
        fresh = [
            {
                "title":     n.get("content", [{}])[0].get("value", n.get("title", "")) if isinstance(n.get("content"), list) else n.get("title", ""),
                "publisher": n.get("publisher", ""),
                "link":      n.get("link", "") or n.get("url", ""),
                "age_h":     round(_hours_ago(n.get("providerPublishTime", 0)), 1),
            }
            for n in news
            if _hours_ago(n.get("providerPublishTime", 0)) <= max_age_hours
            and (n.get("title") or (isinstance(n.get("content"), list) and n["content"]))
        ]
        if fresh:
            return fresh[:max_items]
    except Exception as e:
        log.warning("yfinance news failed for %s: %s", ticker, e)

    # 2. Google News RSS fallback
    try:
        import feedparser
        # Build query from ticker — strip exchange suffix, append 'India NSE'
        base = ticker.replace(".NS", "").replace(".BO", "")
        try:
            info    = yf.Ticker(ticker).info
            company = info.get("shortName") or info.get("longName") or base
            # Drop common suffixes so search is tighter
            for sfx in (" Limited", " Ltd.", " Ltd", " Inc.", " Inc", " Corp."):
                company = company.replace(sfx, "")
            company = company.strip()
        except Exception:
            company = base
        query = f"{company} stock NSE India"
        url   = f"https://news.google.com/rss/search?q={query.replace(' ', '+')}&hl=en-IN&gl=IN&ceid=IN:en"
        feed  = feedparser.parse(url)
        items = []
        for entry in feed.entries:
            age = _entry_age_hours(entry)
            if age is not None and age > max_age_hours:
                continue
            items.append({
                "title":     entry.get("title", "").strip(),
                "publisher": (entry.get("source") or {}).get("title", "Google News"),
                "link":      entry.get("link", ""),
                "age_h":     round(age, 1) if age is not None else 0,
            })
            if len(items) >= max_items:
                break
        if items:
            return items
    except Exception as e:
        log.warning("Google News fallback failed for %s: %s", ticker, e)

    return []


def fetch_rss(max_per_feed: int = 6, max_age_hours: int = 48) -> list:
    try:
        import feedparser
    except ImportError:
        log.warning("feedparser not installed — skipping RSS. Add it to requirements.txt")
        return []

    headlines = []
    for source, url in RSS_FEEDS.items():
        count = 0
        try:
            feed = feedparser.parse(url)
            for entry in feed.entries[:max_per_feed * 3]:   # fetch extra, filter by age
                age = _entry_age_hours(entry)
                if age is not None and age > max_age_hours:
                    continue                                 # skip stale entries
                headlines.append({
                    "source":  source,
                    "title":   entry.get("title", "").strip(),
                    "link":    entry.get("link", ""),
                    "summary": entry.get("summary", "")[:200],
                    "age_h":   round(age, 1) if age is not None else None,
                })
                count += 1
                if count >= max_per_feed:
                    break
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


def _format_telegram(digest: dict, date_str: str) -> str:
    parts = [f"📰 *MORNING MARKET DIGEST | {date_str}*"]

    if digest["holding_news"]:
        parts.append("\n📦 *Your Portfolio*")
        for ticker, items in list(digest["holding_news"].items())[:8]:
            for item in items[:1]:
                tag   = _sentiment_tag(item["title"])
                title = item["title"][:90]
                parts.append(f"{tag} *{display(ticker)}*: {title}")

    if digest["market_headlines"]:
        parts.append("\n📊 *Market Headlines*")
        for h in digest["market_headlines"][:5]:
            tag   = _sentiment_tag(h["title"])
            title = h["title"][:85]
            parts.append(f"{tag} {title} _({h['source']})_")

    if digest["momentum_news"]:
        parts.append("\n⚡ *5-10x Watchlist*")
        for ticker, items in list(digest["momentum_news"].items())[:6]:
            for item in items[:1]:
                tag   = _sentiment_tag(item["title"])
                title = item["title"][:80]
                parts.append(f"{tag} *{display(ticker)}*: {title}")

    parts.append("\n_Run `python main.py --status` for live P&L_")
    return "\n".join(parts)[:4096]


def run() -> None:
    holdings = load_portfolio()
    now_ist  = datetime.now(IST)
    date_str = now_ist.strftime("%d %b %Y")
    log.info("Running news agent for %s", date_str)

    holding_news: dict = {}
    for h in holdings:
        ticker = h["ticker"]
        items  = fetch_ticker_news(ticker)
        if items:
            holding_news[ticker] = items

    momentum_news: dict = {}
    for ticker in MOMENTUM_WATCHLIST:
        items = fetch_ticker_news(ticker, max_items=2)
        if items:
            momentum_news[ticker] = items

    market_headlines = fetch_rss()

    digest = {
        "date":             date_str,
        "timestamp":        now_ist.isoformat(),
        "holding_news":     holding_news,
        "momentum_news":    momentum_news,
        "market_headlines": market_headlines,
    }

    save_json(NEWS_PATH, digest, default=str)
    log.info("Saved news digest → %s", NEWS_PATH)

    notify(_format_telegram(digest, date_str))


if __name__ == "__main__":
    setup_logging()
    run()
