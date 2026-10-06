import csv
import io
import json
import unittest
from datetime import date
from decimal import Decimal
from unittest.mock import patch

import psycopg
from fastapi import HTTPException
from fastapi.responses import JSONResponse, Response

from routes.weekly import api_weekly, export_weekly, router


EXPECTED_HEADERS = [
    "week_start",
    "week_end",
    "weekly_total_hours",
    "weekly_total_miles",
    "weekly_total_elevation_ft",
    "weekly_avg_weight",
    "total_load",
    "main_ride_load",
    "other_load",
    "activity_days",
    "ride_count",
    "walk_count",
    "hike_count",
    "strength_count",
    "very_hard_epic_days",
    "chronic_weekly_cw",
    "ac_ratio",
    "ramp_pct",
    "status_level",
    "status_text",
    "vo2max",
    "falls",
    "audit_grade",
    "audit_green_count",
    "audit_yellow_count",
    "audit_red_count",
    "audit_summary",
    "audit_next_week_action",
    "weekly_comment",
    "week_type",
    "event",
    "planned_focus",
    "actual_focus",
    "risk_note",
    "lesson_learned",
    "status_override",
    "is_travel_week",
    "is_sick_week",
    "is_injury_week",
    "is_bike_park_week",
    "is_recovery_week",
    "is_goal_week",
]


def weekly_row(**updates):
    row = {
        "week_start": date(2026, 9, 28),
        "week_end": date(2026, 10, 4),
        "weekly_total_hours": Decimal("4.5"),
        "weekly_total_miles": Decimal("32.2"),
        "weekly_total_elevation_ft": 4100,
        "weekly_avg_weight": None,
        "total_load": 0,
        "main_ride_load": 75,
        "other_load": 12,
        "activity_days": 4,
        "ride_count": 2,
        "walk_count": 1,
        "hike_count": 1,
        "strength_count": 0,
        "very_hard_epic_days": 0,
        "chronic_weekly_cw": 240,
        "ac_ratio": Decimal("0.85"),
        "ramp_pct": Decimal("1.2"),
        "status_level": 2,
        "status_text": "Build",
        "vo2max": Decimal("47.5"),
        "falls": 0,
        "audit_grade": "green",
        "audit_green_count": 3,
        "audit_yellow_count": 1,
        "audit_red_count": 0,
        "audit_summary": "A steady week",
        "audit_next_week_action": "Keep the easy days easy",
        "weekly_comment": "雪, trails\nA good week",
        "week_type": "build",
        "event": "=HYPERLINK(\"https://invalid.example\")",
        "planned_focus": "Endurance",
        "actual_focus": "Endurance",
        "risk_note": None,
        "lesson_learned": "Keep cadence smooth",
        "status_override": None,
        "is_travel_week": True,
        "is_sick_week": False,
        "is_injury_week": False,
        "is_bike_park_week": False,
        "is_recovery_week": False,
        "is_goal_week": True,
        "coach_note": "must not export",
        "task_note": "must not export",
        "display_priority": 1,
        "hide_from_dashboard": False,
        "audit_source": "internal",
        "raw_payload": {"secret": True},
    }
    row.update(updates)
    return row


class FakeCursor:
    def __init__(self, rows):
        self.rows = list(rows)
        self.sql = None
        self.params = None
        self.executions = []

    def execute(self, sql, params=()):
        self.sql = sql
        self.params = params
        self.executions.append((sql, params))

    def fetchall(self):
        return self.rows[: self.params[0]]

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


class FakeConnection:
    def __init__(self, rows):
        self.cursor_value = FakeCursor(rows)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def cursor(self):
        return self.cursor_value


class WeeklyExportTests(unittest.TestCase):
    def export_with_rows(self, rows, limit=52):
        self.connection = FakeConnection(rows)
        with patch("routes.weekly.db_conn", return_value=self.connection) as database:
            response = export_weekly(limit=limit)
        return response, database

    def test_export_route_is_registered_and_accepts_only_the_three_limits(self):
        route = next(route for route in router.routes if getattr(route, "path", None) == "/api/weekly/export")
        self.assertIn("GET", route.methods)

        for limit in (10, 52, 520):
            with self.subTest(limit=limit):
                response, _ = self.export_with_rows([weekly_row()], limit)
                self.assertIsInstance(response, Response)
                self.assertEqual(self.connection.cursor_value.params, (limit,))

        for limit in (0, 9, 11, 51, 260, 521, -1):
            with self.subTest(limit=limit):
                with patch("routes.weekly.db_conn") as database:
                    with self.assertRaises(HTTPException) as raised:
                        export_weekly(limit=limit)
                self.assertEqual(raised.exception.status_code, 422)
                self.assertEqual(raised.exception.detail, "limit must be one of 10, 52, or 520.")
                database.assert_not_called()

    def test_display_selection_of_520_is_returned_without_the_old_260_clamp(self):
        rows = [weekly_row(week_start=date(2026, 9, 28)) for _ in range(400)]
        self.connection = FakeConnection(rows)
        with patch("routes.weekly.db_conn", return_value=self.connection):
            response = api_weekly(limit=520)

        self.assertIsInstance(response, JSONResponse)
        self.assertEqual(len(json.loads(response.body)), 400)
        self.assertEqual(self.connection.cursor_value.params, (520,))

    def test_export_uses_canonical_weekly_query_order_and_grain(self):
        response, _ = self.export_with_rows([weekly_row()], 10)

        self.assertEqual(response.status_code, 200)
        sql, params = self.connection.cursor_value.executions[0]
        self.assertEqual(params, (10,))
        self.assertIn("from weeks\n", sql)
        self.assertIn("order by weeks.week_start desc", sql)
        self.assertIn("limit %s", sql)
        self.assertIn("GROUP BY 1", sql)
        self.assertIn("AS weekly_total_hours", sql)
        self.assertIn("AS weekly_avg_weight", sql)
        self.assertIn("sum(falls) AS falls", sql)
        self.assertIn("left join weekly_audit wa", sql)
        self.assertIn("left join weekly_commentary wc", sql)
        self.assertNotIn("weekly_audit_item", sql)
        self.assertEqual(len(self.connection.cursor_value.executions), 1)

    def test_export_emits_the_approved_schema_and_e1_csv_serialization(self):
        response, _ = self.export_with_rows([weekly_row()], 52)

        self.assertEqual(response.headers["content-type"], "text/csv; charset=utf-8")
        self.assertEqual(
            response.headers["content-disposition"],
            'attachment; filename="training-weekly.csv"',
        )
        self.assertTrue(response.body.startswith(b"\xef\xbb\xbf"))
        self.assertIn(b"\r\n", response.body)
        records = list(csv.reader(io.StringIO(response.body.decode("utf-8-sig"), newline="")))
        self.assertEqual(records[0], EXPECTED_HEADERS)
        self.assertEqual(len(records), 2)
        self.assertEqual(records[1][5], "")
        self.assertEqual(records[1][6], "0")
        self.assertEqual(records[1][28], "雪, trails\nA good week")
        self.assertEqual(records[1][30], "'=HYPERLINK(\"https://invalid.example\")")
        self.assertEqual(records[1][36:42], ["true", "false", "false", "false", "false", "true"])
        for forbidden in (
            "coach_note",
            "task_note",
            "display_priority",
            "hide_from_dashboard",
            "audit_source",
            "raw_payload",
            "must not export",
            "internal",
        ):
            self.assertNotIn(forbidden, response.body.decode("utf-8-sig"))

    def test_empty_export_returns_headers_only(self):
        response, _ = self.export_with_rows([], 10)

        self.assertEqual(response.status_code, 200)
        records = list(csv.reader(io.StringIO(response.body.decode("utf-8-sig"), newline="")))
        self.assertEqual(records, [EXPECTED_HEADERS])

    def test_database_and_serialization_errors_are_bounded(self):
        with self.assertLogs("routes.weekly", level="ERROR") as logged:
            with patch(
                "routes.weekly.db_conn",
                side_effect=psycopg.OperationalError("private SQL and parameters"),
            ) as database:
                response = export_weekly(limit=52)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.body, b'{"detail":"Weekly export is temporarily unavailable."}')
        database.assert_called_once()
        self.assertIn("OperationalError", logged.output[0])
        self.assertNotIn("private SQL", logged.output[0])

        with self.assertLogs("routes.weekly", level="ERROR") as logged:
            response, _ = self.export_with_rows([{"week_start": object()}], 10)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.body, b'{"detail":"Weekly export is temporarily unavailable."}')
        self.assertIn("TypeError", logged.output[0])


if __name__ == "__main__":
    unittest.main()
