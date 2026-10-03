"""Bounded browser-facing activity search routes."""

import math
from datetime import date, datetime, time
from enum import Enum
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

from db import db_conn, json_safe


router = APIRouter()

MAX_LIMIT = 100
DEFAULT_LIMIT = 50
MAX_FILTER_VALUES = 25
MAX_FILTER_VALUE_LENGTH = 100
MAX_TEXT_LENGTH = 200
ACTIVITY_CATEGORIES = {"ride", "hike", "walk", "run", "ski", "mobility", "strength", "other"}


class ActivitySort(str, Enum):
    NEWEST = "newest"
    OLDEST = "oldest"
    START_TIME = "start_time"
    HIGHEST_ELEVATION = "highest_elevation"
    LONGEST_DISTANCE = "longest_distance"
    LONGEST_DURATION = "longest_duration"


SORT_SQL = {
    ActivitySort.NEWEST: "a.date_local DESC, a.start_at_local DESC NULLS LAST, a.activity_id DESC",
    ActivitySort.OLDEST: "a.date_local ASC, a.start_at_local ASC NULLS LAST, a.activity_id ASC",
    ActivitySort.START_TIME: "a.start_at_local ASC NULLS LAST, a.activity_id ASC",
    ActivitySort.HIGHEST_ELEVATION: (
        "a.elevation_ft DESC NULLS LAST, a.date_local DESC, "
        "a.start_at_local DESC NULLS LAST, a.activity_id DESC"
    ),
    ActivitySort.LONGEST_DISTANCE: (
        "a.distance_mi DESC NULLS LAST, a.date_local DESC, "
        "a.start_at_local DESC NULLS LAST, a.activity_id DESC"
    ),
    ActivitySort.LONGEST_DURATION: (
        "a.moving_sec DESC NULLS LAST, a.date_local DESC, "
        "a.start_at_local DESC NULLS LAST, a.activity_id DESC"
    ),
}

SELECT_SQL = """
    SELECT
        a.activity_id,
        a.date_local,
        a.start_at_local,
        a.start_at_utc,
        a.timezone,
        a.utc_offset_seconds,
        a."name" AS name,
        a.sport_type,
        a.activity_category,
        a.gear_id,
        g.gear_name,
        a.distance_mi,
        a.elevation_ft,
        a.moving_sec,
        a.elapsed_sec,
        d.main_ride_load AS activity_load
    FROM public.strava_activities AS a
    LEFT JOIN public.gear AS g
        ON g.gear_id = a.gear_id
    LEFT JOIN public.daily_training AS d
        ON d.date = a.date_local
        AND d.main_ride_id = a.activity_id
"""


def _default_date_range():
    current_date = datetime.now(ZoneInfo("America/Denver")).date()
    try:
        start_date = current_date.replace(year=current_date.year - 1)
    except ValueError:
        start_date = current_date.replace(year=current_date.year - 1, day=28)
    return start_date, current_date


def _clean_filter_values(values, field_name, *, lowercase=False, allowed=None):
    if values is None:
        return []
    if len(values) > MAX_FILTER_VALUES:
        raise HTTPException(status_code=422, detail=f"Too many {field_name} values.")

    cleaned = []
    seen = set()
    for value in values:
        if not isinstance(value, str):
            raise HTTPException(status_code=422, detail=f"Invalid {field_name} value.")
        value = value.strip()
        normalized = value.lower() if lowercase else value
        if not value or len(value) > MAX_FILTER_VALUE_LENGTH:
            raise HTTPException(status_code=422, detail=f"Invalid {field_name} value.")
        if allowed is not None and normalized not in allowed:
            raise HTTPException(status_code=422, detail=f"Unsupported {field_name} value.")
        if normalized not in seen:
            cleaned.append(normalized)
            seen.add(normalized)
    return cleaned


def _escape_like_literal(value):
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _shape_activity(row):
    fields = (
        "activity_id",
        "date_local",
        "start_at_local",
        "start_at_utc",
        "timezone",
        "utc_offset_seconds",
        "name",
        "sport_type",
        "activity_category",
        "gear_id",
        "gear_name",
        "distance_mi",
        "elevation_ft",
        "moving_sec",
        "elapsed_sec",
        "activity_load",
    )
    return {field: json_safe(row.get(field)) for field in fields}


@router.get("/api/activities/search")
def search_activities(
    start_date: date | None = None,
    end_date: date | None = None,
    text: str | None = None,
    sport_type: list[str] | None = Query(default=None),
    activity_category: list[str] | None = Query(default=None),
    gear_id: list[str] | None = Query(default=None),
    min_distance_mi: float | None = Query(default=None, ge=0),
    max_distance_mi: float | None = Query(default=None, ge=0),
    min_elevation_ft: float | None = Query(default=None, ge=0),
    max_elevation_ft: float | None = Query(default=None, ge=0),
    min_duration_sec: int | None = Query(default=None, ge=0),
    max_duration_sec: int | None = Query(default=None, ge=0),
    start_time_from: time | None = None,
    start_time_to: time | None = None,
    sort: ActivitySort = ActivitySort.NEWEST,
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    offset: int = Query(default=0, ge=0),
):
    if (start_date is None) != (end_date is None):
        raise HTTPException(status_code=422, detail="start_date and end_date must be supplied together.")
    if start_date is None:
        applied_start_date, applied_end_date = _default_date_range()
    else:
        applied_start_date, applied_end_date = start_date, end_date
    if applied_start_date > applied_end_date:
        raise HTTPException(status_code=422, detail="start_date must be on or before end_date.")

    trimmed_text = (text or "").strip()
    if len(trimmed_text) > MAX_TEXT_LENGTH:
        raise HTTPException(status_code=422, detail="text must not exceed 200 characters.")

    sports = _clean_filter_values(sport_type, "sport_type", lowercase=True)
    categories = _clean_filter_values(
        activity_category,
        "activity_category",
        lowercase=True,
        allowed=ACTIVITY_CATEGORIES,
    )
    gears = _clean_filter_values(gear_id, "gear_id")

    numeric_ranges = (
        (min_distance_mi, max_distance_mi, "distance"),
        (min_elevation_ft, max_elevation_ft, "elevation"),
        (min_duration_sec, max_duration_sec, "duration"),
    )
    for minimum, maximum, field_name in numeric_ranges:
        if minimum is not None and not math.isfinite(minimum):
            raise HTTPException(status_code=422, detail=f"{field_name} bounds must be finite.")
        if maximum is not None and not math.isfinite(maximum):
            raise HTTPException(status_code=422, detail=f"{field_name} bounds must be finite.")
        if minimum is not None and maximum is not None and minimum > maximum:
            raise HTTPException(status_code=422, detail=f"Minimum {field_name} must not exceed maximum.")

    for value in (start_time_from, start_time_to):
        if value is not None and value.utcoffset() is not None:
            raise HTTPException(status_code=422, detail="Time-of-day filters must be local wall-clock times.")
    if start_time_from is not None and start_time_to is not None and start_time_from > start_time_to:
        raise HTTPException(status_code=422, detail="Overnight time ranges are not supported.")

    conditions = ["a.date_local >= %s", "a.date_local <= %s"]
    parameters = [applied_start_date, applied_end_date]

    if trimmed_text:
        conditions.append("lower(a.\"name\") LIKE lower(%s) ESCAPE '\\'")
        parameters.append(f"%{_escape_like_literal(trimmed_text)}%")

    for values, expression in (
        (sports, "lower(a.sport_type)"),
        (categories, "a.activity_category"),
        (gears, "a.gear_id"),
    ):
        if values:
            placeholders = ", ".join("%s" for _ in values)
            conditions.append(f"{expression} IN ({placeholders})")
            parameters.extend(values)

    for column, minimum, maximum in (
        ("a.distance_mi", min_distance_mi, max_distance_mi),
        ("a.elevation_ft", min_elevation_ft, max_elevation_ft),
        ("a.moving_sec", min_duration_sec, max_duration_sec),
    ):
        if minimum is not None:
            conditions.append(f"{column} >= %s")
            parameters.append(minimum)
        if maximum is not None:
            conditions.append(f"{column} <= %s")
            parameters.append(maximum)

    if start_time_from is not None:
        conditions.append("a.start_at_local IS NOT NULL AND a.start_at_local::time >= %s")
        parameters.append(start_time_from)
    if start_time_to is not None:
        conditions.append("a.start_at_local IS NOT NULL AND a.start_at_local::time <= %s")
        parameters.append(start_time_to)

    sql = (
        SELECT_SQL
        + "\n    WHERE " + "\n      AND ".join(conditions)
        + "\n    ORDER BY " + SORT_SQL[sort]
        + "\n    LIMIT %s OFFSET %s"
    )
    parameters.extend((limit + 1, offset))

    try:
        with db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, tuple(parameters))
                rows = cur.fetchall()
    except Exception:
        return JSONResponse(
            {"detail": "Activity search is temporarily unavailable."},
            status_code=503,
        )

    has_more = len(rows) > limit
    items = [_shape_activity(row) for row in rows[:limit]]
    returned_count = len(items)
    return JSONResponse({
        "schema_version": 1,
        "items": items,
        "returned_count": returned_count,
        "limit": limit,
        "offset": offset,
        "has_more": has_more,
        "next_offset": offset + returned_count if has_more else None,
        "applied_sort": sort.value,
        "applied_start_date": applied_start_date.isoformat(),
        "applied_end_date": applied_end_date.isoformat(),
    })