"""Bounded browser-facing activity search routes."""

import math
from datetime import date, time
from enum import Enum

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

from csv_export import CsvColumn, csv_response
from db import db_conn, json_safe


router = APIRouter()

MAX_LIMIT = 100
DEFAULT_LIMIT = 50
MAX_FILTER_VALUES = 25
MAX_FILTER_VALUE_LENGTH = 100
MAX_TEXT_LENGTH = 200
MAX_ACTIVITY_TYPES = 100
SEARCH_EXPORT_MAX_ROWS = 50_000
ACTIVITY_CATEGORIES = {"ride", "hike", "walk", "run", "ski", "mobility", "strength", "other"}


@router.get("/api/activities/search/types")
def search_activity_types():
    try:
        with db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT DISTINCT sport_type
                    FROM public.strava_activities
                    WHERE sport_type IS NOT NULL
                      AND BTRIM(sport_type) <> ''
                    ORDER BY sport_type
                    LIMIT %s
                    """,
                    (MAX_ACTIVITY_TYPES,),
                )
                values = [str(row["sport_type"]) for row in cur.fetchall() if row.get("sport_type")]
    except Exception:
        return JSONResponse(
            {"detail": "Activity type options are temporarily unavailable."},
            status_code=503,
        )
    return JSONResponse({"sport_types": values})


class ActivitySortBy(str, Enum):
    DATE = "date"
    START = "start"
    ACTIVITY = "activity"
    TYPE = "type"
    CATEGORY = "category"
    BIKE = "bike"
    DISTANCE = "distance"
    ELEVATION = "elevation"
    MOVING = "moving"
    ELAPSED = "elapsed"
    LOAD = "load"


class ActivitySortDirection(str, Enum):
    ASC = "asc"
    DESC = "desc"


class ActivitySort(str, Enum):
    NEWEST = "newest"
    OLDEST = "oldest"
    START_TIME = "start_time"
    HIGHEST_ELEVATION = "highest_elevation"
    LONGEST_DISTANCE = "longest_distance"
    LONGEST_DURATION = "longest_duration"


SORT_COLUMN_SQL = {
    ActivitySortBy.DATE: "sa.date_local",
    ActivitySortBy.START: "sa.start_at_local",
    ActivitySortBy.ACTIVITY: 'sa."name"',
    ActivitySortBy.TYPE: "sa.sport_type",
    ActivitySortBy.CATEGORY: "sa.activity_category",
    ActivitySortBy.BIKE: "g.gear_name",
    ActivitySortBy.DISTANCE: "sa.distance_mi",
    ActivitySortBy.ELEVATION: "sa.elevation_ft",
    ActivitySortBy.MOVING: "sa.moving_sec",
    ActivitySortBy.ELAPSED: "sa.elapsed_sec",
    ActivitySortBy.LOAD: "d.main_ride_load",
}

SORT_DIRECTION_SQL = {
    ActivitySortDirection.ASC: "ASC",
    ActivitySortDirection.DESC: "DESC",
}

LEGACY_SORTS = {
    ActivitySort.NEWEST: (ActivitySortBy.DATE, ActivitySortDirection.DESC),
    ActivitySort.OLDEST: (ActivitySortBy.DATE, ActivitySortDirection.ASC),
    ActivitySort.START_TIME: (ActivitySortBy.START, ActivitySortDirection.ASC),
    ActivitySort.HIGHEST_ELEVATION: (ActivitySortBy.ELEVATION, ActivitySortDirection.DESC),
    ActivitySort.LONGEST_DISTANCE: (ActivitySortBy.DISTANCE, ActivitySortDirection.DESC),
    ActivitySort.LONGEST_DURATION: (ActivitySortBy.MOVING, ActivitySortDirection.DESC),
}

SELECT_SQL = """
    SELECT
        sa.activity_id,
        sa.date_local,
        sa.start_at_local,
        sa.start_at_utc,
        sa.timezone,
        sa.utc_offset_seconds,
        sa."name" AS name,
        sa.sport_type,
        sa.activity_category,
        sa.gear_id,
        g.gear_name,
        sa.distance_mi,
        sa.elevation_ft,
        sa.moving_sec,
        sa.elapsed_sec,
        d.main_ride_load AS activity_load
    FROM public.strava_activities AS sa
    LEFT JOIN public.gear AS g
        ON g.gear_id = sa.gear_id
    LEFT JOIN public.daily_training AS d
        ON d.date = sa.date_local
        AND d.main_ride_id = sa.activity_id
"""

COUNT_SQL = """
    SELECT COUNT(*) AS total_count
    FROM public.strava_activities AS sa
"""

SEARCH_EXPORT_SELECT_SQL = """
    SELECT
        sa.activity_id,
        sa.date_local,
        sa.start_at_local,
        sa.start_at_utc,
        sa.timezone,
        sa.utc_offset_seconds,
        sa."name" AS name,
        sa.sport_type,
        sa.activity_category,
        sa.gear_id,
        g.gear_name,
        sa.distance_mi,
        sa.elevation_ft,
        sa.moving_sec,
        sa.elapsed_sec,
        d.main_ride_load AS activity_load,
        sa.description
        {private_note_column}
    FROM public.strava_activities AS sa
    LEFT JOIN public.gear AS g
        ON g.gear_id = sa.gear_id
    LEFT JOIN public.daily_training AS d
        ON d.date = sa.date_local
        AND d.main_ride_id = sa.activity_id
"""

SEARCH_EXPORT_COLUMNS = (
    CsvColumn("activity_id", "activity_id"),
    CsvColumn("date_local", "date_local"),
    CsvColumn("start_at_local", "start_at_local"),
    CsvColumn("start_at_utc", "start_at_utc"),
    CsvColumn("timezone", "timezone"),
    CsvColumn("utc_offset_seconds", "utc_offset_seconds"),
    CsvColumn("name", "name"),
    CsvColumn("sport_type", "sport_type"),
    CsvColumn("activity_category", "activity_category"),
    CsvColumn("gear_id", "gear_id"),
    CsvColumn("gear_name", "gear_name"),
    CsvColumn("distance_mi", "distance_mi"),
    CsvColumn("elevation_ft", "elevation_ft"),
    CsvColumn("moving_sec", "moving_sec"),
    CsvColumn("elapsed_sec", "elapsed_sec"),
    CsvColumn("activity_load", "activity_load"),
    CsvColumn("description", "description"),
)
SEARCH_EXPORT_PRIVATE_NOTE_COLUMN = CsvColumn("private_note", "private_note")


def _resolve_sort(sort_by, sort_direction, legacy_sort):
    if legacy_sort is not None:
        if sort_by is not None or sort_direction is not None:
            raise HTTPException(
                status_code=422,
                detail="sort cannot be combined with sort_by or sort_direction.",
            )
        resolved_by, resolved_direction = LEGACY_SORTS[legacy_sort]
        return resolved_by, resolved_direction, legacy_sort.value

    resolved_by = sort_by or ActivitySortBy.DATE
    resolved_direction = sort_direction or ActivitySortDirection.DESC
    legacy_value = {
        (ActivitySortBy.DATE, ActivitySortDirection.DESC): ActivitySort.NEWEST.value,
        (ActivitySortBy.DATE, ActivitySortDirection.ASC): ActivitySort.OLDEST.value,
        (ActivitySortBy.START, ActivitySortDirection.ASC): ActivitySort.START_TIME.value,
        (ActivitySortBy.ELEVATION, ActivitySortDirection.DESC): ActivitySort.HIGHEST_ELEVATION.value,
        (ActivitySortBy.DISTANCE, ActivitySortDirection.DESC): ActivitySort.LONGEST_DISTANCE.value,
        (ActivitySortBy.MOVING, ActivitySortDirection.DESC): ActivitySort.LONGEST_DURATION.value,
    }.get((resolved_by, resolved_direction), resolved_by.value)
    return resolved_by, resolved_direction, legacy_value


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


def _build_search_criteria(
    start_date,
    end_date,
    text,
    sport_type,
    activity_category,
    gear_id,
    min_distance_mi,
    max_distance_mi,
    min_elevation_ft,
    max_elevation_ft,
    min_duration_sec,
    max_duration_sec,
    start_time_from,
    start_time_to,
    sort_by,
    sort_direction,
    sort,
):
    if (start_date is None) != (end_date is None):
        raise HTTPException(status_code=422, detail="start_date and end_date must be supplied together.")
    if start_date is not None and start_date > end_date:
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

    resolved_sort_by, resolved_sort_direction, applied_sort = _resolve_sort(
        sort_by,
        sort_direction,
        sort,
    )

    conditions = []
    parameters = []

    if start_date is not None and end_date is not None:
        conditions.extend(("sa.date_local >= %s", "sa.date_local <= %s"))
        parameters.extend((start_date, end_date))

    if trimmed_text:
        conditions.append("lower(sa.\"name\") LIKE lower(%s) ESCAPE '\\'")
        parameters.append(f"%{_escape_like_literal(trimmed_text)}%")

    for values, expression in (
        (sports, "lower(sa.sport_type)"),
        (categories, "sa.activity_category"),
        (gears, "sa.gear_id"),
    ):
        if values:
            placeholders = ", ".join("%s" for _ in values)
            conditions.append(f"{expression} IN ({placeholders})")
            parameters.extend(values)

    for column, minimum, maximum in (
        ("sa.distance_mi", min_distance_mi, max_distance_mi),
        ("sa.elevation_ft", min_elevation_ft, max_elevation_ft),
        ("sa.moving_sec", min_duration_sec, max_duration_sec),
    ):
        if minimum is not None:
            conditions.append(f"{column} >= %s")
            parameters.append(minimum)
        if maximum is not None:
            conditions.append(f"{column} <= %s")
            parameters.append(maximum)

    if start_time_from is not None:
        conditions.append("sa.start_at_local IS NOT NULL AND sa.start_at_local::time >= %s")
        parameters.append(start_time_from)
    if start_time_to is not None:
        conditions.append("sa.start_at_local IS NOT NULL AND sa.start_at_local::time <= %s")
        parameters.append(start_time_to)

    where_sql = "\n    WHERE " + "\n      AND ".join(conditions) if conditions else ""
    direction_sql = SORT_DIRECTION_SQL[resolved_sort_direction]
    order_sql = (
        f"{SORT_COLUMN_SQL[resolved_sort_by]} {direction_sql} NULLS LAST, "
        f"sa.activity_id {direction_sql}"
    )
    return (
        where_sql,
        tuple(parameters),
        order_sql,
        resolved_sort_by,
        resolved_sort_direction,
        applied_sort,
    )


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
    sort_by: ActivitySortBy | None = None,
    sort_direction: ActivitySortDirection | None = None,
    sort: ActivitySort | None = None,
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    offset: int = Query(default=0, ge=0),
):
    (
        where_sql,
        filter_parameters,
        order_sql,
        resolved_sort_by,
        resolved_sort_direction,
        applied_sort,
    ) = _build_search_criteria(
        start_date,
        end_date,
        text,
        sport_type,
        activity_category,
        gear_id,
        min_distance_mi,
        max_distance_mi,
        min_elevation_ft,
        max_elevation_ft,
        min_duration_sec,
        max_duration_sec,
        start_time_from,
        start_time_to,
        sort_by,
        sort_direction,
        sort,
    )
    count_sql = COUNT_SQL + where_sql
    sql = SELECT_SQL + where_sql + "\n    ORDER BY " + order_sql + "\n    LIMIT %s OFFSET %s"
    item_parameters = (*filter_parameters, limit, offset)

    try:
        with db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(count_sql, filter_parameters)
                total_count = int(cur.fetchone()["total_count"])
                cur.execute(sql, item_parameters)
                rows = cur.fetchall()
    except Exception:
        return JSONResponse(
            {"detail": "Activity search is temporarily unavailable."},
            status_code=503,
        )

    items = [_shape_activity(row) for row in rows]
    returned_count = len(items)
    has_more = offset + returned_count < total_count
    return JSONResponse({
        "schema_version": 1,
        "items": items,
        "returned_count": returned_count,
        "total_count": total_count,
        "limit": limit,
        "offset": offset,
        "has_more": has_more,
        "next_offset": offset + returned_count if has_more else None,
        "applied_sort": applied_sort,
        "applied_sort_by": resolved_sort_by.value,
        "applied_sort_direction": resolved_sort_direction.value,
        "applied_start_date": start_date.isoformat() if start_date else None,
        "applied_end_date": end_date.isoformat() if end_date else None,
    })


@router.get("/api/activities/search/export")
def export_search_activities(
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
    sort_by: ActivitySortBy | None = None,
    sort_direction: ActivitySortDirection | None = None,
    sort: ActivitySort | None = None,
    include_private_note: bool = Query(default=True),
):
    (
        where_sql,
        filter_parameters,
        order_sql,
        _resolved_sort_by,
        _resolved_sort_direction,
        _applied_sort,
    ) = _build_search_criteria(
        start_date,
        end_date,
        text,
        sport_type,
        activity_category,
        gear_id,
        min_distance_mi,
        max_distance_mi,
        min_elevation_ft,
        max_elevation_ft,
        min_duration_sec,
        max_duration_sec,
        start_time_from,
        start_time_to,
        sort_by,
        sort_direction,
        sort,
    )
    sql = SEARCH_EXPORT_SELECT_SQL.format(
        private_note_column=",\n        sa.private_note" if include_private_note else "",
    )
    sql += where_sql + "\n    ORDER BY " + order_sql + "\n    LIMIT %s"
    parameters = (*filter_parameters, SEARCH_EXPORT_MAX_ROWS + 1)

    try:
        with db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, parameters)
                rows = cur.fetchall()
    except Exception:
        return JSONResponse(
            {"detail": "Activity export is temporarily unavailable."},
            status_code=503,
        )

    if len(rows) > SEARCH_EXPORT_MAX_ROWS:
        raise HTTPException(
            status_code=422,
            detail="Refine Search filters to export no more than 50,000 activities.",
        )

    columns = SEARCH_EXPORT_COLUMNS
    if include_private_note:
        columns += (SEARCH_EXPORT_PRIVATE_NOTE_COLUMN,)
    try:
        return csv_response(columns, rows, "training-search.csv")
    except Exception:
        return JSONResponse(
            {"detail": "Activity export is temporarily unavailable."},
            status_code=503,
        )