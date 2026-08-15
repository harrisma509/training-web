"""
Daily route module.

Owns the /api/daily endpoint for Daily tab table data.
This endpoint combines daily_training and daily health tables.

Do not put Weekly, Zones, Sync, or Weekly Audit logic here.
"""

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from db import db_conn, rows_to_json

router = APIRouter()


def _ride_search_pattern(query: str) -> str:
    cleaned = (query or "").strip()
    escaped = cleaned.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


@router.get("/api/rides/search")
def api_ride_search(q: str = "", limit: int = 5):
    trimmed_q = (q or "").strip()
    if len(trimmed_q) < 2:
        return JSONResponse({"rows": [], "total_count": 0})

    limit = max(1, min(int(limit or 5), 5))
    like_pattern = _ride_search_pattern(trimmed_q)

    sql = """
        select
            date,
            main_ride_name,
            main_ride_bike_name,
            main_ride_id
        from daily_training
        where
            main_ride_name is not null
            and trim(main_ride_name) <> ''
            and lower(main_ride_name) like lower(%s) escape '\\'
        order by date desc
        limit %s
    """

    count_sql = """
        select count(*) as total_count
        from daily_training
        where
            main_ride_name is not null
            and trim(main_ride_name) <> ''
            and lower(main_ride_name) like lower(%s) escape '\\'
    """

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (like_pattern, limit))
            rows = cur.fetchall()
            cur.execute(count_sql, (like_pattern,))
            totals = cur.fetchone()

    total_count = int((totals or {}).get("total_count", 0) or 0)
    return JSONResponse({"rows": rows_to_json(rows), "total_count": total_count})


@router.get("/api/daily")
def api_daily(limit: int = 365, q: str = ""):
    trimmed_q = (q or "").strip()
    if trimmed_q:
        limit = max(1, min(int(limit or 1000), 1000))
        like_pattern = _ride_search_pattern(trimmed_q)
        sql = """
            select
                daily_training.date AS date,
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
                daily_training.main_ride_id,
                daily_training.main_ride_name,
                daily_training.main_ride_bike_name,
                daily_training.main_ride_time,
                daily_training.main_ride_miles,
                daily_training.main_ride_elevation_ft,
                daily_training.main_ride_load,
                daily_training.main_ride_load_text,
                daily_training.main_ride_band,
                daily_training.main_ride_hr_zones,
                daily_training.other_activity_names,
                daily_training.other_load,
                daily_training.total_load,
                health_sleep.sleep_score AS sleep_score,
                health_sleep.total_sleep_hr AS total_sleep_hr,
                health_rhr.rhr_bpm AS rhr_bpm,
                health_hrv.hrv_sdnn_ms AS hrv_sdnn_ms,
                health_steps.steps AS steps,
                health_weight.weight_lb AS weight_lb
            from daily_training
            left join health_sleep
                on health_sleep.date = daily_training.date
            left join health_rhr
                on health_rhr.date = daily_training.date
            left join health_hrv
                on health_hrv.date = daily_training.date
            left join health_steps
                on health_steps.date = daily_training.date
            left join health_weight
                on health_weight.date = daily_training.date
            where
                daily_training.main_ride_name is not null
                and trim(daily_training.main_ride_name) <> ''
                and lower(daily_training.main_ride_name) like lower(%s) escape '\\'
            order by daily_training.date desc
            limit %s
        """
        count_sql = """
            select count(*) as total_count
            from daily_training
            where
                main_ride_name is not null
                and trim(main_ride_name) <> ''
                and lower(main_ride_name) like lower(%s) escape '\\'
        """
        with db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(count_sql, (like_pattern,))
                total_result = cur.fetchone()
                cur.execute(sql, (like_pattern, limit))
                rows = cur.fetchall()
        total_count = int((total_result or {}).get("total_count", 0) or 0)
        return JSONResponse({"rows": rows_to_json(rows), "total_count": total_count})

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
            daily_training.main_ride_id,
            daily_training.main_ride_name,
            daily_training.main_ride_bike_name,
            daily_training.main_ride_time,
            daily_training.main_ride_miles,
            daily_training.main_ride_elevation_ft,
            daily_training.main_ride_load,
            daily_training.main_ride_load_text,
            daily_training.main_ride_band,
            daily_training.main_ride_hr_zones,
            daily_training.other_activity_names,
            daily_training.other_load,
            daily_training.total_load,
            health_sleep.sleep_score AS sleep_score,
            health_sleep.total_sleep_hr AS total_sleep_hr,
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
