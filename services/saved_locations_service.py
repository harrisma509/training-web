"""Persistence helpers for durable saved locations."""

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from db import db_conn
from services.geocoding_service import resolve_place, search_places


LOCATION_TYPES = frozenset({"home", "work", "training", "other"})
LIFECYCLE_STATES = frozenset({"active", "hidden", "archived"})
COORDINATE_QUANTUM = Decimal("0.000001")
MAX_DISPLAY_NAME_LENGTH = 120


class SavedLocationNotFoundError(LookupError):
    """A requested saved location does not exist."""


class SavedLocationConfigurationError(RuntimeError):
    """The persisted Home location is missing or inconsistent."""


class SavedLocationInUseError(RuntimeError):
    """A saved location is referenced by Plan history."""


def _validate_name(display_name):
    if not isinstance(display_name, str) or not display_name.strip():
        raise ValueError("display_name must be a non-empty string.")
    normalized = display_name.strip()
    if len(normalized) > MAX_DISPLAY_NAME_LENGTH:
        raise ValueError(
            f"display_name must be at most {MAX_DISPLAY_NAME_LENGTH} characters."
        )
    return normalized


def _validate_coordinate(value, *, field_name, minimum, maximum):
    if isinstance(value, bool):
        raise ValueError(f"{field_name} must be a finite decimal coordinate.")
    try:
        coordinate = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise ValueError(
            f"{field_name} must be a finite decimal coordinate."
        ) from None
    if not coordinate.is_finite() or not minimum <= coordinate <= maximum:
        raise ValueError(f"{field_name} is outside the valid range.")
    normalized = coordinate.quantize(
        COORDINATE_QUANTUM,
        rounding=ROUND_HALF_UP,
    )
    if not minimum <= normalized <= maximum:
        raise ValueError(f"{field_name} is outside the valid range.")
    return normalized


def _validate_timezone(timezone_name):
    if not isinstance(timezone_name, str) or not timezone_name.strip():
        raise ValueError("timezone_name must be an IANA timezone name.")
    normalized = timezone_name.strip()
    try:
        ZoneInfo(normalized)
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError("timezone_name must be an IANA timezone name.") from None
    return normalized


def _validate_location_type(location_type):
    if not isinstance(location_type, str):
        raise ValueError("location_type is invalid.")
    normalized = location_type.strip().lower()
    if normalized not in LOCATION_TYPES:
        raise ValueError("location_type is invalid.")
    return normalized


def _validate_lifecycle_state(lifecycle_state):
    if not isinstance(lifecycle_state, str):
        raise ValueError("lifecycle_state is invalid.")
    normalized = lifecycle_state.strip().lower()
    if normalized not in LIFECYCLE_STATES:
        raise ValueError("lifecycle_state is invalid.")
    return normalized


def _validated_location_fields(
    *,
    display_name,
    latitude,
    longitude,
    timezone_name,
    location_type,
    lifecycle_state,
):
    return {
        "display_name": _validate_name(display_name),
        "latitude": _validate_coordinate(
            latitude,
            field_name="latitude",
            minimum=Decimal("-90"),
            maximum=Decimal("90"),
        ),
        "longitude": _validate_coordinate(
            longitude,
            field_name="longitude",
            minimum=Decimal("-180"),
            maximum=Decimal("180"),
        ),
        "timezone_name": _validate_timezone(timezone_name),
        "location_type": _validate_location_type(location_type),
        "lifecycle_state": _validate_lifecycle_state(lifecycle_state),
    }


def _location_summary(row):
    return {
        "location_id": row["location_id"],
        "display_name": row["display_name"],
        "timezone_name": row["timezone_name"],
        "location_type": row["location_type"],
        "lifecycle_state": row["lifecycle_state"],
        "is_home": row["is_home"],
    }


def list_active_saved_locations():
    """Return display and selection metadata without exposing coordinates."""
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    location_id,
                    display_name,
                    timezone_name,
                    location_type,
                    lifecycle_state,
                    is_home
                FROM public.saved_location
                WHERE lifecycle_state = 'active'
                ORDER BY is_home DESC, display_name, location_id
                """
            )
            rows = cur.fetchall()
    return [_location_summary(row) for row in rows]


def list_saved_locations_for_management():
    """Return lifecycle and reference metadata without exposing coordinates."""
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    sl.location_id,
                    sl.display_name,
                    sl.timezone_name,
                    sl.location_type,
                    sl.lifecycle_state,
                    sl.is_home,
                    (
                        EXISTS (
                            SELECT 1
                            FROM public.plan_template pt
                            WHERE pt.saved_location_id = sl.location_id
                        )
                        OR EXISTS (
                            SELECT 1
                            FROM public.plan_item pi
                            WHERE pi.saved_location_id = sl.location_id
                        )
                    ) AS is_referenced
                FROM public.saved_location sl
                ORDER BY
                    sl.is_home DESC,
                    CASE sl.lifecycle_state
                        WHEN 'active' THEN 0
                        WHEN 'hidden' THEN 1
                        ELSE 2
                    END,
                    sl.display_name,
                    sl.location_id
                """
            )
            rows = cur.fetchall()
    return [
        {**_location_summary(row), "is_referenced": bool(row["is_referenced"])}
        for row in rows
    ]


def search_saved_locations(query):
    return search_places(query)


def resolve_home_location():
    """Resolve the unique Home record for server-side use only."""
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    location_id,
                    display_name,
                    latitude,
                    longitude,
                    timezone_name,
                    location_type,
                    lifecycle_state,
                    is_home
                FROM public.saved_location
                WHERE is_home = true
                """
            )
            rows = cur.fetchall()

    if len(rows) != 1:
        raise SavedLocationConfigurationError(
            "Exactly one Home saved location must be configured."
        )
    row = rows[0]
    if (
        row["lifecycle_state"] != "active"
        or row["location_type"] != "home"
        or row["is_home"] is not True
    ):
        raise SavedLocationConfigurationError(
            "The Home saved location is inconsistent."
        )
    try:
        _validate_timezone(row["timezone_name"])
        _validate_coordinate(
            row["latitude"],
            field_name="latitude",
            minimum=Decimal("-90"),
            maximum=Decimal("90"),
        )
        _validate_coordinate(
            row["longitude"],
            field_name="longitude",
            minimum=Decimal("-180"),
            maximum=Decimal("180"),
        )
    except ValueError as exc:
        raise SavedLocationConfigurationError(
            "The Home saved location is invalid."
        ) from exc
    return row


def create_saved_location(
    *,
    display_name,
    latitude,
    longitude,
    timezone_name,
    location_type,
    lifecycle_state="active",
):
    """Persist a location; the first location is the immutable Home default."""
    fields = _validated_location_fields(
        display_name=display_name,
        latitude=latitude,
        longitude=longitude,
        timezone_name=timezone_name,
        location_type=location_type,
        lifecycle_state=lifecycle_state,
    )

    with db_conn() as conn:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "LOCK TABLE public.saved_location IN SHARE ROW EXCLUSIVE MODE"
                )
                cur.execute(
                    """
                    SELECT location_id
                    FROM public.saved_location
                    WHERE is_home = true
                    """
                )
                home_exists = cur.fetchone() is not None
                is_home = not home_exists
                if is_home and fields["location_type"] != "home":
                    raise ValueError("The first saved location must be Home.")
                if not is_home and fields["location_type"] == "home":
                    raise ValueError("Only one Home saved location is allowed.")
                if is_home and fields["lifecycle_state"] != "active":
                    raise ValueError("The Home saved location must be active.")

                cur.execute(
                    """
                    INSERT INTO public.saved_location (
                        display_name,
                        latitude,
                        longitude,
                        timezone_name,
                        location_type,
                        lifecycle_state,
                        is_home
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    RETURNING
                        location_id,
                        display_name,
                        timezone_name,
                        location_type,
                        lifecycle_state,
                        is_home
                    """,
                    (
                        fields["display_name"],
                        fields["latitude"],
                        fields["longitude"],
                        fields["timezone_name"],
                        fields["location_type"],
                        fields["lifecycle_state"],
                        is_home,
                    ),
                )
                row = cur.fetchone()
            if row is None:
                raise RuntimeError("Saved-location insert returned no row.")
            conn.commit()
        except Exception:
            conn.rollback()
            raise
    return _location_summary(row)


def create_saved_location_from_place(
    *,
    provider_place_id,
    display_name,
    location_type,
):
    """Resolve the selected place server-side before persisting its coordinates."""
    resolved = resolve_place(provider_place_id)
    return create_saved_location(
        display_name=display_name,
        latitude=resolved["latitude"],
        longitude=resolved["longitude"],
        timezone_name=resolved["timezone_name"],
        location_type=location_type,
    )


def set_home_location(location_id):
    """Move the Home/default designation atomically while retaining stable IDs."""
    if type(location_id) is not int or location_id < 1:
        raise ValueError("location_id must be a positive integer.")

    with db_conn() as conn:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "LOCK TABLE public.saved_location IN SHARE ROW EXCLUSIVE MODE"
                )
                cur.execute(
                    """
                    SELECT location_id, lifecycle_state
                    FROM public.saved_location
                    WHERE location_id = %s
                    FOR UPDATE
                    """,
                    (location_id,),
                )
                target = cur.fetchone()
                if target is None:
                    raise SavedLocationNotFoundError()
                if target["lifecycle_state"] != "active":
                    raise ValueError("Only an active location can be Home.")

                cur.execute(
                    """
                    UPDATE public.saved_location
                    SET is_home = false,
                        location_type = 'other',
                        updated_at = now()
                    WHERE is_home = true
                      AND location_id <> %s
                    """,
                    (location_id,),
                )
                cur.execute(
                    """
                    UPDATE public.saved_location
                    SET is_home = true,
                        location_type = 'home',
                        updated_at = now()
                    WHERE location_id = %s
                    RETURNING
                        location_id,
                        display_name,
                        timezone_name,
                        location_type,
                        lifecycle_state,
                        is_home
                    """,
                    (location_id,),
                )
                row = cur.fetchone()
            if row is None:
                raise SavedLocationNotFoundError()
            conn.commit()
        except Exception:
            conn.rollback()
            raise
    return _location_summary(row)


def delete_saved_location(location_id):
    """Delete only an unreferenced location, checking under a row lock."""
    if type(location_id) is not int or location_id < 1:
        raise ValueError("location_id must be a positive integer.")

    with db_conn() as conn:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT location_id
                    FROM public.saved_location
                    WHERE location_id = %s
                    FOR UPDATE
                    """,
                    (location_id,),
                )
                if cur.fetchone() is None:
                    raise SavedLocationNotFoundError()
                cur.execute(
                    """
                    SELECT
                        EXISTS (
                            SELECT 1
                            FROM public.plan_template
                            WHERE saved_location_id = %s
                        )
                        OR EXISTS (
                            SELECT 1
                            FROM public.plan_item
                            WHERE saved_location_id = %s
                        ) AS is_referenced
                    """,
                    (location_id, location_id),
                )
                if cur.fetchone()["is_referenced"]:
                    raise SavedLocationInUseError()
                cur.execute(
                    """
                    DELETE FROM public.saved_location
                    WHERE location_id = %s
                    RETURNING location_id
                    """,
                    (location_id,),
                )
                deleted = cur.fetchone()
            if deleted is None:
                raise SavedLocationNotFoundError()
            conn.commit()
        except Exception:
            conn.rollback()
            raise
    return {"location_id": deleted["location_id"]}


def update_saved_location(
    location_id,
    *,
    display_name,
    lifecycle_state,
):
    """Rename or change lifecycle without changing the saved location identity."""
    if type(location_id) is not int or location_id < 1:
        raise ValueError("location_id must be a positive integer.")
    normalized_name = _validate_name(display_name)
    normalized_state = _validate_lifecycle_state(lifecycle_state)

    with db_conn() as conn:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT is_home
                    FROM public.saved_location
                    WHERE location_id = %s
                    FOR UPDATE
                    """,
                    (location_id,),
                )
                row = cur.fetchone()
                if row is None:
                    raise SavedLocationNotFoundError()
                if row["is_home"] and normalized_state != "active":
                    raise ValueError("The Home saved location must remain active.")

                cur.execute(
                    """
                    UPDATE public.saved_location
                    SET display_name = %s,
                        lifecycle_state = %s,
                        updated_at = now()
                    WHERE location_id = %s
                    RETURNING
                        location_id,
                        display_name,
                        timezone_name,
                        location_type,
                        lifecycle_state,
                        is_home
                    """,
                    (normalized_name, normalized_state, location_id),
                )
                updated_row = cur.fetchone()
            if updated_row is None:
                raise SavedLocationNotFoundError()
            conn.commit()
        except Exception:
            conn.rollback()
            raise
    return _location_summary(updated_row)
