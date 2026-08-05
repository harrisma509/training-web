"""
Zones route module.

Owns the /api/zones endpoint for weekly HR zone summary data.
This module should remain read-only.
"""

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from db import db_conn, rows_to_json

router = APIRouter()


@router.get("/api/zones")
def api_zones(limit: int = 60):
    limit = max(1, min(limit, 260))

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
            rows = cur.fetchall()

    return JSONResponse(rows_to_json(rows))
