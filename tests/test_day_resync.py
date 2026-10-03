import json
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from routes.sync import (
    create_activity_resync,
    create_day_resync,
    get_sync_request_status,
    preview_day_resync,
)


class FakeCursor:
    def __init__(self, fetchall_values=None, fetchone_values=None):
        self.fetchall_values = list(fetchall_values or [])
        self.fetchone_values = list(fetchone_values or [])
        self.sql = []
        self.params = []

    def execute(self, sql, params=()):
        self.sql.append(sql)
        self.params.append(params)

    def fetchall(self):
        return self.fetchall_values.pop(0) if self.fetchall_values else []

    def fetchone(self):
        return self.fetchone_values.pop(0) if self.fetchone_values else None

    def __enter__(self):
        return self

    def __exit__(self, *args):
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

    def __exit__(self, *args):
        return False


def payload(response):
    return json.loads(response.body.decode("utf-8"))


class DayResyncRouteTests(unittest.TestCase):
    def test_preview_counts_all_canonical_activities(self):
        cursor = FakeCursor(fetchall_values=[[{"activity_id": 101}, {"activity_id": 202}]])
        with patch("routes.sync.db_conn", return_value=FakeConnection(cursor)):
            response = preview_day_resync("2026-09-24")

        self.assertEqual(payload(response), {"date": "2026-09-24", "activity_count": 2})
        self.assertIn("public.strava_activities", cursor.sql[0])
        self.assertNotIn("daily_training", cursor.sql[0])

    def test_preview_rejects_invalid_dates_and_large_days(self):
        response = preview_day_resync("2026-2-4")
        self.assertEqual(response.status_code, 400)

        cursor = FakeCursor(fetchall_values=[[{"activity_id": value} for value in range(1, 27)]])
        with patch("routes.sync.db_conn", return_value=FakeConnection(cursor)):
            response = preview_day_resync("2026-09-24")
        self.assertEqual(response.status_code, 400)

    def test_post_enqueues_each_activity_and_returns_local_request_ids(self):
        cursor = FakeCursor(
            fetchall_values=[
                [{"activity_id": 101}, {"activity_id": 202}],
                [],
            ],
            fetchone_values=[{"id": 501}, {"id": 502}],
        )
        conn = FakeConnection(cursor)
        with patch("routes.sync.db_conn", return_value=conn):
            response = create_day_resync("2026-09-24")

        self.assertEqual(
            payload(response),
            {
                "date": "2026-09-24",
                "activity_count": 2,
                "enqueued_count": 2,
                "already_active_count": 0,
                "request_ids": [501, 502],
            },
        )
        self.assertTrue(conn.committed)
        self.assertNotIn("activity_name", payload(response))
        self.assertNotIn("description", payload(response))

    def test_post_reuses_existing_active_request_without_duplicate(self):
        cursor = FakeCursor(
            fetchall_values=[
                [{"activity_id": 101}],
                [{"activity_id": 101, "id": 501}],
            ]
        )
        conn = FakeConnection(cursor)
        with patch("routes.sync.db_conn", return_value=conn):
            response = create_day_resync("2026-09-24")

        self.assertEqual(payload(response)["request_ids"], [501])
        self.assertEqual(payload(response)["already_active_count"], 1)
        self.assertEqual(payload(response)["enqueued_count"], 0)
        self.assertTrue(conn.committed)

    def test_single_activity_resync_verifies_then_enqueues_one_fixed_request(self):
        cursor = FakeCursor(fetchone_values=[
            {"activity_id": 101},
            {"id": 501},
            {"status": "pending"},
        ])
        conn = FakeConnection(cursor)
        with patch("routes.sync.db_conn", return_value=conn):
            response = create_activity_resync("101")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload(response), {
            "activity_id": 101,
            "request_id": 501,
            "status": "pending",
            "already_active": False,
        })
        self.assertEqual(cursor.params[0], (101,))
        self.assertIn("public.strava_activities", cursor.sql[0])
        self.assertIn("VALUES ('dashboard', 1, 'pending', 'activity_resync', %s)", cursor.sql[1])
        self.assertEqual(cursor.params[1], (101,))
        self.assertIn("request_type = 'activity_resync'", cursor.sql[2])
        self.assertEqual(cursor.params[2], (501,))
        self.assertTrue(conn.committed)
        self.assertNotIn("request_type", payload(response))
        self.assertNotIn("requested_by", payload(response))

    def test_single_activity_resync_rejects_invalid_or_unknown_ids_without_enqueue(self):
        for activity_id in ("0", "-1", "abc", "１２３", "9223372036854775808", "1" * 100):
            with self.subTest(activity_id=activity_id), patch("routes.sync.db_conn") as database:
                response = create_activity_resync(activity_id)
                self.assertEqual(response.status_code, 400)
                database.assert_not_called()

        cursor = FakeCursor(fetchone_values=[None])
        with patch("routes.sync.db_conn", return_value=FakeConnection(cursor)):
            response = create_activity_resync("999999")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(len(cursor.sql), 1)
        self.assertIn("public.strava_activities", cursor.sql[0])

    def test_single_activity_resync_reuses_running_request_and_status_is_allowlisted(self):
        cursor = FakeCursor(fetchone_values=[
            {"activity_id": 101},
            None,
            {"id": 501},
            {"status": "running"},
        ])
        conn = FakeConnection(cursor)
        with patch("routes.sync.db_conn", return_value=conn):
            response = create_activity_resync("101")

        self.assertEqual(payload(response)["request_id"], 501)
        self.assertEqual(payload(response)["status"], "running")
        self.assertTrue(payload(response)["already_active"])
        self.assertIn("DO NOTHING", cursor.sql[1])
        self.assertIn("status IN ('pending', 'running')", cursor.sql[2])
        self.assertTrue(conn.committed)

        status_cursor = FakeCursor(fetchone_values=[{
            "id": 501,
            "status": "completed",
            "completed_at_utc": datetime(2026, 9, 24, tzinfo=timezone.utc),
        }])
        with patch("routes.sync.db_conn", return_value=FakeConnection(status_cursor)):
            status_response = get_sync_request_status(payload(response)["request_id"])
        self.assertEqual(status_response.status_code, 200)
        self.assertEqual(payload(status_response)["status"], "completed")

    def test_status_is_allowlisted(self):
        cursor = FakeCursor(fetchone_values=[{
            "id": 501,
            "status": "completed",
            "completed_at_utc": datetime(2026, 9, 24, tzinfo=timezone.utc),
            "result_json": {"description": "secret"},
        }])
        with patch("routes.sync.db_conn", return_value=FakeConnection(cursor)):
            response = get_sync_request_status(501)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload(response)["status"], "completed")
        self.assertNotIn("result_json", payload(response))


if __name__ == "__main__":
    unittest.main()