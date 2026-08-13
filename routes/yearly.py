"""
Yearly route module.

Owns the read-only Yearly dashboard views and preview calculations.
This endpoint exposes annual summaries, monthly hours, and preview diagnostics.
"""

import math
from datetime import date, datetime, timezone

from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse

from db import db_conn, json_safe, rows_to_json

router = APIRouter()

ANNUAL_RECORD_METRICS = [
    "training_hours",
    "active_days",
    "cycling_distance_mi",
    "total_elevation_ft",
    "bike_elevation_ft",
    "ride_count",
    "ski_days",
]

MONTH_NAMES = [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
]


def _value_is_record(value, record_max):
    if value is None or record_max is None:
        return False
    try:
        return math.isclose(float(value), float(record_max), rel_tol=1e-9, abs_tol=1e-6)
    except (TypeError, ValueError):
        return False


def _safe_float(value):
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _json_safe_payload(value):
    if isinstance(value, dict):
        return {key: _json_safe_payload(inner_value) for key, inner_value in value.items()}
    if isinstance(value, list):
        return [_json_safe_payload(item) for item in value]
    if isinstance(value, tuple):
        return [_json_safe_payload(item) for item in value]
    return json_safe(value)


@router.get("/api/yearly")
def api_yearly():
    annual_sql = """
        select
            calendar_year,
            training_hours,
            active_days,
            cycling_distance_mi,
            total_elevation_ft,
            bike_elevation_ft,
            ride_count,
            ski_days,
            is_ytd,
            through_date
        from public.training_year
        order by calendar_year desc
    """

    monthly_sql = """
        select
            calendar_year,
            calendar_month,
            training_hours
        from public.training_year_month
        order by calendar_year desc, calendar_month asc
    """

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(annual_sql)
            annual_rows = rows_to_json(cur.fetchall())
            cur.execute(monthly_sql)
            monthly_rows = rows_to_json(cur.fetchall())

    annual_record_max = {}
    for metric in ANNUAL_RECORD_METRICS:
        values = [
            float(row[metric])
            for row in annual_rows
            if row.get("is_ytd") is False and row.get(metric) is not None
        ]
        annual_record_max[metric] = max(values) if values else None

    for row in annual_rows:
        for metric in ANNUAL_RECORD_METRICS:
            value = row.get(metric)
            record_max = annual_record_max.get(metric)
            row[f"{metric}_record"] = bool(
                row.get("is_ytd") is False and _value_is_record(value, record_max)
            )

    year_meta = {
        int(row["calendar_year"]): row
        for row in annual_rows
    }

    month_values_by_year = {}
    month_record_max = {month: [] for month in range(1, 13)}
    for row in monthly_rows:
        year = int(row["calendar_year"])
        month = int(row["calendar_month"])
        year_row = year_meta.get(year)
        if year_row and year_row.get("is_ytd") is True and year_row.get("through_date"):
            through_month = date.fromisoformat(year_row["through_date"]).month
            if month > through_month:
                row["training_hours"] = None

        month_values_by_year.setdefault(year, {})[month] = row.get("training_hours")
        if (
            row.get("training_hours") is not None
            and year_row is not None
            and year_row.get("is_ytd") is False
        ):
            month_record_max[month].append(float(row["training_hours"]))

    monthly_hours = []
    for year in sorted({int(row["calendar_year"]) for row in annual_rows}, reverse=True):
        year_row = {"calendar_year": year}
        month_totals = []

        for month_index in range(1, 13):
            key = MONTH_NAMES[month_index - 1]
            value = month_values_by_year.get(year, {}).get(month_index)
            year_row[key] = value
            if value is not None:
                month_totals.append(float(value))
            record_max = max(month_record_max[month_index]) if month_record_max[month_index] else None
            year_row[f"{key}_record"] = bool(
                value is not None
                and year_meta.get(year, {}).get("is_ytd") is False
                and _value_is_record(value, record_max)
            )

        total = sum(month_totals) if month_totals else None
        year_row["total"] = total
        monthly_hours.append(year_row)

    return JSONResponse({
        "annual_metrics": annual_rows,
        "monthly_hours": monthly_hours,
    })


@router.post("/api/yearly/calculate/preview")
def api_yearly_calculate_preview(payload: dict | None = Body(default=None)):
    if payload is None or not isinstance(payload, dict):
        return JSONResponse({"detail": "Request body must be an object with a calendar_year value."}, status_code=400)

    raw_year = payload.get("calendar_year")
    try:
        calendar_year = int(raw_year)
    except (TypeError, ValueError):
        return JSONResponse({"detail": "calendar_year must be a valid integer."}, status_code=400)

    current_year = datetime.now(timezone.utc).year

    if calendar_year == 2012:
        return JSONResponse(
            {"detail": "2012 is reserved for historical workbook import and cannot be previewed."},
            status_code=400,
        )

    if calendar_year < 2013:
        return JSONResponse({"detail": "calendar_year must be >= 2013."}, status_code=400)

    if calendar_year > current_year:
        return JSONResponse({"detail": "calendar_year cannot be in the future."}, status_code=400)

    sql = """
        select
            date_local,
            activity_category,
            moving_sec,
            distance_mi,
            elevation_ft
        from public.strava_activities
        where date_local >= %s
          and date_local < %s
        order by date_local asc
    """

    year_start = date(calendar_year, 1, 1)
    year_end = date(calendar_year + 1, 1, 1)

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (year_start, year_end))
            rows = rows_to_json(cur.fetchall())

    monthly = []
    if not rows:
        for month_index in range(1, 13):
            monthly.append({
                "calendar_month": month_index,
                "strava_activity_hours": None,
                "active_days": None,
                "activity_count": None,
                "total_distance_mi": None,
                "cycling_distance_mi": None,
                "total_elevation_ft": None,
                "bike_elevation_ft": None,
                "ride_count": None,
                "ride_days": None,
                "ski_days": None,
            })
        missing_months = list(range(1, 13))
        activity_count = 0
        months_with_activity = 0
        source_first_date = None
        source_last_date = None
        warnings = ["No Strava activity data found for the requested year."]
        is_ytd = calendar_year == current_year
        coverage_status = "ytd" if is_ytd else "missing_months"
        if not is_ytd and missing_months:
            warnings.append(f"Missing activity coverage for month(s): {missing_months}.")
    else:
        monthly_map = {month: {
            "calendar_month": month,
            "strava_activity_hours": 0.0,
            "active_days": 0,
            "activity_count": 0,
            "total_distance_mi": 0.0,
            "cycling_distance_mi": 0.0,
            "total_elevation_ft": 0,
            "bike_elevation_ft": 0,
            "ride_count": 0,
            "ride_days": 0,
            "ski_days": 0,
        } for month in range(1, 13)}

        activity_count = 0
        distinct_dates = set()
        for row in rows:
            activity_count += 1
            activity_date = row.get("date_local")
            if activity_date:
                distinct_dates.add(activity_date)
            month_index = int(activity_date[5:7]) if activity_date else None
            if month_index is None:
                continue
            month_bucket = monthly_map.setdefault(month_index, {
                "calendar_month": month_index,
                "strava_activity_hours": 0.0,
                "active_days": 0,
                "activity_count": 0,
                "total_distance_mi": 0.0,
                "cycling_distance_mi": 0.0,
                "total_elevation_ft": 0,
                "bike_elevation_ft": 0,
                "ride_count": 0,
                "ride_days": 0,
                "ski_days": 0,
            })

            month_bucket["activity_count"] += 1
            month_bucket["strava_activity_hours"] = _safe_float(month_bucket["strava_activity_hours"]) or 0.0
            month_bucket["strava_activity_hours"] += (_safe_float(row.get("moving_sec")) or 0.0) / 3600.0
            distance_mi = _safe_float(row.get("distance_mi")) or 0.0
            elevation_ft = _safe_float(row.get("elevation_ft")) or 0.0
            month_bucket["total_distance_mi"] = (_safe_float(month_bucket["total_distance_mi"]) or 0.0) + distance_mi
            month_bucket["total_elevation_ft"] = (_safe_float(month_bucket["total_elevation_ft"]) or 0) + int(elevation_ft)

            category = (row.get("activity_category") or "").strip().lower()
            if category == "ride":
                month_bucket["cycling_distance_mi"] = (_safe_float(month_bucket["cycling_distance_mi"]) or 0.0) + distance_mi
                month_bucket["bike_elevation_ft"] = (_safe_float(month_bucket["bike_elevation_ft"]) or 0) + int(elevation_ft)
                month_bucket["ride_count"] += 1
            if category == "ski":
                month_bucket["ski_days"] += 1

        for month_index in range(1, 13):
            month_bucket = monthly_map.get(month_index)
            if month_bucket is None:
                month_bucket = {
                    "calendar_month": month_index,
                    "strava_activity_hours": None,
                    "active_days": None,
                    "activity_count": None,
                    "total_distance_mi": None,
                    "cycling_distance_mi": None,
                    "total_elevation_ft": None,
                    "bike_elevation_ft": None,
                    "ride_count": None,
                    "ride_days": None,
                    "ski_days": None,
                }
            else:
                month_bucket["active_days"] = 0
                month_bucket["ride_days"] = 0
                year_date_values = [
                    row.get("date_local")
                    for row in rows
                    if row.get("date_local") and int(row["date_local"][5:7]) == month_index
                ]
                month_bucket["active_days"] = len(set(year_date_values))
                month_bucket["ride_days"] = len({
                    row["date_local"]
                    for row in rows
                    if row.get("date_local") and int(row["date_local"][5:7]) == month_index and (row.get("activity_category") or "").strip().lower() == "ride"
                })
                month_bucket["strava_activity_hours"] = round(month_bucket["strava_activity_hours"], 2)
                month_bucket["total_distance_mi"] = round(_safe_float(month_bucket["total_distance_mi"]) or 0.0, 2)
                month_bucket["cycling_distance_mi"] = round(_safe_float(month_bucket["cycling_distance_mi"]) or 0.0, 2)
                month_bucket["total_elevation_ft"] = int(_safe_float(month_bucket["total_elevation_ft"]) or 0)
                month_bucket["bike_elevation_ft"] = int(_safe_float(month_bucket["bike_elevation_ft"]) or 0)
                month_bucket["ride_count"] = int(month_bucket["ride_count"])
                month_bucket["ride_days"] = int(month_bucket["ride_days"])
                month_bucket["ski_days"] = int(len({
                    row["date_local"]
                    for row in rows
                    if row.get("date_local") and int(row["date_local"][5:7]) == month_index and (row.get("activity_category") or "").strip().lower() == "ski"
                }))
            monthly.append(month_bucket)

        missing_months = [
            month_index
            for month_index in range(1, 13)
            if not any(
                item.get("calendar_month") == month_index and item.get("activity_count") not in (None, 0)
                for item in monthly
            )
        ]
        months_with_activity = len([
            item for item in monthly if item.get("activity_count") not in (None, 0)
        ])
        source_first_date = min(row.get("date_local") for row in rows if row.get("date_local"))
        source_last_date = max(row.get("date_local") for row in rows if row.get("date_local"))
        is_ytd = calendar_year == current_year
        warnings = []
        if missing_months:
            warnings.append(f"Missing activity coverage for month(s): {missing_months}.")
        if calendar_year == 2016 and 10 in missing_months:
            warnings.append("2016 missing October activity coverage; do not classify as complete.")
        coverage_status = "ytd" if is_ytd else ("missing_months" if missing_months else "complete_calendar")

    annual_values = {
        "training_hours": round(sum((row.get("moving_sec") or 0.0) / 3600.0 for row in rows), 2),
        "strava_activity_hours": round(sum((row.get("moving_sec") or 0.0) / 3600.0 for row in rows), 2),
        "active_days": len({row.get("date_local") for row in rows if row.get("date_local")}),
        "activity_count": activity_count,
        "total_distance_mi": round(sum(_safe_float(row.get("distance_mi")) or 0.0 for row in rows), 2),
        "cycling_distance_mi": round(sum(
            (_safe_float(row.get("distance_mi")) or 0.0)
            for row in rows
            if (row.get("activity_category") or "").strip().lower() == "ride"
        ), 2),
        "total_elevation_ft": int(sum(int(_safe_float(row.get("elevation_ft")) or 0) for row in rows)),
        "bike_elevation_ft": int(sum(
            int(_safe_float(row.get("elevation_ft")) or 0)
            for row in rows
            if (row.get("activity_category") or "").strip().lower() == "ride"
        )),
        "ride_count": sum(1 for row in rows if (row.get("activity_category") or "").strip().lower() == "ride"),
        "ride_days": len({
            row.get("date_local")
            for row in rows
            if (row.get("activity_category") or "").strip().lower() == "ride"
        }),
        "ski_days": len({
            row.get("date_local")
            for row in rows
            if (row.get("activity_category") or "").strip().lower() == "ski"
        }),
        "strength_sessions": sum(1 for row in rows if (row.get("activity_category") or "").strip().lower() == "strength"),
        "mobility_sessions": sum(1 for row in rows if (row.get("activity_category") or "").strip().lower() == "mobility"),
        "walk_count": sum(1 for row in rows if (row.get("activity_category") or "").strip().lower() == "walk"),
        "hike_count": sum(1 for row in rows if (row.get("activity_category") or "").strip().lower() == "hike"),
    }

    current_values = {}
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select
                    calendar_year,
                    training_hours,
                    strava_activity_hours,
                    active_days,
                    activity_count,
                    total_distance_mi,
                    cycling_distance_mi,
                    total_elevation_ft,
                    bike_elevation_ft,
                    ride_count,
                    ride_days,
                    ski_days,
                    strength_sessions,
                    mobility_sessions,
                    walk_count,
                    hike_count,
                    source_first_date,
                    source_last_date,
                    months_with_activity,
                    coverage_status,
                    is_ytd,
                    through_date
                from public.training_year
                where calendar_year = %s
                """,
                (calendar_year,),
            )
            stored = cur.fetchone()
            if stored:
                current_values = dict(stored)
                current_values = {
                    key: json_safe(value)
                    for key, value in current_values.items()
                    if value is not None
                }

    differences = {}
    for key, proposed_value in annual_values.items():
        stored_value = current_values.get(key)
        if stored_value is None:
            continue
        if isinstance(stored_value, str):
            if proposed_value == stored_value:
                differences[key] = {"stored": stored_value, "proposed": proposed_value, "difference": 0}
            else:
                differences[key] = {"stored": stored_value, "proposed": proposed_value, "difference": "changed"}
            continue
        try:
            difference = float(proposed_value) - float(stored_value)
        except (TypeError, ValueError):
            difference = None
        differences[key] = {
            "stored": stored_value,
            "proposed": proposed_value,
            "difference": difference,
        }

    requested_at_utc = datetime.now(timezone.utc)
    started_at_utc = requested_at_utc
    completed_at_utc = requested_at_utc
    insert_sql = """
        insert into public.training_year_run (
            calendar_year,
            requested_at_utc,
            requested_by,
            calculation_mode,
            apply_changes,
            source_first_date,
            source_last_date,
            activity_count,
            months_with_activity,
            status,
            message,
            started_at_utc,
            completed_at_utc
        ) values (
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
        ) returning training_year_run_id
    """
    message = (
        f"Preview completed for {calendar_year}; "
        f"coverage_status={coverage_status}; "
        f"warnings={len(warnings)}; "
        f"months_with_activity={months_with_activity}."
    )

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                insert_sql,
                (
                    calendar_year,
                    requested_at_utc,
                    "settings",
                    "preview",
                    False,
                    source_first_date,
                    source_last_date,
                    activity_count,
                    months_with_activity,
                    "completed",
                    message,
                    started_at_utc,
                    completed_at_utc,
                ),
            )
            run_row = cur.fetchone()
            training_year_run_id = run_row.get("training_year_run_id") if run_row else None

    response = {
        "calendar_year": calendar_year,
        "coverage_status": coverage_status,
        "is_ytd": is_ytd,
        "source_first_date": json_safe(source_first_date),
        "source_last_date": json_safe(source_last_date),
        "activity_count": activity_count,
        "months_with_activity": months_with_activity,
        "missing_months": missing_months,
        "warnings": warnings,
        "current_values": current_values,
        "proposed_annual_values": {key: json_safe(value) for key, value in annual_values.items()},
        "differences": {
            key: {inner_key: json_safe(inner_value) for inner_key, inner_value in value.items()}
            for key, value in differences.items()
        },
        "monthly_summary": [
            {key: json_safe(inner_value) for key, inner_value in item.items()}
            for item in monthly
        ],
        "training_year_run_id": training_year_run_id,
    }

    return JSONResponse(_json_safe_payload(response))
