import unittest
from datetime import date, datetime
from pathlib import Path
from unittest.mock import patch

from pydantic import ValidationError
from starlette.exceptions import HTTPException

from routes.daily_checkins import (
    DailyCheckinPayload,
    delete_daily_checkin,
    get_daily_checkin,
    list_daily_checkins,
    save_daily_checkin,
)


FLAGS = (
    "is_travel",
    "is_sick",
    "is_injury",
    "is_bike_park",
    "is_recovery",
    "is_goal_event",
    "is_bad_weather",
    "is_high_life_stress",
    "is_lost",
    "is_gear",
    "is_crash",
    "is_group_ride",
    "is_sore",
    "is_tired",
    "is_poor_sleep",
)


def row(checkin_date="2026-09-16", note="Good day"):
    values = {
        "checkin_date": date.fromisoformat(checkin_date),
        "overall_status": "good",
        "note": note,
        "readiness": None,
        "energy": None,
        "soreness": None,
        "pain": None,
        "physical_labor": None,
        "handling_quality": None,
        "created_at": datetime(2026, 9, 16, 12, 0),
        "updated_at": datetime(2026, 9, 16, 12, 0),
    }
    values.update({flag: False for flag in FLAGS})
    return values


class FakeCursor:
    def __init__(self, rows=None, one=None, rowcount=1, error=None):
        self.rows = rows or []
        self.one = one
        self.rowcount = rowcount
        self.error = error
        self.executed = []

    def execute(self, sql, params=()):
        if self.error:
            raise self.error
        self.executed.append((sql, params))

    def fetchone(self):
        return self.one

    def fetchall(self):
        return self.rows

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False


class FakeConnection:
    def __init__(self, cursor):
        self.cursor_value = cursor
        self.committed = False

    def cursor(self):
        return self.cursor_value

    def commit(self):
        self.committed = True

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False


class DailyCheckinValidationTests(unittest.TestCase):
    def test_minimal_payload_defaults_flags_false(self):
        payload = DailyCheckinPayload(overall_status="good", note="  Ready  ")
        self.assertEqual(payload.note, "Ready")
        self.assertTrue(all(getattr(payload, flag) is False for flag in FLAGS))

    def test_fully_populated_payload_preserves_none_semantics_and_flags(self):
        values = {
            "overall_status": "mixed",
            "note": " Felt fine after work ",
            "readiness": 5,
            "energy": 4,
            "soreness": 0,
            "pain": 1,
            "physical_labor": "none",
            "handling_quality": "sharp",
            **{flag: True for flag in FLAGS},
        }
        payload = DailyCheckinPayload(**values)
        self.assertEqual(payload.note, "Felt fine after work")
        self.assertEqual(payload.physical_labor, "none")
        self.assertTrue(all(getattr(payload, flag) is True for flag in FLAGS))

    def test_note_boundaries_and_status(self):
        self.assertEqual(len(DailyCheckinPayload(overall_status="poor", note=" " + "x" * 999 + " ").note), 999)
        self.assertEqual(len(DailyCheckinPayload(overall_status="good", note=" " + "x" * 1000 + " ").note), 1000)
        for note in ("", "   ", "x" * 1001):
            with self.subTest(note_length=len(note)), self.assertRaises(ValidationError):
                DailyCheckinPayload(overall_status="good", note=note)
        with self.assertRaises(ValidationError):
            DailyCheckinPayload(overall_status="unknown", note="valid")

    def test_numeric_and_enum_ranges(self):
        for field, values in {
            "readiness": (1, 5, 0, 6),
            "energy": (1, 5, 0, 6),
            "soreness": (0, 4, -1, 5),
            "pain": (0, 4, -1, 5),
        }.items():
            DailyCheckinPayload(overall_status="good", note="valid", **{field: values[0]})
            DailyCheckinPayload(overall_status="good", note="valid", **{field: values[1]})
            for invalid in values[2:]:
                with self.subTest(field=field, value=invalid), self.assertRaises(ValidationError):
                    DailyCheckinPayload(overall_status="good", note="valid", **{field: invalid})
        for field, value in (("physical_labor", "extreme"), ("handling_quality", "blunt")):
            with self.subTest(field=field), self.assertRaises(ValidationError):
                DailyCheckinPayload(overall_status="good", note="valid", **{field: value})

    def test_unknown_fields_and_non_boolean_flags_are_rejected(self):
        with self.assertRaises(ValidationError):
            DailyCheckinPayload(overall_status="good", note="valid", extra_field=True)
        with self.assertRaises(ValidationError):
            DailyCheckinPayload(overall_status="good", note="valid", is_sore=1)


class DailyCheckinRouteTests(unittest.TestCase):
    def test_create_returns_complete_stored_row(self):
        stored = row()
        cursor = FakeCursor(one=stored)
        payload = DailyCheckinPayload(overall_status="good", note="valid")
        with patch("routes.daily_checkins.db_conn", return_value=FakeConnection(cursor)):
            response = save_daily_checkin("2026-09-16", payload)
        self.assertEqual(response["checkin_date"], "2026-09-16")
        self.assertEqual(response["note"], "Good day")
        self.assertIn("ON CONFLICT (checkin_date)", cursor.executed[0][0])

    def test_update_preserves_created_at_and_updates_timestamp_in_sql(self):
        cursor = FakeCursor(one=row())
        with patch("routes.daily_checkins.db_conn", return_value=FakeConnection(cursor)):
            save_daily_checkin("2026-09-16", DailyCheckinPayload(overall_status="mixed", note="updated"))
        sql = cursor.executed[0][0]
        self.assertNotIn("created_at = EXCLUDED.created_at", sql)
        self.assertIn("updated_at = now()", sql)

    def test_get_one_and_absent_get(self):
        cursor = FakeCursor(one=row())
        with patch("routes.daily_checkins.db_conn", return_value=FakeConnection(cursor)):
            self.assertEqual(get_daily_checkin("2026-09-16")["note"], "Good day")
        with patch("routes.daily_checkins.db_conn", return_value=FakeConnection(FakeCursor(one=None))):
            with self.assertRaisesRegex(HTTPException, "Daily check-in not found"):
                get_daily_checkin("2026-09-16")

    def test_range_is_inclusive_ordered_and_empty_is_valid(self):
        rows = [row("2026-09-16"), row("2026-09-15")]
        cursor = FakeCursor(rows=rows)
        with patch("routes.daily_checkins.db_conn", return_value=FakeConnection(cursor)):
            result = list_daily_checkins("2026-09-15", "2026-09-16")
        self.assertEqual(len(result), 2)
        self.assertIn("ORDER BY checkin_date DESC", cursor.executed[0][0])
        with patch("routes.daily_checkins.db_conn", return_value=FakeConnection(FakeCursor(rows=[]))):
            self.assertEqual(list_daily_checkins("2026-09-15", "2026-09-16"), [])

    def test_range_bounds_and_dates_are_rejected_before_db_access(self):
        with patch("routes.daily_checkins.db_conn") as db_conn:
            for args in (("2026-09-17", "2026-09-16"), ("2026-01-01", "2027-01-02"), ("2026-02-30", "2026-03-01")):
                with self.subTest(args=args), self.assertRaises(HTTPException):
                    list_daily_checkins(*args)
            db_conn.assert_not_called()

    def test_delete_only_targets_checkin_and_absent_delete_is_404(self):
        cursor = FakeCursor(rowcount=1)
        with patch("routes.daily_checkins.db_conn", return_value=FakeConnection(cursor)):
            response = delete_daily_checkin("2026-09-16")
        self.assertEqual(response.status_code, 204)
        self.assertIn("DELETE FROM public.daily_checkin", cursor.executed[0][0])
        with patch("routes.daily_checkins.db_conn", return_value=FakeConnection(FakeCursor(rowcount=0))):
            with self.assertRaisesRegex(HTTPException, "Daily check-in not found"):
                delete_daily_checkin("2026-09-16")

    def test_db_errors_are_sanitized(self):
        with patch("routes.daily_checkins.db_conn", side_effect=RuntimeError("secret SQL detail")):
            with self.assertRaisesRegex(HTTPException, "storage is unavailable") as error:
                get_daily_checkin("2026-09-16")
        self.assertNotIn("secret", str(error.exception))


class DailyCheckinSchemaTests(unittest.TestCase):
    def test_schema_artifacts_contain_contract_and_no_activity_foreign_key(self):
        root = Path(__file__).resolve().parents[2]
        schema = (root / "training-etl" / "sql" / "training_postgress_db_schema.sql").read_text()
        standalone = (root / "training-etl" / "sql" / "daily_checkins_v1.sql").read_text()
        for artifact in (schema, standalone):
            self.assertIn("CREATE TABLE", artifact)
            self.assertIn("daily_checkin_pkey PRIMARY KEY (checkin_date)", artifact)
            self.assertIn("daily_checkin_note_not_blank_check", artifact)
            self.assertIn("daily_checkin_updated_at_after_created_at_check", artifact)
            for flag in FLAGS:
                self.assertRegex(artifact.lower(), rf"{flag} (bool|boolean)\b")
            self.assertNotIn("REFERENCES public.strava_activities", artifact)
            self.assertNotIn("REFERENCES public.daily_training", artifact)


if __name__ == "__main__":
    unittest.main()
