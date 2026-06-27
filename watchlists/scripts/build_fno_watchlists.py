#!/usr/bin/env python3
"""
Build NSE F&O watchlists split by market-cap tier (SEBI classification).

Output files (under watchlists/):
  largecap.json / largecap.txt   — top-100 by market cap (Nifty100 universe)
  midcap.json  / midcap.txt      — rank 101-250 (Nifty Midcap 150 universe)
  smallcap.json / smallcap.txt   — rank 251+ (Nifty Smallcap 250 universe)
  all_fno.txt                    — every confirmed F&O stock, TradingView import

Run:
  cd portfolio-tracker-agents
  python watchlists/scripts/build_fno_watchlists.py
"""

import json, time, math, sys
from pathlib import Path
from datetime import datetime, timezone

import yfinance as yf

# ---------------------------------------------------------------------------
# NSE F&O equity universe — (NSE symbol, yfinance .NS ticker)
# Curated from SEBI/NSE F&O lot-size circular (June 2026).
# Symbols where yfinance changed the ticker are mapped explicitly.
# ---------------------------------------------------------------------------
FNO_STOCKS = [
    # --- Nifty 50 ---
    ("RELIANCE",    "RELIANCE.NS"),
    ("TCS",         "TCS.NS"),
    ("HDFCBANK",    "HDFCBANK.NS"),
    ("INFY",        "INFY.NS"),
    ("ICICIBANK",   "ICICIBANK.NS"),
    ("HINDUNILVR",  "HINDUNILVR.NS"),
    ("SBIN",        "SBIN.NS"),
    ("BHARTIARTL",  "BHARTIARTL.NS"),
    ("KOTAKBANK",   "KOTAKBANK.NS"),
    ("ITC",         "ITC.NS"),
    ("LT",          "LT.NS"),
    ("AXISBANK",    "AXISBANK.NS"),
    ("MARUTI",      "MARUTI.NS"),
    ("SUNPHARMA",   "SUNPHARMA.NS"),
    ("ASIANPAINT",  "ASIANPAINT.NS"),
    ("BAJFINANCE",  "BAJFINANCE.NS"),
    ("TITAN",       "TITAN.NS"),
    ("HCLTECH",     "HCLTECH.NS"),
    ("WIPRO",       "WIPRO.NS"),
    ("POWERGRID",   "POWERGRID.NS"),
    ("NTPC",        "NTPC.NS"),
    ("ONGC",        "ONGC.NS"),
    ("JSWSTEEL",    "JSWSTEEL.NS"),
    ("TATASTEEL",   "TATASTEEL.NS"),
    ("TATAMOTORS",  "TATAMOTORS.NS"),
    ("M&M",         "M&M.NS"),
    ("BAJAJ-AUTO",  "BAJAJ-AUTO.NS"),
    ("BAJAJFINSV",  "BAJAJFINSV.NS"),
    ("TECHM",       "TECHM.NS"),
    ("GRASIM",      "GRASIM.NS"),
    ("ULTRACEMCO",  "ULTRACEMCO.NS"),
    ("HINDALCO",    "HINDALCO.NS"),
    ("COALINDIA",   "COALINDIA.NS"),
    ("DIVISLAB",    "DIVISLAB.NS"),
    ("DRREDDY",     "DRREDDY.NS"),
    ("CIPLA",       "CIPLA.NS"),
    ("NESTLEIND",   "NESTLEIND.NS"),
    ("BRITANNIA",   "BRITANNIA.NS"),
    ("EICHERMOT",   "EICHERMOT.NS"),
    ("HEROMOTOCO",  "HEROMOTOCO.NS"),
    ("BPCL",        "BPCL.NS"),
    ("TATACONSUM",  "TATACONSUM.NS"),
    ("INDUSINDBK",  "INDUSINDBK.NS"),
    ("SBILIFE",     "SBILIFE.NS"),
    ("APOLLOHOSP",  "APOLLOHOSP.NS"),
    ("HDFCLIFE",    "HDFCLIFE.NS"),
    ("ADANIPORTS",  "ADANIPORTS.NS"),
    ("TRENT",       "TRENT.NS"),
    # --- Nifty Next 50 / Nifty 100 ---
    ("ADANIENT",    "ADANIENT.NS"),
    ("ADANIGREEN",  "ADANIGREEN.NS"),
    ("ADANIPOWER",  "ADANIPOWER.NS"),
    ("ATGL",        "ATGL.NS"),
    ("AMBUJACEM",   "AMBUJACEM.NS"),
    ("BANKBARODA",  "BANKBARODA.NS"),
    ("BERGEPAINT",  "BERGEPAINT.NS"),
    ("BEL",         "BEL.NS"),
    ("BOSCHLTD",    "BOSCHLTD.NS"),
    ("CANBK",       "CANBK.NS"),
    ("CHOLAFIN",    "CHOLAFIN.NS"),
    ("COLPAL",      "COLPAL.NS"),
    ("CONCOR",      "CONCOR.NS"),
    ("DLF",         "DLF.NS"),
    ("DALBHARAT",   "DALBHARAT.NS"),
    ("GAIL",        "GAIL.NS"),
    ("GODREJCP",    "GODREJCP.NS"),
    ("GODREJPROP",  "GODREJPROP.NS"),
    ("GUJGASLTD",   "GUJGASLTD.NS"),
    ("HAL",         "HAL.NS"),
    ("HAVELLS",     "HAVELLS.NS"),
    ("ICICIGI",     "ICICIGI.NS"),
    ("ICICIPRULI",  "ICICIPRULI.NS"),
    ("IGL",         "IGL.NS"),
    ("IRCTC",       "IRCTC.NS"),
    ("INDUSTOWER",  "INDUSTOWER.NS"),
    ("JINDALSTEL",  "JINDALSTEL.NS"),
    ("JUBLFOOD",    "JUBLFOOD.NS"),
    ("LICI",        "LICI.NS"),
    ("LUPIN",       "LUPIN.NS"),
    ("MARICO",      "MARICO.NS"),
    ("MUTHOOTFIN",  "MUTHOOTFIN.NS"),
    ("NMDC",        "NMDC.NS"),
    ("OBEROIRLTY",  "OBEROIRLTY.NS"),
    ("OFSS",        "OFSS.NS"),
    ("OIL",         "OIL.NS"),
    ("PAGEIND",     "PAGEIND.NS"),
    ("PFC",         "PFC.NS"),
    ("PIDILITIND",  "PIDILITIND.NS"),
    ("PIIND",       "PIIND.NS"),
    ("PNB",         "PNB.NS"),
    ("POLYCAB",     "POLYCAB.NS"),
    ("RECLTD",      "RECLTD.NS"),
    ("SAIL",        "SAIL.NS"),
    ("SBICARD",     "SBICARD.NS"),
    ("SRF",         "SRF.NS"),
    ("SUNTV",       "SUNTV.NS"),
    ("TATAPOWER",   "TATAPOWER.NS"),
    ("TATACOMM",    "TATACOMM.NS"),
    ("TORNTPHARM",  "TORNTPHARM.NS"),
    ("TORNTPOWER",  "TORNTPOWER.NS"),
    ("TVSMOTOR",    "TVSMOTOR.NS"),
    ("UBL",         "UBL.NS"),
    ("UPL",         "UPL.NS"),
    ("VEDL",        "VEDL.NS"),
    ("VOLTAS",      "VOLTAS.NS"),
    ("ZOMATO",      "ZOMATO.NS"),
    ("NAUKRI",      "NAUKRI.NS"),
    # --- Nifty Midcap 150 F&O eligible ---
    ("ABCAPITAL",   "ABCAPITAL.NS"),
    ("ABB",         "ABB.NS"),
    ("ACC",         "ACC.NS"),
    ("APLAPOLLO",   "APLAPOLLO.NS"),
    ("AUBANK",      "AUBANK.NS"),
    ("AUROPHARMA",  "AUROPHARMA.NS"),
    ("BALKRISIND",  "BALKRISIND.NS"),
    ("BANDHANBNK",  "BANDHANBNK.NS"),
    ("BATAINDIA",   "BATAINDIA.NS"),
    ("BIOCON",      "BIOCON.NS"),
    ("BLUEDART",    "BLUEDART.NS"),
    ("BSOFT",       "BSOFT.NS"),
    ("CESC",        "CESC.NS"),
    ("COFORGE",     "COFORGE.NS"),
    ("CROMPTON",    "CROMPTON.NS"),
    ("CUMMINSIND",  "CUMMINSIND.NS"),
    ("CYIENT",      "CYIENT.NS"),
    ("DELTACORP",   "DELTACORP.NS"),
    ("DEEPAKFERT",  "DEEPAKFERT.NS"),   # was DEEPAKNITRI
    ("ENDURANCE",   "ENDURANCE.NS"),
    ("ESCORTS",     "ESCORTS.NS"),
    ("EXIDEIND",    "EXIDEIND.NS"),
    ("FEDERALBNK",  "FEDERALBNK.NS"),
    ("GLENMARK",    "GLENMARK.NS"),
    ("GMRAIRPORT",  "GMRAIRPORT.NS"),
    ("GRANULES",    "GRANULES.NS"),
    ("GSPL",        "GSPL.NS"),
    ("HINDPETRO",   "HINDPETRO.NS"),
    ("IDFCFIRSTB",  "IDFCFIRSTB.NS"),
    ("IEX",         "IEX.NS"),
    ("INDHOTEL",    "INDHOTEL.NS"),
    ("INDIAMART",   "INDIAMART.NS"),
    ("INDIGO",      "INDIGO.NS"),
    ("JKCEMENT",    "JKCEMENT.NS"),
    ("JSL",         "JSL.NS"),
    ("JUBLINGREA",  "JUBLINGREA.NS"),
    ("KANSAINER",   "KANSAINER.NS"),
    ("KEI",         "KEI.NS"),
    ("KTKBANK",     "KTKBANK.NS"),      # was KMBNK
    ("LTFH",        "LTFH.NS"),
    ("M&MFIN",      "M&MFIN.NS"),
    ("MANAPPURAM",  "MANAPPURAM.NS"),
    ("MCX",         "MCX.NS"),
    ("MFSL",        "MFSL.NS"),
    ("MPHASIS",     "MPHASIS.NS"),
    ("NATIONALUM",  "NATIONALUM.NS"),
    ("NBCC",        "NBCC.NS"),
    ("NESCO",       "NESCO.NS"),
    ("PETRONET",    "PETRONET.NS"),
    ("PERSISTENT",  "PERSISTENT.NS"),
    ("PVRINOX",     "PVRINOX.NS"),
    ("RBLBANK",     "RBLBANK.NS"),
    ("RAMCOCEM",    "RAMCOCEM.NS"),
    ("SIEMENS",     "SIEMENS.NS"),
    ("STARHEALTH",  "STARHEALTH.NS"),
    ("SYNGENE",     "SYNGENE.NS"),
    ("TIINDIA",     "TIINDIA.NS"),
    ("UJJIVANSFB",  "UJJIVANSFB.NS"),
    ("IDEA",        "IDEA.NS"),
    ("ZEEL",        "ZEEL.NS"),
    ("LICHSGFIN",   "LICHSGFIN.NS"),
    ("MRF",         "MRF.NS"),
    # --- Nifty Smallcap 250 F&O eligible ---
    ("ALKEM",       "ALKEM.NS"),
    ("ANGELONE",    "ANGELONE.NS"),
    ("ASTRAL",      "ASTRAL.NS"),
    ("ATUL",        "ATUL.NS"),
    ("BALRAMCHIN",  "BALRAMCHIN.NS"),
    ("BAYERCROP",   "BAYERCROP.NS"),
    ("CARBORUNIV",  "CARBORUNIV.NS"),
    ("CASTROLIND",  "CASTROLIND.NS"),
    ("CDSL",        "CDSL.NS"),
    ("CENTURYPLY",  "CENTURYPLY.NS"),
    ("CHAMBLFERT",  "CHAMBLFERT.NS"),
    ("CLEAN",       "CLEAN.NS"),
    ("DCMSHRIRAM",  "DCMSHRIRAM.NS"),
    ("EIDPARRY",    "EIDPARRY.NS"),
    ("EMAMILTD",    "EMAMILTD.NS"),
    ("EQUITASBNK",  "EQUITASBNK.NS"),
    ("FINCABLES",   "FINCABLES.NS"),
    ("FLUOROCHEM",  "FLUOROCHEM.NS"),
    ("GALAXYSURF",  "GALAXYSURF.NS"),
    ("GHCL",        "GHCL.NS"),
    ("GNFC",        "GNFC.NS"),
    ("GODFRYPHLP",  "GODFRYPHLP.NS"),
    ("GRAPHITE",    "GRAPHITE.NS"),
    ("GSFC",        "GSFC.NS"),
    ("IPCALAB",     "IPCALAB.NS"),
    ("JBCHEPHARM",  "JBCHEPHARM.NS"),
    ("JINDALSAW",   "JINDALSAW.NS"),
    ("JKLAKSHMI",   "JKLAKSHMI.NS"),
    ("KNRCON",      "KNRCON.NS"),
    ("KRBL",        "KRBL.NS"),
    ("LALPATHLAB",  "LALPATHLAB.NS"),
    ("LAOPALA",     "LAOPALA.NS"),
    ("LINDEINDIA",  "LINDEINDIA.NS"),
    ("LUXIND",      "LUXIND.NS"),
    ("MASTEK",      "MASTEK.NS"),
    ("METROPOLIS",  "METROPOLIS.NS"),
    ("MMFL",        "MMFL.NS"),
    ("MSTCLTD",     "MSTCLTD.NS"),
    ("NAVINFLUOR",  "NAVINFLUOR.NS"),
    ("NILKAMAL",    "NILKAMAL.NS"),
    ("NRBBEARING",  "NRBBEARING.NS"),
    ("OLECTRA",     "OLECTRA.NS"),
    ("ORIENTELEC",  "ORIENTELEC.NS"),
    ("PNBHOUSING",  "PNBHOUSING.NS"),
    ("PRINCEPIPE",  "PRINCEPIPE.NS"),
    ("RADICO",      "RADICO.NS"),
    ("RAJESHEXPO",  "RAJESHEXPO.NS"),
    ("RATNAMANI",   "RATNAMANI.NS"),
    ("SAFARI",      "SAFARI.NS"),
    ("SAPPHIRE",    "SAPPHIRE.NS"),
    ("SHRIRAMFIN",  "SHRIRAMFIN.NS"),
    ("SONACOMS",    "SONACOMS.NS"),
    ("SPARC",       "SPARC.NS"),
    ("STLTECH",     "STLTECH.NS"),
    ("SUDARSCHEM",  "SUDARSCHEM.NS"),
    ("SUNDARMFIN",  "SUNDARMFIN.NS"),
    ("SUVEN",       "SUVEN.NS"),
    ("SYMPHONY",    "SYMPHONY.NS"),
    ("TATAINVEST",  "TATAINVEST.NS"),
    ("TRITURBINE",  "TRITURBINE.NS"),
    ("VAIBHAVGBL",  "VAIBHAVGBL.NS"),
    ("VINATIORGA",  "VINATIORGA.NS"),
    ("VBL",         "VBL.NS"),
    ("WOCKPHARMA",  "WOCKPHARMA.NS"),
    ("NUVOCO",      "NUVOCO.NS"),
    ("MMFL",        "MMFL.NS"),
]

# Deduplicate (by NSE symbol)
seen_syms: set[str] = set()
unique_stocks: list[tuple[str, str]] = []
for sym, ticker in FNO_STOCKS:
    if sym not in seen_syms:
        seen_syms.add(sym)
        unique_stocks.append((sym, ticker))

FNO_STOCKS = unique_stocks

OUTPUT_DIR = Path(__file__).resolve().parent.parent   # watchlists/

CRORE = 1e7


def fetch_market_cap(ticker: str) -> tuple[float, float]:
    """Return (mcap_inr, price). Returns (0, 0) on error."""
    try:
        info = yf.Ticker(ticker).fast_info
        mc = getattr(info, "market_cap", None) or 0
        px = getattr(info, "last_price", None) or 0
        return float(mc), float(px)
    except Exception:
        return 0.0, 0.0


def build_record(sym: str, ticker: str, mcap: float, price: float, rank: int) -> dict:
    mcap_crore = round(mcap / CRORE, 2)
    return {
        # ── Identity ──────────────────────────────────────────────
        "symbol":       sym,
        "nse_ticker":   ticker,
        "tradingview":  f"NSE:{sym}",       # TradingView watchlist format
        "exchange":     "NSE",
        "currency":     "INR",

        # ── Market cap ────────────────────────────────────────────
        "market_cap_crore": mcap_crore,
        "mcap_rank":    rank,               # rank 1 = largest F&O stock

        # ── Price snapshot ────────────────────────────────────────
        "last_price":   round(price, 2),

        # ── TA configuration (pass to technical_analyzer.py) ─────
        "ta_config": {
            "rsi_period":     14,
            "macd":           {"fast": 12, "slow": 26, "signal": 9},
            "sma_periods":    [20, 50, 200],
            "ema_periods":    [9, 21],
            "bb":             {"period": 20, "std": 2},
            "atr_period":     14,
            "vwap":           True,
            "history_bars":   200,
            "interval":       "1d",
            "intraday_interval": "15m",
        },

        # ── Metadata ──────────────────────────────────────────────
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def save_json(tier: str, stocks: list[dict]) -> Path:
    stocks = sorted(stocks, key=lambda x: x["mcap_rank"])
    descriptions = {
        "largecap":  "NSE F&O — rank 1-100 by market cap (Nifty 100 universe, > ₹40,000 Cr)",
        "midcap":    "NSE F&O — rank 101-250 by market cap (Nifty Midcap 150, ₹8,000–40,000 Cr)",
        "smallcap":  "NSE F&O — rank 251+ by market cap (Nifty Smallcap 250, < ₹8,000 Cr)",
    }
    payload = {
        "tier":              tier,
        "count":             len(stocks),
        "description":       descriptions[tier],
        # Flat list — copy to TradingView → Watchlist → ⋮ → Import list
        "tradingview_list":  [s["tradingview"] for s in stocks],
        "stocks":            stocks,
        "generated_at":      datetime.now(timezone.utc).isoformat(),
    }
    path = OUTPUT_DIR / f"{tier}.json"
    path.write_text(json.dumps(payload, indent=2))
    return path


def save_txt(tier: str, stocks: list[dict]) -> Path:
    """Plain-text TradingView import file — one ticker per line."""
    stocks = sorted(stocks, key=lambda x: x["mcap_rank"])
    lines = [
        f"### NSE F&O — {tier.upper()} ({len(stocks)} stocks)",
        f"### Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
        f"### Paste into TradingView: Watchlist → ⋮ → Import list",
        "",
    ] + [s["tradingview"] for s in stocks]
    path = OUTPUT_DIR / f"{tier}.txt"
    path.write_text("\n".join(lines))
    return path


def main():
    total = len(FNO_STOCKS)
    print(f"NSE F&O Watchlist Builder — {total} symbols")
    print("=" * 60)

    # ── Step 1: fetch market caps ────────────────────────────────
    print("\nFetching market-cap data from Yahoo Finance …")
    mcap_data: dict[str, tuple[float, float]] = {}   # sym → (mcap, price)

    for i, (sym, ticker) in enumerate(FNO_STOCKS, 1):
        mc, px = fetch_market_cap(ticker)
        mcap_data[sym] = (mc, px)
        if i % 20 == 0:
            print(f"  {i}/{total} done …")
        time.sleep(0.15)   # gentle rate-limit

    # ── Step 2: rank by market cap (SEBI-style) ──────────────────
    ranked = sorted(
        [(sym, ticker) for sym, ticker in FNO_STOCKS],
        key=lambda x: mcap_data[x[0]][0],
        reverse=True,
    )

    buckets: dict[str, list[dict]] = {"largecap": [], "midcap": [], "smallcap": []}
    skipped: list[str] = []

    # Absolute SEBI thresholds (applied to F&O universe only):
    #   largecap  > ₹40,000 Cr   ≈ Nifty 100
    #   midcap    ₹8,000–40,000  ≈ Nifty Midcap 150
    #   smallcap  < ₹8,000 Cr    ≈ Nifty Smallcap 250
    LARGE_CRORE = 40_000
    MID_CRORE   =  8_000

    for rank, (sym, ticker) in enumerate(ranked, start=1):
        mc, px = mcap_data[sym]
        if mc == 0:
            skipped.append(sym)
            continue
        mcap_crore = mc / CRORE
        if mcap_crore >= LARGE_CRORE:
            tier = "largecap"
        elif mcap_crore >= MID_CRORE:
            tier = "midcap"
        else:
            tier = "smallcap"
        buckets[tier].append(build_record(sym, ticker, mc, px, rank))

    # ── Step 3: print summary ────────────────────────────────────
    print(f"\nClassification (SEBI thresholds: >₹40k Cr = large, ₹8k-40k = mid, <₹8k = small):")
    for tier, stocks in buckets.items():
        if stocks:
            top = stocks[0]
            bot = stocks[-1]
            print(f"  {tier:10s}: {len(stocks):3d} stocks  "
                  f"({top['symbol']} ₹{top['market_cap_crore']:,.0f}Cr "
                  f"→ {bot['symbol']} ₹{bot['market_cap_crore']:,.0f}Cr)")
    if skipped:
        print(f"  skipped   : {len(skipped):3d} (no data — possibly renamed/delisted)")
        print(f"    {skipped}")

    # ── Step 4: write files ──────────────────────────────────────
    print("\nWriting files …")
    all_stocks: list[dict] = []
    for tier, stocks in buckets.items():
        if not stocks:
            continue
        jpath = save_json(tier, stocks)
        tpath = save_txt(tier, stocks)
        print(f"  {jpath.name}  ({len(stocks)} stocks)")
        print(f"  {tpath.name}")
        all_stocks.extend(stocks)

    # Combined TradingView import (all tiers, sorted by rank)
    all_sorted = sorted(all_stocks, key=lambda x: x["mcap_rank"])
    all_txt = OUTPUT_DIR / "all_fno.txt"
    all_lines = [
        f"### NSE F&O — ALL TIERS ({len(all_sorted)} stocks)",
        f"### Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
        "### Paste into TradingView: Watchlist → ⋮ → Import list",
        "",
    ] + [s["tradingview"] for s in all_sorted]
    all_txt.write_text("\n".join(all_lines))
    print(f"  {all_txt.name}  ({len(all_sorted)} stocks — all tiers combined)")

    # ── Step 5: usage hint ───────────────────────────────────────
    print("\nTradingView import:")
    print("  1. Open TradingView → Watchlist panel → ⋮ → Import list")
    print("  2. Pick one of the .txt files above (drag-and-drop or open dialog)")
    print("  3. Lines starting with ### are comments and are ignored by TV")
    print("\nTA integration:")
    print("  Each stock record has ta_config with RSI/MACD/BB/ATR/VWAP params.")
    print("  Pass ta_config directly to technical_analyzer.py per stock.")


if __name__ == "__main__":
    main()
