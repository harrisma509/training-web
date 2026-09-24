import json
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from routes.daily import api_activity_narrative, api_daily


class FakeCursor:
    def __init__(self, rows, single=None):
        self.rows = rows
        self.single = single
        self.sql = []
        self.params = []

    def execute(self, sql, params=()):
        self.sql.append(sql)
        self.params.append(params)

    def fetchone(self):
        return self.single

    def fetchall(self):
        return self.rows

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False


class FakeConnection:
    def __init__(self, rows=None, single=None):
        self.cursor_value = FakeCursor(rows or [], single)

    def cursor(self):
        return self.cursor_value

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False


class DailyNarrativeRouteTests(unittest.TestCase):
    @staticmethod
    def payload(response):
        return json.loads(response.body.decode("utf-8"))

    def test_daily_projects_presence_flags_without_narrative_text(self):
        row = {
            "date": "2026-09-24",
            "main_ride_id": 123,
            "main_ride_name": "Morning Ride",
            "main_ride_has_description": True,
            "main_ride_has_private_note": False,
        }
        conn = FakeConnection(rows=[row])
        with patch("routes.daily.db_conn", return_value=conn):
            response = api_daily(limit=1)

        payload = self.payload(response)
        self.assertTrue(payload[0]["main_ride_has_description"])
        self.assertFalse(payload[0]["main_ride_has_private_note"])
        self.assertNotIn("description", payload[0])
        self.assertNotIn("private_note", payload[0])
        sql = conn.cursor_value.sql[0]
        self.assertIn("strava_activities AS narrative_activity", sql)
        self.assertIn("trim(narrative_activity.description)", sql)
        self.assertIn("trim(narrative_activity.private_note)", sql)
        self.assertNotIn("narrative_activity.raw_json", sql)

    def test_daily_query_is_parameterized_and_returns_false_safe_flags_for_missing_join(self):
        conn = FakeConnection(rows=[{
            "date": "2026-09-24",
            "main_ride_id": None,
            "main_ride_name": None,
            "main_ride_has_description": False,
            "main_ride_has_private_note": False,
        }])
        with patch("routes.daily.db_conn", return_value=conn):
            response = api_daily(limit=1)

        payload = self.payload(response)
        self.assertFalse(payload[0]["main_ride_has_description"])
        self.assertFalse(payload[0]["main_ride_has_private_note"])
        self.assertEqual(conn.cursor_value.params[0], (1,))

    def test_narrative_endpoint_returns_explicit_allowlist(self):
        conn = FakeConnection(single={
            "activity_id": "18534000278",
            "description": "line one\nline two",
            "private_note": None,
            "narrative_observed_at": datetime(2026, 9, 24, 10, tzinfo=timezone.utc),
            "name": "Hidden activity field",
            "raw_json": "Hidden provider payload",
        })
        with patch("routes.daily.db_conn", return_value=conn):
            response = api_activity_narrative(18534000278)

        payload = self.payload(response)
        self.assertEqual(payload["activity_id"], "18534000278")
        self.assertEqual(payload["description"], "line one\nline two")
        self.assertIsNone(payload["private_note"])
        self.assertTrue(payload["has_description"])
        self.assertFalse(payload["has_private_note"])
        self.assertEqual(
            payload["narrative_observed_at"],
            "2026-09-24T10:00:00+00:00",
        )
        self.assertNotIn("name", payload)
        self.assertNotIn("raw_json", payload)
        self.assertIn("limit 1", conn.cursor_value.sql[0].lower())
        self.assertEqual(conn.cursor_value.params[0], ("18534000278",))

    def test_narrative_endpoint_serializes_timezone_aware_observed_at(self):
        observed_at = datetime(
            2026,
            9,
            24,
            3,
            13,
            57,
            645295,
            tzinfo=timezone.utc,
        )
        conn = FakeConnection(single={
            "activity_id": "18534000278",
            "description": "Synthetic description",
            "private_note": "Synthetic private note",
            "narrative_observed_at": observed_at,
            "name": "Hidden activity field",
            "raw_json": "Hidden provider payload",
        })
        with patch("routes.daily.db_conn", return_value=conn):
            response = api_activity_narrative(18534000278)

        self.assertEqual(response.status_code, 200)
        payload = self.payload(response)
        self.assertEqual(payload["narrative_observed_at"], observed_at.isoformat())
        self.assertIsInstance(payload["narrative_observed_at"], str)
        self.assertEqual(conn.cursor_value.params[0], ("18534000278",))
        self.assertEqual(
            set(payload),
            {
                "activity_id",
                "description",
                "private_note",
                "has_description",
                "has_private_note",
                "narrative_observed_at",
            },
        )
        self.assertNotIn("raw_json", payload)
        self.assertNotIn("Synthetic", self.payload(response).get("detail", ""))

    def test_narrative_endpoint_returns_empty_content_flags(self):
        conn = FakeConnection(single={
            "activity_id": 123,
            "description": "  ",
            "private_note": None,
            "narrative_observed_at": None,
        })
        with patch("routes.daily.db_conn", return_value=conn):
            payload = self.payload(api_activity_narrative(123))

        self.assertFalse(payload["has_description"])
        self.assertFalse(payload["has_private_note"])
        self.assertIsNone(payload["description"])

    def test_unknown_activity_is_safe_404(self):
        with patch("routes.daily.db_conn", return_value=FakeConnection(single=None)):
            response = api_activity_narrative(999)

        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.payload(response)["detail"], "Activity not found.")

    def test_database_failure_is_sanitized(self):
        with patch("routes.daily.db_conn", side_effect=RuntimeError("private narrative SQL")):
            response = api_activity_narrative(123)

        self.assertEqual(response.status_code, 503)
        self.assertNotIn("private narrative SQL", self.payload(response)["detail"])


if __name__ == "__main__":
    unittest.main()
