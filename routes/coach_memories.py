"""Protected Durable Memories management routes and persistence."""

from datetime import datetime

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from coach_memory_router import (
    EDITABLE_FIELDS,
    MEMORY_TYPES,
    MalformedMemoryError,
    MemoryValidationError,
    derived_status,
    is_active_eligible,
    response_memory,
    validate_memory_payload,
    validate_stored_memory,
    DENVER,
)
from db import db_conn

router = APIRouter()
SELECT_COLUMNS = "memory_id, memory_type, title, memory_text, applies_to, priority, effective_date, expires_at, is_active, created_at, updated_at"
ACTIVE_LIMIT = 50


class DurableMemoriesUnavailableError(Exception):
    pass


class MemoryNotFoundError(Exception):
    pass


class ActiveMemoryLimitError(Exception):
    pass


def _now():
    return datetime.now(DENVER)


def _load_row(cur, memory_id, lock=False):
    cur.execute(
        f"SELECT {SELECT_COLUMNS} FROM public.ai_coach_memories WHERE memory_id = %s" + (" FOR UPDATE" if lock else ""),
        (memory_id,),
    )
    row = cur.fetchone()
    if row is None:
        raise MemoryNotFoundError()
    try:
        return validate_stored_memory(row)
    except MalformedMemoryError as exc:
        raise DurableMemoriesUnavailableError() from exc


def load_memories():
    try:
        with db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(f"SELECT {SELECT_COLUMNS} FROM public.ai_coach_memories ORDER BY memory_id")
                rows = cur.fetchall()
        return [validate_stored_memory(row) for row in rows]
    except DurableMemoriesUnavailableError:
        raise
    except Exception as exc:
        raise DurableMemoriesUnavailableError() from exc


def _active_limit_guard(cur, generated_at, local_date, replacing_id=None):
    cur.execute("SELECT pg_advisory_xact_lock(hashtext('training-web.ai_coach_memories.active_limit'))")
    cur.execute(f"SELECT {SELECT_COLUMNS} FROM public.ai_coach_memories WHERE is_active = true")
    count = 0
    for row in cur.fetchall():
        memory = validate_stored_memory(row)
        if memory["memory_id"] != replacing_id and is_active_eligible(memory, generated_at, local_date):
            count += 1
    if count >= ACTIVE_LIMIT:
        raise ActiveMemoryLimitError()


def _parse_memory_id(value):
    try:
        parsed = int(str(value).strip())
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _management_response(memory, generated_at):
    return response_memory(memory, generated_at, generated_at.astimezone(DENVER).date())


def _error(detail, status):
    return JSONResponse({"detail": detail}, status_code=status)


async def _payload(request):
    try:
        return validate_memory_payload(await request.json())
    except MemoryValidationError as exc:
        raise exc
    except Exception:
        raise MemoryValidationError("Invalid request body.") from None


@router.get("/api/settings/ai-coach/memories")
def list_memories(status=None, memory_type=None):
    generated_at = _now()
    local_date = generated_at.astimezone(DENVER).date()
    if status not in {None, "all", "active", "inactive", "future", "expired"}:
        return _error("Unsupported memory status.", 400)
    if memory_type is not None and memory_type not in MEMORY_TYPES:
        return _error("Unsupported memory_type.", 400)
    try:
        memories = load_memories()
    except DurableMemoriesUnavailableError:
        return _error("AI Coach Durable Memories are unavailable.", 503)
    result = []
    for memory in memories:
        if memory_type is not None and memory["memory_type"] != memory_type:
            continue
        item_status = derived_status(memory, generated_at, local_date)
        if status not in {None, "all", item_status}:
            continue
        result.append(response_memory(memory, generated_at, local_date))
    return {"memories": result}


def _write_memory(payload, memory_id=None, action="create"):
    generated_at = _now()
    local_date = generated_at.astimezone(DENVER).date()
    try:
        with db_conn() as conn:
            with conn.cursor() as cur:
                if action == "create":
                    if is_active_eligible(payload, generated_at, local_date):
                        _active_limit_guard(cur, generated_at, local_date)
                    cur.execute(
                        f"""INSERT INTO public.ai_coach_memories
                        (memory_type, title, memory_text, applies_to, priority, effective_date, expires_at, is_active)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                        RETURNING {SELECT_COLUMNS}""",
                        tuple(payload[field] for field in EDITABLE_FIELDS),
                    )
                else:
                    current = _load_row(cur, memory_id, lock=True)
                    if is_active_eligible(payload, generated_at, local_date) and not is_active_eligible(current, generated_at, local_date):
                        _active_limit_guard(cur, generated_at, local_date, replacing_id=memory_id)
                    cur.execute(
                        f"""UPDATE public.ai_coach_memories
                        SET memory_type = %s, title = %s, memory_text = %s, applies_to = %s,
                            priority = %s, effective_date = %s, expires_at = %s,
                            is_active = %s, updated_at = now()
                        WHERE memory_id = %s
                        RETURNING {SELECT_COLUMNS}""",
                        tuple(payload[field] for field in EDITABLE_FIELDS) + (memory_id,),
                    )
                row = cur.fetchone()
                if row is None:
                    conn.rollback()
                    raise MemoryNotFoundError()
                conn.commit()
        return _management_response(validate_stored_memory(row), generated_at)
    except (MemoryNotFoundError, ActiveMemoryLimitError):
        raise
    except MalformedMemoryError as exc:
        raise DurableMemoriesUnavailableError() from exc
    except Exception as exc:
        raise DurableMemoriesUnavailableError() from exc


@router.post("/api/settings/ai-coach/memories")
async def create_memory(request: Request):
    try:
        payload = await _payload(request)
        return _write_memory(payload)
    except MemoryValidationError as exc:
        return _error(str(exc), 400)
    except ActiveMemoryLimitError:
        return _error("The maximum of 50 active eligible memories has been reached.", 409)
    except DurableMemoriesUnavailableError:
        return _error("AI Coach Durable Memories are unavailable.", 503)


@router.put("/api/settings/ai-coach/memories/{memory_id}")
async def update_memory(memory_id: str, request: Request):
    parsed_id = _parse_memory_id(memory_id)
    if parsed_id is None:
        return _error("memory_id must be a positive integer.", 400)
    try:
        payload = await _payload(request)
        return _write_memory(payload, parsed_id, "update")
    except MemoryValidationError as exc:
        return _error(str(exc), 400)
    except MemoryNotFoundError:
        return _error("Durable Memory not found.", 404)
    except ActiveMemoryLimitError:
        return _error("The maximum of 50 active eligible memories has been reached.", 409)
    except DurableMemoriesUnavailableError:
        return _error("AI Coach Durable Memories are unavailable.", 503)


def _set_active(memory_id, is_active):
    parsed_id = _parse_memory_id(memory_id)
    if parsed_id is None:
        return _error("memory_id must be a positive integer.", 400)
    generated_at = _now()
    local_date = generated_at.astimezone(DENVER).date()
    try:
        with db_conn() as conn:
            with conn.cursor() as cur:
                current = _load_row(cur, parsed_id, lock=True)
                if is_active and not is_active_eligible(current, generated_at, local_date):
                    replacement = {**current, "is_active": True}
                    if is_active_eligible(replacement, generated_at, local_date):
                        _active_limit_guard(cur, generated_at, local_date, replacing_id=parsed_id)
                cur.execute(
                    f"UPDATE public.ai_coach_memories SET is_active = %s, updated_at = now() WHERE memory_id = %s RETURNING {SELECT_COLUMNS}",
                    (is_active, parsed_id),
                )
                row = cur.fetchone()
                conn.commit()
        return _management_response(validate_stored_memory(row), generated_at)
    except MemoryNotFoundError:
        return _error("Durable Memory not found.", 404)
    except ActiveMemoryLimitError:
        return _error("The maximum of 50 active eligible memories has been reached.", 409)
    except (MalformedMemoryError, DurableMemoriesUnavailableError):
        return _error("AI Coach Durable Memories are unavailable.", 503)
    except Exception:
        return _error("AI Coach Durable Memories are unavailable.", 503)


@router.post("/api/settings/ai-coach/memories/{memory_id}/deactivate")
def deactivate_memory(memory_id: str):
    return _set_active(memory_id, False)


@router.post("/api/settings/ai-coach/memories/{memory_id}/reactivate")
def reactivate_memory(memory_id: str):
    return _set_active(memory_id, True)