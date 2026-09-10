"""Build, validate, persist, and retrieve immutable Coach context receipts."""

import json
import re
from datetime import date, datetime

from psycopg.types.json import Jsonb

from coach_memory_router import (
    MEMORY_TYPES,
    PRIORITIES,
    SCOPES,
    SELECTION_REASON_ORDER,
    active_scopes,
    selection_reasons,
)
from db import db_conn, json_safe


RECEIPT_VERSION = 1
MAX_RECEIPT_CHARACTERS = 16_000
MAX_SELECTED_MEMORIES = 12
MAX_MISSING_SOURCES = 20
MAX_MISSING_SOURCE_CHARACTERS = 120
RECEIPT_KEYS = (
    "selected_memories",
    "active_scopes",
    "context_coverage",
    "recent_message_count",
    "custom_instructions_included",
    "additional_data_requested",
)
COVERAGE_KEYS = (
    "data_through_date",
    "detailed_activity_days",
    "weekly_rows",
    "fitness_fatigue_form_days",
    "recovery_days",
    "current_audit_available",
    "completed_audit_available",
    "missing_sources",
)


class ContextReceiptError(Exception):
    pass


class ContextReceiptInvalid(ContextReceiptError):
    pass


class ContextReceiptUnavailable(ContextReceiptError):
    pass


class ContextReceiptConflict(ContextReceiptError):
    pass


try:
    from psycopg.errors import UniqueViolation
except ImportError:
    class UniqueViolation(Exception):
        pass


def _strict_date(value):
    if value is None:
        return None
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ContextReceiptInvalid("Invalid receipt date.")
    try:
        date.fromisoformat(value)
    except ValueError:
        raise ContextReceiptInvalid("Invalid receipt date.") from None
    return value


def _nonnegative_int(value):
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def _coverage(context):
    context = context if isinstance(context, dict) else {}
    progress = context.get("week_progress")
    progress = progress if isinstance(progress, dict) else {}
    source = context.get("coverage")
    source = source if isinstance(source, dict) else {}
    result = {
        "data_through_date": _strict_date(progress.get("data_through_date")) if progress.get("data_through_date") is not None else None,
        "detailed_activity_days": source.get("detailed_daily_days_returned"),
        "weekly_rows": source.get("weekly_rows_returned"),
        "fitness_fatigue_form_days": source.get("fitness_fatigue_form_days_returned"),
        "recovery_days": source.get("recovery_days_requested"),
        "current_audit_available": source.get("current_audit_available"),
        "completed_audit_available": source.get("latest_completed_audit_available"),
        "missing_sources": source.get("missing_sources", []),
    }
    for key in ("detailed_activity_days", "weekly_rows", "fitness_fatigue_form_days", "recovery_days"):
        if result[key] is not None and not _nonnegative_int(result[key]):
            raise ContextReceiptInvalid("Invalid receipt coverage count.")
    for key in ("current_audit_available", "completed_audit_available"):
        if result[key] is not None and not isinstance(result[key], bool):
            raise ContextReceiptInvalid("Invalid receipt coverage availability.")
    missing = result["missing_sources"]
    if not isinstance(missing, list) or len(missing) > MAX_MISSING_SOURCES:
        raise ContextReceiptInvalid("Invalid receipt missing-source list.")
    if any(not isinstance(item, str) or not item.strip() or len(item) > MAX_MISSING_SOURCE_CHARACTERS for item in missing):
        raise ContextReceiptInvalid("Invalid receipt missing-source list.")
    result["missing_sources"] = missing[:]
    return result


def build_receipt(selected_memories, evidence, context, history, custom_instructions_included):
    if not isinstance(selected_memories, list) or len(selected_memories) > MAX_SELECTED_MEMORIES:
        raise ContextReceiptInvalid("Invalid selected memory count.")
    if not isinstance(history, list):
        raise ContextReceiptInvalid("Invalid receipt history.")
    if not isinstance(custom_instructions_included, bool):
        raise ContextReceiptInvalid("Invalid Custom Instructions indicator.")
    selected = []
    for memory in selected_memories:
        if not isinstance(memory, dict):
            raise ContextReceiptInvalid("Invalid selected memory.")
        reasons = selection_reasons(memory, evidence)
        snapshot = {
            "memory_id": memory.get("memory_id"),
            "title": memory.get("title"),
            "memory_type": memory.get("memory_type"),
            "priority": memory.get("priority"),
            "selection_reasons": reasons,
        }
        selected.append(snapshot)
    receipt = {
        "selected_memories": selected,
        "active_scopes": [scope for scope in SCOPES if scope in active_scopes(evidence)],
        "context_coverage": _coverage(context),
        "recent_message_count": len(history),
        "custom_instructions_included": custom_instructions_included,
        "additional_data_requested": [],
    }
    validate_receipt(receipt)
    return receipt


def validate_receipt(receipt):
    if not isinstance(receipt, dict) or set(receipt) != set(RECEIPT_KEYS):
        raise ContextReceiptInvalid("Invalid receipt shape.")
    memories = receipt["selected_memories"]
    if not isinstance(memories, list) or len(memories) > MAX_SELECTED_MEMORIES:
        raise ContextReceiptInvalid("Invalid selected memory count.")
    for memory in memories:
        if not isinstance(memory, dict) or set(memory) != {"memory_id", "title", "memory_type", "priority", "selection_reasons"}:
            raise ContextReceiptInvalid("Invalid selected memory shape.")
        if not isinstance(memory["memory_id"], int) or isinstance(memory["memory_id"], bool) or memory["memory_id"] <= 0:
            raise ContextReceiptInvalid("Invalid selected memory identifier.")
        if not isinstance(memory["title"], str) or not memory["title"].strip():
            raise ContextReceiptInvalid("Invalid selected memory title.")
        if memory["memory_type"] not in MEMORY_TYPES or memory["priority"] not in PRIORITIES:
            raise ContextReceiptInvalid("Invalid selected memory metadata.")
        reasons = memory["selection_reasons"]
        if not isinstance(reasons, list) or not reasons or len(set(reasons)) != len(reasons) or reasons != [item for item in SELECTION_REASON_ORDER if item in reasons] or any(item not in SELECTION_REASON_ORDER for item in reasons):
            raise ContextReceiptInvalid("Invalid selected memory reasons.")
    scopes = receipt["active_scopes"]
    if not isinstance(scopes, list) or scopes != [scope for scope in SCOPES if scope in scopes] or len(set(scopes)) != len(scopes) or "all_training" not in scopes:
        raise ContextReceiptInvalid("Invalid active scopes.")
    coverage = receipt["context_coverage"]
    if not isinstance(coverage, dict) or set(coverage) != set(COVERAGE_KEYS):
        raise ContextReceiptInvalid("Invalid context coverage.")
    _coverage({"week_progress": {"data_through_date": coverage["data_through_date"]}, "coverage": coverage})
    if not _nonnegative_int(receipt["recent_message_count"]):
        raise ContextReceiptInvalid("Invalid recent message count.")
    if not isinstance(receipt["custom_instructions_included"], bool):
        raise ContextReceiptInvalid("Invalid Custom Instructions indicator.")
    if receipt["additional_data_requested"] != []:
        raise ContextReceiptInvalid("Invalid additional-data receipt value.")
    serialized = json.dumps(receipt, ensure_ascii=True, separators=(",", ":"))
    if len(serialized) > MAX_RECEIPT_CHARACTERS:
        raise ContextReceiptInvalid("Context receipt exceeds its size limit.")
    return receipt


def persist_receipt(coach_turn_id, receipt):
    validate_receipt(receipt)
    try:
        with db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO public.ai_coach_turn_context_receipts
                        (coach_turn_id, receipt_version, receipt_json)
                    VALUES (%s, %s, %s)
                    """,
                    (coach_turn_id, RECEIPT_VERSION, Jsonb(receipt)),
                )
            conn.commit()
    except UniqueViolation:
        raise ContextReceiptConflict("Context receipt already exists.") from None
    except ContextReceiptError:
        raise
    except Exception:
        raise ContextReceiptUnavailable("Context receipt persistence is unavailable.") from None


def receipt_response(row):
    if row is None or row.get("receipt_version") != RECEIPT_VERSION:
        raise ContextReceiptUnavailable("Stored context receipt is unsupported.")
    try:
        validate_receipt(row["receipt_json"])
    except ContextReceiptInvalid:
        raise ContextReceiptUnavailable("Stored context receipt is invalid.") from None
    return {
        "coach_turn_id": row["coach_turn_id"],
        "receipt_version": row["receipt_version"],
        "receipt_json": row["receipt_json"],
        "created_at": json_safe(row["created_at"]),
    }


def load_receipt(coach_turn_id):
    try:
        with db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT r.coach_turn_id, r.receipt_version, r.receipt_json, r.created_at
                    FROM public.ai_coach_turn_context_receipts r
                    JOIN public.coach_turn t ON t.coach_turn_id = r.coach_turn_id
                    WHERE r.coach_turn_id = %s
                    """,
                    (coach_turn_id,),
                )
                row = cur.fetchone()
        if row is None:
            return None
        return receipt_response(row)
    except ContextReceiptUnavailable:
        raise
    except Exception:
        raise ContextReceiptUnavailable("Context receipt retrieval is unavailable.") from None