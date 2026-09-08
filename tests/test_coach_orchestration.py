import unittest
from decimal import Decimal
import os
import socket
import sys
import types
from urllib.error import HTTPError, URLError
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
from coach_cost import (
    BudgetUnavailableError,
    CostLimitError,
    enforce_monthly_budget,
    estimated_cost,
    preflight_cost,
    pricing_for_model,
)
from coach_orchestrator import respond_to_coach, validate_reasoning_effort
from context_client import (
    ContextAuthError,
    ContextInvalidResponseError,
    ContextUnavailableError,
    ContextTimeoutError,
    fetch_current_context,
)
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


class FakeContextResponse:
    status = 200

    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False

    def read(self):
        import json

        return json.dumps(self.payload).encode("utf-8")


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
        self.assertEqual(preflight_cost("gpt-5.6-luna", 1000, 300), Decimal("0.000560"))
        with self.assertRaises(BudgetUnavailableError):
            preflight_cost("other-model", 1000, 300)

    def test_monthly_budget_rejects_unknown_historical_costs(self):
        with patch("coach_cost.check_monthly_budget", lambda: (Decimal("1.00"), 1)):
            with self.assertRaises(BudgetUnavailableError):
                enforce_monthly_budget(Decimal("0.01"))

    def test_monthly_budget_allows_exact_ceiling_and_rejects_overage(self):
        with patch("coach_cost.check_monthly_budget", lambda: (Decimal("4.99"), 0)):
            enforce_monthly_budget(Decimal("0.01"))
        with patch("coach_cost.check_monthly_budget", lambda: (Decimal("4.99"), 0)):
            with self.assertRaises(CostLimitError):
                enforce_monthly_budget(Decimal("0.02"))
        with patch("coach_cost.check_monthly_budget", lambda: (Decimal("5.00"), 0)):
            with self.assertRaises(CostLimitError):
                enforce_monthly_budget(Decimal("0"))

    def test_unknown_model_budget_failure_prevents_provider_call(self):
        self.provider.model = "unknown-model"
        with patch("coach_orchestrator._start_coach_turn", return_value=({}, self.user_message, self.started)), \
             patch("coach_orchestrator._recent_coach_messages", return_value=[]), \
             patch("coach_orchestrator._fail_coach_turn") as fail:
            with self.assertRaises(Exception) as raised:
                respond_to_coach(3, "Question", context_loader=lambda: CONTEXT, provider_factory=lambda: self.provider)
        self.assertEqual(raised.exception.status_code, 503)
        self.assertEqual(fail.call_args.kwargs["error_category"], "budget_unavailable")
        self.assertEqual(self.provider.requests, [])

    def test_unknown_historical_cost_budget_failure_prevents_provider_call(self):
        with patch("coach_orchestrator._start_coach_turn", return_value=({}, self.user_message, self.started)), \
             patch("coach_orchestrator._recent_coach_messages", return_value=[]), \
             patch("coach_cost.check_monthly_budget", lambda: (Decimal("1.00"), 1)), \
             patch("coach_orchestrator._fail_coach_turn") as fail:
            with self.assertRaises(Exception) as raised:
                respond_to_coach(3, "Question", context_loader=lambda: CONTEXT, provider_factory=lambda: self.provider)
        self.assertEqual(raised.exception.status_code, 503)
        self.assertEqual(fail.call_args.kwargs["error_category"], "budget_unavailable")
        self.assertEqual(self.provider.requests, [])

    def test_projected_monthly_limit_failure_prevents_provider_call(self):
        with patch("coach_orchestrator._start_coach_turn", return_value=({}, self.user_message, self.started)), \
             patch("coach_orchestrator._recent_coach_messages", return_value=[]), \
             patch("coach_orchestrator.enforce_monthly_budget", side_effect=CostLimitError()), \
             patch("coach_orchestrator._fail_coach_turn") as fail:
            with self.assertRaises(Exception) as raised:
                respond_to_coach(3, "Question", context_loader=lambda: CONTEXT, provider_factory=lambda: self.provider)
        self.assertEqual(raised.exception.status_code, 429)
        self.assertEqual(fail.call_args.kwargs["error_category"], "budget_limit")
        self.assertEqual(self.provider.requests, [])

    def test_context_client_uses_training_api_token_header(self):
        with patch.dict(os.environ, {"TRAINING_API_BASE_URL": "https://training.example", "TRAINING_API_TOKEN": "secret"}, clear=True), \
             patch("context_client.urlopen", return_value=FakeContextResponse(CONTEXT)) as open_url:
            self.assertEqual(fetch_current_context(), CONTEXT)
        request = open_url.call_args.args[0]
        self.assertEqual(request.get_header("X-internal-token"), "secret")
        self.assertNotIn("TRAINING_API_INTERNAL_TOKEN", os.environ)

    def test_context_network_errors_are_classified(self):
        with patch.dict(os.environ, {"TRAINING_API_BASE_URL": "https://training.example", "TRAINING_API_TOKEN": "secret"}, clear=True):
            with patch("context_client.urlopen", side_effect=URLError(socket.timeout())):
                with self.assertRaises(ContextTimeoutError):
                    fetch_current_context()
            with patch("context_client.urlopen", side_effect=URLError(ConnectionRefusedError())):
                with self.assertRaises(ContextUnavailableError):
                    fetch_current_context()

    def test_context_http_errors_are_sanitized(self):
        with patch.dict(os.environ, {"TRAINING_API_BASE_URL": "https://training.example", "TRAINING_API_TOKEN": "secret"}, clear=True):
            for status in (401, 403):
                with patch("context_client.urlopen", side_effect=HTTPError("https://training.example", status, "hidden", {}, None)):
                    with self.assertRaises(ContextAuthError):
                        fetch_current_context()
            with patch("context_client.urlopen", side_effect=HTTPError("https://training.example", 500, "hidden", {}, None)):
                with self.assertRaises(ContextUnavailableError):
                    fetch_current_context()

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
