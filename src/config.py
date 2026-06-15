"""Cached YAML config loader shared by src/ modules."""
import os
from typing import Optional
import yaml

_CONFIG_PATH = os.path.join(os.path.dirname(__file__), "..", "config.yaml")
_cache: Optional[dict] = None


def load() -> dict:
    global _cache
    if _cache is None:
        try:
            with open(_CONFIG_PATH) as f:
                _cache = yaml.safe_load(f) or {}
        except FileNotFoundError:
            _cache = {}
    return _cache
