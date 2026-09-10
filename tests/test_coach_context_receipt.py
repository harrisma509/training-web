import sys
import types
import unittest
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
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
        patch = get
        put = get

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

from coach_context_receipt import (
    COVERAGE_KEYS,
    RECEIPT_KEYS,
    ContextReceiptConflict,
    ContextReceiptInvalid,
    ContextReceiptUnavailable,
    build_receipt,
    load_receipt,
    persist_receipt,
    receipt_response,
    validate_receipt,
)
from coach_memory_router import CriticalMemoryOverflowError, route_evidence
from coach_orchestrator import respond_to_coach
from routes.coach_custom_instructions import CustomInstructions
from routes.coach_memories import DurableMemoriesUnavailableError
from routes.coach_settings import CoachSettings


DENVER = timezone(timedelta(hours=-6), "America/Denver")
NOW = datetime(2026, 9, 9, 12, 0, tzinfo=DENVER)
CONTEXT = {
    "week_progress": {"data_through_date": "2026-09-09"},
    "coverage": {
        "detailed_daily_days_returned": 10,
        "weekly_rows_returned": 12,
        "fitness_fatigue_form_days_returned": 90,
        "recovery_days_requested": 28,
        "current_audit_available": True,
        "latest_completed_audit_available": True,
        "missing_sources": [],
    },
    "recent_days": [],
    "athlete_narrative": {},
}


def selected_memory(memory_id=1, title="Recovery rule"):
    return {
        "memory_id": memory_id,
        "title": title,
        "memory_type": "safety",
        "memory_text": "Pain changes the recommendation.",
        "applies_to": ["all_training", "recovery"],
        "priority": "high",
        "effective_date": None,
        "expires_at": None,
        "is_active": True,
        "created_at": NOW,
        "updated_at": NOW,
    }


def response():
    return SimpleNamespace(
        text="Coach response",
        provider="fake",
        model="gpt-5.6-luna",
        provider_response_id="response-1",
        input_tokens=10,
        cached_input_tokens=0,
        output_tokens=5,
        reasoning_tokens=0,
        total_tokens=15,
        elapsed_ms=1,
        finish_status="completed",
    )


class FakeProvider:
    model = "gpt-5.6-luna"

    def __init__(self, error=None, events=None):
        self.error = error
        self.events = events if events is not None else []
        self.requests = []

    def complete(self, request):
        self.events.append("provider")
        self.requests.append(request)
        if self.error:
            raise self.error
        return response()


class ReceiptContractTests(unittest.TestCase):
    def test_builds_exact_v1_shape_and_excludes_memory_details(self):
        evidence = route_evidence("How is recovery?", [], CONTEXT)
        receipt = build_receipt([selected_memory()], evidence, CONTEXT, [], True)

        self.assertEqual(set(receipt), set(RECEIPT_KEYS))
        self.assertEqual(set(receipt["context_coverage"]), set(COVERAGE_KEYS))
        snapshot = receipt["selected_memories"][0]
        self.assertEqual(set(snapshot), {"memory_id", "title", "memory_type", "priority", "selection_reasons"})
        self.assertNotIn("memory_text", snapshot)
        self.assertNotIn("applies_to", snapshot)
        self.assertNotIn("effective_date", snapshot)
        self.assertNotIn("created_at", snapshot)
        self.assertNotIn("updated_at", snapshot)

    def test_reasons_and_scopes_are_canonical(self):
        context = {**CONTEXT, "athlete_narrative": {"current_week": {"is_injury_week": True}}}
        evidence = route_evidence("How is recovery?", [], context)
        receipt = build_receipt([selected_memory()], evidence, context, [], False)

        self.assertEqual(receipt["active_scopes"], ["all_training", "recovery"])
        self.assertEqual(receipt["selected_memories"][0]["selection_reasons"], [
            "high_all_training_safety",
            "current_question_match",
            "authoritative_context_match",
            "all_training_match",
        ])

    def test_supporting_recent_entities_are_not_receipt_active_scopes(self):
        context = {"recent_days": [{"main_ride_bike_name": "Denna"}]}
        evidence = route_evidence("When is my surgery?", [], context)
        receipt = build_receipt([], evidence, context, [], False)
        self.assertEqual(receipt["active_scopes"], ["all_training", "recovery"])

    def test_missing_coverage_stays_unknown(self):
        receipt = build_receipt([], route_evidence("Question", [], {}), {}, [], False)
        coverage = receipt["context_coverage"]
        self.assertIsNone(coverage["data_through_date"])
        self.assertIsNone(coverage["detailed_activity_days"])
        self.assertIsNone(coverage["current_audit_available"])
        self.assertEqual(coverage["missing_sources"], [])

    def test_validation_rejects_unknown_keys_bad_booleans_and_bad_reasons(self):
        receipt = build_receipt([], route_evidence("Question", [], {}), {}, [], False)
        with self.assertRaises(ContextReceiptInvalid):
            validate_receipt({**receipt, "unknown": True})
        with self.assertRaises(ContextReceiptInvalid):
            validate_receipt({**receipt, "custom_instructions_included": 1})
        invalid_memory = selected_memory()
        invalid_memory["selection_reasons"] = ["not-approved"]
        bad = build_receipt([], route_evidence("Question", [], {}), {}, [], False)
        bad["selected_memories"] = [{
            "memory_id": 1,
            "title": "Title",
            "memory_type": "safety",
            "priority": "high",
            "selection_reasons": ["not-approved"],
        }]
        with self.assertRaises(ContextReceiptInvalid):
            validate_receipt(bad)

    def test_validation_rejects_receipt_over_16000_characters(self):
        receipt = build_receipt([], route_evidence("Question", [], {}), {}, [], False)
        receipt["selected_memories"] = [{
            "memory_id": 1,
            "title": "x" * 16_000,
            "memory_type": "safety",
            "priority": "high",
            "selection_reasons": ["all_training_match"],
        }]
        with self.assertRaises(ContextReceiptInvalid):
            validate_receipt(receipt)


class FakeCursor:
    def __init__(self, row=None, error=None):
        self.row = row
        self.error = error
        self.calls = []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, query, params=None):
        if self.error:
            raise self.error
        self.calls.append((query, params))

    def fetchone(self):
        return self.row


class FakeConnection:
    def __init__(self, cursor):
        self.cursor_value = cursor
        self.committed = False

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def cursor(self):
        return self.cursor_value

    def commit(self):
        self.committed = True


class ReceiptPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.receipt = build_receipt([], route_evidence("Question", [], {}), {}, [], False)

    def test_persistence_uses_parameterized_insert_and_commits(self):
        cursor = FakeCursor()
        connection = FakeConnection(cursor)
        with patch("coach_context_receipt.db_conn", return_value=connection):
            persist_receipt(9, self.receipt)
        self.assertEqual(len(cursor.calls), 1)
        self.assertIn("INSERT INTO public.ai_coach_turn_context_receipts", cursor.calls[0][0])
        self.assertEqual(cursor.calls[0][1][0], 9)
        self.assertTrue(connection.committed)

    def test_duplicate_and_database_failures_are_classified(self):
        duplicate_cursor = FakeCursor(error=__import__("coach_context_receipt").UniqueViolation())
        with patch("coach_context_receipt.db_conn", return_value=FakeConnection(duplicate_cursor)):
            with self.assertRaises(ContextReceiptConflict):
                persist_receipt(9, self.receipt)
        failed_cursor = FakeCursor(error=RuntimeError("hidden"))
        with patch("coach_context_receipt.db_conn", return_value=FakeConnection(failed_cursor)):
            with self.assertRaises(ContextReceiptUnavailable):
                persist_receipt(9, self.receipt)

    def test_retrieval_returns_historical_receipt_without_routing(self):
        row = {
            "coach_turn_id": 9,
            "receipt_version": 1,
            "receipt_json": self.receipt,
            "created_at": NOW,
        }
        cursor = FakeCursor(row=row)
        with patch("coach_context_receipt.db_conn", return_value=FakeConnection(cursor)), \
               patch("coach_context_receipt.validate_receipt", wraps=validate_receipt) as validate:
            result = load_receipt(9)
        self.assertEqual(result["receipt_json"], self.receipt)
        self.assertEqual(result["created_at"], NOW.isoformat())
        validate.assert_called_once_with(self.receipt)

    def test_malformed_or_unsupported_stored_receipt_is_unavailable(self):
        row = {"coach_turn_id": 9, "receipt_version": 2, "receipt_json": {}, "created_at": NOW}
        with self.assertRaises(ContextReceiptUnavailable):
            receipt_response(row)
        row["receipt_version"] = 1
        with self.assertRaises(ContextReceiptUnavailable):
            receipt_response(row)


class OrchestrationReceiptTests(unittest.TestCase):
    def setUp(self):
        self.started = {"coach_turn_id": 9}
        self.user_message = {"coach_message_id": 10, "coach_session_id": 3, "message_text": "Question"}
        self.settings = CoachSettings(Decimal("5.00"), Decimal("0.25"), 1200, "low", "now")
        self.instructions = CustomInstructions("", "", "", "", "", "", "", "now")

    def invoke(self, provider, receipt_persistor, *, context=None, load_memories=None, preflight=None, capacity=None):
        events = []

        @contextmanager
        def default_capacity():
            events.append("capacity_enter")
            try:
                yield
            finally:
                events.append("capacity_exit")

        capacity = capacity or default_capacity
        with patch("coach_orchestrator._start_coach_turn", return_value=({}, self.user_message, self.started)), \
             patch("coach_orchestrator._recent_coach_messages", return_value=[]), \
             patch("coach_orchestrator._complete_coach_turn", return_value=({}, {})), \
             patch("coach_orchestrator._coach_session_snapshot", return_value={}), \
             patch("coach_orchestrator.enforce_monthly_budget"), \
             patch("coach_orchestrator.load_memories", side_effect=load_memories or (lambda: [])), \
             patch("coach_orchestrator.provider_capacity", capacity), \
             patch("coach_orchestrator.preflight_cost", side_effect=preflight or (lambda *args: Decimal("0"))), \
             patch("coach_orchestrator._fail_coach_turn"):
            result = respond_to_coach(
                3,
                "How is recovery?",
                context_loader=lambda: context or CONTEXT,
                provider_factory=lambda: provider,
                settings_loader=lambda: self.settings,
                custom_instructions_loader=lambda: self.instructions,
                receipt_persistor=receipt_persistor,
            )
        return result, events

    def test_capacity_rejection_creates_no_receipt_or_provider_call(self):
        provider = FakeProvider()
        receipts = []

        @contextmanager
        def rejected_capacity():
            from coach_guards import ProviderCapacityError
            raise ProviderCapacityError()
            yield

        with self.assertRaises(Exception) as raised:
            self.invoke(provider, lambda turn_id, receipt: receipts.append(receipt), capacity=rejected_capacity)
        self.assertEqual(raised.exception.category, "provider_concurrency_limit")
        self.assertEqual(receipts, [])
        self.assertEqual(provider.requests, [])

    def test_receipt_returns_before_provider_and_fallback_preserves_scopes(self):
        events = []
        provider = FakeProvider(events=events)

        def persist(turn_id, receipt):
            events.append(("receipt", receipt))

        result, capacity_events = self.invoke(
            provider,
            persist,
            load_memories=lambda: (_ for _ in ()).throw(DurableMemoriesUnavailableError()),
        )
        receipt = next(item[1] for item in events if isinstance(item, tuple))
        self.assertEqual(receipt["selected_memories"], [])
        self.assertIn("recovery", receipt["active_scopes"])
        self.assertEqual([item[0] if isinstance(item, tuple) else item for item in events], ["receipt", "provider"])
        self.assertEqual(capacity_events, ["capacity_enter", "capacity_exit"])
        self.assertEqual(result["turn"], {})

    def test_receipt_failure_prevents_provider_and_maps_category(self):
        provider = FakeProvider()
        with self.assertRaises(Exception) as raised:
            self.invoke(provider, lambda turn_id, receipt: (_ for _ in ()).throw(ContextReceiptUnavailable("hidden")))
        self.assertEqual(raised.exception.status_code, 503)
        self.assertEqual(raised.exception.category, "context_receipt_unavailable")
        self.assertEqual(provider.requests, [])

    def test_budget_and_critical_overflow_create_no_receipt(self):
        provider = FakeProvider()
        receipts = []
        with self.assertRaises(Exception):
            self.invoke(provider, lambda turn_id, receipt: receipts.append(receipt), preflight=lambda *args: (_ for _ in ()).throw(ValueError("budget")))
        self.assertEqual(receipts, [])
        self.assertEqual(provider.requests, [])

        with self.assertRaises(Exception):
            self.invoke(
                provider,
                lambda turn_id, receipt: receipts.append(receipt),
                load_memories=lambda: (_ for _ in ()).throw(CriticalMemoryOverflowError()),
            )
        self.assertEqual(receipts, [])
        self.assertEqual(provider.requests, [])

    def test_invalid_and_conflict_failures_have_distinct_categories(self):
        for error, category in (
            (ContextReceiptInvalid("hidden"), "context_receipt_invalid"),
            (ContextReceiptConflict("hidden"), "context_receipt_conflict"),
        ):
            provider = FakeProvider()
            with self.subTest(category=category), self.assertRaises(Exception) as raised:
                self.invoke(provider, lambda turn_id, receipt, error=error: (_ for _ in ()).throw(error))
            self.assertEqual(raised.exception.status_code, 500)
            self.assertEqual(raised.exception.category, category)
            self.assertEqual(provider.requests, [])


if __name__ == "__main__":
    unittest.main()
