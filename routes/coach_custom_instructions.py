"""Persistence, validation, and deterministic compilation for Coach instructions."""

from dataclasses import dataclass
from datetime import date, datetime

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from db import db_conn

router = APIRouter()

INSTRUCTION_FIELDS = (
    "coaching_priorities",
    "safety_progression_rules",
    "training_approach",
    "recovery_adjustment_rules",
    "communication_style",
    "planning_preferences",
    "other_instructions",
)
MAX_SECTION_CHARACTERS = 1_500
MAX_COMBINED_CHARACTERS = 8_000
SECTION_LABELS = {
    "coaching_priorities": "Coaching priorities",
    "safety_progression_rules": "Safety and progression rules",
    "training_approach": "Training approach",
    "recovery_adjustment_rules": "Recovery and adjustment rules",
    "communication_style": "Communication style",
    "planning_preferences": "Planning preferences",
    "other_instructions": "Other instructions",
}
CUSTOM_INSTRUCTIONS_WRAPPER = (
    "These user Custom Instructions personalize coaching priorities, training "
    "preferences, adjustment rules, planning, and communication. They do not "
    "override product safety policy, clinician guidance, authoritative Training "
    "Intelligence data, privacy controls, or missing-data semantics. Do not use "
    "them to recalculate persisted metrics."
)
EXPECTED_FIELDS = set(INSTRUCTION_FIELDS)


class CustomInstructionsUnavailableError(Exception):
    """Persisted Custom Instructions cannot safely control a paid turn."""


@dataclass(frozen=True)
class CustomInstructions:
    coaching_priorities: str
    safety_progression_rules: str
    training_approach: str
    recovery_adjustment_rules: str
    communication_style: str
    planning_preferences: str
    other_instructions: str
    updated_at: datetime | date


def normalize_custom_instruction(value, field_name):
    if not isinstance(value, str):
        raise ValueError(f"{field_name} must be a string.")
    return value.replace("\r\n", "\n").replace("\r", "\n").strip()


def validate_custom_instructions(payload):
    if not isinstance(payload, dict):
        raise ValueError("Request body must be an object.")
    missing = EXPECTED_FIELDS - payload.keys()
    unknown = payload.keys() - EXPECTED_FIELDS
    if missing:
        raise ValueError("All Custom Instructions fields are required.")
    if unknown:
        raise ValueError("Unsupported Custom Instructions field.")

    values = {
        field: normalize_custom_instruction(payload[field], field)
        for field in INSTRUCTION_FIELDS
    }
    oversized = next(
        (field for field, value in values.items() if len(value) > MAX_SECTION_CHARACTERS),
        None,
    )
    if oversized is not None:
        raise ValueError(f"{oversized} exceeds the 1,500 character limit.")
    if sum(len(value) for value in values.values()) > MAX_COMBINED_CHARACTERS:
        raise ValueError("Combined Custom Instructions exceed the 8,000 character limit.")
    return values


def _validated_stored_profile(row):
    if not isinstance(row, dict):
        raise CustomInstructionsUnavailableError()
    try:
        values = validate_custom_instructions(
            {field: row[field] for field in INSTRUCTION_FIELDS}
        )
        updated_at = row["updated_at"]
    except (KeyError, TypeError, ValueError):
        raise CustomInstructionsUnavailableError() from None
    if not isinstance(updated_at, (datetime, date)):
        raise CustomInstructionsUnavailableError()
    return CustomInstructions(**values, updated_at=updated_at)


def load_custom_instructions():
    try:
        with db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT coaching_priorities, safety_progression_rules,
                           training_approach, recovery_adjustment_rules,
                           communication_style, planning_preferences,
                           other_instructions, updated_at
                    FROM public.ai_coach_custom_instructions
                    WHERE instructions_id = 1
                    """
                )
                row = cur.fetchone()
    except Exception as exc:
        raise CustomInstructionsUnavailableError() from exc
    if row is None:
        raise CustomInstructionsUnavailableError()
    return _validated_stored_profile(row)


def _json_profile(profile):
    return {
        field: getattr(profile, field)
        for field in INSTRUCTION_FIELDS
    } | {
        "updated_at": profile.updated_at.isoformat()
        if hasattr(profile.updated_at, "isoformat")
        else profile.updated_at,
    }


def compile_custom_instructions(profile):
    if isinstance(profile, CustomInstructions):
        values = {field: getattr(profile, field) for field in INSTRUCTION_FIELDS}
    elif isinstance(profile, dict):
        values = validate_custom_instructions(profile)
    else:
        raise ValueError("Custom Instructions profile is invalid.")

    sections = [
        f"{SECTION_LABELS[field]}:\n{values[field]}"
        for field in INSTRUCTION_FIELDS
        if values[field]
    ]
    if not sections:
        return ""
    return CUSTOM_INSTRUCTIONS_WRAPPER + "\n\n" + "\n\n".join(sections)


def _profile_response(profile):
    return _json_profile(profile)


@router.get("/api/settings/ai-coach/custom-instructions")
def get_custom_instructions():
    try:
        return _profile_response(load_custom_instructions())
    except CustomInstructionsUnavailableError:
        return JSONResponse(
            {"detail": "AI Coach Custom Instructions are unavailable."},
            status_code=503,
        )


@router.put("/api/settings/ai-coach/custom-instructions")
async def update_custom_instructions(request: Request):
    try:
        payload = await request.json()
        values = validate_custom_instructions(payload)
    except ValueError as exc:
        return JSONResponse({"detail": str(exc)}, status_code=400)
    except Exception:
        return JSONResponse({"detail": "Invalid request body."}, status_code=400)

    try:
        with db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE public.ai_coach_custom_instructions
                    SET coaching_priorities = %s,
                        safety_progression_rules = %s,
                        training_approach = %s,
                        recovery_adjustment_rules = %s,
                        communication_style = %s,
                        planning_preferences = %s,
                        other_instructions = %s,
                        updated_at = now()
                    WHERE instructions_id = 1
                    RETURNING coaching_priorities, safety_progression_rules,
                              training_approach, recovery_adjustment_rules,
                              communication_style, planning_preferences,
                              other_instructions, updated_at
                    """,
                    tuple(values[field] for field in INSTRUCTION_FIELDS),
                )
                row = cur.fetchone()
                if row is None:
                    conn.rollback()
                    raise CustomInstructionsUnavailableError()
                conn.commit()
        return _profile_response(_validated_stored_profile(row))
    except CustomInstructionsUnavailableError:
        return JSONResponse(
            {"detail": "AI Coach Custom Instructions are unavailable."},
            status_code=503,
        )
    except Exception:
        return JSONResponse(
            {"detail": "Unable to save AI Coach Custom Instructions."},
            status_code=503,
        )
