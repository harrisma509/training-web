import unittest
from decimal import Decimal
import sys
import types
from unittest.mock import patch

if "openai" not in sys.modules:
    fake_openai = types.ModuleType("openai")

    class FakeOpenAIError(Exception):
        pass

    fake_openai.APIStatusError = FakeOpenAIError
    fake_openai.APITimeoutError = FakeOpenAIError
    fake_openai.AuthenticationError = FakeOpenAIError
    fake_openai.OpenAI = object
    fake_openai.PermissionDeniedError = FakeOpenAIError
    fake_openai.RateLimitError = FakeOpenAIError
    sys.modules["openai"] = fake_openai

if "fastapi" not in sys.modules:
    fake_fastapi = types.ModuleType("fastapi")

    class FakeRouter:
        def get(self, *args, **kwargs):
            return lambda function: function

        post = get

    fake_fastapi.APIRouter = FakeRouter
    fake_fastapi.Request = object
    fake_responses = types.ModuleType("fastapi.responses")
    fake_responses.JSONResponse = object
    sys.modules["fastapi"] = fake_fastapi
    sys.modules["fastapi.responses"] = fake_responses

if "psycopg" not in sys.modules:
    fake_psycopg = types.ModuleType("psycopg")
    fake_rows = types.ModuleType("psycopg.rows")
    fake_rows.dict_row = object()
    fake_json = types.ModuleType("psycopg.types.json")
    fake_json.Jsonb = lambda value: value
    fake_types = types.ModuleType("psycopg.types")
    sys.modules["psycopg"] = fake_psycopg
    sys.modules["psycopg.rows"] = fake_rows
    sys.modules["psycopg.types"] = fake_types
    sys.modules["psycopg.types.json"] = fake_json

from ai_provider import AIRequest, AIResponse, AIProviderError, AITimeoutError
from coach_cost import CostLimitError, estimated_cost, pricing_for_model
from coach_orchestrator import respond_to_coach, validate_reasoning_effort
from context_client import ContextUnavailableError
from openai_adapter import _reasoning_argument
from routes.coach import CoachActiveTurn, CoachSessionArchived, CoachSessionNotFound


CONTEXT = {
    "as_of": "2026-09-07",
    "week_progress": {},
    "current_weekly_audit": {},
    "latest_completed_weekly_audit": {},
    "weekly_load_history": [],
    "weekly_tid_history": [],
    "recent_days": [],
    "fitness_fatigue_form": {},
    "recovery_history": [],
    "athlete_narrative": {},
    "coverage": {},
    "missing_subjective_context": [],
}


class FakeProvider:
    model = "gpt-5.6-luna"
    provider = "fake"

    def __init__(self, response=None, error=None):
        self.response = response
        self.error = error
        self.requests = []

    def complete(self, request):
        self.requests.append(request)
        if self.error:
            raise self.error
        return self.response


class CoachOrchestrationTests(unittest.TestCase):
    def setUp(self):
        self.response = AIResponse(
            text=" Summary\n\n- Keep the easy days easy.",
            provider="fake",
            model="gpt-5.6-luna",
            provider_response_id="resp-1",
            input_tokens=100,
            cached_input_tokens=20,
            output_tokens=30,
            reasoning_tokens=5,
            total_tokens=130,
            elapsed_ms=42,
            finish_status="completed",
        )
        self.provider = FakeProvider(self.response)
        self.started = {"coach_turn_id": 9}
        self.user_message = {"coach_message_id": 10, "coach_session_id": 3, "message_text": "How am I doing?"}
        self.completed = {"coach_turn_id": 9, "status": "completed"}

    def test_success_uses_low_reasoning_and_persists_exact_usage_and_cost(self):
        with patch("coach_orchestrator._start_coach_turn", return_value=({}, self.user_message, self.started)), \
             patch("coach_orchestrator._recent_coach_messages", return_value=[]), \
             patch("coach_orchestrator._complete_coach_turn", return_value=({"coach_message_id": 11}, self.completed)) as complete, \
             patch("coach_orchestrator._coach_session_snapshot", return_value={"total_tokens": 130}), \
             patch("coach_orchestrator.enforce_monthly_budget", return_value={"recorded_cost_usd": Decimal("0"), "unknown_cost_count": 0}), \
             patch("coach_orchestrator._fail_coach_turn") as fail:
            result = respond_to_coach(
                3,
                "How am I doing?",
                context_loader=lambda: CONTEXT,
                provider_factory=lambda: self.provider,
            )

        request = self.provider.requests[0]
        self.assertEqual(request.reasoning_effort, "low")
        self.assertEqual(request.max_output_tokens, 1200)
        self.assertEqual(request.timeout_seconds, 60.0)
        self.assertIn('"as_of":"2026-09-07"', request.input_text)
        self.assertEqual(result["turn"], self.completed)
        complete.assert_called_once()
        self.assertEqual(complete.call_args.kwargs["input_tokens"], 100)
        self.assertEqual(complete.call_args.kwargs["cached_input_tokens"], 20)
        self.assertEqual(complete.call_args.kwargs["output_tokens"], 30)
        self.assertEqual(complete.call_args.kwargs["reasoning_tokens"], 5)
        self.assertEqual(complete.call_args.kwargs["total_tokens"], 130)
        self.assertEqual(complete.call_args.kwargs["estimated_cost_usd"], Decimal("0.000052"))
        fail.assert_not_called()

    def test_context_failure_marks_started_turn_and_does_not_call_provider(self):
        self.provider = FakeProvider(self.response)
        with patch("coach_orchestrator._start_coach_turn", return_value=({}, self.user_message, self.started)), \
             patch("coach_orchestrator._fail_coach_turn") as fail:
            with self.assertRaises(Exception) as raised:
                respond_to_coach(3, "Question", context_loader=lambda: (_ for _ in ()).throw(
                    ContextUnavailableError("hidden")
                ), provider_factory=lambda: self.provider)
        self.assertEqual(raised.exception.status_code, 503)
        fail.assert_called_once()
        self.assertEqual(fail.call_args.kwargs["error_category"], "context_unavailable")
        self.assertEqual(self.provider.requests, [])

    def test_provider_timeout_marks_turn_timed_out(self):
        self.provider = FakeProvider(error=AITimeoutError("hidden"))
        with patch("coach_orchestrator._start_coach_turn", return_value=({}, self.user_message, self.started)), \
             patch("coach_orchestrator._recent_coach_messages", return_value=[]), \
               patch("coach_orchestrator.enforce_monthly_budget", return_value={"recorded_cost_usd": Decimal("0"), "unknown_cost_count": 0}), \
             patch("coach_orchestrator._fail_coach_turn") as fail:
            with self.assertRaises(Exception) as raised:
                respond_to_coach(3, "Question", context_loader=lambda: CONTEXT, provider_factory=lambda: self.provider)
        self.assertEqual(raised.exception.status_code, 504)
        fail.assert_called_once()
        self.assertEqual(fail.call_args.kwargs["status"], "timed_out")
        self.assertEqual(fail.call_args.kwargs["error_category"], "provider_timeout")

    def test_reasoning_argument_is_omitted_when_null(self):
        self.assertEqual(_reasoning_argument(None), {})
        self.assertEqual(_reasoning_argument("none"), {"reasoning": {"effort": "none"}})
        with self.assertRaises(Exception):
            _reasoning_argument("unsupported")
        with self.assertRaises(ValueError):
            validate_reasoning_effort("unsupported")

    def test_cost_uses_decimal_rates_and_unknown_model_is_null(self):
        self.assertEqual(
            estimated_cost("gpt-5.6-luna", 1000, 200, 300),
            Decimal("0.000524"),
        )
        self.assertIsNone(pricing_for_model("other-model"))
        self.assertIsNone(estimated_cost("other-model", 1000, 200, 300))

    def test_existing_started_turn_conflict_is_rejected_before_provider(self):
        with patch("coach_orchestrator._start_coach_turn", side_effect=CoachActiveTurn()):
            with self.assertRaises(CoachActiveTurn):
                respond_to_coach(3, "Question", context_loader=lambda: CONTEXT, provider_factory=lambda: self.provider)
        self.assertEqual(self.provider.requests, [])

    def test_monthly_budget_rejection_prevents_provider_execution(self):
        with patch("coach_orchestrator._start_coach_turn", return_value=({}, self.user_message, self.started)), \
             patch("coach_orchestrator._recent_coach_messages", return_value=[]), \
             patch("coach_orchestrator.enforce_monthly_budget", side_effect=CostLimitError()), \
             patch("coach_orchestrator._fail_coach_turn") as fail:
            with self.assertRaises(Exception) as raised:
                respond_to_coach(3, "Question", context_loader=lambda: CONTEXT, provider_factory=lambda: self.provider)
        self.assertEqual(raised.exception.status_code, 429)
        self.assertEqual(fail.call_args.kwargs["error_category"], "budget_limit")
        self.assertEqual(self.provider.requests, [])


if __name__ == "__main__":
    unittest.main()
