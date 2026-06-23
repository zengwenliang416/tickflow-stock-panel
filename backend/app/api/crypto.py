"""Crypto market endpoints backed by OKX."""
from __future__ import annotations

import time

from fastapi import APIRouter, Query

from app.services import okx_market_data

router = APIRouter(prefix="/api/crypto", tags=["crypto"])


def _parse_symbols(symbols: str | None) -> list[str] | None:
    if not symbols or not isinstance(symbols, str):
        return None
    parsed = [item.strip().upper() for item in symbols.split(",") if item.strip()]
    return list(dict.fromkeys(parsed))


@router.get("/tickers")
def tickers(symbols: str | None = Query(default=None, description="Comma-separated OKX instIds")) -> dict:
    selected = _parse_symbols(symbols)
    rows = okx_market_data.fetch_spot_tickers(selected)
    return {
        "source": "okx",
        "market": "SPOT",
        "count": len(rows),
        "symbols": selected or okx_market_data.configured_symbols(),
        "rows": rows,
        "updated_at": int(time.time() * 1000),
        "auth": okx_market_data.auth_status(),
    }
