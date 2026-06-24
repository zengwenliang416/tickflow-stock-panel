"""Longbridge/LongPort market data adapter."""
from __future__ import annotations

import json
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime
from decimal import Decimal
from functools import lru_cache
from pathlib import Path
from typing import Any

import polars as pl
from longbridge.openapi import (
    AdjustType,
    Config,
    Language,
    Market,
    OAuthBuilder,
    Period,
    QuoteContext,
)

logger = logging.getLogger(__name__)

CORE_INDEX_SYMBOLS = (".DJI.US", ".IXIC.US", ".SPX.US", "HSI.HK", "HSTECH.HK")
CORE_INDEX_NAMES = {
    ".DJI.US": "道琼斯",
    ".IXIC.US": "纳斯达克",
    ".SPX.US": "标普500",
    "HSI.HK": "恒生指数",
    "HSTECH.HK": "恒生科技",
}

CN_STOCK_PREFIXES = {
    "SH": ("600", "601", "603", "605", "688", "689"),
    "SZ": ("000", "001", "002", "003", "300", "301"),
    "BJ": ("4", "8", "9"),
}
CN_NON_STOCK_NAME_KEYWORDS = (
    "ETF",
    "LOF",
    "REIT",
    "基金",
    "债",
    "转债",
    "指数",
    "货币",
    "理财",
)


def _to_float(value: Any) -> float | None:
    if value in (None, "", "-"):
        return None
    if isinstance(value, Decimal):
        return float(value)
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _token_client_id() -> str:
    token_dir = Path.home() / ".longbridge" / "openapi" / "tokens"
    for path in sorted(token_dir.glob("*")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        client_id = data.get("client_id")
        if isinstance(client_id, str) and client_id:
            return client_id
    raise RuntimeError(f"Longbridge OAuth token not found under {token_dir}")


def _build_oauth():
    client_id = _token_client_id()

    def _auth_required(url: str) -> None:
        raise RuntimeError(f"Longbridge OAuth token expired; re-login required: {url}")

    return OAuthBuilder(client_id).build(_auth_required)


@lru_cache(maxsize=1)
def get_quote_context() -> QuoteContext:
    config = Config.from_oauth(
        _build_oauth(),
        language=Language.ZH_CN,
        enable_print_quote_packages=False,
    )
    return QuoteContext(config)


def _quote_row(item: Any) -> dict:
    symbol = str(item.symbol)
    names = _watchlist_name_map()
    last_price = _to_float(item.last_done)
    prev_close = _to_float(item.prev_close)
    change_amount = None
    change_pct = None
    if last_price is not None and prev_close not in (None, 0):
        change_amount = last_price - prev_close
        change_pct = change_amount / prev_close
    high = _to_float(item.high) or last_price
    low = _to_float(item.low) or last_price
    amplitude = None
    if high is not None and low is not None and prev_close not in (None, 0):
        amplitude = (high - low) / prev_close
    timestamp = item.timestamp.isoformat() if getattr(item, "timestamp", None) else datetime.now().isoformat(timespec="seconds")
    return {
        "symbol": symbol,
        "name": CORE_INDEX_NAMES.get(symbol) or names.get(symbol) or symbol,
        "last_price": last_price,
        "prev_close": prev_close,
        "open": _to_float(item.open) or last_price,
        "high": high,
        "low": low,
        "volume": _to_float(item.volume),
        "amount": _to_float(item.turnover),
        "change_pct": change_pct,
        "change_amount": change_amount,
        "amplitude": amplitude,
        "turnover_rate": None,
        "timestamp": timestamp,
        "session": str(getattr(item, "trade_status", "realtime")),
    }


def _quote_rows(symbols: list[str]) -> list[dict]:
    if not symbols:
        return []
    ctx = get_quote_context()
    out = []
    for item in ctx.quote(symbols):
        out.append(_quote_row(item))
    return out


def _security_name(item: Any) -> str:
    return str(
        getattr(item, "name_cn", None)
        or getattr(item, "name_hk", None)
        or getattr(item, "name_en", None)
        or getattr(item, "symbol", "")
    )


def _is_cn_stock_security(item: Any) -> bool:
    symbol = str(getattr(item, "symbol", "") or "")
    code, _, market = symbol.partition(".")
    prefixes = CN_STOCK_PREFIXES.get(market)
    if not code or not prefixes or not code.startswith(prefixes):
        return False

    name = _security_name(item)
    lowered = name.lower()
    return not any(keyword.lower() in lowered for keyword in CN_NON_STOCK_NAME_KEYWORDS)


@lru_cache(maxsize=1)
def cn_stock_instruments() -> tuple[dict, ...]:
    """Return A-share stock instruments from Longbridge CN security list."""
    ctx = get_quote_context()
    rows: list[dict] = []
    for item in ctx.security_list(Market.CN):
        if not _is_cn_stock_security(item):
            continue
        symbol = str(item.symbol)
        code, _, market = symbol.partition(".")
        rows.append({
            "symbol": symbol,
            "name": _security_name(item),
            "code": code,
            "exchange": market,
            "region": "CN",
            "type": "stock",
            "asset_type": "stock",
            "listing_date": None,
            "total_shares": None,
            "float_shares": None,
            "tick_size": None,
            "limit_up": None,
            "limit_down": None,
            "as_of": date.today(),
        })
    return tuple(sorted(rows, key=lambda row: row["symbol"]))


def cn_stock_symbols() -> list[str]:
    return [row["symbol"] for row in cn_stock_instruments()]


@lru_cache(maxsize=1)
def watchlist_instruments() -> tuple[dict, ...]:
    ctx = get_quote_context()
    by_symbol: dict[str, dict] = {}
    for group in ctx.watchlist():
        for sec in getattr(group, "securities", []) or []:
            symbol = str(sec.symbol)
            market = str(sec.market).split(".")[-1]
            by_symbol[symbol] = {
                "symbol": symbol,
                "name": str(sec.name) if sec.name else symbol,
                "market": market,
            }
    return tuple(sorted(by_symbol.values(), key=lambda row: row["symbol"]))


def _watchlist_name_map() -> dict[str, str]:
    return {row["symbol"]: row["name"] for row in watchlist_instruments() if row.get("name")}


def watchlist_symbols() -> list[str]:
    return [row["symbol"] for row in watchlist_instruments()]


def stock_symbols_from_quotes(quotes: list[dict] | None = None) -> list[str]:
    return sorted({row["symbol"] for row in (quotes or watchlist_instruments()) if row.get("symbol")})


def fetch_realtime_stock_quotes(symbols: list[str] | None = None) -> list[dict]:
    symbols = symbols or watchlist_symbols()
    return fetch_realtime_quotes_by_symbols(symbols)


def fetch_realtime_index_quotes(symbols: list[str] | None = None) -> list[dict]:
    return fetch_realtime_quotes_by_symbols(symbols or list(CORE_INDEX_SYMBOLS))


def fetch_realtime_quotes_by_symbols(symbols: list[str], batch_size: int = 100) -> list[dict]:
    if not symbols:
        return []
    rows: list[dict] = []
    seen: set[str] = set()
    for i in range(0, len(symbols), batch_size):
        chunk = [s for s in symbols[i:i + batch_size] if s and s not in seen]
        seen.update(chunk)
        rows.extend(_quote_rows(chunk))
    return rows


def fetch_realtime_quotes() -> list[dict]:
    symbols = [*watchlist_symbols(), *CORE_INDEX_SYMBOLS]
    return fetch_realtime_quotes_by_symbols(symbols)


def records_to_daily(records: list[dict], trade_date: date | None = None) -> pl.DataFrame:
    if not records:
        return pl.DataFrame()
    trade_date = trade_date or date.today()
    rows = []
    for row in records:
        close = _to_float(row.get("last_price"))
        if close is None:
            continue
        rows.append({
            "symbol": row.get("symbol"),
            "date": trade_date,
            "open": _to_float(row.get("open")) or close,
            "high": _to_float(row.get("high")) or close,
            "low": _to_float(row.get("low")) or close,
            "close": close,
            "volume": _to_float(row.get("volume")),
            "amount": _to_float(row.get("amount")),
        })
    return pl.DataFrame(rows) if rows else pl.DataFrame()


def records_to_instruments(records: list[dict], asset_type: str = "stock") -> pl.DataFrame:
    rows = []
    for row in records:
        symbol = str(row.get("symbol") or "")
        if not symbol:
            continue
        code, _, market = symbol.partition(".")
        rows.append({
            "symbol": symbol,
            "name": row.get("name") or symbol,
            "code": code,
            "exchange": market,
            "region": market,
            "type": asset_type,
            "asset_type": asset_type,
            "listing_date": None,
            "total_shares": None,
            "float_shares": None,
            "tick_size": None,
            "limit_up": None,
            "limit_down": None,
            "as_of": date.today(),
        })
    return pl.DataFrame(rows).unique(subset=["symbol"], keep="last").sort("symbol") if rows else pl.DataFrame()


def fetch_instruments() -> pl.DataFrame:
    frames: list[pl.DataFrame] = []
    cn_rows = list(cn_stock_instruments())
    if cn_rows:
        frames.append(pl.DataFrame(cn_rows))

    watchlist_rows = list(watchlist_instruments())
    if watchlist_rows:
        frames.append(records_to_instruments(watchlist_rows, asset_type="stock"))

    if not frames:
        return pl.DataFrame()
    return pl.concat(frames, how="diagonal_relaxed").unique(subset=["symbol"], keep="first").sort("symbol")


def fetch_index_instruments() -> pl.DataFrame:
    rows = [{"symbol": s, "name": CORE_INDEX_NAMES[s]} for s in CORE_INDEX_SYMBOLS]
    return records_to_instruments(rows, asset_type="index")


def fetch_daily(symbol: str, count: int | None = None, start_time: datetime | None = None, end_time: datetime | None = None) -> pl.DataFrame:
    del start_time, end_time
    ctx = get_quote_context()
    candles = ctx.candlesticks(symbol, Period.Day, count or 260, AdjustType.NoAdjust)
    rows = []
    for candle in candles:
        ts = candle.timestamp
        rows.append({
            "symbol": symbol,
            "date": ts.date() if hasattr(ts, "date") else date.fromisoformat(str(ts)[:10]),
            "open": _to_float(candle.open),
            "high": _to_float(candle.high),
            "low": _to_float(candle.low),
            "close": _to_float(candle.close),
            "volume": _to_float(candle.volume),
            "amount": _to_float(candle.turnover),
        })
    return pl.DataFrame(rows) if rows else pl.DataFrame()


def fetch_daily_batch(
    symbols: list[str],
    count: int | None = None,
    start_time: datetime | None = None,
    end_time: datetime | None = None,
    max_workers: int = 6,
    on_chunk_done=None,
) -> pl.DataFrame:
    if not symbols:
        return pl.DataFrame()
    frames: list[pl.DataFrame] = []
    total = len(symbols)
    done = 0
    with ThreadPoolExecutor(max_workers=max(1, min(max_workers, total))) as pool:
        futures = {
            pool.submit(fetch_daily, symbol, count, start_time, end_time): symbol
            for symbol in symbols
        }
        for fut in as_completed(futures):
            symbol = futures[fut]
            try:
                df = fut.result()
                if not df.is_empty():
                    frames.append(df)
            except Exception as e:
                logger.warning("Longbridge daily fetch failed for %s: %s", symbol, e)
            done += 1
            if on_chunk_done:
                on_chunk_done(done, total)
    return pl.concat(frames, how="diagonal_relaxed") if frames else pl.DataFrame()
