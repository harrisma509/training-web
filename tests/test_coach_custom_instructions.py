import asyncio
import sys
import types
import unittest
from datetime import datetime
from unittest.mock import patch

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

from routes.coach_custom_instructions import (
    INSTRUCTION_FIELDS,
    CustomInstructions,
    CustomInstructionsUnavailableError,
    compile_custom_instructions,
    get_custom_instructions,
    load_custom_instructions,
    update_custom_instructions,
    validate_custom_instructions,
)


class Request:
    def __init__(self, payload):
        self.payload = payload

    async def json(self):
        return self.payload


def profile_payload(value=""):
    return {field: value for field in INSTRUCTION_FIELDS}


class CoachCustomInstructionsTests(unittest.TestCase):
    def test_blank_profile_is_valid_and_compiles_to_empty(self):
        values = validate_custom_instructions(profile_payload())
        self.assertEqual(values, profile_payload())
        self.assertEqual(
            compile_custom_instructions(
                CustomInstructions(**values, updated_at="2026-09-08T00:00:00Z")
            ),
            "",
        )

    def test_normalization_preserves_internal_formatting(self):
        payload = profile_payload()
        payload["communication_style"] = "  First\r\n\r\nSecond\r  "
        values = validate_custom_instructions(payload)
        self.assertEqual(values["communication_style"], "First\n\nSecond")

    def test_exact_section_limit_is_accepted_and_over_limit_is_rejected(self):
        payload = profile_payload()
        payload["coaching_priorities"] = "a" * 1500
        validate_custom_instructions(payload)
        payload["coaching_priorities"] += "a"
        with self.assertRaisesRegex(ValueError, "1,500"):
            validate_custom_instructions(payload)

    def test_exact_combined_limit_is_accepted_and_over_limit_is_rejected(self):
        payload = profile_payload()
        payload["coaching_priorities"] = "a" * 1500
        payload["safety_progression_rules"] = "b" * 1500
        payload["training_approach"] = "c" * 1500
        payload["recovery_adjustment_rules"] = "d" * 1500
        payload["communication_style"] = "e" * 1500
        payload["planning_preferences"] = "f" * 500
        validate_custom_instructions(payload)
        payload["other_instructions"] = "g"
        with self.assertRaisesRegex(ValueError, "8,000"):
            validate_custom_instructions(payload)

    def test_required_unknown_and_non_string_fields_are_rejected(self):
        payload = profile_payload()
        del payload["other_instructions"]
        with self.assertRaisesRegex(ValueError, "required"):
            validate_custom_instructions(payload)
        payload = profile_payload()
        payload["unexpected"] = "no"
        with self.assertRaisesRegex(ValueError, "Unsupported"):
            validate_custom_instructions(payload)
        for invalid in (None, False, 3, [], {}):
            payload = profile_payload()
            payload["training_approach"] = invalid
            with self.assertRaisesRegex(ValueError, "string"):
                validate_custom_instructions(payload)

    def test_compilation_is_ordered_labeled_and_wrapped(self):
        payload = profile_payload()
        payload["other_instructions"] = "Keep answers concise."
        payload["coaching_priorities"] = "Safety first."
        compiled = compile_custom_instructions(payload)
        self.assertIn("These user Custom Instructions personalize", compiled)
        self.assertLess(compiled.index("Coaching priorities:"), compiled.index("Other instructions:"))
        self.assertIn("Safety first.", compiled)
        self.assertNotIn("Training approach:", compiled)

    def test_stored_profile_failure_is_sanitized(self):
        with patch("routes.coach_custom_instructions.db_conn", side_effect=RuntimeError("secret")):
            with self.assertRaises(CustomInstructionsUnavailableError):
                load_custom_instructions()
        with patch("routes.coach_custom_instructions.db_conn", side_effect=RuntimeError("secret")):
            response = get_custom_instructions()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.content["detail"], "AI Coach Custom Instructions are unavailable.")

    def test_arbitrary_stored_timestamp_is_rejected(self):
        row = {**profile_payload(), "updated_at": "2026-09-08T12:00:00Z"}

        class Cursor:
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def execute(self, query): pass
            def fetchone(self): return row

        class Connection:
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def cursor(self): return Cursor()

        with patch("routes.coach_custom_instructions.db_conn", return_value=Connection()):
            with self.assertRaises(CustomInstructionsUnavailableError):
                load_custom_instructions()

    def test_get_returns_complete_profile_without_provider(self):
        row = {field: field.replace("_", " ") for field in INSTRUCTION_FIELDS}
        row["updated_at"] = datetime(2026, 9, 8, 12, 0)

        class Cursor:
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def execute(self, query): self.query = query
            def fetchone(self): return row

        class Connection:
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def cursor(self): return Cursor()

        with patch("routes.coach_custom_instructions.db_conn", return_value=Connection()):
            result = get_custom_instructions()
        self.assertEqual(set(result), set(INSTRUCTION_FIELDS) | {"updated_at"})
        self.assertEqual(result["updated_at"], "2026-09-08T12:00:00")

    def test_put_normalizes_and_scopes_parameterized_singleton_update(self):
        payload = profile_payload()
        payload["communication_style"] = "  Direct\r\n answers  "
        row = {**validate_custom_instructions(payload), "updated_at": datetime(2026, 9, 8, 12, 0)}

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
        with patch("routes.coach_custom_instructions.db_conn", return_value=connection):
            result = asyncio.run(update_custom_instructions(Request(payload)))
        query, params = connection.cursor_instance.calls[0]
        self.assertTrue(connection.committed)
        self.assertEqual(result["communication_style"], "Direct\n answers")
        self.assertEqual(params[INSTRUCTION_FIELDS.index("communication_style")], "Direct\n answers")
        self.assertIn("WHERE instructions_id = 1", query)
        self.assertIn("%s", query)


if __name__ == "__main__":
    unittest.main()
