import asyncio
import json
import subprocess
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
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


def asgi_request(application, method, path):
    messages = []
    request_received = False
    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": method,
        "scheme": "http",
        "path": path,
        "raw_path": path.encode("ascii"),
        "query_string": b"",
        "root_path": "",
        "headers": [(b"host", b"testserver")],
        "client": ("testclient", 50000),
        "server": ("testserver", 80),
    }

    async def receive():
        nonlocal request_received
        if request_received:
            return {"type": "http.disconnect"}
        request_received = True
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        messages.append(message)

    asyncio.run(application(scope, receive, send))
    response_start = next(message for message in messages if message["type"] == "http.response.start")
    response_body = b"".join(
        message.get("body", b"")
        for message in messages
        if message["type"] == "http.response.body"
    )
    return response_start["status"], json.loads(response_body)


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
        request_script = """
import json
import sys
from unittest.mock import patch
sys.path.insert(0, "tests")
from app import app
import test_day_resync as support

cursor = support.FakeCursor(fetchone_values=[
    {"activity_id": "101"},
    {"id": 501},
    {"status": "pending"},
])
conn = support.FakeConnection(cursor)
with patch("routes.sync.db_conn", return_value=conn):
    status_code, response_payload = support.asgi_request(
        app, "POST", "/api/sync/activities/101/resync"
    )
status_cursor = support.FakeCursor(fetchone_values=[{
    "id": 501,
    "status": "completed",
    "completed_at_utc": None,
}])
with patch("routes.sync.db_conn", return_value=support.FakeConnection(status_cursor)):
    status_route_code, status_route_payload = support.asgi_request(
        app, "GET", "/api/sync-requests/501"
    )
print(json.dumps({
    "status_code": status_code,
    "payload": response_payload,
    "sql": cursor.sql,
    "params": cursor.params,
    "committed": conn.committed,
    "status_route_code": status_route_code,
    "status_route_payload": status_route_payload,
}))
"""
        completed = subprocess.run(
            [sys.executable, "-c", request_script],
            cwd=Path(__file__).resolve().parents[1],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        request_result = json.loads(completed.stdout.strip().splitlines()[-1])
        cursor_sql = request_result["sql"]
        cursor_params = request_result["params"]

        self.assertEqual(request_result["status_code"], 200)
        self.assertEqual(request_result["payload"], {
            "activity_id": 101,
            "request_id": 501,
            "status": "pending",
            "already_active": False,
        })
        self.assertEqual(cursor_params[0], ["101"])
        self.assertIn("public.strava_activities", cursor_sql[0])
        self.assertIn("VALUES ('dashboard', 1, 'pending', 'activity_resync', %s)", cursor_sql[1])
        self.assertEqual(cursor_params[1], [101])
        self.assertEqual(sum("INSERT INTO public.sync_request" in sql for sql in cursor_sql), 1)
        self.assertIn("request_type = 'activity_resync'", cursor_sql[2])
        self.assertEqual(cursor_params[2], [501])
        self.assertTrue(request_result["committed"])
        self.assertEqual(request_result["status_route_code"], 200)
        self.assertEqual(request_result["status_route_payload"]["status"], "completed")
        self.assertNotIn("request_type", request_result["payload"])
        self.assertNotIn("requested_by", request_result["payload"])

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