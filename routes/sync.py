"""
Sync route module.

Owns sync status and sync request endpoints:
- /api/sync-status
- /api/sync-request

This module reports latest sync health and inserts sync_request rows.
Do not put ETL implementation logic here.
"""

from datetime import datetime, timezone

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from db import db_conn

router = APIRouter()


def _format_sync_response(latest, open_request, latest_good):
    good_statuses = ("ok", "success")

    if not latest:
        return {
            "health": "unknown",
            "label": "No sync history",
            "last_sync_time_utc": None,
            "hours_since_good_sync": None,
            "status": None,
            "days_back": None,
            "activity_count": None,
            "warning_count": None,
            "daily_rows": None,
            "weekly_rows": None
        }

    run_at_utc = latest["run_at_utc"]
    days_back = latest["days_back"]
    activity_count = latest["activity_count"]
    daily_rows = latest["daily_rows"]
    weekly_rows = latest["weekly_rows"]
    warning_count = latest["warning_count"]
    status = latest["status"]

    status_normalized = status.lower() if status else ""
    latest_good_time = latest_good["run_at_utc"] if latest_good else None
    hours_since_good_sync = None

    if latest_good_time:
        if latest_good_time.tzinfo is None:
            latest_good_time = latest_good_time.replace(tzinfo=timezone.utc)

        now_utc = datetime.now(timezone.utc)
        hours_since_good_sync = round((now_utc - latest_good_time).total_seconds() / 3600, 1)

    if status_normalized not in good_statuses:
        health = "failed"
        label = "Last sync had an error"
    elif hours_since_good_sync is not None and hours_since_good_sync <= 8:
        health = "healthy"
        label = "Sync current"
    elif hours_since_good_sync is not None:
        health = "stale"
        label = "Sync not current"
    else:
        health = "unknown"
        label = "No good sync found"

    request_id = None
    request_status = None
    request_time_utc = None

    if open_request:
        request_id = open_request["id"]
        request_status = open_request["status"]
        request_time_utc = open_request["requested_at_utc"]

        if request_status == "pending":
            health = "pending"
            label = "Sync requested"
        elif request_status == "running":
            health = "running"
            label = "Sync running"

    return {
        "health": health,
        "label": label,
        "last_sync_time_utc": run_at_utc.isoformat() if run_at_utc else None,
        "hours_since_good_sync": hours_since_good_sync,
        "status": status,
        "days_back": days_back,
        "activity_count": activity_count,
        "warning_count": warning_count,
        "daily_rows": daily_rows,
        "weekly_rows": weekly_rows,
        "sync_request_id": request_id,
        "sync_request_status": request_status,
        "sync_request_time_utc": request_time_utc.isoformat() if request_time_utc else None
    }


@router.get("/api/sync-status")
def get_sync_status():
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    run_at_utc,
                    days_back,
                    activity_count,
                    daily_rows,
                    weekly_rows,
                    warning_count,
                    status
                FROM sync_run_log
                ORDER BY run_at_utc DESC
                LIMIT 1
            """)
            latest = cur.fetchone()

            cur.execute("""
                SELECT
                    id,
                    requested_at_utc,
                    status,
                    days_back
                FROM sync_request
                WHERE status IN ('pending', 'running')
                ORDER BY requested_at_utc DESC
                LIMIT 1
            """)
            open_request = cur.fetchone()

            cur.execute("""
                SELECT run_at_utc
                FROM sync_run_log
                WHERE lower(status) IN ('ok', 'success')
                ORDER BY run_at_utc DESC
                LIMIT 1
            """)
            latest_good = cur.fetchone()
    finally:
        conn.close()

    return JSONResponse(_format_sync_response(latest, open_request, latest_good))


@router.post("/api/sync-request")
def create_sync_request():
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    id,
                    requested_at_utc,
                    status,
                    days_back
                FROM sync_request
                WHERE status IN ('pending', 'running')
                ORDER BY requested_at_utc DESC
                LIMIT 1
            """)
            existing = cur.fetchone()

            if existing:
                return {
                    "created": False,
                    "message": "Sync already requested",
                    "request_id": existing["id"],
                    "status": existing["status"],
                    "requested_at_utc": existing["requested_at_utc"].isoformat(),
                    "days_back": existing["days_back"]
                }

            cur.execute("""
                INSERT INTO sync_request (
                    requested_by,
                    days_back,
                    status
                )
                VALUES (
                    'dashboard',
                    7,
                    'pending'
                )
                RETURNING
                    id,
                    requested_at_utc,
                    status,
                    days_back
            """)
            row = cur.fetchone()

    return {
        "created": True,
        "message": "Sync requested",
        "request_id": row["id"],
        "status": row["status"],
        "requested_at_utc": row["requested_at_utc"].isoformat(),
        "days_back": row["days_back"]
    }
