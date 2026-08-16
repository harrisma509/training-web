"""
Bike components route module.

Owns a read-only endpoint that combines:
- eligible bikes
- selected bike summary
- active component roster
- latest service event per component
- derived usage since latest service event
"""

import re
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from typing import Optional

from fastapi import APIRouter, Body, HTTPException
from fastapi.responses import JSONResponse

from db import db_conn, json_safe

router = APIRouter()

DEFAULT_GEAR_ID = "b15895517"


def _normalize_text(value):
    if value is None:
        return ""
    return str(value).strip()


def _normalize_display_part(value):
    if value is None:
        return ""

    text = str(value).strip()
    if not text:
        return ""

    if text.lower() in {"null", "none", "undefined"}:
        return ""

    return text


def _format_gear_display_name(row):
    parts = [
        _normalize_display_part(row.get("model_year")),
        _normalize_display_part(row.get("brand")),
        _normalize_display_part(row.get("gear_name")),
    ]

    name = " ".join(part for part in parts if part)
    if name:
        return name

    return _normalize_display_part(row.get("gear_name")) or _normalize_display_part(row.get("gear_id"))


def _clamp_non_negative(value):
    if value is None:
        return None
    return max(float(value), 0.0)


def _normalize_component_key(value, fallback=""):
    raw = (value or fallback or "").strip()
    if not raw:
        return "component"

    clean = re.sub(r"[^a-z0-9]+", "-", raw.lower()).strip("-")
    if not clean:
        return "component"
    return clean


def _format_bike_display_name(row):
    if not row:
        return "Unknown bike"

    parts = [
        _normalize_display_part(row.get("model_year")),
        _normalize_display_part(row.get("brand")),
        _normalize_display_part(row.get("gear_name")),
    ]
    bike_name = " ".join(part for part in parts if part)
    if bike_name:
        return bike_name
    return _normalize_display_part(row.get("gear_name")) or "Unknown bike"


def _coerce_optional_decimal(value):
    if value is None or value == "":
        return None
    if value in ("null", "None", "none"):
        return None
    try:
        numeric = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return None
    return numeric


@router.get("/api/gear/components")
def api_gear_components(gear_id: Optional[str] = None):
    bikes_sql = """
        select
            g.gear_id,
            g.gear_name,
            g.brand,
            g.model_year,
            coalesce(g.active, true) as active,
            coalesce(g.retired, false) as retired
        from gear g
        where lower(coalesce(g.gear_type, '')) = 'bike'
          and coalesce(g.active, true) = true
          and coalesce(g.retired, false) = false
        order by
            coalesce(g.model_year, 0) desc,
            lower(coalesce(g.brand, '')),
            lower(coalesce(g.gear_name, '')),
            g.gear_id
    """

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(bikes_sql)
            eligible_bikes = cur.fetchall()

            bike_options = []
            for row in eligible_bikes:
                bike_options.append(
                    {
                        "gear_id": row["gear_id"],
                        "gear_name": row["gear_name"],
                        "brand": row["brand"],
                        "model_year": row["model_year"],
                        "display_name": _format_gear_display_name(row),
                    }
                )

            eligible_ids = {row["gear_id"] for row in eligible_bikes}

            if gear_id:
                if gear_id not in eligible_ids:
                    raise HTTPException(status_code=400, detail="Invalid or ineligible gear_id.")
                selected_gear_id = gear_id
            elif DEFAULT_GEAR_ID in eligible_ids:
                selected_gear_id = DEFAULT_GEAR_ID
            elif eligible_bikes:
                selected_gear_id = eligible_bikes[0]["gear_id"]
            else:
                selected_gear_id = None

            if not selected_gear_id:
                return JSONResponse(
                    {
                        "available_bikes": bike_options,
                        "selected_gear_id": None,
                        "selected_bike": None,
                        "components": [],
                    }
                )

            selected_bike_sql = """
                select
                    g.gear_id,
                    g.gear_name,
                    g.brand,
                    g.model_year,
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
                    max(sa.date_local) as last_activity_date
                from gear g
                left join strava_activities sa
                    on sa.gear_id = g.gear_id
                where g.gear_id = %s
                group by g.gear_id, g.gear_name, g.brand, g.model_year
            """

            cur.execute(selected_bike_sql, (selected_gear_id,))
            selected_bike_row = cur.fetchone()

            components_sql = """
                with component_rows as (
                    select
                        gc.gear_component_id,
                        gc.gear_id,
                        gc.component_key,
                        gc.component_name,
                        gc.component_group,
                        gc."position",
                        gc.track_life,
                        gc.track_service,
                        gc.preferred_metric,
                        gc.service_interval_miles,
                        gc.service_interval_hours,
                        gc.service_interval_days,
                        gc.service_interval_rides,
                        gc.warning_percent,
                        gc.display_order,
                        gc.active,
                        gc.notes
                    from gear_component gc
                    where gc.gear_id = %s
                      and coalesce(gc.active, true) = true
                ),
                bike_totals as (
                    select
                        coalesce(sum(coalesce(sa.distance_mi, 0)), 0) as total_miles,
                        coalesce(sum(coalesce(sa.moving_sec, 0)) / 3600.0, 0) as total_hours,
                        coalesce(sum(coalesce(sa.elevation_ft, 0)), 0) as total_elevation_ft,
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
                        ) as total_rides
                    from strava_activities sa
                    where sa.gear_id = %s
                ),
                latest_events as (
                    select distinct on (gse.gear_component_id)
                        gse.gear_component_id,
                        gse.service_event_id,
                        gse.service_date,
                        gse.action,
                        gse.product_name,
                        gse.manufacturer,
                        gse.model,
                        gse.notes as event_notes,
                        gse.cost,
                        gse.odometer_miles,
                        gse.odometer_hours,
                        gse.odometer_rides,
                        gse.odometer_elevation_ft,
                        gse.performed_by,
                        gse.service_location,
                        gse.source,
                        gse.source_reference,
                        gse.created_at,
                        gse.updated_at
                    from public.gear_service_event gse
                    where gse.gear_id = %s
                    order by
                        gse.gear_component_id,
                        gse.service_date desc nulls last,
                        gse.created_at desc nulls last,
                        gse.service_event_id desc
                )
                select
                    c.gear_component_id,
                    c.gear_id,
                    c.component_key,
                    c.component_name,
                    c.component_group,
                    c."position",
                    c.track_life,
                    c.track_service,
                    c.preferred_metric,
                    c.service_interval_miles,
                    c.service_interval_hours,
                    c.service_interval_days,
                    c.service_interval_rides,
                    c.warning_percent,
                    c.display_order,
                    c.active,
                    c.notes,
                    le.service_event_id,
                    le.service_date,
                    le.action,
                    le.product_name,
                    le.manufacturer,
                    le.model,
                    le.event_notes,
                    le.cost,
                    le.odometer_miles,
                    le.odometer_hours,
                    le.odometer_rides,
                    le.odometer_elevation_ft,
                    le.performed_by,
                    le.service_location,
                    le.source,
                    le.source_reference,
                    le.created_at,
                    le.updated_at,
                    bt.total_miles,
                    bt.total_hours,
                    bt.total_rides,
                    bt.total_elevation_ft,
                    fallback.miles_since_date,
                    fallback.hours_since_date,
                    fallback.rides_since_date,
                    fallback.elevation_since_date
                from component_rows c
                cross join bike_totals bt
                left join latest_events le
                    on le.gear_component_id = c.gear_component_id
                left join lateral (
                    select
                        coalesce(sum(coalesce(sa.distance_mi, 0)), 0) as miles_since_date,
                        coalesce(sum(coalesce(sa.moving_sec, 0)) / 3600.0, 0) as hours_since_date,
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
                        ) as rides_since_date,
                        coalesce(sum(coalesce(sa.elevation_ft, 0)), 0) as elevation_since_date
                    from strava_activities sa
                    where sa.gear_id = %s
                      and le.service_date is not null
                      and sa.date_local::date > le.service_date
                ) fallback on true
                order by
                    coalesce(c.display_order, 999999),
                    lower(coalesce(c.component_group, '')),
                    lower(coalesce(c."position", '')),
                    lower(coalesce(c.component_name, '')),
                    c.gear_component_id
            """

            cur.execute(
                components_sql,
                (
                    selected_gear_id,
                    selected_gear_id,
                    selected_gear_id,
                    selected_gear_id,
                ),
            )
            component_rows = cur.fetchall()

    selected_bike = {
        "gear_id": selected_bike_row["gear_id"],
        "gear_name": selected_bike_row["gear_name"],
        "brand": selected_bike_row["brand"],
        "model_year": selected_bike_row["model_year"],
        "display_name": _format_gear_display_name(selected_bike_row),
        "activity_count": json_safe(selected_bike_row["activity_count"]),
        "ride_count": json_safe(selected_bike_row["ride_count"]),
        "miles": json_safe(selected_bike_row["miles"]),
        "hours": json_safe(selected_bike_row["hours"]),
        "elevation_ft": json_safe(selected_bike_row["elevation_ft"]),
        "last_activity_date": json_safe(selected_bike_row["last_activity_date"]),
    }

    components = []
    today = date.today()

    for row in component_rows:
        service_date = row["service_date"]
        has_event = row["service_event_id"] is not None

        days_since_service = None
        if service_date is not None:
            days_since_service = max((today - service_date).days, 0)

        miles_since_service = None
        hours_since_service = None
        rides_since_service = None
        elevation_since_service = None

        miles_basis = None
        hours_basis = None
        rides_basis = None
        elevation_basis = None

        if has_event:
            if row["odometer_miles"] is not None:
                miles_since_service = _clamp_non_negative(row["total_miles"] - row["odometer_miles"])
                miles_basis = "odometer"
            else:
                miles_since_service = _clamp_non_negative(row["miles_since_date"])
                miles_basis = "activities_after_service_date"

            if row["odometer_hours"] is not None:
                hours_since_service = _clamp_non_negative(row["total_hours"] - row["odometer_hours"])
                hours_basis = "odometer"
            else:
                hours_since_service = _clamp_non_negative(row["hours_since_date"])
                hours_basis = "activities_after_service_date"

            if row["odometer_rides"] is not None:
                rides_since_service = _clamp_non_negative(row["total_rides"] - row["odometer_rides"])
                rides_basis = "odometer"
            else:
                rides_since_service = _clamp_non_negative(row["rides_since_date"])
                rides_basis = "activities_after_service_date"

            if row["odometer_elevation_ft"] is not None:
                elevation_since_service = _clamp_non_negative(row["total_elevation_ft"] - row["odometer_elevation_ft"])
                elevation_basis = "odometer"
            else:
                elevation_since_service = _clamp_non_negative(row["elevation_since_date"])
                elevation_basis = "activities_after_service_date"

        component_payload = {
            "gear_component_id": row["gear_component_id"],
            "gear_id": row["gear_id"],
            "component_key": row["component_key"],
            "component_name": row["component_name"],
            "component_group": row["component_group"],
            "position": row["position"],
            "track_life": row["track_life"],
            "track_service": row["track_service"],
            "preferred_metric": row["preferred_metric"],
            "service_interval_miles": row["service_interval_miles"],
            "service_interval_hours": row["service_interval_hours"],
            "service_interval_days": row["service_interval_days"],
            "service_interval_rides": row["service_interval_rides"],
            "warning_percent": row["warning_percent"],
            "display_order": row["display_order"],
            "active": row["active"],
            "notes": row["notes"],
            "latest_event": None,
            "usage_since_latest_event": {
                "days_since_service": days_since_service,
                "miles_since_service": miles_since_service,
                "hours_since_service": hours_since_service,
                "rides_since_service": rides_since_service,
                "elevation_ft_since_service": elevation_since_service,
                "miles_basis": miles_basis,
                "hours_basis": hours_basis,
                "rides_basis": rides_basis,
                "elevation_basis": elevation_basis,
            },
        }

        if has_event:
            component_payload["latest_event"] = {
                "service_event_id": row["service_event_id"],
                "gear_component_id": row["gear_component_id"],
                "gear_id": row["gear_id"],
                "service_date": json_safe(row["service_date"]),
                "action": row["action"],
                "product_name": row["product_name"],
                "manufacturer": row["manufacturer"],
                "model": row["model"],
                "notes": row["event_notes"],
                "cost": json_safe(row["cost"]),
                "odometer_miles": json_safe(row["odometer_miles"]),
                "odometer_hours": json_safe(row["odometer_hours"]),
                "odometer_rides": json_safe(row["odometer_rides"]),
                "odometer_elevation_ft": json_safe(row["odometer_elevation_ft"]),
                "performed_by": row.get("performed_by"),
                "service_location": row.get("service_location"),
                "source": row["source"],
                "source_reference": row["source_reference"],
                "created_at": json_safe(row["created_at"]),
                "updated_at": json_safe(row["updated_at"]),
            }

        components.append(component_payload)

    archived_components = []
    archived_sql = """
        select
            gc.gear_component_id,
            gc.gear_id,
            gc.component_key,
            gc.component_name,
            gc.component_group,
            gc."position",
            gc.track_life,
            gc.track_service,
            gc.preferred_metric,
            gc.service_interval_miles,
            gc.service_interval_hours,
            gc.service_interval_days,
            gc.service_interval_rides,
            gc.warning_percent,
            gc.display_order,
            gc.active,
            gc.notes
        from gear_component gc
        where gc.gear_id = %s
          and coalesce(gc.active, true) = false
        order by
            coalesce(gc.display_order, 999999),
            lower(coalesce(gc.component_group, '')),
            lower(coalesce(gc.component_name, '')),
            gc.gear_component_id
    """

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(archived_sql, (selected_gear_id,))
            archived_rows = cur.fetchall()

    for row in archived_rows:
        archived_components.append(
            {
                "gear_component_id": row["gear_component_id"],
                "gear_id": row["gear_id"],
                "component_key": row["component_key"],
                "component_name": row["component_name"],
                "component_group": row["component_group"],
                "position": row["position"],
                "track_life": row["track_life"],
                "track_service": row["track_service"],
                "preferred_metric": row["preferred_metric"],
                "service_interval_miles": row["service_interval_miles"],
                "service_interval_hours": row["service_interval_hours"],
                "service_interval_days": row["service_interval_days"],
                "service_interval_rides": row["service_interval_rides"],
                "warning_percent": row["warning_percent"],
                "display_order": row["display_order"],
                "active": row["active"],
                "notes": row["notes"],
            }
        )

    return JSONResponse(
        {
            "available_bikes": bike_options,
            "selected_gear_id": selected_gear_id,
            "selected_bike": selected_bike,
            "components": [
                {
                    key: json_safe(value)
                    for key, value in component.items()
                }
                for component in components
            ],
            "archived_components": [
                {
                    key: json_safe(value)
                    for key, value in component.items()
                }
                for component in archived_components
            ],
        }
    )


@router.post("/api/gear/components")
def api_add_component(payload: dict | None = Body(default=None)):
    if payload is None or not isinstance(payload, dict):
        return JSONResponse({"detail": "Request body must be an object."}, status_code=400)

    gear_id = _normalize_text(payload.get("gear_id"))
    if not gear_id:
        return JSONResponse({"detail": "gear_id is required."}, status_code=400)

    if isinstance(payload.get("component"), dict):
        payload = {**payload["component"], **payload.get("component", {})}
    if isinstance(payload.get("baseline"), dict):
        baseline = payload["baseline"]
        payload["baseline_mode"] = payload.get("baseline_mode", baseline.get("mode"))
        payload["baseline_service_date"] = payload.get("baseline_service_date", baseline.get("service_date"))

    baseline_mode = _normalize_text(payload.get("baseline_mode")) or "current_snapshot"
    if baseline_mode not in {"current_snapshot", "custom", "original"}:
        return JSONResponse({"detail": "baseline_mode must be current_snapshot, custom, or original."}, status_code=400)

    baseline_service_date = _normalize_text(payload.get("baseline_service_date"))
    try:
        service_date = date.fromisoformat(baseline_service_date) if baseline_service_date else date.today()
    except ValueError:
        return JSONResponse({"detail": "baseline_service_date must be a valid ISO date."}, status_code=400)

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("select gear_id from gear where gear_id = %s and coalesce(active, true) = true", (gear_id,))
            if cur.fetchone() is None:
                return JSONResponse({"detail": "Invalid or inactive gear_id."}, status_code=400)

            component_name = _normalize_text(payload.get("component_name"))
            component_group = _normalize_text(payload.get("component_group"))
            if not component_name:
                return JSONResponse({"detail": "component_name is required."}, status_code=400)
            if not component_group:
                return JSONResponse({"detail": "component_group is required."}, status_code=400)

            component_key = _normalize_component_key(payload.get("component_key"), component_name)
            position = _normalize_text(payload.get("position")) or None
            track_life = bool(payload.get("track_life", False))
            track_service = bool(payload.get("track_service", True))
            preferred_metric = _normalize_text(payload.get("preferred_metric")) or "mixed"
            if preferred_metric not in {"miles", "hours", "days", "rides", "mixed", "inspection"}:
                return JSONResponse({"detail": "preferred_metric is invalid."}, status_code=400)

            warning_percent = _coerce_optional_decimal(payload.get("warning_percent", 80))
            if warning_percent is None:
                warning_percent = Decimal("80.00")
            if warning_percent <= 0 or warning_percent > 100:
                return JSONResponse({"detail": "warning_percent must be between 0 and 100."}, status_code=400)

            display_order = payload.get("display_order")
            try:
                display_order = int(display_order) if display_order not in (None, "", "null") else 100
            except (TypeError, ValueError):
                return JSONResponse({"detail": "display_order must be an integer."}, status_code=400)

            service_interval_miles = _coerce_optional_decimal(payload.get("service_interval_miles"))
            service_interval_hours = _coerce_optional_decimal(payload.get("service_interval_hours"))
            service_interval_days = payload.get("service_interval_days")
            service_interval_rides = payload.get("service_interval_rides")

            for value_name, value in {
                "service_interval_days": service_interval_days,
                "service_interval_rides": service_interval_rides,
            }.items():
                if value in (None, "", "null"):
                    continue
                try:
                    numeric = int(value)
                except (TypeError, ValueError):
                    return JSONResponse({"detail": f"{value_name} must be a non-negative integer."}, status_code=400)
                if numeric < 0:
                    return JSONResponse({"detail": f"{value_name} cannot be negative."}, status_code=400)
                if value_name == "service_interval_days":
                    service_interval_days = numeric
                else:
                    service_interval_rides = numeric

            if service_interval_miles is not None and service_interval_miles <= 0:
                return JSONResponse({"detail": "service_interval_miles must be positive when provided."}, status_code=400)
            if service_interval_hours is not None and service_interval_hours <= 0:
                return JSONResponse({"detail": "service_interval_hours must be positive when provided."}, status_code=400)

            cur.execute(
                "select gear_component_id from gear_component where gear_id = %s and lower(component_key) = lower(%s) and coalesce(active, true) = true",
                (gear_id, component_key),
            )
            if cur.fetchone() is not None:
                return JSONResponse({"detail": "An active component with that key already exists for this bike."}, status_code=409)

            cur.execute(
                "select gear_component_id from gear_component where gear_id = %s and lower(component_key) = lower(%s) and coalesce(active, true) = false",
                (gear_id, component_key),
            )
            if cur.fetchone() is not None:
                return JSONResponse({"detail": "That component key exists as archived. Restore it instead of creating a duplicate."}, status_code=409)

            cur.execute(
                """
                    select
                        coalesce(sum(coalesce(sa.distance_mi, 0)), 0) as total_miles,
                        coalesce(sum(coalesce(sa.moving_sec, 0)) / 3600.0, 0) as total_hours,
                        count(sa.activity_id) filter (
                            where lower(coalesce(sa.activity_category, '')) = 'ride'
                                or lower(coalesce(sa.sport_type, '')) in (
                                    'ride', 'road', 'gravel', 'mountain bike', 'mtb', 'e-bike', 'ebike',
                                    'cycling', 'virtual ride', 'indoor cycle'
                                )
                                or lower(coalesce(sa.sport_type, '')) like '%%bike%%'
                        ) as total_rides
                    from strava_activities sa
                    where sa.gear_id = %s
                """,
                (gear_id,),
            )
            bike_usage = cur.fetchone()

            if baseline_mode == "original":
                odometer_miles = 0
                odometer_hours = 0
                odometer_rides = 0
            elif baseline_mode == "custom":
                baseline_miles = payload.get("baseline_bike_miles")
                baseline_hours = payload.get("baseline_bike_hours")
                baseline_rides = payload.get("baseline_bike_rides")
                if baseline_miles in (None, "", "null"):
                    baseline_miles = bike_usage["total_miles"]
                if baseline_hours in (None, "", "null"):
                    baseline_hours = bike_usage["total_hours"]
                if baseline_rides in (None, "", "null"):
                    baseline_rides = bike_usage["total_rides"]
                try:
                    baseline_miles = float(baseline_miles)
                except (TypeError, ValueError):
                    return JSONResponse({"detail": "baseline_bike_miles must be a non-negative number."}, status_code=400)
                try:
                    baseline_hours = float(baseline_hours)
                except (TypeError, ValueError):
                    return JSONResponse({"detail": "baseline_bike_hours must be a non-negative number."}, status_code=400)
                try:
                    baseline_rides = int(baseline_rides)
                except (TypeError, ValueError):
                    return JSONResponse({"detail": "baseline_bike_rides must be a non-negative integer."}, status_code=400)
                if baseline_miles < 0 or baseline_hours < 0 or baseline_rides < 0:
                    return JSONResponse({"detail": "component baseline values cannot be negative."}, status_code=400)
                odometer_miles = baseline_miles
                odometer_hours = baseline_hours
                odometer_rides = baseline_rides
            else:
                odometer_miles = float(bike_usage["total_miles"]) if bike_usage["total_miles"] is not None else None
                odometer_hours = float(bike_usage["total_hours"]) if bike_usage["total_hours"] is not None else None
                odometer_rides = int(bike_usage["total_rides"]) if bike_usage["total_rides"] is not None else None

            cur.execute(
                """
                    insert into gear_component (
                        gear_id,
                        component_key,
                        component_name,
                        component_group,
                        position,
                        track_life,
                        track_service,
                        preferred_metric,
                        service_interval_miles,
                        service_interval_hours,
                        service_interval_days,
                        service_interval_rides,
                        warning_percent,
                        display_order,
                        active,
                        notes
                    ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, true, %s)
                    returning gear_component_id
                """,
                (
                    gear_id,
                    component_key,
                    component_name,
                    component_group,
                    position,
                    track_life,
                    track_service,
                    preferred_metric,
                    service_interval_miles,
                    service_interval_hours,
                    service_interval_days,
                    service_interval_rides,
                    warning_percent,
                    display_order,
                    _normalize_text(payload.get("notes")) or None,
                ),
            )
            row = cur.fetchone()
            component_id = row["gear_component_id"]

            cur.execute(
                """
                    insert into gear_service_event (
                        gear_component_id,
                        gear_id,
                        service_date,
                        action,
                        notes,
                        cost,
                        odometer_miles,
                        odometer_hours,
                        odometer_rides,
                        odometer_elevation_ft,
                        performed_by,
                        service_location,
                        source,
                        source_reference
                    ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'app', %s)
                """,
                (
                    component_id,
                    gear_id,
                    service_date,
                    "New" if baseline_mode == "original" else "Installation",
                    "Original lifecycle baseline captured at component creation." if baseline_mode == "original" else "Initial lifecycle baseline captured at component creation.",
                    None,
                    odometer_miles,
                    odometer_hours,
                    odometer_rides,
                    0,
                    None,
                    None,
                    f"component:{component_id}",
                ),
            )
            return JSONResponse({"gear_component_id": component_id, "component_key": component_key}, status_code=201)


@router.patch("/api/components/{gear_component_id}")
def api_update_component(gear_component_id: int, payload: dict | None = Body(default=None)):
    if payload is None or not isinstance(payload, dict):
        return JSONResponse({"detail": "Request body must be an object."}, status_code=400)

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                    select
                        gear_component_id,
                        gear_id,
                        component_key,
                        component_name,
                        component_group,
                        position,
                        track_life,
                        track_service,
                        preferred_metric,
                        service_interval_miles,
                        service_interval_hours,
                        service_interval_days,
                        service_interval_rides,
                        warning_percent,
                        display_order,
                        active,
                        notes
                    from gear_component
                    where gear_component_id = %s
                """,
                (gear_component_id,),
            )
            component = cur.fetchone()
            if component is None:
                raise HTTPException(status_code=404, detail="Component not found.")

            new_name = _normalize_text(payload.get("component_name"))
            if new_name:
                component_name = new_name
            else:
                component_name = component["component_name"]

            new_group = _normalize_text(payload.get("component_group"))
            if new_group:
                component_group = new_group
            else:
                component_group = component["component_group"]

            if not component_name:
                return JSONResponse({"detail": "component_name is required."}, status_code=400)
            if not component_group:
                return JSONResponse({"detail": "component_group is required."}, status_code=400)

            component_key = _normalize_component_key(payload.get("component_key"), component["component_key"])
            if payload.get("component_key") not in (None, ""):
                cur.execute(
                    "select gear_component_id from gear_component where gear_id = %s and lower(component_key) = lower(%s) and gear_component_id != %s and coalesce(active, true) = true",
                    (component["gear_id"], component_key, gear_component_id),
                )
                if cur.fetchone() is not None:
                    return JSONResponse({"detail": "An active component with that key already exists for this bike."}, status_code=409)

            position = _normalize_text(payload.get("position")) or None
            track_life = payload.get("track_life")
            if track_life is not None:
                track_life = bool(track_life)
            else:
                track_life = component["track_life"]

            track_service = payload.get("track_service")
            if track_service is not None:
                track_service = bool(track_service)
            else:
                track_service = component["track_service"]

            preferred_metric = _normalize_text(payload.get("preferred_metric")) or component["preferred_metric"]
            if preferred_metric not in {"miles", "hours", "days", "rides", "mixed", "inspection"}:
                return JSONResponse({"detail": "preferred_metric is invalid."}, status_code=400)

            warning_percent = _coerce_optional_decimal(payload.get("warning_percent"))
            if warning_percent is None:
                warning_percent = Decimal(str(component["warning_percent"])) if component["warning_percent"] is not None else Decimal("80.00")
            if warning_percent <= 0 or warning_percent > 100:
                return JSONResponse({"detail": "warning_percent must be between 0 and 100."}, status_code=400)

            service_interval_miles = _coerce_optional_decimal(payload.get("service_interval_miles"))
            if service_interval_miles is None and "service_interval_miles" in payload:
                service_interval_miles = None
            elif service_interval_miles is None:
                service_interval_miles = component["service_interval_miles"]
            if service_interval_miles is not None and service_interval_miles <= 0:
                return JSONResponse({"detail": "service_interval_miles must be positive when provided."}, status_code=400)

            service_interval_hours = _coerce_optional_decimal(payload.get("service_interval_hours"))
            if service_interval_hours is None and "service_interval_hours" in payload:
                service_interval_hours = None
            elif service_interval_hours is None:
                service_interval_hours = component["service_interval_hours"]
            if service_interval_hours is not None and service_interval_hours <= 0:
                return JSONResponse({"detail": "service_interval_hours must be positive when provided."}, status_code=400)

            service_interval_days = payload.get("service_interval_days")
            if service_interval_days in (None, "", "null"):
                service_interval_days = None
            else:
                try:
                    service_interval_days = int(service_interval_days)
                except (TypeError, ValueError):
                    return JSONResponse({"detail": "service_interval_days must be a non-negative integer."}, status_code=400)
                if service_interval_days < 0:
                    return JSONResponse({"detail": "service_interval_days cannot be negative."}, status_code=400)
            if service_interval_days is None and "service_interval_days" in payload:
                service_interval_days = None
            elif service_interval_days is None:
                service_interval_days = component["service_interval_days"]

            service_interval_rides = payload.get("service_interval_rides")
            if service_interval_rides in (None, "", "null"):
                service_interval_rides = None
            else:
                try:
                    service_interval_rides = int(service_interval_rides)
                except (TypeError, ValueError):
                    return JSONResponse({"detail": "service_interval_rides must be a non-negative integer."}, status_code=400)
                if service_interval_rides < 0:
                    return JSONResponse({"detail": "service_interval_rides cannot be negative."}, status_code=400)
            if service_interval_rides is None and "service_interval_rides" in payload:
                service_interval_rides = None
            elif service_interval_rides is None:
                service_interval_rides = component["service_interval_rides"]

            display_order = payload.get("display_order")
            if display_order in (None, "", "null"):
                display_order = component["display_order"]
            else:
                try:
                    display_order = int(display_order)
                except (TypeError, ValueError):
                    return JSONResponse({"detail": "display_order must be an integer."}, status_code=400)

            notes = payload.get("notes")
            if notes is None:
                notes = component["notes"]
            notes = _normalize_text(notes) or None

            cur.execute(
                """
                    update gear_component
                    set component_key = %s,
                        component_name = %s,
                        component_group = %s,
                        position = %s,
                        track_life = %s,
                        track_service = %s,
                        preferred_metric = %s,
                        service_interval_miles = %s,
                        service_interval_hours = %s,
                        service_interval_days = %s,
                        service_interval_rides = %s,
                        warning_percent = %s,
                        display_order = %s,
                        notes = %s,
                        updated_at = now()
                    where gear_component_id = %s
                """,
                (
                    component_key,
                    component_name,
                    component_group,
                    position,
                    track_life,
                    track_service,
                    preferred_metric,
                    service_interval_miles,
                    service_interval_hours,
                    service_interval_days,
                    service_interval_rides,
                    warning_percent,
                    display_order,
                    notes,
                    gear_component_id,
                ),
            )
            return JSONResponse({"gear_component_id": gear_component_id, "updated": True})


@router.post("/api/components/{gear_component_id}/archive")
def api_archive_component(gear_component_id: int):
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "update gear_component set active = false, updated_at = now() where gear_component_id = %s returning gear_component_id",
                (gear_component_id,),
            )
            if cur.fetchone() is None:
                raise HTTPException(status_code=404, detail="Component not found.")
    return JSONResponse({"gear_component_id": gear_component_id, "active": False})


@router.post("/api/components/{gear_component_id}/restore")
def api_restore_component(gear_component_id: int):
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "select gear_id, component_key from gear_component where gear_component_id = %s",
                (gear_component_id,),
            )
            component = cur.fetchone()
            if component is None:
                raise HTTPException(status_code=404, detail="Component not found.")

            cur.execute(
                "select gear_component_id from gear_component where gear_id = %s and lower(component_key) = lower(%s) and coalesce(active, true) = true and gear_component_id != %s",
                (component["gear_id"], component["component_key"], gear_component_id),
            )
            if cur.fetchone() is not None:
                return JSONResponse({"detail": "An active component with that key already exists for this bike."}, status_code=409)

            cur.execute(
                "update gear_component set active = true, updated_at = now() where gear_component_id = %s returning gear_component_id",
                (gear_component_id,),
            )
            row = cur.fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="Component not found.")
    return JSONResponse({"gear_component_id": gear_component_id, "active": True})


@router.get("/api/components/{gear_component_id}/services")
def api_component_services(gear_component_id: int):
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                    select
                        gc.gear_component_id,
                        gc.gear_id,
                        gc.component_name,
                        gc.component_group,
                        gc.position,
                        gc.active,
                        gc.track_service,
                        g.gear_name,
                        g.brand,
                        g.model_year
                    from gear_component gc
                    join gear g on g.gear_id = gc.gear_id
                    where gc.gear_component_id = %s
                """,
                (gear_component_id,),
            )
            component = cur.fetchone()
            if not component:
                raise HTTPException(status_code=404, detail="Component not found.")

            cur.execute(
                """
                    select
                        service_event_id,
                        gear_component_id,
                        gear_id,
                        service_date,
                        action,
                        product_name,
                        manufacturer,
                        model,
                        notes,
                        cost,
                        odometer_miles,
                        odometer_hours,
                        odometer_rides,
                        odometer_elevation_ft,
                        performed_by,
                        service_location,
                        created_at,
                        updated_at
                    from gear_service_event
                    where gear_component_id = %s
                    order by service_date desc, service_event_id desc
                """,
                (gear_component_id,),
            )
            service_rows = cur.fetchall()

    component_payload = {
        "gear_component_id": component["gear_component_id"],
        "gear_id": component["gear_id"],
        "component_name": component["component_name"],
        "component_group": component["component_group"],
        "position": component["position"],
        "active": component["active"],
        "track_service": component["track_service"],
        "bike_name": component["gear_name"],
        "bike_display_name": _format_bike_display_name(component),
        "brand": component["brand"],
        "model_year": component["model_year"],
    }

    services = [
        {
            "service_event_id": row["service_event_id"],
            "gear_component_id": row["gear_component_id"],
            "gear_id": row["gear_id"],
            "service_date": json_safe(row["service_date"]),
            "service_type": row["action"],
            "product_name": row["product_name"],
            "manufacturer": row["manufacturer"],
            "model": row["model"],
            "notes": row["notes"],
            "cost": json_safe(row["cost"]),
            "mileage_at_service": json_safe(row["odometer_miles"]),
            "hours_at_service": json_safe(row["odometer_hours"]),
            "rides_at_service": json_safe(row["odometer_rides"]),
            "elevation_at_service": json_safe(row["odometer_elevation_ft"]),
            "service_provider": row["performed_by"],
            "service_location": row["service_location"],
            "created_at": json_safe(row["created_at"]),
            "updated_at": json_safe(row["updated_at"]),
        }
        for row in service_rows
    ]

    return JSONResponse({"component": component_payload, "services": services})


@router.post("/api/components/{gear_component_id}/services")
def api_create_component_service(gear_component_id: int, payload: dict | None = Body(default=None)):
    if payload is None or not isinstance(payload, dict):
        return JSONResponse({"detail": "Request body must be an object."}, status_code=400)

    raw_service_date = payload.get("service_date")
    try:
        service_date = date.fromisoformat(str(raw_service_date)) if raw_service_date not in (None, "") else None
    except ValueError:
        return JSONResponse({"detail": "service_date must be a valid ISO date."}, status_code=400)

    if service_date is None:
        return JSONResponse({"detail": "service_date is required."}, status_code=400)

    if service_date > date.today() + timedelta(days=365):
        return JSONResponse({"detail": "service_date cannot be more than one year in the future."}, status_code=400)

    service_type = _normalize_text(payload.get("service_type"))
    if not service_type:
        return JSONResponse({"detail": "service_type is required."}, status_code=400)

    notes = _normalize_text(payload.get("notes"))
    service_provider = _normalize_text(payload.get("service_provider"))
    if service_provider == "null":
        service_provider = ""

    raw_cost = payload.get("service_cost")
    cost = None
    if raw_cost not in (None, "", "null", "None"):
        try:
            cost = Decimal(str(raw_cost))
        except (InvalidOperation, TypeError, ValueError):
            return JSONResponse({"detail": "service_cost must be a valid non-negative number."}, status_code=400)
        if cost < 0:
            return JSONResponse({"detail": "service_cost cannot be negative."}, status_code=400)

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                    select gear_id
                    from gear_component
                    where gear_component_id = %s
                """,
                (gear_component_id,),
            )
            component_row = cur.fetchone()
            if not component_row:
                raise HTTPException(status_code=404, detail="Component not found.")

            gear_id = component_row["gear_id"]

            cur.execute(
                """
                    select
                        coalesce(sum(coalesce(sa.distance_mi, 0)), 0) as total_miles,
                        coalesce(sum(coalesce(sa.moving_sec, 0)) / 3600.0, 0) as total_hours,
                        count(sa.activity_id) filter (
                            where lower(coalesce(sa.activity_category, '')) = 'ride'
                                or lower(coalesce(sa.sport_type, '')) in (
                                    'ride', 'road', 'gravel', 'mountain bike', 'mtb', 'e-bike', 'ebike',
                                    'cycling', 'virtual ride', 'indoor cycle'
                                )
                                or lower(coalesce(sa.sport_type, '')) like '%%bike%%'
                        ) as total_rides
                    from strava_activities sa
                    where sa.gear_id = %s
                """,
                (gear_id,),
            )
            usage_snapshot = cur.fetchone()

            odometer_miles = float(usage_snapshot["total_miles"]) if usage_snapshot and usage_snapshot["total_miles"] is not None else None
            odometer_hours = float(usage_snapshot["total_hours"]) if usage_snapshot and usage_snapshot["total_hours"] is not None else None
            odometer_rides = int(usage_snapshot["total_rides"]) if usage_snapshot and usage_snapshot["total_rides"] is not None else None

            cur.execute(
                """
                    insert into gear_service_event (
                        gear_component_id,
                        gear_id,
                        service_date,
                        action,
                        notes,
                        cost,
                        odometer_miles,
                        odometer_hours,
                        odometer_rides,
                        performed_by,
                        service_location,
                        source,
                        source_reference
                    )
                    values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'app', %s)
                    returning
                        service_event_id,
                        gear_component_id,
                        gear_id,
                        service_date,
                        action,
                        notes,
                        cost,
                        odometer_miles,
                        odometer_hours,
                        odometer_rides,
                        performed_by,
                        service_location,
                        created_at,
                        updated_at
                """,
                (
                    gear_component_id,
                    gear_id,
                    service_date,
                    service_type,
                    notes or None,
                    cost,
                    odometer_miles,
                    odometer_hours,
                    odometer_rides,
                    service_provider or None,
                    payload.get("service_location") or None,
                    f"component:{gear_component_id}",
                ),
            )
            row = cur.fetchone()

    return JSONResponse(
        {
            "service_event_id": row["service_event_id"],
            "gear_component_id": row["gear_component_id"],
            "gear_id": row["gear_id"],
            "service_date": json_safe(row["service_date"]),
            "service_type": row["action"],
            "notes": row["notes"],
            "cost": json_safe(row["cost"]),
            "mileage_at_service": json_safe(row["odometer_miles"]),
            "hours_at_service": json_safe(row["odometer_hours"]),
            "rides_at_service": json_safe(row["odometer_rides"]),
            "service_provider": row["performed_by"],
            "service_location": row["service_location"],
            "created_at": json_safe(row["created_at"]),
            "updated_at": json_safe(row["updated_at"]),
        }
    )


@router.patch("/api/components/{gear_component_id}/services/{service_event_id}")
def api_update_component_service(gear_component_id: int, service_event_id: int, payload: dict | None = Body(default=None)):
    if payload is None or not isinstance(payload, dict):
        return JSONResponse({"detail": "Request body must be an object."}, status_code=400)

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                    select
                        gc.gear_component_id,
                        gc.gear_id,
                        gc.component_name,
                        gc.component_group,
                        gc.position,
                        gc.active,
                        gc.track_service
                    from gear_component gc
                    where gc.gear_component_id = %s
                """,
                (gear_component_id,),
            )
            component = cur.fetchone()
            if component is None:
                raise HTTPException(status_code=404, detail="Component not found.")

            cur.execute(
                """
                    select
                        service_event_id,
                        gear_component_id,
                        gear_id,
                        service_date,
                        action,
                        product_name,
                        manufacturer,
                        model,
                        notes,
                        cost,
                        odometer_miles,
                        odometer_hours,
                        odometer_rides,
                        odometer_elevation_ft,
                        performed_by,
                        service_location,
                        source,
                        source_reference,
                        created_at,
                        updated_at
                    from gear_service_event
                    where service_event_id = %s and gear_component_id = %s
                """,
                (service_event_id, gear_component_id),
            )
            existing = cur.fetchone()
            if existing is None:
                raise HTTPException(status_code=404, detail="Service event not found for this component.")

            raw_service_date = payload.get("service_date")
            if raw_service_date in (None, ""):
                service_date = existing["service_date"]
            else:
                try:
                    service_date = date.fromisoformat(str(raw_service_date))
                except ValueError:
                    return JSONResponse({"detail": "service_date must be a valid ISO date."}, status_code=400)
                if service_date > date.today() + timedelta(days=365):
                    return JSONResponse({"detail": "service_date cannot be more than one year in the future."}, status_code=400)

            raw_action = payload.get("action")
            if raw_action in (None, ""):
                action = existing["action"]
            else:
                action = _normalize_text(raw_action)
                if not action:
                    return JSONResponse({"detail": "action is required."}, status_code=400)

            def _resolve_optional_text(field_name, current_value):
                value = payload.get(field_name)
                if value is None:
                    return current_value
                normalized = _normalize_text(value)
                if normalized in {"", "null", "none", "undefined"}:
                    return None
                return normalized

            def _resolve_optional_numeric(field_name, current_value):
                raw_value = payload.get(field_name)
                if raw_value in (None, ""):
                    return current_value
                if raw_value in ("null", "None", "none", "undefined"):
                    return None
                if isinstance(raw_value, str):
                    raw_value = raw_value.strip()
                    if raw_value == "":
                        return current_value
                try:
                    numeric = float(raw_value)
                except (TypeError, ValueError):
                    return JSONResponse({"detail": f"{field_name} must be a valid number."}, status_code=400)
                if numeric < 0:
                    return JSONResponse({"detail": f"{field_name} cannot be negative."}, status_code=400)
                return numeric

            product_name = _resolve_optional_text("product_name", existing["product_name"])
            manufacturer = _resolve_optional_text("manufacturer", existing["manufacturer"])
            model = _resolve_optional_text("model", existing["model"])
            notes = _resolve_optional_text("notes", existing["notes"])
            service_provider = _resolve_optional_text("service_provider", existing["performed_by"])
            service_location = _resolve_optional_text("service_location", existing["service_location"])

            raw_cost = payload.get("cost")
            if raw_cost in (None, ""):
                cost = existing["cost"]
            else:
                if str(raw_cost).strip().lower() in {"null", "none", "undefined"}:
                    cost = None
                else:
                    try:
                        cost = Decimal(str(raw_cost))
                    except (InvalidOperation, TypeError, ValueError):
                        return JSONResponse({"detail": "cost must be a valid non-negative number."}, status_code=400)
                    if cost < 0:
                        return JSONResponse({"detail": "cost cannot be negative."}, status_code=400)

            odometer_miles = _resolve_optional_numeric("odometer_miles", existing["odometer_miles"])
            odometer_hours = _resolve_optional_numeric("odometer_hours", existing["odometer_hours"])
            odometer_rides = _resolve_optional_numeric("odometer_rides", existing["odometer_rides"])
            odometer_elevation_ft = _resolve_optional_numeric("odometer_elevation_ft", existing["odometer_elevation_ft"])

            if isinstance(odometer_rides, (float, int)):
                odometer_rides = int(odometer_rides)
            if isinstance(odometer_miles, (float, int)) and not isinstance(odometer_miles, bool):
                odometer_miles = float(odometer_miles)
            if isinstance(odometer_hours, (float, int)) and not isinstance(odometer_hours, bool):
                odometer_hours = float(odometer_hours)
            if isinstance(odometer_elevation_ft, (float, int)) and not isinstance(odometer_elevation_ft, bool):
                odometer_elevation_ft = float(odometer_elevation_ft)

            cur.execute(
                """
                    update gear_service_event
                    set service_date = %s,
                        action = %s,
                        product_name = %s,
                        manufacturer = %s,
                        model = %s,
                        notes = %s,
                        cost = %s,
                        odometer_miles = %s,
                        odometer_hours = %s,
                        odometer_rides = %s,
                        odometer_elevation_ft = %s,
                        performed_by = %s,
                        service_location = %s,
                        updated_at = now()
                    where service_event_id = %s and gear_component_id = %s
                    returning
                        service_event_id,
                        gear_component_id,
                        gear_id,
                        service_date,
                        action,
                        product_name,
                        manufacturer,
                        model,
                        notes,
                        cost,
                        odometer_miles,
                        odometer_hours,
                        odometer_rides,
                        odometer_elevation_ft,
                        performed_by,
                        service_location,
                        created_at,
                        updated_at
                """,
                (
                    service_date,
                    action,
                    product_name,
                    manufacturer,
                    model,
                    notes,
                    cost,
                    odometer_miles,
                    odometer_hours,
                    odometer_rides,
                    odometer_elevation_ft,
                    service_provider,
                    service_location,
                    service_event_id,
                    gear_component_id,
                ),
            )
            row = cur.fetchone()

    return JSONResponse(
        {
            "service_event_id": row["service_event_id"],
            "gear_component_id": row["gear_component_id"],
            "gear_id": row["gear_id"],
            "service_date": json_safe(row["service_date"]),
            "service_type": row["action"],
            "product_name": row["product_name"],
            "manufacturer": row["manufacturer"],
            "model": row["model"],
            "notes": row["notes"],
            "cost": json_safe(row["cost"]),
            "mileage_at_service": json_safe(row["odometer_miles"]),
            "hours_at_service": json_safe(row["odometer_hours"]),
            "rides_at_service": json_safe(row["odometer_rides"]),
            "elevation_at_service": json_safe(row["odometer_elevation_ft"]),
            "service_provider": row["performed_by"],
            "service_location": row["service_location"],
            "created_at": json_safe(row["created_at"]),
            "updated_at": json_safe(row["updated_at"]),
        }
    )
