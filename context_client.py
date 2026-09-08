"""Small server-side client for authoritative Coach context."""

import json
import os
import socket
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
    "fitness_fatigue_form",
    "recovery_history",
    "athlete_narrative",
    "coverage",
    "missing_subjective_context",
}
CONTEXT_TIMEOUT_SECONDS = 15.0
CONTEXT_PATH = "/internal/coach/context/current"
MAX_CONTEXT_CHARS = 120_000


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


def _context_url(base_url):
    return base_url.rstrip("/") + CONTEXT_PATH


def fetch_current_context():
    base_url = _setting("TRAINING_API_BASE_URL")
    token = _setting("TRAINING_API_TOKEN")
    request = Request(
        _context_url(base_url),
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
    return payload
