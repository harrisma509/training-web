import os
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path

import psycopg
from fastapi import FastAPI
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from psycopg.rows import dict_row

from health_api.routes import router as health_router


BASE_DIR = Path(__file__).resolve().parent

app = FastAPI(title="Training Dashboard")
app.include_router(health_router)

app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")


def db_conn():
    return psycopg.connect(
        host=os.environ["DB_HOST"],
        port=os.environ["DB_PORT"],
        dbname=os.environ["DB_NAME"],
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
        row_factory=dict_row,
    )


def json_safe(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()

    if isinstance(value, Decimal):
        return float(value)

    return value


def rows_to_json(rows):
    return [
        {key: json_safe(value) for key, value in row.items()}
        for row in rows
    ]


@app.get("/", response_class=HTMLResponse)
def index():
    return (BASE_DIR / "index.html").read_text(encoding="utf-8")

@app.get("/api/daily")
def api_daily(limit: int = 365):
    limit = max(1, min(limit, 1000))

    sql = """
        with dates AS (
            select date from daily_training
            union
            select date from health_sleep
            union
            select date from health_rhr
            union
            select date from health_steps
            union
            select date from health_hrv
            union
            select date from health_weight
        )
        select
            dates.date AS date,
            daily_training.activity_count,
            daily_training.activity_categories,
            daily_training.ride_count,
            daily_training.walk_count,
            daily_training.hike_count,
            daily_training.strength_count,
            daily_training.mobility_count,
            daily_training.ski_count,
            daily_training.run_count,
            daily_training.other_count,
            daily_training.main_ride_name,
            daily_training.main_ride_bike_name,
            daily_training.main_ride_load,
            daily_training.main_ride_load_source,
            daily_training.main_ride_band,
            daily_training.other_activity_names,
            daily_training.other_load,
            daily_training.total_load,
            health_sleep.sleep_score AS sleep_score,
            health_rhr.rhr_bpm AS rhr_bpm,
            health_hrv.hrv_sdnn_ms AS hrv_sdnn_ms,
            health_steps.steps AS steps,
            health_weight.weight_lb AS weight_lb
        from dates
        left join daily_training
            on daily_training.date = dates.date
        left join health_sleep
            on health_sleep.date = dates.date
        left join health_rhr
            on health_rhr.date = dates.date
        left join health_hrv
            on health_hrv.date = dates.date
        left join health_steps
            on health_steps.date = dates.date
        left join health_weight
            on health_weight.date = dates.date
        order by dates.date desc
        limit %s
    """

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (limit,))
            rows = cur.fetchall()

    return JSONResponse(rows_to_json(rows))


@app.get("/api/weekly")
def api_weekly(limit: int = 60):
    limit = max(1, min(limit, 260))

    sql = """
        select
            week_start,
            week_end,
            total_load,
            main_ride_load,
            other_load,
            activity_days,
            ride_count,
            walk_count,
            hike_count,
            strength_count,
            very_hard_epic_days,
            chronic_weekly_cw,
            ac_ratio,
            ramp_pct_display,
            status_level,
            status_text
        from weekly_training
        order by week_start desc
        limit %s
    """

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (limit,))
            rows = cur.fetchall()

    return JSONResponse(rows_to_json(rows))


@app.get("/api/status")
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

@app.get("/api/sync-status")
def get_sync_status():
    good_statuses = ("ok", "success")

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

@app.post("/api/sync-request")
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