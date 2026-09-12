import unittest
import asyncio
from decimal import Decimal
import json
import os
import socket
import sys
import types
from datetime import timedelta, timezone
from urllib.error import HTTPError, URLError
from unittest.mock import patch
from types import SimpleNamespace
import zoneinfo

try:
    zoneinfo.ZoneInfo("America/Denver")
except Exception:
    _real_zone_info = zoneinfo.ZoneInfo
    zoneinfo.ZoneInfo = lambda key: (
        timezone(timedelta(hours=-6), key)
        if key == "America/Denver"
        else _real_zone_info(key)
    )

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
        patch = get
        put = get
        delete = get

    fake_fastapi.APIRouter = FakeRouter
    fake_fastapi.Request = object
    fake_responses = types.ModuleType("fastapi.responses")

    class FakeJSONResponse:
        def __init__(self, content, status_code=200):
            self.content = content
            self.status_code = status_code

    fake_responses.JSONResponse = FakeJSONResponse
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
    MonthlyBudgetDisabledError,
    MonthlyBudgetLimitError,
    TurnCostLimitError,
    enforce_monthly_budget,
    estimated_cost,
    preflight_cost,
    pricing_for_model,
)
from coach_orchestrator import _build_input, respond_to_coach, validate_reasoning_effort
from coach_policy import COACH_POLICY
from routes.coach_settings import CoachSettings, CoachSettingsUnavailableError, validate_coach_settings
from routes.coach_settings import get_ai_coach_settings, update_ai_coach_settings
from routes.coach_custom_instructions import CustomInstructions, CustomInstructionsUnavailableError
from context_client import (
    ContextAuthError,
    ContextInvalidResponseError,
    ContextUnavailableError,
    ContextTimeoutError,
    fetch_current_context,
)
from openai_adapter import OpenAIProvider, _reasoning_argument
from routes.coach import (
    CoachActiveTurn,
    CoachSessionArchived,
    CoachSessionNotFound,
    DEFAULT_SESSION_TITLE,
    _auto_title_session,
    _derive_session_title,
    get_coach_session,
    update_coach_session,
)


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

TEMPORAL_CONTEXT = {
    **CONTEXT,
    "as_of": {
        "timezone": "America/Denver",
        "current_date": "2026-09-08",
        "response_generated_at": "2026-09-08T13:59:08.357321-06:00",
    },
    "recent_days": [
        {"date": "2026-09-08", "activity": "Morning Walk"},
        {"date": "2026-09-07", "activity": "Virginia Canyon ride"},
    ],
    "recovery_history": [
        {"date": "2026-09-07", "weight": 197.0, "sleep_hours": 8.17},
        {"date": "2026-09-08", "weight": 199.2, "sleep_hours": 6.40},
    ],
    "athlete_narrative": {
        "injury": "Calf injury tied to the 2026-09-07 Virginia Canyon ride"
    },
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


class FakeResponsesClient:
    def __init__(self):
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(
            output_text="Coach response",
            model="gpt-5.6-luna",
            id="resp-1",
            status="completed",
            usage=None,
        )


class FakeOpenAIClient:
    def __init__(self):
        self.responses = FakeResponsesClient()


class OpenAIAdapterTests(unittest.TestCase):
    def test_complete_disables_provider_managed_storage_without_network_call(self):
        provider = OpenAIProvider.__new__(OpenAIProvider)
        provider._client = FakeOpenAIClient()
        provider.model = "gpt-5.6-luna"

        response = provider.complete(
            AIRequest(
                model="gpt-5.6-luna",
                instructions="Be concise.",
                input_text="Question",
                max_output_tokens=100,
                timeout_seconds=5.0,
            )
        )

        self.assertEqual(response.text, "Coach response")
        self.assertEqual(provider._client.responses.calls[0]["store"], False)


class CoachPolicyTests(unittest.TestCase):
    def test_policy_compresses_follow_ups_without_dropping_safety_guidance(self):
        policy = COACH_POLICY.lower()
        for requirement in (
            "initial question",
            "follow-up",
            "focus on what changed",
            "do not repeat unchanged",
            "active injury restrictions",
            "clinician guidance",
            "urgent safety information",
            "one concise follow-up question",
        ):
            self.assertIn(requirement, policy)

    def test_temporal_reference_derives_dates_and_preserves_context(self):
        input_text, context_characters, _ = _build_input(TEMPORAL_CONTEXT, [], "What happened yesterday?")

        self.assertIn("Current local date: Tuesday, 2026-09-08", input_text)
        self.assertIn("Today: 2026-09-08", input_text)
        self.assertIn("Yesterday: 2026-09-07", input_text)
        self.assertIn("Tomorrow: 2026-09-09", input_text)
        self.assertIn("Context generated at: 2026-09-08T13:59:08.357321-06:00", input_text)
        self.assertIn('"activity":"Morning Walk"', input_text)
        self.assertIn('"activity":"Virginia Canyon ride"', input_text)
        self.assertIn('"date":"2026-09-08","sleep_hours":6.4,"weight":199.2', input_text)
        self.assertIn('"date":"2026-09-07","sleep_hours":8.17,"weight":197.0', input_text)
        self.assertIn("Calf injury tied to the 2026-09-07 Virginia Canyon ride", input_text)
        expected_context_json = json.dumps(TEMPORAL_CONTEXT, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
        self.assertEqual(context_characters, len(expected_context_json))

    def test_invalid_current_date_does_not_use_server_date(self):
        invalid_context = {**TEMPORAL_CONTEXT, "as_of": {"current_date": "not-a-date"}}

        input_text, _, _ = _build_input(invalid_context, [], "What happened yesterday?")

        self.assertIn("Current local date: unavailable; relative dates are unavailable", input_text)
        self.assertNotIn("Yesterday: 2026-09-07", input_text)
        self.assertNotIn("Tomorrow: 2026-09-09", input_text)

    def test_policy_matches_temporal_facts_by_explicit_date(self):
        policy = COACH_POLICY.lower()
        for requirement in (
            "temporal reference",
            "today, yesterday, and tomorrow",
            "explicit date",
            "adjacent array position",
            "relevant calendar dates",
            "acknowledge the uncertainty rather than guessing",
        ):
            self.assertIn(requirement, policy)

    def test_request_assembly_distinguishes_initial_and_follow_up_history(self):
        initial_input, _, _ = _build_input(CONTEXT, [], "Initial question")
        follow_up_history = [{"role": "assistant", "message_text": "Prior answer"}]
        follow_up_input, _, _ = _build_input(CONTEXT, follow_up_history, "New information")

        self.assertIn("Recent conversation:\n[]", initial_input)
        self.assertIn('"message_text":"Prior answer"', follow_up_input)
        self.assertIn("Current question:\nNew information", follow_up_input)

    def test_provider_input_preserves_complete_role_bearing_history(self):
        history = [
            {"role": "user", "message_text": "I asked about the Denna."},
            {"role": "assistant", "message_text": "The prior answer mentioned the Wild and Rallon."},
        ]
        input_text, _, _ = _build_input(CONTEXT, history, "What about tomorrow?")
        self.assertIn('"role":"user"', input_text)
        self.assertIn('"role":"assistant"', input_text)
        self.assertIn("The prior answer mentioned the Wild and Rallon.", input_text)


class CoachSettingsTests(unittest.TestCase):
    def test_seed_defaults_and_server_boundaries_validate(self):
        settings = validate_coach_settings({
            "monthly_cost_limit_usd": Decimal("5.00"),
            "max_turn_cost_usd": Decimal("0.25"),
            "max_output_tokens": 1200,
            "reasoning_effort": "low",
        })
        self.assertEqual(settings["monthly_cost_limit_usd"], Decimal("5.00"))
        self.assertEqual(validate_coach_settings({
            "monthly_cost_limit_usd": Decimal("0.00"),
            "max_turn_cost_usd": Decimal("1.00"),
            "max_output_tokens": 8000,
            "reasoning_effort": "high",
        })["max_output_tokens"], 8000)

    def test_invalid_settings_reject_boundaries_booleans_and_fields(self):
        base = {
            "monthly_cost_limit_usd": Decimal("5.00"),
            "max_turn_cost_usd": Decimal("0.25"),
            "max_output_tokens": 1200,
            "reasoning_effort": "low",
        }
        for field, value in (
            ("monthly_cost_limit_usd", Decimal("25.01")),
            ("max_turn_cost_usd", Decimal("1.01")),
            ("max_output_tokens", 8001),
            ("reasoning_effort", "unsupported"),
            ("max_output_tokens", True),
        ):
            payload = {**base, field: value}
            with self.assertRaises(ValueError):
                validate_coach_settings(payload)
        with self.assertRaises(ValueError):
            validate_coach_settings({**base, "unexpected": 1})
        with self.assertRaises(ValueError):
            validate_coach_settings({key: value for key, value in base.items() if key != "reasoning_effort"})

    def test_get_serializes_money_and_updated_at_without_provider(self):
        row = {
            "monthly_cost_limit_usd": Decimal("5.00"),
            "max_turn_cost_usd": Decimal("0.25"),
            "max_output_tokens": 1200,
            "reasoning_effort": "low",
            "updated_at": __import__("datetime").datetime(2026, 9, 8, 12, 0),
        }

        class Cursor:
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def execute(self, query): self.query = query
            def fetchone(self): return row

        class Connection:
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def cursor(self): return Cursor()

        with patch("routes.coach_settings.db_conn", return_value=Connection()):
            result = get_ai_coach_settings()
        self.assertEqual(result["monthly_cost_limit_usd"], "5.00")
        self.assertEqual(result["max_output_tokens"], 1200)
        self.assertEqual(result["updated_at"], "2026-09-08T12:00:00")

    def test_update_is_parameterized_and_scoped_to_singleton(self):
        row = {
            "monthly_cost_limit_usd": Decimal("0.00"),
            "max_turn_cost_usd": Decimal("1.00"),
            "max_output_tokens": 8000,
            "reasoning_effort": "high",
            "updated_at": __import__("datetime").datetime(2026, 9, 8, 12, 0),
        }

        class Request:
            async def json(self):
                return {
                    "monthly_cost_limit_usd": "0.00",
                    "max_turn_cost_usd": "1.00",
                    "max_output_tokens": 8000,
                    "reasoning_effort": "high",
                }

        class Cursor:
            def __init__(self): self.calls = []
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def execute(self, query, params): self.calls.append((query, params))
            def fetchone(self): return row

        class Connection:
            def __init__(self): self.cursor_instance = Cursor(); self.committed = False
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def cursor(self): return self.cursor_instance
            def commit(self): self.committed = True

        connection = Connection()
        with patch("routes.coach_settings.db_conn", return_value=connection):
            result = asyncio.run(update_ai_coach_settings(Request()))
        query, params = connection.cursor_instance.calls[0]
        self.assertTrue(connection.committed)
        self.assertEqual(result["max_output_tokens"], 8000)
        self.assertEqual(params, (Decimal("0.00"), Decimal("1.00"), 8000, "high"))
        self.assertIn("WHERE settings_id = 1", query)
        self.assertIn("%s", query)

    def test_persistence_failure_is_sanitized(self):
        with patch("routes.coach_settings.db_conn", side_effect=RuntimeError("hidden database error")):
            result = get_ai_coach_settings()
        self.assertEqual(result.status_code, 503)
        self.assertEqual(result.content["detail"], "AI Coach settings are unavailable.")


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
        self.settings = CoachSettings(
            monthly_cost_limit_usd=Decimal("5.00"),
            max_turn_cost_usd=Decimal("0.25"),
            max_output_tokens=1200,
            reasoning_effort="low",
            updated_at="2026-09-08T00:00:00+00:00",
        )
        settings_patch = patch("coach_orchestrator.load_coach_settings", return_value=self.settings)
        settings_patch.start()
        self.addCleanup(settings_patch.stop)
        instructions_patch = patch(
            "coach_orchestrator.load_custom_instructions",
            return_value=CustomInstructions(
                "", "", "", "", "", "", "", "2026-09-08T00:00:00+00:00"
            ),
        )
        instructions_patch.start()
        self.addCleanup(instructions_patch.stop)
        receipt_patch = patch("coach_orchestrator.persist_receipt")
        receipt_patch.start()
        self.addCleanup(receipt_patch.stop)

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

    def test_persisted_settings_reach_request_and_cost_guards(self):
        settings = CoachSettings(
            monthly_cost_limit_usd=Decimal("10.00"),
            max_turn_cost_usd=Decimal("1.00"),
            max_output_tokens=8000,
            reasoning_effort="high",
            updated_at="2026-09-08T00:00:00+00:00",
        )
        with patch("coach_orchestrator._start_coach_turn", return_value=({}, self.user_message, self.started)), \
             patch("coach_orchestrator._recent_coach_messages", return_value=[]), \
             patch("coach_orchestrator._complete_coach_turn", return_value=({"coach_message_id": 11}, self.completed)), \
             patch("coach_orchestrator._coach_session_snapshot", return_value={"total_tokens": 130}), \
             patch("coach_orchestrator.preflight_cost", return_value=Decimal("0.10")) as preflight, \
             patch("coach_orchestrator.enforce_monthly_budget", return_value={"recorded_cost_usd": Decimal("0"), "unknown_cost_count": 0}) as monthly, \
             patch("coach_orchestrator._fail_coach_turn"):
            respond_to_coach(
                3,
                "Question",
                context_loader=lambda: CONTEXT,
                provider_factory=lambda: self.provider,
                settings_loader=lambda: settings,
            )

        request = self.provider.requests[0]
        self.assertEqual(request.max_output_tokens, 8000)
        self.assertEqual(request.reasoning_effort, "high")
        preflight.assert_called_once_with("gpt-5.6-luna", unittest.mock.ANY, 8000, Decimal("1.00"))
        monthly.assert_called_once_with(Decimal("0.10"), Decimal("10.00"))

    def test_custom_instructions_reach_provider_after_policy_and_cost_accounting(self):
        instructions = CustomInstructions(
            "Safety first.", "", "", "", "Keep it direct.", "", "", "now"
        )
        with patch("coach_orchestrator.load_custom_instructions", return_value=instructions), \
             patch("coach_orchestrator._start_coach_turn", return_value=({}, self.user_message, self.started)), \
             patch("coach_orchestrator._recent_coach_messages", return_value=[]), \
             patch("coach_orchestrator._complete_coach_turn", return_value=({"coach_message_id": 11}, self.completed)), \
             patch("coach_orchestrator._coach_session_snapshot", return_value={}), \
             patch("coach_orchestrator.preflight_cost", return_value=Decimal("0.10")) as preflight, \
             patch("coach_orchestrator.enforce_monthly_budget", return_value={"recorded_cost_usd": Decimal("0"), "unknown_cost_count": 0}), \
             patch("coach_orchestrator._fail_coach_turn"):
            respond_to_coach(3, "Question", context_loader=lambda: CONTEXT, provider_factory=lambda: self.provider)

        request = self.provider.requests[0]
        self.assertTrue(request.instructions.startswith(COACH_POLICY))
        self.assertLess(request.instructions.index(COACH_POLICY), request.instructions.index("Coaching priorities:"))
        self.assertIn("Safety first.", request.instructions)
        self.assertIn("Keep it direct.", request.instructions)
        self.assertEqual(preflight.call_args.args[1], len(request.input_text) + len(request.instructions))

    def test_custom_instructions_failure_reconciles_turn_before_provider(self):
        with patch("coach_orchestrator._start_coach_turn", return_value=({}, self.user_message, self.started)), \
             patch("coach_orchestrator._recent_coach_messages", return_value=[]), \
             patch("coach_orchestrator.load_custom_instructions", side_effect=CustomInstructionsUnavailableError()), \
             patch("coach_orchestrator._fail_coach_turn") as fail:
            with self.assertRaises(Exception) as raised:
                respond_to_coach(3, "Question", context_loader=lambda: CONTEXT, provider_factory=lambda: self.provider)
        self.assertEqual(raised.exception.status_code, 503)
        self.assertEqual(raised.exception.category, "custom_instructions_unavailable")
        self.assertEqual(fail.call_args.kwargs["error_category"], "custom_instructions_unavailable")
        self.assertEqual(self.provider.requests, [])

    def test_zero_monthly_limit_blocks_provider(self):
        settings = CoachSettings(Decimal("0.00"), Decimal("1.00"), 1200, "low", "now")
        with patch("coach_orchestrator._start_coach_turn", return_value=({}, self.user_message, self.started)), \
             patch("coach_orchestrator._recent_coach_messages", return_value=[]), \
             patch("coach_orchestrator.enforce_monthly_budget", side_effect=CostLimitError()), \
             patch("coach_orchestrator._fail_coach_turn") as fail:
            with self.assertRaises(Exception) as raised:
                respond_to_coach(3, "Question", context_loader=lambda: CONTEXT,
                                 provider_factory=lambda: self.provider,
                                 settings_loader=lambda: settings)
        self.assertEqual(raised.exception.status_code, 429)
        self.assertEqual(fail.call_args.kwargs["error_category"], "budget_limit")
        self.assertEqual(self.provider.requests, [])

    def test_unavailable_settings_blocks_provider_and_reconciles_turn(self):
        with patch("coach_orchestrator._start_coach_turn", return_value=({}, self.user_message, self.started)), \
               patch("coach_orchestrator._recent_coach_messages", return_value=[]), \
             patch("coach_orchestrator._fail_coach_turn") as fail:
            with self.assertRaises(Exception) as raised:
                respond_to_coach(3, "Question", context_loader=lambda: CONTEXT,
                                 provider_factory=lambda: self.provider,
                                 settings_loader=lambda: (_ for _ in ()).throw(CoachSettingsUnavailableError()))
        self.assertEqual(raised.exception.status_code, 503)
        self.assertEqual(fail.call_args.kwargs["error_category"], "settings_unavailable")
        self.assertEqual(self.provider.requests, [])

    def test_session_title_derivation_normalizes_and_bounds_text(self):
        self.assertEqual(
            _derive_session_title("  How\n am I doing this week?  "),
            "How am I doing this week?",
        )
        self.assertEqual(
            _derive_session_title("# How am I doing this week?"),
            "How am I doing this week?",
        )
        title = _derive_session_title("This is a deliberately long question that should stop at a complete word boundary without leaking more text")
        self.assertLessEqual(len(title), 60)
        self.assertTrue(title.endswith("..."))
        self.assertNotIn(" ", title[-4:-3])
        self.assertEqual(_derive_session_title("\n`  `"), DEFAULT_SESSION_TITLE)

    def test_auto_title_uses_parameterized_guard_and_does_not_touch_activity(self):
        class FakeCursor:
            rowcount = 1

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc_value, traceback):
                return False

            def execute(self, query, params):
                self.query = query
                self.params = params

        class FakeConnection:
            def __init__(self):
                self.cursor_instance = FakeCursor()

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc_value, traceback):
                return False

            def cursor(self):
                return self.cursor_instance

            def commit(self):
                pass

        connection = FakeConnection()
        with patch("routes.coach.db_conn", return_value=connection):
            self.assertTrue(_auto_title_session(3, 10, "How am I doing this week?"))
        self.assertEqual(connection.cursor_instance.params, (
            "How am I doing this week?", 3, DEFAULT_SESSION_TITLE, 3, 10,
        ))
        self.assertIn("NOT EXISTS", connection.cursor_instance.query)
        self.assertIn("SET title = %s, updated_at = now()", connection.cursor_instance.query)
        self.assertNotIn("last_activity_at", connection.cursor_instance.query)

    def test_auto_title_guard_returns_false_after_manual_rename(self):
        class FakeCursor:
            rowcount = 0

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc_value, traceback):
                return False

            def execute(self, query, params):
                pass

        class FakeConnection:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc_value, traceback):
                return False

            def cursor(self):
                return FakeCursor()

            def commit(self):
                pass

        with patch("routes.coach.db_conn", return_value=FakeConnection()):
            self.assertFalse(_auto_title_session(3, 10, "A later question"))

    def test_patch_session_title_validates_and_returns_public_session(self):
        class FakeRequest:
            async def json(self):
                return {"title": "Calf recovery plan"}

        session = {
            "coach_session_id": 3,
            "title": "Calf recovery plan",
            "status": "active",
            "provider": None,
            "default_model": None,
            "coaching_policy_version": "coach-v1",
            "last_activity_at": None,
            "created_at": None,
            "updated_at": None,
        }

        class FakeCursor:
            def __init__(self):
                self.queries = []

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc_value, traceback):
                return False

            def execute(self, query, params):
                self.queries.append((query, params))

            def fetchone(self):
                return session

        class FakeConnection:
            def __init__(self):
                self.cursor_instance = FakeCursor()
                self.committed = False

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc_value, traceback):
                return False

            def cursor(self):
                return self.cursor_instance

            def commit(self):
                self.committed = True

        connection = FakeConnection()
        with patch("routes.coach.db_conn", return_value=connection):
            result = asyncio.run(update_coach_session("3", FakeRequest()))
        self.assertEqual(result["session"]["title"], "Calf recovery plan")
        self.assertTrue(connection.committed)
        query, params = connection.cursor_instance.queries[0]
        self.assertEqual(params, ("Calf recovery plan", 3))
        self.assertIn("SET title = %s, updated_at = now()", query)
        self.assertNotIn("last_activity_at =", query)

    def test_patch_session_title_rejects_invalid_and_unknown_requests(self):
        class FakeRequest:
            def __init__(self, payload):
                self.payload = payload

            async def json(self):
                return self.payload

        for payload in ({"title": " "}, {"title": 4}, {"title": "x" * 201}):
            result = asyncio.run(update_coach_session("3", FakeRequest(payload)))
            self.assertEqual(result.status_code, 400)

        result = asyncio.run(update_coach_session("0", FakeRequest({"title": "Valid"})))
        self.assertEqual(result.status_code, 400)

        class EmptyCursor:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc_value, traceback):
                return False

            def execute(self, query, params):
                pass

            def fetchone(self):
                return None

        class EmptyConnection:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc_value, traceback):
                return False

            def cursor(self):
                return EmptyCursor()

            def rollback(self):
                pass

        with patch("routes.coach.db_conn", return_value=EmptyConnection()):
            result = asyncio.run(update_coach_session("3", FakeRequest({"title": "Missing"})))
        self.assertEqual(result.status_code, 404)

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
        self.assertEqual(preflight_cost("gpt-5.6-luna", 1000, 300, Decimal("0.25")), Decimal("0.000560"))
        with self.assertRaises(BudgetUnavailableError):
            preflight_cost("other-model", 1000, 300, Decimal("0.25"))

    def test_monthly_budget_rejects_unknown_historical_costs(self):
        with patch("coach_cost.check_monthly_budget", lambda: (Decimal("1.00"), 1)):
            with self.assertRaises(BudgetUnavailableError):
                enforce_monthly_budget(Decimal("0.01"), Decimal("5.00"))

    def test_malformed_proposed_cost_remains_budget_unavailable(self):
        with self.assertRaises(BudgetUnavailableError):
            enforce_monthly_budget("not-a-cost", Decimal("5.00"))

    def test_nonfinite_accounting_cost_remains_budget_unavailable(self):
        with patch("coach_cost.check_monthly_budget", return_value=(Decimal("NaN"), 0)):
            with self.assertRaises(BudgetUnavailableError):
                enforce_monthly_budget(Decimal("0.01"), Decimal("5.00"))

    def test_zero_monthly_budget_short_circuits_accounting(self):
        with patch("coach_cost.check_monthly_budget") as check_budget:
            with self.assertRaises(MonthlyBudgetDisabledError):
                enforce_monthly_budget(Decimal("0.01"), Decimal("0.00"))
        check_budget.assert_not_called()

    def test_monthly_budget_rejection_has_distinct_reason(self):
        with patch("coach_cost.check_monthly_budget", return_value=(Decimal("5.00"), 0)):
            with self.assertRaises(MonthlyBudgetLimitError):
                enforce_monthly_budget(Decimal("0.00"), Decimal("5.00"))
        with patch("coach_cost.check_monthly_budget", return_value=(Decimal("4.99"), 0)):
            with self.assertRaises(MonthlyBudgetLimitError):
                enforce_monthly_budget(Decimal("0.02"), Decimal("5.00"))

    def test_preflight_rejection_has_distinct_per_turn_reason(self):
        with self.assertRaises(TurnCostLimitError):
            preflight_cost("gpt-5.6-luna", 2_000_000, 300, Decimal("0.25"))

    def test_budget_error_messages_are_actionable_and_provider_is_not_called(self):
        cases = (
            (
                MonthlyBudgetDisabledError(),
                "budget_disabled",
                "AI Coach is paused because the monthly budget limit is $0.00. Update it in Settings > AI Coach.",
            ),
            (
                MonthlyBudgetLimitError(),
                "monthly_budget_limit",
                "The AI Coach monthly budget has been reached. Increase the limit in Settings > AI Coach or wait until next month.",
            ),
            (
                TurnCostLimitError(),
                "turn_cost_limit",
                "This response exceeds the maximum estimated cost per turn. Increase the limit in Settings > AI Coach or request a shorter response.",
            ),
        )
        for error, category, detail in cases:
            with self.subTest(category=category), \
                 patch("coach_orchestrator._start_coach_turn", return_value=({}, self.user_message, self.started)), \
                 patch("coach_orchestrator._recent_coach_messages", return_value=[]), \
                 patch("coach_orchestrator.preflight_cost", side_effect=error) as preflight, \
                 patch("coach_orchestrator._fail_coach_turn") as fail:
                with self.assertRaises(Exception) as raised:
                    respond_to_coach(
                        3,
                        "Question",
                        context_loader=lambda: CONTEXT,
                        provider_factory=lambda: self.provider,
                    )
            self.assertEqual(raised.exception.status_code, 429)
            self.assertEqual(raised.exception.category, category)
            self.assertEqual(raised.exception.detail, detail)
            self.assertEqual(fail.call_args.kwargs["error_category"], category)
            preflight.assert_called_once()
            self.assertEqual(self.provider.requests, [])

    def test_unavailable_budget_remains_generic_and_distinct(self):
        with patch("coach_orchestrator._start_coach_turn", return_value=({}, self.user_message, self.started)), \
             patch("coach_orchestrator._recent_coach_messages", return_value=[]), \
             patch("coach_orchestrator.preflight_cost", side_effect=BudgetUnavailableError()), \
             patch("coach_orchestrator._fail_coach_turn") as fail:
            with self.assertRaises(Exception) as raised:
                respond_to_coach(3, "Question", context_loader=lambda: CONTEXT, provider_factory=lambda: self.provider)
        self.assertEqual(raised.exception.status_code, 503)
        self.assertEqual(raised.exception.category, "budget_unavailable")
        self.assertEqual(raised.exception.detail, "Coach budget status is unavailable.")
        self.assertEqual(fail.call_args.kwargs["error_category"], "budget_unavailable")
        self.assertEqual(self.provider.requests, [])

    def test_monthly_budget_allows_exact_ceiling_and_rejects_overage(self):
        with patch("coach_cost.check_monthly_budget", lambda: (Decimal("4.99"), 0)):
            enforce_monthly_budget(Decimal("0.01"), Decimal("5.00"))
        with patch("coach_cost.check_monthly_budget", lambda: (Decimal("4.99"), 0)):
            with self.assertRaises(CostLimitError):
                enforce_monthly_budget(Decimal("0.02"), Decimal("5.00"))
        with patch("coach_cost.check_monthly_budget", lambda: (Decimal("5.00"), 0)):
            with self.assertRaises(CostLimitError):
                enforce_monthly_budget(Decimal("0"), Decimal("5.00"))

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

    def test_session_detail_returns_bounded_turn_metadata_without_private_fields(self):
        session = {
            "coach_session_id": 3,
            "title": "Injury check-in",
            "status": "active",
            "provider": "fake",
            "default_model": "gpt-5.6-luna",
            "coaching_policy_version": "coach-v1",
            "summary": None,
            "summary_through_message_id": None,
            "compacted_at": None,
            "compaction_count": 0,
            "last_provider_response_id": None,
            "last_activity_at": None,
            "created_at": None,
            "updated_at": None,
        }
        messages = [{
            "coach_message_id": 11,
            "coach_session_id": 3,
            "role": "assistant",
            "message_kind": "text",
            "message_text": "Take an easy day.",
            "structured_payload": None,
            "created_at": None,
        }]
        turns = [{
            "assistant_message_id": 11,
            "provider": "fake",
            "model": "gpt-5.6-luna",
            "status": "completed",
            "elapsed_ms": 9900,
            "total_tokens": 32700,
            "estimated_cost_usd": Decimal("0.0073"),
        }]
        usage = {
            "message_count": 1,
            "turn_count": 1,
            "completed_turn_count": 1,
            "failed_turn_count": 0,
            "timed_out_turn_count": 0,
            "input_tokens": 100,
            "cached_input_tokens": 0,
            "output_tokens": 100,
            "reasoning_tokens": 0,
            "total_tokens": 200,
            "estimated_cost_usd": Decimal("0.0073"),
            "latest_turn_status": "completed",
            "latest_input_tokens": 100,
            "latest_cached_input_tokens": 0,
            "latest_output_tokens": 100,
            "latest_reasoning_tokens": 0,
            "latest_total_tokens": 200,
            "latest_estimated_cost_usd": Decimal("0.0073"),
        }

        class FakeCursor:
            def __init__(self):
                self.results = iter([session, messages, turns, usage])
                self.queries = []

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc_value, traceback):
                return False

            def execute(self, query, params):
                self.queries.append((query, params))

            def fetchone(self):
                return next(self.results) if len(self.queries) == 1 or len(self.queries) == 4 else None

            def fetchall(self):
                return next(self.results)

        class FakeConnection:
            def __init__(self):
                self.cursor_instance = FakeCursor()

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc_value, traceback):
                return False

            def cursor(self):
                return self.cursor_instance

        connection = FakeConnection()
        with patch("routes.coach.db_conn", return_value=connection):
            result = get_coach_session("3")

        self.assertEqual(set(result), {"session", "messages", "usage", "turns"})
        self.assertEqual(result["turns"], [{
            "assistant_message_id": 11,
            "provider": "fake",
            "model": "gpt-5.6-luna",
            "status": "completed",
            "elapsed_ms": 9900,
            "total_tokens": 32700,
            "estimated_cost_usd": 0.0073,
        }])
        self.assertNotIn("request_id", result["turns"][0])
        self.assertEqual(len(connection.cursor_instance.queries), 4)
        self.assertIn("LIMIT", connection.cursor_instance.queries[2][0])


if __name__ == "__main__":
    unittest.main()
