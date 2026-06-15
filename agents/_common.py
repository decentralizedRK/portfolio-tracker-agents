"""Shared utilities for all portfolio agents.

Importing this module automatically:
  - Adds the project root to sys.path
  - Calls load_dotenv()
"""

import json
import logging
import os
import sys
from logging.handlers import RotatingFileHandler

# ── Path bootstrap ────────────────────────────────────────────────────────────
_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), ".."))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from dotenv import load_dotenv
load_dotenv()

# ── Shared constants ──────────────────────────────────────────────────────────
DATA_DIR = os.path.join(_ROOT, "data")


def display(ticker: str) -> str:
    """Strip exchange suffix for human-readable display (RELIANCE.NS → RELIANCE)."""
    return ticker.replace(".NS", "").replace(".BO", "")


def save_json(path: str, data: dict, **kwargs) -> None:
    """Atomically write JSON to path (tmp file + os.replace)."""
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2, **kwargs)
    os.replace(tmp, path)


def notify(msg: str) -> None:
    """Send message to console and Telegram."""
    from src.notifier import send_console, send_telegram
    send_console(msg)
    send_telegram(msg)


def setup_logging() -> None:
    """Configure rotating-file + stream logging for agent entry points."""
    handler = RotatingFileHandler("agent.log", maxBytes=10 * 1024 * 1024, backupCount=3)
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s: %(message)s",
        handlers=[logging.StreamHandler(), handler],
    )
