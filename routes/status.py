"""
Dashboard status route module.

Owns /api/status, which provides compact current dashboard status:
- latest day
- last ride
- current week

Do not put sync request logic here.
"""

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
