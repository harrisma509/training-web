"""
Daily route module.

Owns the /api/daily endpoint for Daily tab table data.
This endpoint combines daily_training and daily health tables.

Do not put Weekly, Zones, Sync, or Weekly Audit logic here.
"""

from datetime import date as Date

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from db import db_conn, rows_to_json

router = APIRouter()
MAX_READ_RANGE_DAYS = 119


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
def api_daily(
    limit: int = 365,
    q: str = "",
    date: Date | None = None,
    start_date: Date | None = None,
    end_date: Date | None = None,
):
    if date is not None and (start_date is not None or end_date is not None):
        raise HTTPException(status_code=422, detail="date cannot be combined with a date range")
    if (start_date is None) != (end_date is None):
        raise HTTPException(status_code=422, detail="start_date and end_date must be provided together")
    if start_date is not None and start_date >= end_date:
        raise HTTPException(status_code=422, detail="start_date must be before end_date")
    if start_date is not None and (end_date - start_date).days > MAX_READ_RANGE_DAYS:
        raise HTTPException(status_code=422, detail="date range must not exceed 119 days")

    trimmed_q = (q or "").strip()
    if trimmed_q:
        limit = max(1, min(int(limit or 1000), 1000))
        like_pattern = _ride_search_pattern(trimmed_q)
        date_filter = "\n                and daily_training.date = %s" if date is not None else ""
        range_filter = (
            "\n                and daily_training.date >= %s"
            "\n                and daily_training.date < %s"
            if start_date is not None else ""
        )
        count_date_filter = "\n                and date = %s" if date is not None else ""
        count_range_filter = (
            "\n                and date >= %s"
            "\n                and date < %s"
            if start_date is not None else ""
        )
        sql = f"""
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
                daily_training.main_ride_sport_type,
                daily_training.main_ride_category,
                daily_training.main_ride_bike_name,
                daily_training.main_ride_time,
                daily_training.main_ride_miles,
                daily_training.main_ride_elevation_ft,
                daily_training.main_ride_load,
                daily_training.main_ride_load_text,
                daily_training.main_ride_band,
                daily_training.main_ride_hr_zones,
                (coalesce(nullif(trim(narrative_activity.description), ''), '') <> '')
                    AS main_ride_has_description,
                (coalesce(nullif(trim(narrative_activity.private_note), ''), '') <> '')
                    AS main_ride_has_private_note,
                daily_training.other_activities,
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
            left join strava_activities AS narrative_activity
                on narrative_activity.activity_id = daily_training.main_ride_id
            where
                daily_training.main_ride_name is not null
                and trim(daily_training.main_ride_name) <> ''
                and lower(daily_training.main_ride_name) like lower(%s) escape '\\'
                {date_filter}
                {range_filter}
            order by daily_training.date desc
            limit %s
        """
        count_sql = f"""
            select count(*) as total_count
            from daily_training
            where
                main_ride_name is not null
                and trim(main_ride_name) <> ''
                and lower(main_ride_name) like lower(%s) escape '\\'
                {count_date_filter}
                {count_range_filter}
        """
        count_params = (
            (like_pattern, date) if date is not None
            else (like_pattern, start_date, end_date) if start_date is not None
            else (like_pattern,)
        )
        query_params = (
            (like_pattern, date, limit) if date is not None
            else (like_pattern, start_date, end_date, limit) if start_date is not None
            else (like_pattern, limit)
        )
        with db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(count_sql, count_params)
                total_result = cur.fetchone()
                cur.execute(sql, query_params)
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
            daily_training.main_ride_sport_type,
            daily_training.main_ride_category,
            daily_training.main_ride_bike_name,
            daily_training.main_ride_time,
            daily_training.main_ride_miles,
            daily_training.main_ride_elevation_ft,
            daily_training.main_ride_load,
            daily_training.main_ride_load_text,
            daily_training.main_ride_band,
            daily_training.main_ride_hr_zones,
            (coalesce(nullif(trim(narrative_activity.description), ''), '') <> '')
                AS main_ride_has_description,
            (coalesce(nullif(trim(narrative_activity.private_note), ''), '') <> '')
                AS main_ride_has_private_note,
            daily_training.other_activities,
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
        left join strava_activities AS narrative_activity
            on narrative_activity.activity_id = daily_training.main_ride_id
    """
    filters = []
    params = []
    if date is not None:
        filters.append("dates.date = %s")
        params.append(date)
    if start_date is not None:
        filters.extend(["dates.date >= %s", "dates.date < %s"])
        params.extend([start_date, end_date])
    if filters:
        sql += "\n        where " + " and ".join(filters)
    sql += "\n        order by dates.date desc\n        limit %s"
    params.append(limit)

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, tuple(params))
            rows = cur.fetchall()

    return JSONResponse(rows_to_json(rows))


@router.get("/api/activities/{activity_id}/narrative")
def api_activity_narrative(activity_id: int):
    try:
        with db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    select
                        activity_id,
                        description,
                        private_note,
                        narrative_observed_at
                    from strava_activities
                    where activity_id = %s
                    limit 1
                    """,
                    (str(activity_id),),
                )
                row = cur.fetchone()
    except Exception:
        return JSONResponse(
            {"detail": "Activity narrative is temporarily unavailable."},
            status_code=503,
        )

    if not row:
        return JSONResponse({"detail": "Activity not found."}, status_code=404)

    description = row.get("description")
    private_note = row.get("private_note")
    if description is not None and not str(description).strip():
        description = None
    if private_note is not None and not str(private_note).strip():
        private_note = None
    observed_at = row.get("narrative_observed_at")
    return JSONResponse({
        "activity_id": row["activity_id"],
        "description": description,
        "private_note": private_note,
        "has_description": bool(description and str(description).strip()),
        "has_private_note": bool(private_note and str(private_note).strip()),
        "narrative_observed_at": observed_at.isoformat() if observed_at else None,
    })
