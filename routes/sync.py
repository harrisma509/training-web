"""
Sync route module.

Owns sync status, sync request endpoints, and the app preference used for new full-sync requests.
- /api/sync-status
- /api/sync-request
- /api/settings/app-preferences

This module reports latest sync health and inserts sync_request rows.
Do not put ETL implementation logic here.
"""

import logging
import os
from datetime import date, datetime, timezone

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from db import db_conn

logger = logging.getLogger(__name__)

router = APIRouter()

MAX_DAY_RESYNC_ACTIVITIES = 25


def _parse_local_date(date_text):
    if not isinstance(date_text, str) or len(date_text) != 10:
        raise ValueError("Invalid date")
    try:
        parsed = date.fromisoformat(date_text)
    except ValueError as exc:
        raise ValueError("Invalid date") from exc
    if parsed.isoformat() != date_text:
        raise ValueError("Invalid date")
    return parsed


def _canonical_activity_ids(cur, date_text):
    cur.execute(
        """
        SELECT activity_id
        FROM public.strava_activities
        WHERE date_local = %s
        ORDER BY activity_id
        LIMIT %s
        """,
        (date_text, MAX_DAY_RESYNC_ACTIVITIES + 1),
    )
    raw_ids = [row.get("activity_id") for row in cur.fetchall()]
    if len(raw_ids) > MAX_DAY_RESYNC_ACTIVITIES:
        raise ValueError("Too many activities for one day")

    activity_ids = []
    for activity_id in raw_ids:
        text_id = str(activity_id).strip()
        if not text_id.isdigit() or int(text_id) <= 0:
            raise ValueError("Invalid canonical activity id")
        activity_ids.append(int(text_id))
    return activity_ids


def _active_activity_requests(cur, activity_ids):
    if not activity_ids:
        return {}
    cur.execute(
        """
        SELECT id, activity_id
        FROM public.sync_request
        WHERE request_type = 'activity_resync'
          AND status IN ('pending', 'running')
          AND activity_id = ANY(%s)
        ORDER BY id
        """,
        (activity_ids,),
    )
    return {int(row["activity_id"]): int(row["id"]) for row in cur.fetchall()}


def _enqueue_activity_resync(cur, activity_id):
    cur.execute(
        """
        INSERT INTO public.sync_request (
            requested_by,
            days_back,
            status,
            request_type,
            activity_id
        )
        VALUES ('dashboard', 1, 'pending', 'activity_resync', %s)
        ON CONFLICT (activity_id)
        WHERE request_type = 'activity_resync'
          AND status IN ('pending', 'running')
        DO NOTHING
        RETURNING id
        """,
        (activity_id,),
    )
    row = cur.fetchone()
    if row:
        return int(row["id"]), False
    cur.execute(
        """
        SELECT id
        FROM public.sync_request
        WHERE request_type = 'activity_resync'
          AND status IN ('pending', 'running')
          AND activity_id = %s
        LIMIT 1
        """,
        (activity_id,),
    )
    row = cur.fetchone()
    if not row:
        raise RuntimeError("Unable to enqueue activity resync")
    return int(row["id"]), True


def _sanitize_days_back(value):
    if isinstance(value, bool):
        return None
    if not isinstance(value, int):
        return None
    if value < 1 or value > 6000:
        return None
    return value


def _env_default_sync_days_back():
    try:
        value = int(os.environ.get("DAYS_BACK", "7"))
    except (TypeError, ValueError):
        return 7
    if value < 1 or value > 6000:
        return 7
    return value


def _effective_default_sync_days_back():
    fallback = _env_default_sync_days_back()

    try:
        with db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT default_sync_days_back
                    FROM public.app_settings
                    WHERE settings_id = 1
                    """
                )
                row = cur.fetchone()
    except Exception:
        logger.exception("Unable to read app_settings default_sync_days_back; using fallback value")
        return fallback

    if row is None:
        logger.warning("app_settings default_sync_days_back missing; using fallback value")
        return fallback

    value = _sanitize_days_back(row.get("default_sync_days_back"))
    if value is None:
        logger.warning("app_settings default_sync_days_back invalid; using fallback value")
        return fallback
    return value


def _format_sync_response(latest, open_request, latest_good):
    good_statuses = ("ok", "success")

    if not latest:
        return {
            "health": "unknown",
            "label": "No sync history",
            "last_sync_time_utc": None,
            "hours_since_good_sync": None,
            "status": None,
            "days_back": None,
            "activity_count": None,
            "warning_count": None,
            "daily_rows": None,
            "weekly_rows": None
        }

    run_at_utc = latest["run_at_utc"]
    days_back = latest["days_back"]
    activity_count = latest["activity_count"]
    daily_rows = latest["daily_rows"]
    weekly_rows = latest["weekly_rows"]
    warning_count = latest["warning_count"]
    status = latest["status"]

    status_normalized = status.lower() if status else ""
    latest_good_time = latest_good["run_at_utc"] if latest_good else None
    hours_since_good_sync = None

    if latest_good_time:
        if latest_good_time.tzinfo is None:
            latest_good_time = latest_good_time.replace(tzinfo=timezone.utc)

        now_utc = datetime.now(timezone.utc)
        hours_since_good_sync = round((now_utc - latest_good_time).total_seconds() / 3600, 1)

    if status_normalized not in good_statuses:
        health = "failed"
        label = "Last sync had an error"
    elif hours_since_good_sync is not None and hours_since_good_sync <= 8:
        health = "healthy"
        label = "Sync current"
    elif hours_since_good_sync is not None:
        health = "stale"
        label = "Sync not current"
    else:
        health = "unknown"
        label = "No good sync found"

    request_id = None
    request_status = None
    request_time_utc = None

    if open_request:
        request_id = open_request["id"]
        request_status = open_request["status"]
        request_time_utc = open_request["requested_at_utc"]

        if request_status == "pending":
            health = "pending"
            label = "Sync requested"
        elif request_status == "running":
            health = "running"
            label = "Sync running"

    return {
        "health": health,
        "label": label,
        "last_sync_time_utc": run_at_utc.isoformat() if run_at_utc else None,
        "hours_since_good_sync": hours_since_good_sync,
        "status": status,
        "days_back": days_back,
        "activity_count": activity_count,
        "warning_count": warning_count,
        "daily_rows": daily_rows,
        "weekly_rows": weekly_rows,
        "sync_request_id": request_id,
        "sync_request_status": request_status,
        "sync_request_time_utc": request_time_utc.isoformat() if request_time_utc else None
    }


@router.get("/api/sync-status")
def get_sync_status():
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    run_at_utc,
                    days_back,
                    activity_count,
                    daily_rows,
                    weekly_rows,
                    warning_count,
                    status
                FROM sync_run_log
                ORDER BY run_at_utc DESC
                LIMIT 1
            """)
            latest = cur.fetchone()

            cur.execute("""
                SELECT
                    id,
                    requested_at_utc,
                    status,
                    days_back
                FROM sync_request
                                WHERE request_type = 'full_sync'
                                    AND status IN ('pending', 'running')
                ORDER BY requested_at_utc DESC
                LIMIT 1
            """)
            open_request = cur.fetchone()

            cur.execute("""
                SELECT run_at_utc
                FROM sync_run_log
                WHERE lower(status) IN ('ok', 'success')
                ORDER BY run_at_utc DESC
                LIMIT 1
            """)
            latest_good = cur.fetchone()
    finally:
        conn.close()

    return JSONResponse(_format_sync_response(latest, open_request, latest_good))


@router.get("/api/sync-requests/{request_id}")
def get_sync_request_status(request_id: int):
    if request_id <= 0:
        return JSONResponse({"detail": "Invalid request id."}, status_code=400)
    try:
        with db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, status, completed_at_utc
                    FROM public.sync_request
                    WHERE id = %s
                      AND request_type = 'activity_resync'
                    LIMIT 1
                    """,
                    (request_id,),
                )
                row = cur.fetchone()
    except Exception:
        logger.exception("Failed to read activity resync request status")
        return JSONResponse({"detail": "Request status unavailable."}, status_code=503)
    if not row:
        return JSONResponse({"detail": "Request not found."}, status_code=404)
    return JSONResponse({
        "request_id": int(row["id"]),
        "status": str(row["status"]),
        "completed_at_utc": row["completed_at_utc"].isoformat() if row["completed_at_utc"] else None,
    })


@router.get("/api/sync/dates/{date_text}/resync-preview")
def preview_day_resync(date_text: str):
    try:
        _parse_local_date(date_text)
        with db_conn() as conn:
            with conn.cursor() as cur:
                activity_ids = _canonical_activity_ids(cur, date_text)
    except ValueError as exc:
        return JSONResponse({"detail": str(exc)}, status_code=400)
    except Exception:
        logger.exception("Failed to preview day resync")
        return JSONResponse({"detail": "Day resync preview unavailable."}, status_code=503)
    return JSONResponse({"date": date_text, "activity_count": len(activity_ids)})


@router.post("/api/sync/dates/{date_text}/resync")
def create_day_resync(date_text: str):
    try:
        _parse_local_date(date_text)
        with db_conn() as conn:
            with conn.cursor() as cur:
                activity_ids = _canonical_activity_ids(cur, date_text)
                active_requests = _active_activity_requests(cur, activity_ids)
                request_ids = []
                already_active_count = 0
                for activity_id in activity_ids:
                    if activity_id in active_requests:
                        request_ids.append(active_requests[activity_id])
                        already_active_count += 1
                        continue
                    request_id, already_active = _enqueue_activity_resync(cur, activity_id)
                    request_ids.append(request_id)
                    if already_active:
                        already_active_count += 1
                conn.commit()
    except ValueError as exc:
        return JSONResponse({"detail": str(exc)}, status_code=400)
    except Exception:
        logger.exception("Failed to enqueue day resync")
        return JSONResponse({"detail": "Day resync could not be queued."}, status_code=503)
    return JSONResponse({
        "date": date_text,
        "activity_count": len(activity_ids),
        "enqueued_count": len(activity_ids) - already_active_count,
        "already_active_count": already_active_count,
        "request_ids": request_ids,
    })


@router.get("/api/settings/app-preferences")
def get_app_preferences():
    return {
        "default_sync_days_back": _effective_default_sync_days_back()
    }


@router.post("/api/settings/app-preferences")
async def update_app_preferences(request: Request):
    try:
        payload = await request.json()
    except Exception:
        return JSONResponse({"detail": "Invalid request body."}, status_code=400)

    if not isinstance(payload, dict):
        return JSONResponse({"detail": "Invalid request body."}, status_code=400)

    candidate = payload.get("default_sync_days_back")
    value = _sanitize_days_back(candidate)
    if value is None:
        return JSONResponse({"detail": "default_sync_days_back must be an integer between 1 and 6000."}, status_code=400)

    try:
        with db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE public.app_settings
                    SET
                        default_sync_days_back = %s,
                        updated_at = now()
                    WHERE settings_id = 1
                    RETURNING default_sync_days_back, updated_at
                    """,
                    (value,),
                )
                row = cur.fetchone()
                if row is None:
                    return JSONResponse({"detail": "Preference unavailable."}, status_code=500)
                conn.commit()
                return {
                    "default_sync_days_back": int(row["default_sync_days_back"])
                }
    except Exception:
        logger.exception("Failed to save app preference update")
        return JSONResponse({"detail": "Unable to save preference."}, status_code=500)


@router.post("/api/sync-request")
def create_sync_request():
    days_back = _effective_default_sync_days_back()

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    id,
                    requested_at_utc,
                    status,
                    days_back
                FROM sync_request
                                WHERE request_type = 'full_sync'
                                    AND status IN ('pending', 'running')
                ORDER BY requested_at_utc DESC
                LIMIT 1
            """)
            existing = cur.fetchone()

            if existing:
                return {
                    "created": False,
                    "message": "Sync already requested",
                    "request_id": existing["id"],
                    "status": existing["status"],
                    "requested_at_utc": existing["requested_at_utc"].isoformat(),
                    "days_back": existing["days_back"]
                }

            cur.execute("""
                INSERT INTO sync_request (
                    requested_by,
                    days_back,
                    status
                )
                VALUES (
                    'dashboard',
                    %s,
                    'pending'
                )
                RETURNING
                    id,
                    requested_at_utc,
                    status,
                    days_back
            """, (days_back,))
            row = cur.fetchone()

    return {
        "created": True,
        "message": "Sync requested",
        "request_id": row["id"],
        "status": row["status"],
        "requested_at_utc": row["requested_at_utc"].isoformat(),
        "days_back": row["days_back"]
    }
