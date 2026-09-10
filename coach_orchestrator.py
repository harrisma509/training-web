"""One bounded, provider-neutral Coach response orchestration path."""

import json
import logging
import time
import uuid
from datetime import date, datetime, timedelta

from ai_factory import configured_ai_provider
from ai_provider import (
    AIAuthenticationError,
    AIConfigurationError,
    AIProviderError,
    AIRequest,
    AIRateLimitError,
    AITimeoutError,
)
from coach_cost import (
    BudgetUnavailableError,
    CostLimitError,
    MonthlyBudgetDisabledError,
    MonthlyBudgetLimitError,
    TurnCostLimitError,
    estimated_cost,
    enforce_monthly_budget,
    preflight_cost,
)
from coach_guards import ProviderCapacityError, provider_capacity
from coach_policy import COACH_POLICY
from routes.coach_custom_instructions import (
    CustomInstructionsUnavailableError,
    compile_custom_instructions,
    load_custom_instructions,
)
from routes.coach_settings import CoachSettingsUnavailableError, load_coach_settings
from coach_memory_router import DENVER, CriticalMemoryOverflowError, compile_memories, select_memories
from routes.coach_memories import DurableMemoriesUnavailableError, load_memories
from context_client import ContextError, MAX_CONTEXT_CHARS, fetch_current_context
from routes.coach import (
    MAX_MESSAGE_LENGTH,
    _complete_coach_turn,
    _fail_coach_turn,
    _recent_coach_messages,
    _coach_session_snapshot,
    _start_coach_turn,
)

logger = logging.getLogger(__name__)
MAX_HISTORY_CHARS = 24_000
MAX_HISTORY_MESSAGES = 24
MAX_OUTPUT_TOKENS = 1_200
PROVIDER_TIMEOUT_SECONDS = 60.0
SUPPORTED_REASONING_EFFORTS = {"none", "low", "medium", "high"}


class CoachOrchestrationError(Exception):
    def __init__(self, status_code, detail, category, turn_id=None):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
        self.category = category
        self.turn_id = turn_id


def validate_reasoning_effort(value):
    if value not in SUPPORTED_REASONING_EFFORTS:
        raise ValueError("Unsupported reasoning effort.")
    return value


def _temporal_reference(context):
    as_of = context.get("as_of") if isinstance(context, dict) else None
    as_of = as_of if isinstance(as_of, dict) else {}
    timezone_name = as_of.get("timezone")
    current_date_value = as_of.get("current_date")
    generated_at = as_of.get("response_generated_at")
    lines = [
        "Temporal reference:",
        f"Timezone: {timezone_name if isinstance(timezone_name, str) and timezone_name.strip() else 'unknown'}",
    ]

    parsed_date = None
    if isinstance(current_date_value, str) and len(current_date_value) == 10:
        try:
            parsed_date = date.fromisoformat(current_date_value)
        except ValueError:
            parsed_date = None
        if parsed_date is not None and parsed_date.isoformat() != current_date_value:
            parsed_date = None

    if parsed_date is None:
        lines.append("Current local date: unavailable; relative dates are unavailable")
    else:
        lines.extend(
            [
                f"Current local date: {parsed_date.strftime('%A, %Y-%m-%d')}",
                f"Today: {parsed_date.isoformat()}",
                f"Yesterday: {(parsed_date - timedelta(days=1)).isoformat()}",
                f"Tomorrow: {(parsed_date + timedelta(days=1)).isoformat()}",
            ]
        )

    if isinstance(generated_at, str) and generated_at.strip():
        lines.append(f"Context generated at: {generated_at}")
    else:
        lines.append("Context generated at: unknown")
    lines.append("Collection ordering: array position is not authoritative; match every record by its explicit date")
    return "\n".join(lines)


def _build_input(context, history, message):
    context_json = json.dumps(context, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
    if len(context_json) > MAX_CONTEXT_CHARS:
        raise CoachOrchestrationError(502, "Coach context is too large.", "context_too_large")
    history_json = json.dumps(history, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
    return (
        _temporal_reference(context)
        + "\n\nAuthoritative training context:\n" + context_json
        + "\nRecent conversation:\n" + history_json
        + "\nCurrent question:\n" + message
    ), len(context_json), len(history_json)


def _validate_response(response):
    text = response.text.strip() if isinstance(response.text, str) else ""
    if not text:
        raise AIProviderError("AI provider returned no response text.")
    if not isinstance(response.provider, str) or not response.provider.strip():
        raise AIProviderError("AI provider response is missing provider metadata.")
    if not isinstance(response.model, str) or not response.model.strip():
        raise AIProviderError("AI provider response is missing model metadata.")
    if not isinstance(response.elapsed_ms, int) or response.elapsed_ms < 0:
        raise AIProviderError("AI provider response is missing elapsed metadata.")
    if response.finish_status not in {None, "completed", "succeeded"}:
        raise AIProviderError("AI provider response was not completed.")
    return text


def _failure(turn_id, status, category, status_code, detail, started):
    try:
        _fail_coach_turn(
            turn_id,
            status=status,
            error_category=category,
            elapsed_ms=round((time.perf_counter() - started) * 1000),
        )
    except Exception:
        logger.exception("Failed to persist Coach turn failure turn_id=%s", turn_id)
        raise CoachOrchestrationError(500, "Unable to finalize Coach turn.", "internal_error", turn_id) from None
    raise CoachOrchestrationError(status_code, detail, category, turn_id)


def respond_to_coach(
    session_id,
    message,
    *,
    context_loader=fetch_current_context,
    provider_factory=configured_ai_provider,
    settings_loader=None,
    custom_instructions_loader=None,
):
    request_id = f"coach-{uuid.uuid4().hex}"
    _, user_message, started_turn = _start_coach_turn(session_id, message, request_id)
    turn_id = started_turn["coach_turn_id"]
    started = time.perf_counter()
    try:
        context = context_loader()
        history = _recent_coach_messages(session_id, user_message["coach_message_id"], MAX_HISTORY_MESSAGES, MAX_HISTORY_CHARS)
        input_text, context_characters, history_characters = _build_input(context, history, message)
        settings = (settings_loader or load_coach_settings)()
        custom_instructions = (custom_instructions_loader or load_custom_instructions)()
        compiled_custom_instructions = compile_custom_instructions(custom_instructions)
        try:
            stored_memories = load_memories()
            generated_at = datetime.now(DENVER)
            selected_memories = select_memories(
                stored_memories,
                message,
                history,
                context,
                generated_at,
                generated_at.date(),
            )
            compiled_memories = compile_memories(selected_memories)
        except DurableMemoriesUnavailableError:
            logger.warning("Durable Memories unavailable; continuing without optional memory context")
            compiled_memories = ""
        except CriticalMemoryOverflowError as exc:
            raise CoachOrchestrationError(
                503,
                "AI Coach Durable Memory safety configuration is unavailable.",
                "durable_memory_safety_unavailable",
            ) from exc
        provider_instructions = (
            COACH_POLICY
            if not compiled_custom_instructions
            else COACH_POLICY + "\n\n" + compiled_custom_instructions
        )
        if compiled_memories:
            provider_instructions += "\n\n" + compiled_memories
        provider = provider_factory()
        model = provider.model
        proposed_cost = preflight_cost(
            model,
            len(input_text) + len(provider_instructions),
            settings.max_output_tokens,
            settings.max_turn_cost_usd,
        )
        enforce_monthly_budget(proposed_cost, settings.monthly_cost_limit_usd)
        request = AIRequest(
            model=model,
            instructions=provider_instructions,
            input_text=input_text,
            max_output_tokens=settings.max_output_tokens,
            timeout_seconds=PROVIDER_TIMEOUT_SECONDS,
            reasoning_effort=validate_reasoning_effort(settings.reasoning_effort),
        )
        with provider_capacity():
            response = provider.complete(request)
        assistant_text = _validate_response(response)
        cost = estimated_cost(
            response.model,
            response.input_tokens,
            response.cached_input_tokens,
            response.output_tokens,
        )
        assistant_message, completed_turn = _complete_coach_turn(
            turn_id,
            assistant_text,
            provider=response.provider,
            model=response.model,
            provider_response_id=response.provider_response_id,
            input_tokens=response.input_tokens,
            cached_input_tokens=response.cached_input_tokens,
            output_tokens=response.output_tokens,
            reasoning_tokens=response.reasoning_tokens,
            total_tokens=response.total_tokens,
            estimated_cost_usd=cost,
            elapsed_ms=response.elapsed_ms,
        )
        return {
            "message": user_message,
            "assistant_message": assistant_message,
            "turn": completed_turn,
            "usage": _coach_session_snapshot(session_id),
        }
    except ContextError as exc:
        _failure(turn_id, "failed", exc.category, exc.status_code, "Coach context is unavailable.", started)
    except AITimeoutError:
        _failure(turn_id, "timed_out", "provider_timeout", 504, "Coach provider timed out.", started)
    except AIRateLimitError:
        _failure(turn_id, "failed", "provider_rate_limited", 429, "Coach provider rejected the request.", started)
    except AIAuthenticationError:
        _failure(turn_id, "failed", "provider_authentication_failed", 502, "Coach provider rejected the request.", started)
    except (AIConfigurationError,):
        _failure(turn_id, "failed", "provider_configuration", 503, "Coach provider is unavailable.", started)
    except ProviderCapacityError:
        _failure(turn_id, "failed", "provider_concurrency_limit", 429, "Coach provider capacity is unavailable.", started)
    except MonthlyBudgetDisabledError:
        _failure(
            turn_id,
            "failed",
            "budget_disabled",
            429,
            "AI Coach is paused because the monthly budget limit is $0.00. Update it in Settings > AI Coach.",
            started,
        )
    except MonthlyBudgetLimitError:
        _failure(
            turn_id,
            "failed",
            "monthly_budget_limit",
            429,
            "The AI Coach monthly budget has been reached. Increase the limit in Settings > AI Coach or wait until next month.",
            started,
        )
    except TurnCostLimitError:
        _failure(
            turn_id,
            "failed",
            "turn_cost_limit",
            429,
            "This response exceeds the maximum estimated cost per turn. Increase the limit in Settings > AI Coach or request a shorter response.",
            started,
        )
    except CostLimitError:
        _failure(turn_id, "failed", "budget_limit", 429, "Coach budget capacity is unavailable.", started)
    except BudgetUnavailableError:
        _failure(turn_id, "failed", "budget_unavailable", 503, "Coach budget status is unavailable.", started)
    except CoachSettingsUnavailableError:
        _failure(turn_id, "failed", "settings_unavailable", 503, "Coach settings are unavailable.", started)
    except CustomInstructionsUnavailableError:
        _failure(
            turn_id,
            "failed",
            "custom_instructions_unavailable",
            503,
            "AI Coach Custom Instructions are unavailable.",
            started,
        )
    except CoachOrchestrationError as exc:
        _failure(turn_id, "failed", exc.category, exc.status_code, exc.detail, started)
    except AIProviderError:
        _failure(turn_id, "failed", "provider_failed", 502, "Coach provider failed.", started)
    except Exception:
        logger.exception("Unexpected Coach orchestration failure turn_id=%s", turn_id)
        _failure(turn_id, "failed", "internal_error", 500, "Unable to complete Coach response.", started)
