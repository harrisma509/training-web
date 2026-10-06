"""
Weekly route module.

Owns the /api/weekly endpoint for Weekly tab table data.
This endpoint combines weekly_training, weekly_commentary, VO2 max, and falls data.

Do not add Weekly Audit logic in this refactor.
"""

import logging

import psycopg
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from csv_export import CsvColumn, csv_response
from db import db_conn, rows_to_json

router = APIRouter()
logger = logging.getLogger(__name__)

WEEKLY_EXPORT_LIMITS = (10, 52, 520)
WEEKLY_EXPORT_COLUMNS = (
    CsvColumn("week_start", "week_start"),
    CsvColumn("week_end", "week_end"),
    CsvColumn("weekly_total_hours", "weekly_total_hours"),
    CsvColumn("weekly_total_miles", "weekly_total_miles"),
    CsvColumn("weekly_total_elevation_ft", "weekly_total_elevation_ft"),
    CsvColumn("weekly_avg_weight", "weekly_avg_weight"),
    CsvColumn("total_load", "total_load"),
    CsvColumn("main_ride_load", "main_ride_load"),
    CsvColumn("other_load", "other_load"),
    CsvColumn("activity_days", "activity_days"),
    CsvColumn("ride_count", "ride_count"),
    CsvColumn("walk_count", "walk_count"),
    CsvColumn("hike_count", "hike_count"),
    CsvColumn("strength_count", "strength_count"),
    CsvColumn("very_hard_epic_days", "very_hard_epic_days"),
    CsvColumn("chronic_weekly_cw", "chronic_weekly_cw"),
    CsvColumn("ac_ratio", "ac_ratio"),
    CsvColumn("ramp_pct", "ramp_pct"),
    CsvColumn("status_level", "status_level"),
    CsvColumn("status_text", "status_text"),
    CsvColumn("vo2max", "vo2max"),
    CsvColumn("falls", "falls"),
    CsvColumn("audit_grade", "audit_grade"),
    CsvColumn("audit_green_count", "audit_green_count"),
    CsvColumn("audit_yellow_count", "audit_yellow_count"),
    CsvColumn("audit_red_count", "audit_red_count"),
    CsvColumn("audit_summary", "audit_summary"),
    CsvColumn("audit_next_week_action", "audit_next_week_action"),
    CsvColumn("weekly_comment", "weekly_comment"),
    CsvColumn("week_type", "week_type"),
    CsvColumn("event", "event"),
    CsvColumn("planned_focus", "planned_focus"),
    CsvColumn("actual_focus", "actual_focus"),
    CsvColumn("risk_note", "risk_note"),
    CsvColumn("lesson_learned", "lesson_learned"),
    CsvColumn("status_override", "status_override"),
    CsvColumn("is_travel_week", "is_travel_week"),
    CsvColumn("is_sick_week", "is_sick_week"),
    CsvColumn("is_injury_week", "is_injury_week"),
    CsvColumn("is_bike_park_week", "is_bike_park_week"),
    CsvColumn("is_recovery_week", "is_recovery_week"),
    CsvColumn("is_goal_week", "is_goal_week"),
)


def _query_weekly_rows(limit: int):
    sql = """
        with weeks AS (
            select week_start from weekly_training
            union
            select week_start from health_vo2_max
            union
            select date - (extract(isodow from date)::integer - 1) from health_falls
        ),
        daily_activity_week AS (
            SELECT
                date - (extract(isodow from date)::integer - 1) AS week_start,
                ROUND(
                    SUM(
                        COALESCE(EXTRACT(EPOCH FROM NULLIF(main_ride_time, '')::interval), 0)
                        + COALESCE(EXTRACT(EPOCH FROM NULLIF(other_time, '')::interval), 0)
                    ) / 3600.0,
                    1
                ) AS weekly_total_hours,
                ROUND(SUM(COALESCE(main_ride_miles, 0) + COALESCE(other_miles, 0))::numeric, 1) AS weekly_total_miles,
                SUM(COALESCE(main_ride_elevation_ft, 0) + COALESCE(other_elevation_ft, 0)) AS weekly_total_elevation_ft
            FROM daily_training
            GROUP BY 1
        ),
        weekly_weight AS (
            SELECT
                date - (extract(isodow from date)::integer - 1) AS week_start,
                AVG(weight_lb) AS weekly_avg_weight
            FROM health_weight
            GROUP BY 1
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
            wa.overall_grade AS audit_grade,
            wa.green_count AS audit_green_count,
            wa.yellow_count AS audit_yellow_count,
            wa.red_count AS audit_red_count,
            wa.audit_summary AS audit_summary,
            wa.next_week_action AS audit_next_week_action,
            weekly_training.total_load,
            daily_activity_week.weekly_total_hours,
            daily_activity_week.weekly_total_miles,
            daily_activity_week.weekly_total_elevation_ft,
            weekly_weight.weekly_avg_weight,
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
            weekly_training.ramp_pct,
            weekly_training.ramp_pct_display,
            weekly_training.status_level,
            weekly_training.status_text,
            health_vo2_max.vo2max AS vo2max
            ,coalesce(fall_weeks.falls, 0) AS falls
        from weeks
        left join weekly_training
            on weekly_training.week_start = weeks.week_start
        left join weekly_audit wa
            on wa.week_start = weeks.week_start
        left join daily_activity_week
            on daily_activity_week.week_start = weeks.week_start
        left join weekly_weight
            on weekly_weight.week_start = weeks.week_start
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

    return rows


@router.get("/api/weekly")
def api_weekly(limit: int = 60):
    limit = max(1, min(limit, 520))
    return JSONResponse(rows_to_json(_query_weekly_rows(limit)))


@router.get("/api/weekly/export")
def export_weekly(limit: int = 52):
    if limit not in WEEKLY_EXPORT_LIMITS:
        raise HTTPException(
            status_code=422,
            detail="limit must be one of 10, 52, or 520.",
        )

    try:
        rows = _query_weekly_rows(limit)
    except psycopg.Error as error:
        logger.error("Weekly export query failed (%s).", type(error).__name__)
        return JSONResponse(
            {"detail": "Weekly export is temporarily unavailable."},
            status_code=503,
        )

    try:
        return csv_response(WEEKLY_EXPORT_COLUMNS, rows, "training-weekly.csv")
    except (TypeError, ValueError, UnicodeError) as error:
        logger.error("Weekly export serialization failed (%s).", type(error).__name__)
        return JSONResponse(
            {"detail": "Weekly export is temporarily unavailable."},
            status_code=503,
        )
