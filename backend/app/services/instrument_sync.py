"""标的维表同步服务。

盘前 9:10 调用 tf.exchanges.get_instruments("SH"/"SZ"/"BJ", type="stock")
获取全量标的元数据，flatten ext 字段，写入 instruments.parquet。

Starter+ 盘后可用 quotes.get(universes) 顺便补充 name。
"""
from __future__ import annotations

import logging
from datetime import date
from pathlib import Path

import polars as pl

from app.config import settings
from app.tickflow.client import get_client

logger = logging.getLogger(__name__)

_EXCHANGES = ["SH", "SZ", "BJ"]


def _flatten_instruments(items: list[dict]) -> list[dict]:
    """把 SDK 返回的 Instrument 列表 flatten 成扁平行。"""
    rows = []
    for item in items:
        row = {
            "symbol": item.get("symbol"),
            "name": item.get("name"),
            "code": item.get("code"),
            "exchange": item.get("exchange"),
            "region": item.get("region"),
            "type": item.get("type"),
        }
        ext = item.get("ext") or {}
        row["listing_date"] = ext.get("listing_date")
        row["total_shares"] = ext.get("total_shares")
        row["float_shares"] = ext.get("float_shares")
        row["tick_size"] = ext.get("tick_size")
        row["limit_up"] = ext.get("limit_up")
        row["limit_down"] = ext.get("limit_down")
        rows.append(row)
    return rows


def sync_instruments(data_dir: Path) -> int:
    """全量同步标的维表 → data/instruments/instruments.parquet。

    返回写入的行数。
    """
    if settings.use_longbridge:
        try:
            from app.services import longbridge_market_data
            df = longbridge_market_data.fetch_instruments()
            return _write_instruments(data_dir, df, "Longbridge instruments")
        except Exception as e:  # noqa: BLE001
            logger.warning("Longbridge instruments sync failed: %s", e)
            return 0

    tf = get_client()
    all_rows: list[dict] = []

    for ex in _EXCHANGES:
        try:
            items = tf.exchanges.get_instruments(ex, instrument_type="stock")
            if items:
                all_rows.extend(_flatten_instruments(items))
                logger.info("instruments %s: %d stocks", ex, len(items))
        except Exception as e:
            logger.warning("get_instruments(%s) failed: %s", ex, e)

    if not all_rows:
        try:
            from app.services import free_market_data
            quotes = free_market_data.fetch_realtime_stock_quotes()
            return save_instruments_from_quotes(data_dir, quotes)
        except Exception as e:  # noqa: BLE001
            logger.warning("free instruments sync failed: %s", e)
            return 0

    df = pl.DataFrame(all_rows)
    df = df.with_columns(pl.lit(date.today()).alias("as_of"))
    return _write_instruments(data_dir, df, "instruments synced")


def _write_instruments(data_dir: Path, df: pl.DataFrame, label: str) -> int:
    if df.is_empty():
        return 0
    out = data_dir / "instruments" / "instruments.parquet"
    out.parent.mkdir(parents=True, exist_ok=True)
    df.write_parquet(out)
    logger.info("%s: %d rows → %s", label, df.height, out)
    return df.height


def save_instruments_from_quotes(data_dir: Path, quotes_data: list[dict]) -> int:
    """用免费行情/实时行情里的 symbol/name 生成 instruments 维表。"""
    if not quotes_data:
        return 0
    if settings.use_longbridge:
        from app.services import longbridge_market_data
        df = longbridge_market_data.records_to_instruments(quotes_data, asset_type="stock")
    else:
        from app.services import free_market_data
        df = free_market_data.records_to_instruments(quotes_data, asset_type="stock")
    return _write_instruments(data_dir, df, "instruments synced from quotes")


def enrich_names_from_quotes(
    data_dir: Path,
    quotes_data: list[dict],
) -> int:
    """从 quotes 响应中提取 name，更新 instruments 维表（兜底补充）。

    盘后 quotes.get(universes) 返回的数据中包含 ext.name，
    用来补充 instruments 中可能缺失的 name。
    """
    if not quotes_data:
        return 0

    # 构建 symbol → name 映射
    name_map: dict[str, str] = {}
    for q in quotes_data:
        symbol = q.get("symbol", "")
        ext = q.get("ext") or {}
        name = ext.get("name") or q.get("name", "")
        if symbol and name:
            name_map[symbol] = name

    if not name_map:
        return 0

    inst_path = data_dir / "instruments" / "instruments.parquet"
    if not inst_path.exists():
        return 0

    df = pl.read_parquet(inst_path)

    # 只更新空 name 的行
    updates = pl.DataFrame({
        "symbol": list(name_map.keys()),
        "_new_name": list(name_map.values()),
    })
    df = df.join(updates, on="symbol", how="left")
    df = df.with_columns(
        pl.when(pl.col("name").is_null() | (pl.col("name") == ""))
        .then(pl.col("_new_name"))
        .otherwise(pl.col("name"))
        .alias("name"),
    ).drop("_new_name")

    df.write_parquet(inst_path)
    logger.info("instruments name enriched from quotes: %d names", len(name_map))
    return len(name_map)
