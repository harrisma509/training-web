"""Persistence and trusted-LAN API routes for AI Coach settings."""

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from db import db_conn

router = APIRouter()

DEFAULT_MONTHLY_COST_LIMIT = Decimal("5.00")
DEFAULT_MAX_TURN_COST = Decimal("0.25")
DEFAULT_MAX_OUTPUT_TOKENS = 1200
DEFAULT_REASONING_EFFORT = "low"

MONTHLY_COST_MIN = Decimal("0.00")
MONTHLY_COST_MAX = Decimal("25.00")
TURN_COST_MIN = Decimal("0.01")
TURN_COST_MAX = Decimal("1.00")
OUTPUT_TOKENS_MIN = 250
OUTPUT_TOKENS_MAX = 8000
SUPPORTED_REASONING_EFFORTS = {"none", "low", "medium", "high"}
EXPECTED_FIELDS = {
    "monthly_cost_limit_usd",
    "max_turn_cost_usd",
    "max_output_tokens",
    "reasoning_effort",
}


class CoachSettingsUnavailableError(Exception):
    """The persisted Coach settings cannot safely control a paid turn."""


@dataclass(frozen=True)
class CoachSettings:
    monthly_cost_limit_usd: Decimal
    max_turn_cost_usd: Decimal
    max_output_tokens: int
    reasoning_effort: str
    updated_at: datetime | date | str


def _decimal_value(value, field_name):
    if isinstance(value, bool):
        raise ValueError(f"{field_name} must be a number.")
    try:
        decimal_value = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise ValueError(f"{field_name} must be a number.") from None
    if not decimal_value.is_finite():
        raise ValueError(f"{field_name} must be a finite number.")
    return decimal_value


def _integer_value(value, field_name):
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{field_name} must be an integer.")
    return value


def validate_coach_settings(payload):
    if not isinstance(payload, dict):
        raise ValueError("Request body must be an object.")
    missing = EXPECTED_FIELDS - payload.keys()
    unknown = payload.keys() - EXPECTED_FIELDS
    if missing:
        raise ValueError("All Coach settings fields are required.")
    if unknown:
        raise ValueError("Unsupported Coach settings field.")

    monthly_limit = _decimal_value(payload["monthly_cost_limit_usd"], "monthly_cost_limit_usd")
    turn_limit = _decimal_value(payload["max_turn_cost_usd"], "max_turn_cost_usd")
    output_tokens = _integer_value(payload["max_output_tokens"], "max_output_tokens")
    reasoning_effort = payload["reasoning_effort"]

    if not MONTHLY_COST_MIN <= monthly_limit <= MONTHLY_COST_MAX:
        raise ValueError("monthly_cost_limit_usd is outside the allowed range.")
    if not TURN_COST_MIN <= turn_limit <= TURN_COST_MAX:
        raise ValueError("max_turn_cost_usd is outside the allowed range.")
    if not OUTPUT_TOKENS_MIN <= output_tokens <= OUTPUT_TOKENS_MAX:
        raise ValueError("max_output_tokens is outside the allowed range.")
    if reasoning_effort not in SUPPORTED_REASONING_EFFORTS:
        raise ValueError("reasoning_effort is unsupported.")

    return {
        "monthly_cost_limit_usd": monthly_limit,
        "max_turn_cost_usd": turn_limit,
        "max_output_tokens": output_tokens,
        "reasoning_effort": reasoning_effort,
    }


def _json_settings(settings):
    return {
        **settings,
        "monthly_cost_limit_usd": str(settings["monthly_cost_limit_usd"]),
        "max_turn_cost_usd": str(settings["max_turn_cost_usd"]),
    }


def load_coach_settings():
    try:
        with db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT monthly_cost_limit_usd, max_turn_cost_usd,
                           max_output_tokens, reasoning_effort, updated_at
                    FROM public.ai_coach_settings
                    WHERE settings_id = 1
                    """
                )
                row = cur.fetchone()
    except Exception as exc:
        raise CoachSettingsUnavailableError() from exc
    if row is None:
        raise CoachSettingsUnavailableError()
    try:
        values = validate_coach_settings(
            {
                "monthly_cost_limit_usd": row["monthly_cost_limit_usd"],
                "max_turn_cost_usd": row["max_turn_cost_usd"],
                "max_output_tokens": row["max_output_tokens"],
                "reasoning_effort": row["reasoning_effort"],
            }
        )
        if row.get("updated_at") is None:
            raise ValueError("updated_at is missing.")
    except (KeyError, TypeError, ValueError):
        raise CoachSettingsUnavailableError() from None
    values["updated_at"] = row["updated_at"]
    return CoachSettings(**values)


def _settings_response(settings):
    return _json_settings(
        {
            "monthly_cost_limit_usd": settings.monthly_cost_limit_usd,
            "max_turn_cost_usd": settings.max_turn_cost_usd,
            "max_output_tokens": settings.max_output_tokens,
            "reasoning_effort": settings.reasoning_effort,
            "updated_at": settings.updated_at.isoformat() if hasattr(settings.updated_at, "isoformat") else settings.updated_at,
        }
    )


@router.get("/api/settings/ai-coach")
def get_ai_coach_settings():
    try:
        return _settings_response(load_coach_settings())
    except CoachSettingsUnavailableError:
        return JSONResponse({"detail": "AI Coach settings are unavailable."}, status_code=503)


@router.put("/api/settings/ai-coach")
async def update_ai_coach_settings(request: Request):
    try:
        payload = await request.json()
        values = validate_coach_settings(payload)
    except ValueError as exc:
        return JSONResponse({"detail": str(exc)}, status_code=400)
    except Exception:
        return JSONResponse({"detail": "Invalid request body."}, status_code=400)

    try:
        with db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE public.ai_coach_settings
                    SET monthly_cost_limit_usd = %s,
                        max_turn_cost_usd = %s,
                        max_output_tokens = %s,
                        reasoning_effort = %s,
                        updated_at = now()
                    WHERE settings_id = 1
                    RETURNING monthly_cost_limit_usd, max_turn_cost_usd,
                              max_output_tokens, reasoning_effort, updated_at
                    """,
                    (
                        values["monthly_cost_limit_usd"],
                        values["max_turn_cost_usd"],
                        values["max_output_tokens"],
                        values["reasoning_effort"],
                    ),
                )
                row = cur.fetchone()
                if row is None:
                    conn.rollback()
                    raise CoachSettingsUnavailableError()
                conn.commit()
        return _json_settings(
            {
                "monthly_cost_limit_usd": row["monthly_cost_limit_usd"],
                "max_turn_cost_usd": row["max_turn_cost_usd"],
                "max_output_tokens": row["max_output_tokens"],
                "reasoning_effort": row["reasoning_effort"],
                "updated_at": row["updated_at"].isoformat()
                if hasattr(row["updated_at"], "isoformat")
                else row["updated_at"],
            }
        )
    except CoachSettingsUnavailableError:
        return JSONResponse({"detail": "AI Coach settings are unavailable."}, status_code=503)
    except Exception:
        return JSONResponse({"detail": "Unable to save AI Coach settings."}, status_code=503)