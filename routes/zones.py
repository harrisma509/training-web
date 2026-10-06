"""
Zones route module.

Owns the /api/zones endpoint for weekly HR zone summary data.
This module should remain read-only.
"""

import logging
import math
from datetime import date

import psycopg
from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse

from csv_export import CsvColumn, csv_response
from db import db_conn, rows_to_json

router = APIRouter()
logger = logging.getLogger(__name__)

ZONES_EXPORT_LIMITS = frozenset({26, 60, 260})
ZONES_EXPORT_COLUMNS = tuple(
    CsvColumn(name, name)
    for name in (
        "week_start",
        "ride_time_hhmm",
        "zone_flag",
        "z1_z2_pct",
        "z3_pct",
        "z4_z5_pct",
        "z1_hhmm",
        "z2_hhmm",
        "z3_hhmm",
        "z4_hhmm",
        "z5_hhmm",
        "ride_count",
    )
)
_ZONE_STRING_FIELDS = ("ride_time_hhmm", "z1_hhmm", "z2_hhmm", "z3_hhmm", "z4_hhmm", "z5_hhmm")
_ZONE_PERCENT_FIELDS = ("z1_z2_pct", "z3_pct", "z4_z5_pct")
_ZONE_ROW_KEYS = frozenset(column.key for column in ZONES_EXPORT_COLUMNS)


def _query_zone_rows(limit: int):
    sql = """
        SELECT
            week_start,
            week_end,
            ride_time_hhmm,
            z1_z2_pct,
            z3_pct,
            z4_z5_pct,
            z1_hhmm,
            z2_hhmm,
            z3_hhmm,
            z4_hhmm,
            z5_hhmm,
            ride_count,
            zone_flag
        FROM public.weekly_zone_summary
        ORDER BY week_start DESC
        LIMIT %s
    """

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (limit,))
            return cur.fetchall()


def _valid_zone_row(row):
    if not isinstance(row, dict) or set(row) != _ZONE_ROW_KEYS:
        return False

    week_start = row["week_start"]
    if not isinstance(week_start, str):
        return False
    try:
        if date.fromisoformat(week_start).isoformat() != week_start:
            return False
    except ValueError:
        return False

    for field in _ZONE_STRING_FIELDS:
        value = row[field]
        if value is not None and (
            not isinstance(value, str)
            or len(value) > 64
        ):
            return False

    zone_flag = row["zone_flag"]
    if zone_flag is not None and (
        not isinstance(zone_flag, str)
        or len(zone_flag) > 64
        or any(ord(character) < 32 for character in zone_flag)
    ):
        return False

    for field in _ZONE_PERCENT_FIELDS:
        value = row[field]
        if value is not None and (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or (isinstance(value, float) and not math.isfinite(value))
        ):
            return False

    ride_count = row["ride_count"]
    if ride_count is not None and (
        isinstance(ride_count, bool)
        or not isinstance(ride_count, int)
        or ride_count < 0
    ):
        return False
    return True


@router.get("/api/zones")
def api_zones(limit: int = 60):
    limit = max(1, min(limit, 260))
    rows = _query_zone_rows(limit)
    return JSONResponse(rows_to_json(rows))


@router.post("/api/zones/export")
def export_zones(payload: dict | None = Body(default=None)):
    if not isinstance(payload, dict) or set(payload) != {"limit", "rows"}:
        return JSONResponse(
            {"detail": "Export payload must contain only limit and rows."},
            status_code=422,
        )

    limit = payload["limit"]
    rows = payload["rows"]
    if isinstance(limit, bool) or not isinstance(limit, int) or limit not in ZONES_EXPORT_LIMITS:
        return JSONResponse(
            {"detail": "limit must be one of 26, 60, or 260."},
            status_code=422,
        )
    if not isinstance(rows, list) or not rows or len(rows) > limit:
        return JSONResponse(
            {"detail": "rows must contain between 1 and the selected limit."},
            status_code=422,
        )
    if any(not _valid_zone_row(row) for row in rows):
        return JSONResponse(
            {"detail": "rows contain an invalid Zones export row."},
            status_code=422,
        )

    dates = [row["week_start"] for row in rows]
    if len(set(dates)) != len(dates) or dates != sorted(dates, reverse=True):
        return JSONResponse(
            {"detail": "rows must preserve the unique newest-first Zones order."},
            status_code=422,
        )

    try:
        return csv_response(ZONES_EXPORT_COLUMNS, rows, "training-zones.csv")
    except (TypeError, ValueError, UnicodeError) as error:
        logger.error("Zones export serialization failed (%s).", type(error).__name__)
        return JSONResponse(
            {"detail": "Zones export is temporarily unavailable."},
            status_code=503,
        )
