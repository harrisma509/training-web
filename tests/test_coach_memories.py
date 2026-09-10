import asyncio
import sys
import types
import unittest
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import patch
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

if "fastapi" not in sys.modules:
    fake_fastapi = types.ModuleType("fastapi")

    class FakeRouter:
        def get(self, *args, **kwargs):
            return lambda function: function

        post = get
        put = get
        patch = get

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
    fake_psycopg.connect = None
    fake_rows = types.ModuleType("psycopg.rows")
    fake_rows.dict_row = object()
    fake_json = types.ModuleType("psycopg.types.json")
    fake_json.Jsonb = lambda value: value
    fake_types = types.ModuleType("psycopg.types")
    sys.modules["psycopg"] = fake_psycopg
    sys.modules["psycopg.rows"] = fake_rows
    sys.modules["psycopg.types"] = fake_types
    sys.modules["psycopg.types.json"] = fake_json

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

from coach_memory_router import (
    active_scopes,
    CriticalMemoryOverflowError,
    DENVER,
    compile_memories,
    derived_status,
    route_evidence,
    select_memories,
    validate_memory_payload,
)
from coach_orchestrator import respond_to_coach
from routes.coach_custom_instructions import CustomInstructions
from routes.coach_settings import CoachSettings
from routes.coach_memories import create_memory, deactivate_memory, list_memories

NOW = datetime(2026, 9, 9, 12, 0, tzinfo=DENVER)


def payload(**overrides):
    value = {
        "memory_type": "safety",
        "title": "Recovery rule",
        "memory_text": "Pain changes the recommendation.",
        "applies_to": ["all_training", "recovery"],
        "priority": "high",
        "effective_date": None,
        "expires_at": None,
        "is_active": True,
    }
    value.update(overrides)
    return value


def memory(memory_id=1, **overrides):
    stored = validate_memory_payload(payload(**overrides))
    return {
        "memory_id": memory_id,
        **stored,
        "created_at": NOW,
        "updated_at": NOW,
    }


class MemoryRouterTests(unittest.TestCase):
    def test_normalization_and_strict_fields(self):
        normalized = validate_memory_payload(payload(title="  Title\r\n", memory_text=" A\r\n\rB "))
        self.assertEqual(normalized["title"], "Title")
        self.assertEqual(normalized["memory_text"], "A\n\nB")
        for invalid in (
            {**payload(), "memory_type": " SAFETY "},
            {**payload(), "applies_to": ["recovery", "recovery"]},
            {**payload(), "expires_at": "2026-09-09T12:00:00"},
            {**payload(), "is_active": 1},
            {**payload(), "unexpected": "no"},
        ):
            with self.assertRaises(ValueError):
                validate_memory_payload(invalid)

    def test_status_precedence(self):
        self.assertEqual(derived_status(memory(is_active=False), NOW, date(2026, 9, 9)), "inactive")
        self.assertEqual(derived_status(memory(effective_date="2026-09-10"), NOW, date(2026, 9, 9)), "future")
        self.assertEqual(derived_status(memory(expires_at="2026-09-09T12:00:00-06:00"), NOW, date(2026, 9, 9)), "expired")
        self.assertEqual(derived_status(memory(), NOW, date(2026, 9, 9)), "active")

    def test_router_uses_current_recent_and_authoritative_signals(self):
        evidence = route_evidence(
            "What should I do tomorrow?",
            [{"message_text": "My sleep was poor."}, {"message_text": "I need recovery."}],
            {
                "athlete_narrative": {"current_week": {"is_injury_week": True}},
                "recent_days": [{"main_ride_bike_name": "2022 Orbea Rallon"}],
            },
        )
        self.assertIn("planning", evidence.current)
        self.assertIn("recovery", evidence.recent)
        self.assertIn("recovery", evidence.authoritative)
        self.assertIn("bike_park", evidence.supporting_entity_scopes)
        self.assertIn("mtb", evidence.supporting_entity_scopes)
        generic = route_evidence("That ride was hard at the park.", [], {})
        self.assertNotIn("bike_park", generic.current)

    def test_verified_nested_injury_flags_activate_recovery(self):
        for context in (
            {"athlete_narrative": {"current_week": {"is_injury_week": True}}},
            {"upcoming_context": {"current_week_flags": {"is_injury_week": True}}},
        ):
            self.assertIn("recovery", route_evidence("Question", [], context).authoritative)

    def test_verified_nested_bike_park_flag_activates_bike_scopes(self):
        evidence = route_evidence(
            "Question",
            [],
            {"upcoming_context": {"current_week_flags": {"is_bike_park_week": True}}},
        )
        self.assertIn("bike_park", evidence.authoritative)
        self.assertIn("mtb", evidence.authoritative)

    def test_verified_recent_bike_names_activate_mapped_scopes(self):
        cases = (
            ("2022 Orbea Rallon", {"bike_park", "mtb"}),
            ("2025 Orbea Wild", {"emtb", "mtb"}),
            ("2025 Orbea Denna", {"gravel"}),
        )
        for bike_name, expected_scopes in cases:
            evidence = route_evidence(
                "Question", [], {"recent_days": [{"main_ride_bike_name": bike_name}]},
            )
            self.assertTrue(expected_scopes.issubset(evidence.supporting_entity_scopes))

    def test_recent_entities_are_bounded_to_first_fourteen_rows(self):
        recent_days = [{"main_ride_bike_name": "No special bike"} for _ in range(14)]
        recent_days.append({"main_ride_bike_name": "2022 Orbea Rallon"})
        evidence = route_evidence("Question", [], {"recent_days": recent_days})
        self.assertNotIn("bike_park", evidence.authoritative)
        self.assertNotIn("mtb", evidence.authoritative)

    def test_malformed_nested_objects_and_verified_activity_fields_do_not_crash(self):
        evidence = route_evidence(
            "Question",
            [],
            {
                "athlete_narrative": {"current_week": "invalid"},
                "upcoming_context": [],
                "recent_days": [
                    {
                        "main_ride_name": 42,
                        "main_ride_bike_name": None,
                        "main_ride_sport_type": "gravel ride",
                        "other_activity_names": ["mobility"],
                    }
                ],
            },
        )
        self.assertIn("gravel", evidence.supporting_entity_scopes)

    def test_critical_and_safety_memories_are_selected_without_unrelated_fill(self):
        memories = [
            memory(1, priority="critical", applies_to=["all_training"]),
            memory(2, priority="high", memory_type="medical", applies_to=["all_training"]),
            memory(3, priority="normal", memory_type="preference", applies_to=["skiing"]),
        ]
        selected = select_memories(memories, "How is recovery?", [], {}, NOW, date(2026, 9, 9))
        self.assertEqual([item["memory_id"] for item in selected], [1, 2])

    def test_recent_entities_do_not_select_unrelated_memories_for_surgery(self):
        memories = [
            memory(1, priority="critical", applies_to=["all_training"]),
            memory(2, priority="high", memory_type="medical", applies_to=["all_training", "recovery"]),
            memory(3, memory_type="medical", title="Knee limitations", applies_to=["recovery"]),
            memory(4, memory_type="equipment", title="Denna role", applies_to=["gravel"]),
            memory(5, memory_type="equipment", title="Wild configuration", applies_to=["emtb"]),
            memory(6, memory_type="equipment", title="Rallon role", applies_to=["bike_park"]),
            memory(7, memory_type="training_goal", title="Weight target", applies_to=["weight"]),
        ]
        context = {
            "athlete_narrative": {"current_week": {"is_injury_week": True}},
            "recent_days": [
                {"main_ride_bike_name": "Rallon"},
                {"main_ride_bike_name": "Wild"},
                {"main_ride_bike_name": "Denna"},
                {"other_activity_names": ["strength", "bike park"]},
            ],
        }
        selected = select_memories(memories, "When is my surgery?", [], context, NOW, date(2026, 9, 9))
        self.assertEqual([item["memory_id"] for item in selected], [1, 2, 3])

    def test_gravel_question_uses_question_scope_not_recent_bike_scopes(self):
        memories = [
            memory(1, priority="critical", applies_to=["all_training"]),
            memory(2, memory_type="equipment", title="Denna role", applies_to=["gravel"]),
            memory(3, memory_type="equipment", title="Wild configuration", applies_to=["emtb"]),
            memory(4, memory_type="equipment", title="Rallon role", applies_to=["bike_park"]),
        ]
        context = {"recent_days": [
            {"main_ride_bike_name": "Rallon"},
            {"main_ride_bike_name": "Wild"},
            {"main_ride_bike_name": "Denna"},
        ]}
        selected = select_memories(memories, "Which bike for a gravel ride?", [], context, NOW, date(2026, 9, 9))
        self.assertEqual([item["memory_id"] for item in selected], [1, 2])

    def test_recent_entity_scopes_are_not_reported_as_active(self):
        evidence = route_evidence(
            "When is my surgery?", [], {"recent_days": [{"main_ride_bike_name": "Denna"}]},
        )
        self.assertEqual(active_scopes(evidence), {"all_training", "recovery"})
        self.assertEqual(evidence.supporting_entity_scopes, {"gravel"})

    def test_compilation_excludes_internal_metadata_and_has_wrapper(self):
        compiled = compile_memories([memory(4, title="A title")])
        self.assertIn("These Durable Memories are selected", compiled)
        self.assertIn("A title", compiled)
        self.assertIn("Pain changes", compiled)
        self.assertNotIn("memory_id", compiled)
        self.assertNotIn("all_training", compiled)
        self.assertNotIn("created_at", compiled)

    def test_critical_overflow_fails_safely(self):
        memories = [memory(index, priority="critical", memory_text="x" * 1000) for index in range(1, 13)]
        with self.assertRaises(CriticalMemoryOverflowError):
            select_memories(memories, "Question", [], {}, NOW, date(2026, 9, 9))


class MemoryRouteTests(unittest.TestCase):
    def test_list_returns_derived_statuses(self):
        rows = [
            memory(1),
            memory(2, is_active=False),
            memory(3, effective_date="2026-09-10"),
            memory(4, expires_at="2026-09-09T12:00:00-06:00"),
        ]

        class Cursor:
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def execute(self, query, params=None): pass
            def fetchall(self): return rows

        class Connection:
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def cursor(self): return Cursor()

        with patch("routes.coach_memories.db_conn", return_value=Connection()), \
             patch("routes.coach_memories._now", return_value=NOW):
            result = list_memories()
        self.assertEqual([item["status"] for item in result["memories"]], ["active", "inactive", "future", "expired"])

    def test_create_is_parameterized_and_does_not_supply_memory_id(self):
        row = memory(8)

        class Request:
            async def json(self): return payload()

        class Cursor:
            def __init__(self): self.calls = []
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def execute(self, query, params=None): self.calls.append((query, params))
            def fetchone(self): return row
            def fetchall(self): return []

        class Connection:
            def __init__(self): self.cursor_instance = Cursor(); self.committed = False
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def cursor(self): return self.cursor_instance
            def commit(self): self.committed = True

        connection = Connection()
        with patch("routes.coach_memories.db_conn", return_value=connection), \
             patch("routes.coach_memories._now", return_value=NOW):
            result = asyncio.run(create_memory(Request()))
        insert_query, params = next(call for call in connection.cursor_instance.calls if "INSERT INTO" in call[0])
        self.assertTrue(connection.committed)
        self.assertNotIn("memory_id", insert_query.split("VALUES")[0])
        self.assertEqual(len(params), 8)
        self.assertEqual(result["memory_id"], 8)

    def test_deactivate_is_idempotent_without_delete(self):
        row = memory(8, is_active=False)

        class Cursor:
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def execute(self, query, params=None): self.query = query
            def fetchone(self): return row
            def fetchall(self): return []

        class Connection:
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def cursor(self): return Cursor()
            def commit(self): pass

        with patch("routes.coach_memories.db_conn", return_value=Connection()), \
             patch("routes.coach_memories._now", return_value=NOW):
            result = deactivate_memory("8")
        self.assertEqual(result["status"], "inactive")

    def test_paid_turn_places_memory_after_custom_instructions_and_counts_once(self):
        response = types.SimpleNamespace(
            text="Coach response", provider="fake", model="gpt-5.6-luna",
            provider_response_id="response-1", input_tokens=10, cached_input_tokens=0,
            output_tokens=5, reasoning_tokens=0, total_tokens=15, elapsed_ms=1,
            finish_status="completed",
        )

        class Provider:
            model = "gpt-5.6-luna"

            def __init__(self): self.requests = []
            def complete(self, request): self.requests.append(request); return response

        provider = Provider()
        settings = CoachSettings(Decimal("5.00"), Decimal("0.25"), 1200, "low", "now")
        instruction = CustomInstructions("Safety first.", "", "", "", "", "", "", "now")
        selected = [memory(1, priority="critical")]
        with patch("coach_orchestrator._start_coach_turn", return_value=({}, {"coach_message_id": 2}, {"coach_turn_id": 3})), \
             patch("coach_orchestrator._recent_coach_messages", return_value=[]), \
             patch("coach_orchestrator.load_coach_settings", return_value=settings), \
             patch("coach_orchestrator.load_custom_instructions", return_value=instruction), \
             patch("coach_orchestrator.load_memories", return_value=selected), \
             patch("coach_orchestrator._complete_coach_turn", return_value=({}, {})), \
             patch("coach_orchestrator._coach_session_snapshot", return_value={}), \
             patch("coach_orchestrator.enforce_monthly_budget"), \
             patch("coach_orchestrator._fail_coach_turn"), \
             patch("coach_orchestrator.preflight_cost", return_value=0) as preflight, \
             patch("coach_orchestrator.persist_receipt"):
            respond_to_coach(3, "Question", context_loader=lambda: {}, provider_factory=lambda: provider)
        instructions = provider.requests[0].instructions
        self.assertLess(instructions.index("Coaching priorities:"), instructions.index("These Durable Memories"))
        self.assertIn("Recovery rule", instructions)
        self.assertEqual(preflight.call_args.args[1], len(provider.requests[0].input_text) + len(instructions))


if __name__ == "__main__":
    unittest.main()