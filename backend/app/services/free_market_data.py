"""免费 A 股行情数据适配层。

当前使用东方财富公开行情接口作为基础模式数据源。这里输出项目内部统一
字段,让 QuoteService / K 线同步 / 指数同步复用现有流水线。
"""
from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta
from urllib.parse import urlencode

import httpx
import polars as pl

logger = logging.getLogger(__name__)

EASTMONEY_UT = "bd1d9ddb04089700cf9c27f6f7426281"
EASTMONEY_QUOTE_HOSTS = ("push2delay.eastmoney.com", "push2.eastmoney.com")
CORE_INDEX_SYMBOLS = ("000001.SH", "399001.SZ", "399006.SZ", "000680.SH")
CORE_INDEX_NAMES = {
    "000001.SH": "上证指数",
    "399001.SZ": "深证成指",
    "399006.SZ": "创业板指",
    "000680.SH": "科创综指",
}


def _get_json(url: str, timeout: float = 10.0) -> dict:
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36"
        ),
        "Accept": "application/json,text/plain,*/*",
        "Referer": "https://quote.eastmoney.com/",
    }
    last_exc: Exception | None = None
    # 公开接口偶发主动断连；先直连，再尊重本机/服务器代理环境兜底。
    for trust_env in (False, True):
        with httpx.Client(
            timeout=timeout,
            follow_redirects=True,
            headers=headers,
            trust_env=trust_env,
        ) as client:
            for attempt in range(3):
                try:
                    resp = client.get(url)
                    resp.raise_for_status()
                    return resp.json()
                except Exception as e:  # noqa: BLE001
                    last_exc = e
                    time.sleep(0.3 * (attempt + 1))
    if last_exc:
        raise last_exc
    return {}


def _get_eastmoney_clist(query: str) -> dict:
    last_exc: Exception | None = None
    for host in EASTMONEY_QUOTE_HOSTS:
        try:
            return _get_json(f"https://{host}/api/qt/clist/get?{query}")
        except Exception as e:  # noqa: BLE001
            last_exc = e
            logger.debug("free clist host failed %s: %s", host, e)
    if last_exc:
        raise last_exc
    return {}


def _get_eastmoney_stock(query: str) -> dict:
    last_exc: Exception | None = None
    for host in EASTMONEY_QUOTE_HOSTS:
        try:
            return _get_json(f"https://{host}/api/qt/stock/get?{query}")
        except Exception as e:  # noqa: BLE001
            last_exc = e
            logger.debug("free stock host failed %s: %s", host, e)
    if last_exc:
        raise last_exc
    return {}


def _to_float(value) -> float | None:
    if value in (None, "", "-"):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _to_symbol(code: str, market: int | None = None) -> str:
    code = str(code).strip()
    if not code:
        return ""
    if code.startswith(("83", "87", "88", "43", "92")):
        return f"{code}.BJ"
    if market == 1 or code.startswith(("5", "6", "9")):
        return f"{code}.SH"
    return f"{code}.SZ"


def _secid(symbol: str) -> str:
    code = symbol.split(".", 1)[0]
    suffix = symbol.split(".", 1)[1].upper() if "." in symbol else ""
    market = 1 if suffix == "SH" or code.startswith(("5", "6", "9")) else 0
    return f"{market}.{code}"


def _quote_row(item: dict) -> dict | None:
    symbol = _to_symbol(str(item.get("f12") or ""), item.get("f13"))
    last_price = _to_float(item.get("f2"))
    if not symbol or last_price is None:
        return None
    prev_close = _to_float(item.get("f18"))
    change_amount = _to_float(item.get("f4"))
    change_pct_raw = _to_float(item.get("f3"))
    amplitude_raw = _to_float(item.get("f7"))
    return {
        "symbol": symbol,
        "name": item.get("f14") or symbol,
        "last_price": last_price,
        "prev_close": prev_close,
        "open": _to_float(item.get("f17")) or last_price,
        "high": _to_float(item.get("f15")) or last_price,
        "low": _to_float(item.get("f16")) or last_price,
        "volume": _to_float(item.get("f5")),
        "amount": _to_float(item.get("f6")),
        # 项目内部 change_pct/amplitude 口径为小数:0.05 = 5%
        "change_pct": change_pct_raw / 100 if change_pct_raw is not None else None,
        "change_amount": change_amount,
        "amplitude": amplitude_raw / 100 if amplitude_raw is not None else None,
        # turnover_rate UI 直接按百分比展示,保留 8.79 = 8.79%
        "turnover_rate": _to_float(item.get("f8")),
        "vol_ratio": _to_float(item.get("f10")),
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "session": "realtime",
    }


def _fetch_realtime_stock_quote_page(
    page: int,
    page_size: int,
    fields: str,
    fs: str,
) -> tuple[int, list[dict]]:
    query = urlencode({
        "pn": page,
        "pz": page_size,
        "po": 1,
        "np": 1,
        "ut": EASTMONEY_UT,
        "fltt": 2,
        "invt": 2,
        "fid": "f3",
        "fs": fs,
        "fields": fields,
    }, safe=",:+")
    data = _get_eastmoney_clist(query)
    payload = data.get("data") or {}
    total = int(payload.get("total") or 0)
    rows = []
    for item in payload.get("diff") or []:
        row = _quote_row(item)
        if row:
            rows.append(row)
    return total, rows


def fetch_realtime_stock_quotes() -> list[dict]:
    """拉取沪深京 A 股实时行情。"""
    fields = "f12,f13,f14,f2,f3,f4,f5,f6,f7,f17,f15,f16,f18,f8,f10"
    # 沪深 A 股主板/创业板/科创板。先使用稳定市场片段,避免扩展片段导致整页失败。
    fs = "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23"
    # push2delay currently caps every page to 100 rows even when pz is larger.
    page_size = 100
    total, rows = _fetch_realtime_stock_quote_page(1, page_size, fields, fs)
    if not rows or len(rows) >= total:
        return rows
    total_pages = max(1, (total + page_size - 1) // page_size)
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {
            pool.submit(_fetch_realtime_stock_quote_page, page, page_size, fields, fs): page
            for page in range(2, total_pages + 1)
        }
        for fut in as_completed(futures):
            page = futures[fut]
            try:
                _, page_rows = fut.result()
                rows.extend(page_rows)
            except Exception as e:  # noqa: BLE001
                logger.warning("free quote page %d failed: %s", page, e)
    return rows


def fetch_realtime_index_quotes(symbols: list[str] | None = None) -> list[dict]:
    symbols = symbols or list(CORE_INDEX_SYMBOLS)
    out: list[dict] = []
    fields = "f43,f44,f45,f46,f47,f48,f57,f58,f60,f168,f169,f170"
    for symbol in symbols:
        query = urlencode({"secid": _secid(symbol), "fltt": 2, "fields": fields})
        try:
            data = _get_eastmoney_stock(query)
        except Exception as e:  # noqa: BLE001
            logger.warning("free index quote failed for %s: %s", symbol, e)
            continue
        item = data.get("data") or {}
        last_price = _to_float(item.get("f43"))
        if last_price is None:
            continue
        change_pct_raw = _to_float(item.get("f170"))
        out.append({
            "symbol": symbol,
            "name": item.get("f58") or CORE_INDEX_NAMES.get(symbol) or symbol,
            "last_price": last_price,
            "close": last_price,
            "prev_close": _to_float(item.get("f60")),
            "open": _to_float(item.get("f46")) or last_price,
            "high": _to_float(item.get("f44")) or last_price,
            "low": _to_float(item.get("f45")) or last_price,
            "volume": _to_float(item.get("f47")),
            "amount": _to_float(item.get("f48")),
            "change_pct": change_pct_raw / 100 if change_pct_raw is not None else None,
            "change_amount": _to_float(item.get("f169")),
            "amplitude": None,
            "timestamp": datetime.now().isoformat(timespec="seconds"),
            "session": "realtime",
        })
    return out


def fetch_realtime_quotes() -> list[dict]:
    return [*fetch_realtime_stock_quotes(), *fetch_realtime_index_quotes()]


def stock_symbols_from_quotes(quotes: list[dict] | None = None) -> list[str]:
    quotes = quotes if quotes is not None else fetch_realtime_stock_quotes()
    return sorted({str(q["symbol"]) for q in quotes if q.get("symbol")})


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
        code, _, suffix = symbol.partition(".")
        rows.append({
            "symbol": symbol,
            "name": row.get("name") or symbol,
            "code": code,
            "exchange": suffix,
            "region": "CN",
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
    if not rows:
        return pl.DataFrame()
    return pl.DataFrame(rows).unique(subset=["symbol"], keep="last").sort("symbol")


def fetch_index_instruments() -> pl.DataFrame:
    rows = fetch_realtime_index_quotes(list(CORE_INDEX_SYMBOLS))
    if not rows:
        rows = [{"symbol": s, "name": CORE_INDEX_NAMES[s]} for s in CORE_INDEX_SYMBOLS]
    return records_to_instruments(rows, asset_type="index")


def fetch_daily(
    symbol: str,
    count: int | None = None,
    start_time: datetime | None = None,
    end_time: datetime | None = None,
) -> pl.DataFrame:
    end_date = (end_time.date() if end_time else date.today())
    if start_time:
        start_date = start_time.date()
    elif count:
        start_date = end_date - timedelta(days=max(count * 2, 30))
    else:
        start_date = end_date - timedelta(days=365)

    query = urlencode({
        "secid": _secid(symbol),
        "fields1": "f1,f2,f3,f4,f5,f6",
        "fields2": "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
        "klt": 101,
        "fqt": 1,
        "beg": start_date.strftime("%Y%m%d"),
        "end": end_date.strftime("%Y%m%d"),
    })
    data = _get_json(f"https://push2his.eastmoney.com/api/qt/stock/kline/get?{query}", timeout=12)
    klines = ((data.get("data") or {}).get("klines")) or []
    rows = []
    for line in klines:
        parts = str(line).split(",")
        if len(parts) < 7:
            continue
        try:
            rows.append({
                "symbol": symbol,
                "date": date.fromisoformat(parts[0]),
                "open": _to_float(parts[1]),
                "close": _to_float(parts[2]),
                "high": _to_float(parts[3]),
                "low": _to_float(parts[4]),
                "volume": _to_float(parts[5]),
                "amount": _to_float(parts[6]),
            })
        except ValueError:
            continue
    if count and len(rows) > count:
        rows = rows[-count:]
    return pl.DataFrame(rows) if rows else pl.DataFrame()


def fetch_daily_batch(
    symbols: list[str],
    count: int | None = None,
    start_time: datetime | None = None,
    end_time: datetime | None = None,
    max_workers: int = 8,
    on_chunk_done=None,
) -> pl.DataFrame:
    if not symbols:
        return pl.DataFrame()
    frames: list[pl.DataFrame] = []
    total = len(symbols)
    done = 0
    workers = max(1, min(max_workers, total))
    with ThreadPoolExecutor(max_workers=workers) as pool:
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
            except Exception as e:  # noqa: BLE001
                logger.warning("free daily fetch failed for %s: %s", symbol, e)
            done += 1
            if on_chunk_done:
                on_chunk_done(done, total)
            if done % 100 == 0:
                time.sleep(0.2)
    if not frames:
        return pl.DataFrame()
    return pl.concat(frames, how="diagonal_relaxed")
