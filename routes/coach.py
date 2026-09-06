"""Persistent Coach session routes and transaction helpers."""

import logging
import re
import uuid
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from psycopg.types.json import Jsonb

from db import db_conn, json_safe

logger = logging.getLogger(__name__)
router = APIRouter()

COACHING_POLICY_VERSION = "coach-v1"
DEFAULT_SESSION_TITLE = "New coaching session"
MAX_SESSION_TITLE_LENGTH = 200
MAX_MESSAGE_LENGTH = 12000
DEFAULT_SESSION_LIMIT = 20
MAX_SESSION_LIMIT = 100


def _json_row(row):
    return None if row is None else {key: json_safe(value) for key, value in row.items()}


def _parse_positive_id(value):
    try:
        parsed = int(str(value).strip())
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _parse_limit(value):
    if value is None or value == "":
        return DEFAULT_SESSION_LIMIT
    try:
        parsed = int(str(value).strip())
    except (TypeError, ValueError):
        return None
    return parsed if 1 <= parsed <= MAX_SESSION_LIMIT else None


def _text_value(value, field_name, max_length):
    if not isinstance(value, str):
        return None, f"{field_name} must be text."
    value = value.strip()
    if not value:
        return None, f"{field_name} cannot be blank."
    if len(value) > max_length:
        return None, f"{field_name} is too long."
    return value, None


def _nonnegative_int(value, field_name):
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"{field_name} must be a non-negative integer")
    return value


def _nonnegative_decimal(value, field_name):
    if value is None:
        return None
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise ValueError(f"{field_name} must be a non-negative number") from None
    if parsed < 0:
        raise ValueError(f"{field_name} must be a non-negative number")
    return parsed


def _sanitize_error_category(value):
    if not isinstance(value, str):
        return "unknown_error"
    category = value.strip().lower()
    if not category or len(category) > 100 or not re.fullmatch(r"[a-z0-9_.-]+", category):
        return "unknown_error"
    return category


def _session_select_sql():
    return """
        SELECT coach_session_id, title, status, provider, default_model,
               coaching_policy_version, summary, summary_through_message_id,
               compacted_at, compaction_count, last_provider_response_id,
               last_activity_at, created_at, updated_at
        FROM public.coach_session
    """


def _load_session(cur, session_id, lock=False):
    suffix = " FOR UPDATE" if lock else ""
    cur.execute(_session_select_sql() + " WHERE coach_session_id = %s" + suffix, (session_id,))
    return cur.fetchone()


def _usage_for_session(cur, session_id):
    cur.execute(
        """
        SELECT (SELECT COUNT(*) FROM public.coach_message WHERE coach_session_id = s.coach_session_id) AS message_count,
               (SELECT COUNT(*) FROM public.coach_turn WHERE coach_session_id = s.coach_session_id) AS turn_count,
               (SELECT COUNT(*) FROM public.coach_turn WHERE coach_session_id = s.coach_session_id AND status = 'completed') AS completed_turn_count,
               (SELECT COUNT(*) FROM public.coach_turn WHERE coach_session_id = s.coach_session_id AND status = 'failed') AS failed_turn_count,
               (SELECT COUNT(*) FROM public.coach_turn WHERE coach_session_id = s.coach_session_id AND status = 'timed_out') AS timed_out_turn_count,
               (SELECT COALESCE(SUM(input_tokens), 0) FROM public.coach_turn WHERE coach_session_id = s.coach_session_id) AS input_tokens,
               (SELECT COALESCE(SUM(cached_input_tokens), 0) FROM public.coach_turn WHERE coach_session_id = s.coach_session_id) AS cached_input_tokens,
               (SELECT COALESCE(SUM(output_tokens), 0) FROM public.coach_turn WHERE coach_session_id = s.coach_session_id) AS output_tokens,
               (SELECT COALESCE(SUM(reasoning_tokens), 0) FROM public.coach_turn WHERE coach_session_id = s.coach_session_id) AS reasoning_tokens,
               (SELECT COALESCE(SUM(total_tokens), 0) FROM public.coach_turn WHERE coach_session_id = s.coach_session_id) AS total_tokens,
               (SELECT COALESCE(SUM(estimated_cost_usd), 0) FROM public.coach_turn WHERE coach_session_id = s.coach_session_id) AS estimated_cost_usd,
               latest.status AS latest_turn_status,
               latest.input_tokens AS latest_input_tokens,
               latest.cached_input_tokens AS latest_cached_input_tokens,
               latest.output_tokens AS latest_output_tokens,
               latest.reasoning_tokens AS latest_reasoning_tokens,
               latest.total_tokens AS latest_total_tokens,
               latest.estimated_cost_usd AS latest_estimated_cost_usd
        FROM public.coach_session s
        LEFT JOIN LATERAL (
            SELECT status, input_tokens, cached_input_tokens, output_tokens,
                   reasoning_tokens, total_tokens, estimated_cost_usd
            FROM public.coach_turn
            WHERE coach_session_id = s.coach_session_id
            ORDER BY started_at DESC, coach_turn_id DESC
            LIMIT 1
        ) latest ON TRUE
        WHERE s.coach_session_id = %s
        """,
        (session_id,),
    )
    return cur.fetchone()


def _usage_response(session, usage):
    result = _json_row(usage) or {}
    result.update(
        {
            "session_id": session["coach_session_id"],
            "title": session["title"],
            "created_at": json_safe(session["created_at"]),
            "last_activity_at": json_safe(session["last_activity_at"]),
            "status": session["status"],
            "provider": session["provider"],
            "default_model": session["default_model"],
            "coaching_policy_version": session["coaching_policy_version"],
        }
    )
    return result


@router.post("/api/coach/sessions")
async def create_coach_session(request: Request):
    try:
        payload = await request.json()
    except Exception:
        return JSONResponse({"detail": "Invalid request body."}, status_code=400)
    if payload is None:
        payload = {}
    if not isinstance(payload, dict):
        return JSONResponse({"detail": "Request body must be an object."}, status_code=400)
    title = payload.get("title", DEFAULT_SESSION_TITLE)
    if title is None or (isinstance(title, str) and not title.strip()):
        title = DEFAULT_SESSION_TITLE
    title, error = _text_value(title, "title", MAX_SESSION_TITLE_LENGTH)
    if error:
        return JSONResponse({"detail": error}, status_code=400)

    try:
        with db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO public.coach_session (title, status, coaching_policy_version)
                    VALUES (%s, 'active', %s)
                    RETURNING coach_session_id, title, status, provider, default_model,
                              coaching_policy_version, last_activity_at, created_at, updated_at
                    """,
                    (title, COACHING_POLICY_VERSION),
                )
                session = cur.fetchone()
            conn.commit()
        return {"session": _json_row(session)}
    except Exception:
        logger.exception("Failed to create Coach session")
        return JSONResponse({"detail": "Unable to create Coach session."}, status_code=500)


@router.get("/api/coach/sessions")
def list_coach_sessions(limit: str | None = None):
    parsed_limit = _parse_limit(limit)
    if parsed_limit is None:
        return JSONResponse({"detail": "limit must be an integer between 1 and 100."}, status_code=400)
    try:
        with db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    WITH message_aggregates AS (
                        SELECT coach_session_id, COUNT(*) AS message_count
                        FROM public.coach_message
                        GROUP BY coach_session_id
                    ), turn_aggregates AS (
                        SELECT coach_session_id,
                               COUNT(*) AS turn_count,
                               COALESCE(SUM(total_tokens), 0) AS total_tokens,
                               COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd
                        FROM public.coach_turn
                        GROUP BY coach_session_id
                    )
                    SELECT s.coach_session_id, s.title, s.status, s.provider, s.default_model,
                           s.coaching_policy_version, s.last_activity_at, s.created_at, s.updated_at,
                           COALESCE(ma.message_count, 0) AS message_count,
                           COALESCE(ta.turn_count, 0) AS turn_count,
                           COALESCE(ta.total_tokens, 0) AS total_tokens,
                           COALESCE(ta.estimated_cost_usd, 0) AS estimated_cost_usd
                    FROM public.coach_session s
                    LEFT JOIN message_aggregates ma ON ma.coach_session_id = s.coach_session_id
                    LEFT JOIN turn_aggregates ta ON ta.coach_session_id = s.coach_session_id
                    WHERE s.status = 'active'
                    ORDER BY s.last_activity_at DESC, s.coach_session_id DESC
                    LIMIT %s
                    """,
                    (parsed_limit,),
                )
                rows = cur.fetchall()
        return {"sessions": [_json_row(row) for row in rows]}
    except Exception:
        logger.exception("Failed to list Coach sessions")
        return JSONResponse({"detail": "Unable to list Coach sessions."}, status_code=500)


@router.get("/api/coach/sessions/{session_id}")
def get_coach_session(session_id: str):
    parsed_id = _parse_positive_id(session_id)
    if parsed_id is None:
        return JSONResponse({"detail": "session_id must be a positive integer."}, status_code=400)
    try:
        with db_conn() as conn:
            with conn.cursor() as cur:
                session = _load_session(cur, parsed_id)
                if session is None:
                    return JSONResponse({"detail": "Coach session not found."}, status_code=404)
                cur.execute(
                    """
                    SELECT coach_message_id, coach_session_id, role, message_kind,
                           message_text, structured_payload, created_at
                    FROM public.coach_message
                    WHERE coach_session_id = %s
                    ORDER BY created_at, coach_message_id
                    """,
                    (parsed_id,),
                )
                messages = cur.fetchall()
                usage = _usage_for_session(cur, parsed_id)
        return {
            "session": _json_row(session),
            "messages": [_json_row(message) for message in messages],
            "usage": _usage_response(session, usage),
        }
    except Exception:
        logger.exception("Failed to load Coach session")
        return JSONResponse({"detail": "Unable to load Coach session."}, status_code=500)


@router.post("/api/coach/sessions/{session_id}/messages")
async def create_coach_user_message(session_id: str, request: Request):
    parsed_id = _parse_positive_id(session_id)
    if parsed_id is None:
        return JSONResponse({"detail": "session_id must be a positive integer."}, status_code=400)
    try:
        payload = await request.json()
    except Exception:
        return JSONResponse({"detail": "Invalid request body."}, status_code=400)
    if not isinstance(payload, dict):
        return JSONResponse({"detail": "Request body must be an object."}, status_code=400)
    message_text, error = _text_value(payload.get("message"), "message", MAX_MESSAGE_LENGTH)
    if error:
        return JSONResponse({"detail": error}, status_code=400)

    request_id = f"coach-{uuid.uuid4().hex}"
    try:
        with db_conn() as conn:
            with conn.cursor() as cur:
                session = _load_session(cur, parsed_id, lock=True)
                if session is None:
                    return JSONResponse({"detail": "Coach session not found."}, status_code=404)
                if session["status"] == "archived":
                    return JSONResponse({"detail": "Archived Coach sessions cannot accept messages."}, status_code=409)
                cur.execute(
                    """
                    INSERT INTO public.coach_message (coach_session_id, role, message_kind, message_text)
                    VALUES (%s, 'user', 'text', %s)
                    RETURNING coach_message_id, coach_session_id, role, message_kind,
                              message_text, structured_payload, created_at
                    """,
                    (parsed_id, message_text),
                )
                user_message = cur.fetchone()
                cur.execute(
                    """
                    INSERT INTO public.coach_turn
                        (coach_session_id, user_message_id, request_id, coaching_policy_version, status)
                    VALUES (%s, %s, %s, %s, 'started')
                    RETURNING coach_turn_id, coach_session_id, user_message_id, assistant_message_id,
                              request_id, provider, model, coaching_policy_version, status,
                              started_at, completed_at, created_at
                    """,
                    (parsed_id, user_message["coach_message_id"], request_id, COACHING_POLICY_VERSION),
                )
                turn = cur.fetchone()
                cur.execute(
                    """
                    UPDATE public.coach_session
                    SET last_activity_at = now(), updated_at = now()
                    WHERE coach_session_id = %s
                    """,
                    (parsed_id,),
                )
            conn.commit()
        return {"message": _json_row(user_message), "turn": _json_row(turn)}
    except Exception:
        logger.exception("Failed to persist Coach user message")
        return JSONResponse({"detail": "Unable to persist Coach message."}, status_code=500)


@router.get("/api/coach/sessions/{session_id}/usage")
def get_coach_session_usage(session_id: str):
    parsed_id = _parse_positive_id(session_id)
    if parsed_id is None:
        return JSONResponse({"detail": "session_id must be a positive integer."}, status_code=400)
    try:
        with db_conn() as conn:
            with conn.cursor() as cur:
                session = _load_session(cur, parsed_id)
                if session is None:
                    return JSONResponse({"detail": "Coach session not found."}, status_code=404)
                usage = _usage_for_session(cur, parsed_id)
        return _usage_response(session, usage)
    except Exception:
        logger.exception("Failed to load Coach usage")
        return JSONResponse({"detail": "Unable to load Coach usage."}, status_code=500)


def _validate_turn_metadata(provider, model, provider_response_id, elapsed_ms, tool_call_count):
    for name, value in (("provider", provider), ("model", model), ("provider_response_id", provider_response_id)):
        if value is not None and (not isinstance(value, str) or not value.strip()):
            raise ValueError(f"{name} must be nonblank when supplied")
    return (
        provider.strip() if provider else None,
        model.strip() if model else None,
        provider_response_id.strip() if provider_response_id else None,
        _nonnegative_int(elapsed_ms, "elapsed_ms"),
        _nonnegative_int(tool_call_count, "tool_call_count") or 0,
    )


def _complete_coach_turn(
    turn_id, assistant_text, structured_payload=None, provider=None, model=None,
    provider_response_id=None, input_tokens=None, cached_input_tokens=None,
    output_tokens=None, reasoning_tokens=None, total_tokens=None,
    estimated_cost_usd=None, elapsed_ms=None, tool_call_count=0,
):
    parsed_turn_id = _parse_positive_id(turn_id)
    if parsed_turn_id is None:
        raise ValueError("turn_id must be a positive integer")
    assistant_text, error = _text_value(assistant_text, "assistant_text", MAX_MESSAGE_LENGTH)
    if error:
        raise ValueError(error)
    if structured_payload is not None and not isinstance(structured_payload, dict):
        raise ValueError("structured_payload must be an object")
    provider, model, provider_response_id, elapsed_ms, tool_call_count = _validate_turn_metadata(
        provider, model, provider_response_id, elapsed_ms, tool_call_count
    )
    token_values = [
        _nonnegative_int(value, name)
        for name, value in (
            ("input_tokens", input_tokens), ("cached_input_tokens", cached_input_tokens),
            ("output_tokens", output_tokens), ("reasoning_tokens", reasoning_tokens),
            ("total_tokens", total_tokens),
        )
    ]
    estimated_cost_usd = _nonnegative_decimal(estimated_cost_usd, "estimated_cost_usd")

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT t.*, s.status AS session_status, m.coach_session_id AS user_message_session_id
                FROM public.coach_turn t
                JOIN public.coach_session s ON s.coach_session_id = t.coach_session_id
                JOIN public.coach_message m ON m.coach_message_id = t.user_message_id
                WHERE t.coach_turn_id = %s
                FOR UPDATE
                """,
                (parsed_turn_id,),
            )
            turn = cur.fetchone()
            if turn is None:
                raise LookupError("Coach turn not found")
            if turn["status"] != "started":
                raise RuntimeError("Coach turn is already terminal")
            if turn["user_message_session_id"] != turn["coach_session_id"]:
                raise RuntimeError("Coach turn session mismatch")
            cur.execute(
                """
                INSERT INTO public.coach_message
                    (coach_session_id, role, message_kind, message_text, structured_payload)
                VALUES (%s, 'assistant', 'text', %s, %s)
                RETURNING coach_message_id, coach_session_id, role, message_kind,
                          message_text, structured_payload, created_at
                """,
                (
                    turn["coach_session_id"],
                    assistant_text,
                    Jsonb(structured_payload) if structured_payload is not None else None,
                ),
            )
            assistant_message = cur.fetchone()
            cur.execute(
                """
                UPDATE public.coach_turn
                SET assistant_message_id = %s, provider = %s, model = %s,
                    provider_response_id = %s, status = 'completed', completed_at = now(),
                    elapsed_ms = %s, input_tokens = %s, cached_input_tokens = %s,
                    output_tokens = %s, reasoning_tokens = %s, total_tokens = %s,
                    estimated_cost_usd = %s, tool_call_count = %s
                WHERE coach_turn_id = %s AND status = 'started'
                RETURNING coach_turn_id, status, assistant_message_id, completed_at
                """,
                (
                    assistant_message["coach_message_id"], provider, model, provider_response_id,
                    elapsed_ms, *token_values, estimated_cost_usd, tool_call_count, parsed_turn_id,
                ),
            )
            completed_turn = cur.fetchone()
            if completed_turn is None:
                raise RuntimeError("Coach turn is already terminal")
            cur.execute(
                """
                UPDATE public.coach_session
                SET last_activity_at = now(), updated_at = now(),
                    provider = COALESCE(%s, provider),
                    default_model = COALESCE(%s, default_model),
                    last_provider_response_id = COALESCE(%s, last_provider_response_id)
                WHERE coach_session_id = %s
                """,
                (provider, model, provider_response_id, turn["coach_session_id"]),
            )
        conn.commit()
    return _json_row(assistant_message), _json_row(completed_turn)


def _fail_coach_turn(turn_id, status="failed", error_category="unknown_error", elapsed_ms=None):
    parsed_turn_id = _parse_positive_id(turn_id)
    if parsed_turn_id is None:
        raise ValueError("turn_id must be a positive integer")
    if status not in {"failed", "timed_out", "cancelled"}:
        raise ValueError("unsupported terminal turn status")
    elapsed_ms = _nonnegative_int(elapsed_ms, "elapsed_ms")
    category = _sanitize_error_category(error_category)

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE public.coach_turn
                SET status = %s, error_category = %s, completed_at = now(), elapsed_ms = %s
                WHERE coach_turn_id = %s AND status = 'started'
                RETURNING coach_turn_id, coach_session_id, status, completed_at, elapsed_ms, error_category
                """,
                (status, category, elapsed_ms, parsed_turn_id),
            )
            failed_turn = cur.fetchone()
            if failed_turn is None:
                cur.execute(
                    "SELECT coach_turn_id, status FROM public.coach_turn WHERE coach_turn_id = %s",
                    (parsed_turn_id,),
                )
                existing = cur.fetchone()
                if existing is None:
                    raise LookupError("Coach turn not found")
                raise RuntimeError("Coach turn is already terminal")
            cur.execute(
                """
                UPDATE public.coach_session
                SET last_activity_at = now(), updated_at = now()
                WHERE coach_session_id = %s
                """,
                (failed_turn["coach_session_id"],),
            )
        conn.commit()
    return _json_row(failed_turn)