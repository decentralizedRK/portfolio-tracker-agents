#!/usr/bin/env python3
import argparse
import logging
import os
import sys
from logging.handlers import RotatingFileHandler

from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    handlers=[logging.StreamHandler()],
)
_file_handler = RotatingFileHandler("agent.log", maxBytes=10 * 1024 * 1024, backupCount=3)
_file_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
logging.getLogger().addHandler(_file_handler)

log = logging.getLogger(__name__)

sys.path.insert(0, os.path.dirname(__file__))

import src.portfolio as portfolio_module
from src.threshold_monitor import reset_ticker, reset_all
from src.notifier import send_telegram


# ── commands ──────────────────────────────────────────────────────────────────

def cmd_status(_args):
    from src.price_fetcher import get_price
    from src.threshold_monitor import load_state

    holdings = portfolio_module.load()
    state    = load_state()
    sym      = {"INR": "₹", "USD": "$"}

    print(f"\n{'Ticker':<16} {'Avg Cost':>12} {'Current':>12} {'Change':>8}  {'Band':>5}")
    print("─" * 58)
    for h in holdings:
        t = h["ticker"]
        s = sym.get(h["currency"], "")
        p = get_price(t)
        if p is None:
            print(f"{t:<16} {'—':>12} {'—':>12} {'—':>8}  {'—':>5}")
            continue
        pct  = (p - h["avg_buy_price"]) / h["avg_buy_price"] * 100
        band = state.get(t, 0)
        sign = "+" if pct >= 0 else ""
        print(f"{t:<16} {s}{h['avg_buy_price']:>11,.2f} {s}{p:>11,.2f} {sign}{pct:>6.2f}%  {band:>4}%")
    print()


def cmd_pnl(_args):
    from src.price_fetcher import get_price

    holdings = portfolio_module.load()
    sym      = {"INR": "₹", "USD": "$"}

    print(f"\n{'Ticker':<16} {'Qty':>6} {'Avg Cost':>12} {'Current':>12} {'P&L':>12} {'%':>8}")
    print("─" * 72)
    for h in holdings:
        t = h["ticker"]
        s = sym.get(h["currency"], "")
        p = get_price(t)
        if p is None:
            print(f"{t:<16} {'—':>6}")
            continue
        pnl  = (p - h["avg_buy_price"]) * h["qty"]
        pct  = (p - h["avg_buy_price"]) / h["avg_buy_price"] * 100
        sign = "+" if pnl >= 0 else ""
        print(f"{t:<16} {h['qty']:>6} {s}{h['avg_buy_price']:>11,.2f} {s}{p:>11,.2f} {sign}{s}{pnl:>10,.2f} {pct:>+7.2f}%")
    print()


def cmd_add(args):
    if args.qty is None or args.avg_price is None:
        print("Error: --add requires --qty and --avg-price")
        sys.exit(1)
    portfolio_module.add_holding(args.add, args.qty, args.avg_price)
    print(f"Added/updated: {args.add.upper()}  qty={args.qty}  avg_price={args.avg_price}")


def cmd_remove(args):
    removed = portfolio_module.remove_holding(args.remove)
    print(f"{'Removed' if removed else 'Not found'}: {args.remove.upper()}")


def cmd_reset(args):
    reset_ticker(args.reset.upper())
    print(f"Alert bands reset for {args.reset.upper()}")


def cmd_reset_all(_args):
    reset_all()
    print("All alert bands reset.")


def cmd_test_telegram(_args):
    ok = send_telegram("✅ *Stock Agent* — Telegram connection test successful!")
    if ok:
        print("Test message sent to Telegram successfully.")
    else:
        print("Failed. Check TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env")
        sys.exit(1)


def cmd_once(_args):
    from src.scheduler import run_once
    run_once()


def cmd_run(_args):
    from src.scheduler import run
    run()


# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Stock Technical Analysis Agent — Indian & US Markets",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
examples:
  python main.py                          # run continuous monitoring
  python main.py --once                   # single check cycle
  python main.py --status                 # show live prices vs cost basis
  python main.py --pnl                    # show P&L for all holdings
  python main.py --test-telegram          # send a test Telegram message
  python main.py --add RELIANCE.NS --qty 15 --avg-price 2800
  python main.py --remove TCS.NS
  python main.py --reset TSLA             # re-arm alerts from current price
  python main.py --reset-all
""",
    )

    group = parser.add_mutually_exclusive_group()
    group.add_argument("--status",        action="store_true", help="Show live price and band status")
    group.add_argument("--pnl",           action="store_true", help="Show portfolio P&L summary")
    group.add_argument("--once",          action="store_true", help="Run a single check cycle")
    group.add_argument("--test-telegram", action="store_true", help="Send a test Telegram message")
    group.add_argument("--reset-all",     action="store_true", help="Reset all alert bands")
    group.add_argument("--add",           metavar="TICKER",    help="Add or update a holding")
    group.add_argument("--remove",        metavar="TICKER",    help="Remove a holding")
    group.add_argument("--reset",         metavar="TICKER",    help="Reset alert bands for one ticker")

    parser.add_argument("--qty",       type=float, dest="qty",       help="Quantity (with --add)")
    parser.add_argument("--avg-price", type=float, dest="avg_price", help="Average buy price (with --add)")

    args = parser.parse_args()

    dispatch = {
        "status":        (args.status,        cmd_status),
        "pnl":           (args.pnl,           cmd_pnl),
        "once":          (args.once,           cmd_once),
        "test_telegram": (args.test_telegram,  cmd_test_telegram),
        "reset_all":     (args.reset_all,      cmd_reset_all),
        "add":           (bool(args.add),      cmd_add),
        "remove":        (bool(args.remove),   cmd_remove),
        "reset":         (bool(args.reset),    cmd_reset),
    }

    for _, (active, fn) in dispatch.items():
        if active:
            fn(args)
            return

    cmd_run(args)


if __name__ == "__main__":
    main()
