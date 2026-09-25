"""Small server-side client for authoritative Coach context."""

import json
import os
import socket
from datetime import date
from urllib.parse import urlencode
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


REQUIRED_CONTEXT_SECTIONS = {
    "as_of",
    "week_progress",
    "current_weekly_audit",
    "latest_completed_weekly_audit",
    "weekly_load_history",
    "weekly_tid_history",
    "recent_days",
    "daily_checkins",
    "fitness_fatigue_form",
    "recovery_history",
    "athlete_narrative",
    "coverage",
    "missing_subjective_context",
}
DAILY_CHECKIN_FIELDS = {
    "date", "overall_status", "note", "readiness", "energy", "soreness", "pain",
    "physical_labor", "handling_quality", "flags",
}
DAILY_CHECKIN_FLAGS = (
    "travel", "sick", "injury", "bike_park", "recovery", "goal_event", "bad_weather",
    "high_life_stress", "lost", "gear", "crash", "group_ride", "sore", "tired", "poor_sleep",
)
DAILY_CHECKIN_STATUS = {"good", "mixed", "poor"}
DAILY_CHECKIN_PHYSICAL_LABOR = {"none", "light", "moderate", "heavy"}
DAILY_CHECKIN_HANDLING = {"sharp", "normal", "off"}
CONTEXT_TIMEOUT_SECONDS = 15.0
CONTEXT_PATH = "/internal/coach/context/current"
MAX_CONTEXT_CHARS = 500000 # Maximum serialized authoritative-context size; prevents runaway payloads, excessive cost/latency, and provider-window pressure before the paid API call.


class ContextError(Exception):
    category = "context_unavailable"
    status_code = 503


class ContextTimeoutError(ContextError):
    category = "context_timeout"
    status_code = 504


class ContextAuthError(ContextError):
    category = "context_auth_error"
    status_code = 503


class ContextInvalidResponseError(ContextError):
    category = "context_invalid_response"
    status_code = 502


class ContextUnavailableError(ContextError):
    category = "context_unavailable"
    status_code = 503


def _setting(name):
    value = os.environ.get(name, "").strip()
    if not value:
        raise ContextUnavailableError("Context configuration is unavailable.")
    return value


def _context_url(base_url, daily_days, weekly_rows):
    return base_url.rstrip("/") + CONTEXT_PATH + "?" + urlencode({
        "daily_days": daily_days,
        "weekly_rows": weekly_rows,
    })


def _valid_date(value):
    if not isinstance(value, str):
        return False
    try:
        date.fromisoformat(value)
    except ValueError:
        return False
    return len(value) == 10


def _validate_daily_checkins(payload):
    rows = payload.get("daily_checkins")
    if not isinstance(rows, list):
        raise ContextInvalidResponseError("Context service returned invalid Daily Check-ins.")
    previous_date = None
    for row in rows:
        if not isinstance(row, dict) or set(row) != DAILY_CHECKIN_FIELDS:
            raise ContextInvalidResponseError("Context service returned invalid Daily Check-ins.")
        row_date = row["date"]
        if not _valid_date(row_date) or (previous_date is not None and row_date >= previous_date):
            raise ContextInvalidResponseError("Context service returned invalid Daily Check-ins.")
        previous_date = row_date
        if row["overall_status"] not in DAILY_CHECKIN_STATUS:
            raise ContextInvalidResponseError("Context service returned invalid Daily Check-ins.")
        if not isinstance(row["note"], str) or not row["note"].strip() or len(row["note"]) > 1000:
            raise ContextInvalidResponseError("Context service returned invalid Daily Check-ins.")
        for field, minimum, maximum in (("readiness", 1, 5), ("energy", 1, 5), ("soreness", 0, 4), ("pain", 0, 4)):
            value = row[field]
            if value is not None and (isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum):
                raise ContextInvalidResponseError("Context service returned invalid Daily Check-ins.")
        if row["physical_labor"] is not None and row["physical_labor"] not in DAILY_CHECKIN_PHYSICAL_LABOR:
            raise ContextInvalidResponseError("Context service returned invalid Daily Check-ins.")
        if row["handling_quality"] is not None and row["handling_quality"] not in DAILY_CHECKIN_HANDLING:
            raise ContextInvalidResponseError("Context service returned invalid Daily Check-ins.")
        flags = row["flags"]
        if (
            not isinstance(flags, list)
            or any(not isinstance(flag, str) for flag in flags)
            or len(flags) != len(set(flags))
            or flags != [flag for flag in DAILY_CHECKIN_FLAGS if flag in flags]
        ):
            raise ContextInvalidResponseError("Context service returned invalid Daily Check-ins.")
        if any(flag not in DAILY_CHECKIN_FLAGS for flag in flags):
            raise ContextInvalidResponseError("Context service returned invalid Daily Check-ins.")

    coverage = payload.get("coverage")
    if not isinstance(coverage, dict):
        raise ContextInvalidResponseError("Context service returned invalid coverage.")
    for field, expected_type in (("daily_checkins_included", bool), ("daily_checkin_count", int)):
        value = coverage.get(field)
        if not isinstance(value, expected_type) or (field.endswith("count") and isinstance(value, bool)):
            raise ContextInvalidResponseError("Context service returned invalid coverage.")
    if coverage["daily_checkin_count"] != len(rows) or coverage["daily_checkins_included"] != bool(rows):
        raise ContextInvalidResponseError("Context service returned invalid coverage.")
    for field in ("oldest_daily_checkin_date", "newest_daily_checkin_date"):
        value = coverage.get(field)
        if value is not None and not _valid_date(value):
            raise ContextInvalidResponseError("Context service returned invalid coverage.")
    if rows:
        if coverage["oldest_daily_checkin_date"] != rows[-1]["date"] or coverage["newest_daily_checkin_date"] != rows[0]["date"]:
            raise ContextInvalidResponseError("Context service returned invalid coverage.")
    elif coverage["oldest_daily_checkin_date"] is not None or coverage["newest_daily_checkin_date"] is not None:
        raise ContextInvalidResponseError("Context service returned invalid coverage.")


def fetch_current_context(daily_days=28, weekly_rows=26):
    base_url = _setting("TRAINING_API_BASE_URL")
    token = _setting("TRAINING_API_TOKEN")
    request = Request(
        _context_url(base_url, daily_days, weekly_rows),
        headers={"Accept": "application/json", "X-Internal-Token": token},
        method="GET",
    )
    try:
        with urlopen(request, timeout=CONTEXT_TIMEOUT_SECONDS) as response:
            if response.status != 200:
                if response.status in {401, 403}:
                    raise ContextAuthError("Context authorization failed.")
                raise ContextUnavailableError("Context service returned an error.")
            payload = json.loads(response.read().decode("utf-8"))
    except ContextError:
        raise
    except HTTPError as exc:
        if exc.code in {401, 403}:
            raise ContextAuthError("Context authorization failed.") from exc
        raise ContextUnavailableError("Context service returned an error.") from exc
    except URLError as exc:
        if isinstance(exc.reason, (TimeoutError, socket.timeout)):
            raise ContextTimeoutError("Context service timed out.") from exc
        raise ContextUnavailableError("Context service is unavailable.") from exc
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError):
        raise ContextInvalidResponseError("Context service returned invalid data.") from None
    except Exception as exc:
        raise ContextUnavailableError("Context service is unavailable.") from exc

    if not isinstance(payload, dict) or not REQUIRED_CONTEXT_SECTIONS.issubset(payload):
        raise ContextInvalidResponseError("Context service returned incomplete data.")
    _validate_daily_checkins(payload)
    return payload
