"""
Weekly audit route module.

Owns the /api/weekly-audit/{week_start}/items endpoint for Weekly Audit details.
This endpoint returns read-only audit item rows for a specific week.

Do not add write endpoints or Weekly Audit edit behavior here.
"""

from datetime import datetime

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from db import db_conn, rows_to_json

router = APIRouter()


@router.get("/api/weekly-audit/{week_start}/items")
def get_weekly_audit_items(week_start: str):
    try:
        week_start_date = datetime.strptime(week_start, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=422, detail="week_start must be YYYY-MM-DD")

    sql = """
        SELECT
            week_start,
            item_key,
            item_label,
            status,
            summary,
            sort_order,
            evidence_json
        FROM weekly_audit_item
        WHERE week_start = %s
        ORDER BY sort_order
    """

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (week_start_date,))
            rows = cur.fetchall()

    return JSONResponse(rows_to_json(rows))
