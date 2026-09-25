import json
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from routes.status import api_system_status
from routes.sync import create_sync_request, get_sync_status


class FakeCursor:
    def __init__(self, fetchone_values):
        self.fetchone_values = list(fetchone_values)
        self.sql = []
        self.params = []

    def execute(self, sql, params=()):
        self.sql.append(sql)
        self.params.append(params)

    def fetchone(self):
        return self.fetchone_values.pop(0) if self.fetchone_values else None

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class FakeConnection:
    def __init__(self, cursor):
        self.cursor_value = cursor

    def cursor(self):
        return self.cursor_value

    def close(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def payload(response):
    return json.loads(response.body.decode("utf-8"))


class GlobalSyncStatusTests(unittest.TestCase):
    def test_activity_resync_does_not_drive_sync_status(self):
        now = datetime.now(timezone.utc)
        cursor = FakeCursor([
            {
                "run_at_utc": now,
                "days_back": 7,
                "activity_count": 10,
                "daily_rows": 2,
                "weekly_rows": 1,
                "warning_count": 0,
                "status": "ok",
            },
            None,
            {"run_at_utc": now},
        ])
        with patch("routes.sync.db_conn", return_value=FakeConnection(cursor)):
            response = get_sync_status()

        result = payload(response)
        self.assertEqual(result["health"], "healthy")
        self.assertIsNone(result["sync_request_id"])
        self.assertIn("request_type = 'full_sync'", cursor.sql[1])

    def test_pending_full_sync_still_drives_sync_status(self):
        now = datetime.now(timezone.utc)
        cursor = FakeCursor([
            {
                "run_at_utc": now,
                "days_back": 7,
                "activity_count": 10,
                "daily_rows": 2,
                "weekly_rows": 1,
                "warning_count": 0,
                "status": "ok",
            },
            {
                "id": 41,
                "requested_at_utc": now,
                "status": "pending",
                "days_back": 7,
            },
            {"run_at_utc": now},
        ])
        with patch("routes.sync.db_conn", return_value=FakeConnection(cursor)):
            response = get_sync_status()

        result = payload(response)
        self.assertEqual(result["health"], "pending")
        self.assertEqual(result["sync_request_id"], 41)
        self.assertIn("request_type = 'full_sync'", cursor.sql[1])

    def test_sync_now_ignores_active_activity_resync(self):
        now = datetime.now(timezone.utc)
        cursor = FakeCursor([
            None,
            {"id": 42, "requested_at_utc": now, "status": "pending", "days_back": 7},
        ])
        with patch("routes.sync.db_conn", return_value=FakeConnection(cursor)), patch(
            "routes.sync._effective_default_sync_days_back", return_value=7
        ):
            result = create_sync_request()

        self.assertTrue(result["created"])
        self.assertEqual(result["request_id"], 42)
        self.assertIn("request_type = 'full_sync'", cursor.sql[0])

    def test_sync_now_deduplicates_active_full_sync(self):
        now = datetime.now(timezone.utc)
        cursor = FakeCursor([
            {"id": 43, "requested_at_utc": now, "status": "running", "days_back": 14},
        ])
        with patch("routes.sync.db_conn", return_value=FakeConnection(cursor)), patch(
            "routes.sync._effective_default_sync_days_back", return_value=7
        ):
            result = create_sync_request()

        self.assertFalse(result["created"])
        self.assertEqual(result["request_id"], 43)
        self.assertIn("request_type = 'full_sync'", cursor.sql[0])
        self.assertNotIn("raw_json", result)

    def test_system_status_ignores_latest_activity_resync(self):
        now = datetime.now(timezone.utc)
        cursor = FakeCursor([
            {
                "run_at_utc": now,
                "status": "ok",
                "warning_count": 0,
                "daily_rows": 2,
                "weekly_rows": 1,
            },
            {"run_at_utc": now},
            None,
        ])
        with patch("routes.status.db_conn", return_value=FakeConnection(cursor)):
            response = api_system_status()

        result = payload(response)
        self.assertEqual(result["health"], "healthy")
        self.assertIsNone(result["latest_request_status"])
        self.assertIn("request_type = 'full_sync'", cursor.sql[2])
        self.assertNotIn("raw_json", result)


if __name__ == "__main__":
    unittest.main()
