"""OKX public crypto market data adapter."""
from __future__ import annotations

import time
from datetime import UTC, datetime
from typing import Any

import httpx

from app.config import settings

DEFAULT_SYMBOL_NAMES = {
    "BTC-USDT": "Bitcoin",
    "ETH-USDT": "Ethereum",
    "SOL-USDT": "Solana",
    "OKB-USDT": "OKB",
    "XRP-USDT": "XRP",
    "DOGE-USDT": "Dogecoin",
}

_CACHE_TTL = 3.0
_cache_key: tuple[str, ...] | None = None
_cache_rows: list[dict] = []
_cache_ts: float = 0.0


def _to_float(value: Any) -> float | None:
    if value in (None, "", "-"):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def configured_symbols() -> list[str]:
    raw = settings.okx_symbols or ""
    symbols = [item.strip().upper() for item in raw.split(",") if item.strip()]
    return list(dict.fromkeys(symbols))


def _ms_to_iso(value: Any) -> str | None:
    ts = _to_float(value)
    if ts is None:
        return None
    try:
        return datetime.fromtimestamp(ts / 1000, tz=UTC).isoformat()
    except (OSError, OverflowError, ValueError):
        return None


def _display_name(inst_id: str) -> str:
    if inst_id in DEFAULT_SYMBOL_NAMES:
        return DEFAULT_SYMBOL_NAMES[inst_id]
    base, _, quote = inst_id.partition("-")
    return f"{base}/{quote}" if quote else inst_id


def _normalize(row: dict) -> dict:
    inst_id = str(row.get("instId") or "").upper()
    base, _, quote = inst_id.partition("-")
    last = _to_float(row.get("last"))
    open_24h = _to_float(row.get("open24h"))
    change_amount = None
    change_pct = None
    if last is not None and open_24h not in (None, 0):
        change_amount = last - open_24h
        change_pct = change_amount / open_24h
    return {
        "symbol": inst_id,
        "name": _display_name(inst_id),
        "base": base or None,
        "quote": quote or None,
        "last_price": last,
        "open_24h": open_24h,
        "high_24h": _to_float(row.get("high24h")),
        "low_24h": _to_float(row.get("low24h")),
        "volume_24h": _to_float(row.get("vol24h")),
        "amount_24h": _to_float(row.get("volCcy24h")),
        "bid_price": _to_float(row.get("bidPx")),
        "ask_price": _to_float(row.get("askPx")),
        "change_amount": change_amount,
        "change_pct": change_pct,
        "timestamp": _ms_to_iso(row.get("ts")),
    }


def fetch_spot_tickers(symbols: list[str] | None = None) -> list[dict]:
    wanted = tuple(symbols or configured_symbols())
    now = time.monotonic()
    global _cache_key, _cache_rows, _cache_ts
    if _cache_key == wanted and now - _cache_ts < _CACHE_TTL:
        return list(_cache_rows)

    url = f"{settings.okx_base_url.rstrip('/')}/api/v5/market/tickers"
    with httpx.Client(timeout=12.0, headers={"User-Agent": "tickflow-stock-panel/okx"}) as client:
        resp = client.get(url, params={"instType": "SPOT"})
        resp.raise_for_status()
        payload = resp.json()

    if str(payload.get("code")) != "0":
        raise RuntimeError(f"OKX market API error: {payload.get('msg') or payload.get('code')}")

    rows = payload.get("data") or []
    wanted_set = set(wanted)
    by_symbol = {
        str(row.get("instId") or "").upper(): _normalize(row)
        for row in rows
        if not wanted_set or str(row.get("instId") or "").upper() in wanted_set
    }
    ordered = [by_symbol[s] for s in wanted if s in by_symbol] if wanted else list(by_symbol.values())

    _cache_key = wanted
    _cache_rows = ordered
    _cache_ts = now
    return list(ordered)


def auth_status() -> dict:
    return {
        "api_key_configured": bool(settings.okx_api_key),
        "api_secret_configured": bool(settings.okx_api_secret),
        "passphrase_configured": bool(settings.okx_api_passphrase),
    }
