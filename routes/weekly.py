"""
Weekly route module.

Owns the /api/weekly endpoint for Weekly tab table data.
This endpoint combines weekly_training, weekly_commentary, VO2 max, and falls data.

Do not add Weekly Audit logic in this refactor.
"""

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from db import db_conn, rows_to_json

router = APIRouter()


@router.get("/api/weekly")
def api_weekly(limit: int = 60):
    limit = max(1, min(limit, 260))

    sql = """
        with weeks AS (
            select week_start from weekly_training
            union
            select week_start from health_vo2_max
            union
            select date - (extract(isodow from date)::integer - 1) from health_falls
        )
        select
            weeks.week_start,
            weekly_training.week_end,
            wc.weekly_comment AS weekly_comment,
            wc.week_type AS week_type,
            wc.event AS event,
            wc.planned_focus AS planned_focus,
            wc.actual_focus AS actual_focus,
            wc.risk_note AS risk_note,
            wc.coach_note AS coach_note,
            wc.task_note AS task_note,
            wc.lesson_learned AS lesson_learned,
            wc.status_override AS status_override,
            wc.is_travel_week AS is_travel_week,
            wc.is_sick_week AS is_sick_week,
            wc.is_injury_week AS is_injury_week,
            wc.is_bike_park_week AS is_bike_park_week,
            wc.is_recovery_week AS is_recovery_week,
            wc.is_goal_week AS is_goal_week,
            wc.hide_from_dashboard AS hide_from_dashboard,
            wc.display_priority AS display_priority,
            weekly_training.total_load,
            weekly_training.main_ride_load,
            weekly_training.other_load,
            weekly_training.activity_days,
            weekly_training.ride_count,
            weekly_training.walk_count,
            weekly_training.hike_count,
            weekly_training.strength_count,
            weekly_training.very_hard_epic_days,
            weekly_training.chronic_weekly_cw,
            weekly_training.ac_ratio,
            weekly_training.ramp_pct_display,
            weekly_training.status_level,
            weekly_training.status_text,
            health_vo2_max.vo2max AS vo2max
            ,coalesce(fall_weeks.falls, 0) AS falls
        from weeks
        left join weekly_training
            on weekly_training.week_start = weeks.week_start
        left join weekly_commentary wc
            on wc.week_start = weekly_training.week_start
        left join health_vo2_max
            on health_vo2_max.week_start = weeks.week_start
        left join (
            select
                date - (extract(isodow from date)::integer - 1) AS week_start,
                sum(falls) AS falls
            from health_falls
            group by 1
        ) fall_weeks
            on fall_weeks.week_start = weeks.week_start
        order by weeks.week_start desc
        limit %s
    """

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (limit,))
            rows = cur.fetchall()

    return JSONResponse(rows_to_json(rows))
