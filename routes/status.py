"""
Dashboard status route module.

Owns /api/status, which provides compact current dashboard status:
- latest day
- last ride
- current week

Do not put sync request logic here.
"""

from datetime import datetime, timezone

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from db import db_conn, json_safe

router = APIRouter()


@router.get("/api/status")
def api_status():
    sql = """
        select
            (
                select row_to_json(d)
                from (
                    select
                        date,
                        activity_categories,
                        main_ride_name,
                        main_ride_bike_name,
                        main_ride_load,
                        main_ride_load_source,
                        other_load,
                        total_load
                    from daily_training
                    order by date desc
                    limit 1
                ) d
            ) as latest_day,
            (
                select row_to_json(r)
                from (
                    select
                        date,
                        main_ride_name,
                        main_ride_bike_name,
                        main_ride_load,
                        main_ride_load_source,
                        total_load
                    from daily_training
                    where main_ride_name <> ''
                    order by date desc
                    limit 1
                ) r
            ) as last_ride,
            (
                select row_to_json(w)
                from (
                    select
                        week_start,
                        total_load,
                        ramp_pct_display,
                        ac_ratio,
                        status_level,
                        status_text
                    from weekly_training
                    order by week_start desc
                    limit 1
                ) w
            ) as current_week
    """

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
            row = cur.fetchone()

    return JSONResponse({key: json_safe(value) for key, value in row.items()})


@router.get("/api/system-status")
def api_system_status():
    """Return a compact system summary for the settings drawer without exposing raw rows."""
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    run_at_utc,
                    status,
                    warning_count,
                    daily_rows,
                    weekly_rows
                FROM sync_run_log
                ORDER BY run_at_utc DESC
                LIMIT 1
                """
            )
            latest_sync = cur.fetchone()

            cur.execute(
                """
                SELECT
                    run_at_utc
                FROM sync_run_log
                WHERE lower(status) IN ('ok', 'success')
                ORDER BY run_at_utc DESC
                LIMIT 1
                """
            )
            last_good_sync = cur.fetchone()

            cur.execute(
                """
                SELECT
                    requested_at_utc,
                    started_at_utc,
                    completed_at_utc,
                    status
                FROM sync_request
                ORDER BY requested_at_utc DESC
                LIMIT 1
                """
            )
            latest_request = cur.fetchone()

    latest_sync_run_at_utc = None if latest_sync is None else latest_sync["run_at_utc"]
    status_value = None if latest_sync is None else latest_sync["status"]
    warning_count = None if latest_sync is None else latest_sync["warning_count"]
    daily_rows = None if latest_sync is None else latest_sync["daily_rows"]
    weekly_rows = None if latest_sync is None else latest_sync["weekly_rows"]
    last_good_sync_run_at_utc = None if last_good_sync is None else last_good_sync["run_at_utc"]
    latest_request_status = None if latest_request is None else latest_request["status"]
    latest_request_requested_at_utc = None if latest_request is None else latest_request["requested_at_utc"]
    latest_request_started_at_utc = None if latest_request is None else latest_request["started_at_utc"]
    latest_request_completed_at_utc = None if latest_request is None else latest_request["completed_at_utc"]

    latest_request_duration_seconds = None
    if latest_request_started_at_utc is not None and latest_request_completed_at_utc is not None:
        started_at = latest_request_started_at_utc
        completed_at = latest_request_completed_at_utc
        if started_at.tzinfo is None:
            started_at = started_at.replace(tzinfo=timezone.utc)
        if completed_at.tzinfo is None:
            completed_at = completed_at.replace(tzinfo=timezone.utc)
        latest_request_duration_seconds = max(0, int((completed_at - started_at).total_seconds()))

    health = "unknown"
    if status_value:
        status_normalized = str(status_value).lower()
        if status_normalized not in ("ok", "success"):
            health = "failed"
        elif last_good_sync_run_at_utc is not None:
            if last_good_sync_run_at_utc.tzinfo is None:
                last_good_sync_run_at_utc = last_good_sync_run_at_utc.replace(tzinfo=timezone.utc)
            now_utc = datetime.now(timezone.utc)
            hours_since_good_sync = round((now_utc - last_good_sync_run_at_utc).total_seconds() / 3600, 1)
            health = "healthy" if hours_since_good_sync <= 8 else "stale"
        else:
            health = "unknown"

    if latest_request_status in ("pending", "running"):
        health = "pending" if latest_request_status == "pending" else "running"

    hours_since_good_sync = None
    if last_good_sync_run_at_utc is not None:
        if last_good_sync_run_at_utc.tzinfo is None:
            last_good_sync_run_at_utc = last_good_sync_run_at_utc.replace(tzinfo=timezone.utc)
        now_utc = datetime.now(timezone.utc)
        hours_since_good_sync = round((now_utc - last_good_sync_run_at_utc).total_seconds() / 3600, 1)

    payload = {
        "health": health,
        "status": status_value,
        "latest_sync_run_at_utc": json_safe(latest_sync_run_at_utc),
        "last_good_sync_run_at_utc": json_safe(last_good_sync_run_at_utc),
        "hours_since_good_sync": hours_since_good_sync,
        "warning_count": warning_count,
        "daily_rows": daily_rows,
        "weekly_rows": weekly_rows,
        "latest_request_status": latest_request_status,
        "latest_request_requested_at_utc": json_safe(latest_request_requested_at_utc),
        "duration_seconds": latest_request_duration_seconds,
        "latest_request_duration_seconds": latest_request_duration_seconds,
    }
    return JSONResponse(payload)
