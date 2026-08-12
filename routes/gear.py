"""
Gear route module.

Owns the /api/gear/dashboard endpoint for the Gear tab summary.
This endpoint queries only gear and strava_activities.
"""

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from db import db_conn, rows_to_json

router = APIRouter()


@router.get("/api/gear/dashboard")
def api_gear_dashboard(limit: int = 60):
    limit = max(1, min(limit, 260))

    sql = """
        select
            g.gear_id,
            g.gear_name,
            g.gear_type,
            null::text as category,
            g.brand,
            g.model_year,
            coalesce(g.retired, false) as retired,
            not coalesce(g.retired, false) as active,
            count(sa.activity_id) as activity_count,
            count(sa.activity_id) filter (
                where lower(coalesce(sa.activity_category, '')) = 'ride'
                    or lower(coalesce(sa.sport_type, '')) in (
                        'ride',
                        'road',
                        'gravel',
                        'mountain bike',
                        'mtb',
                        'e-bike',
                        'ebike',
                        'cycling',
                        'virtual ride',
                        'indoor cycle'
                    )
                        or lower(coalesce(sa.sport_type, '')) like '%%bike%%'
            ) as ride_count,
            coalesce(round(sum(coalesce(sa.distance_mi, 0))::numeric, 1), 0.0) as miles,
            coalesce(round(sum(coalesce(sa.moving_sec, 0))::numeric / 3600.0, 1), 0.0) as hours,
            coalesce(sum(coalesce(sa.elevation_ft, 0)), 0) as elevation_ft,
            max(sa.date_local) as last_activity_date,
            null::text as last_activity_name
        from gear g
        left join strava_activities sa
            on sa.gear_id = g.gear_id
        group by
            g.gear_id,
            g.gear_name,
            g.gear_type,
            g.brand,
            g.model_year,
            coalesce(g.retired, false)
        order by
            not coalesce(g.retired, false) desc,
            coalesce(g.retired, false) asc,
            coalesce(g.model_year, 0) desc,
            max(sa.date_local) desc nulls last,
            g.gear_name
        limit %s
    """

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (limit,))
            rows = cur.fetchall()

    return JSONResponse(rows_to_json(rows))
