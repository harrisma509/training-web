import json
import unittest
from datetime import date
from unittest.mock import patch

from routes.weekly import api_weekly


class FakeCursor:
    def __init__(self, rows):
        self.rows = rows
        self.sql = []
        self.params = []

    def execute(self, sql, params=()):
        self.sql.append(sql)
        self.params.append(params)

    def fetchall(self):
        return self.rows

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class FakeConnection:
    def __init__(self, rows):
        self.cursor_value = FakeCursor(rows)

    def cursor(self):
        return self.cursor_value

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class WeeklyRouteCurrentEmptyWeekTests(unittest.TestCase):
    def test_zero_activity_row_preserves_null_interpretive_values_and_missing_audit(self):
        row = {
            "week_start": date(2026, 10, 5),
            "week_end": date(2026, 10, 11),
            "weekly_comment": None,
            "audit_grade": None,
            "total_load": 0,
            "weekly_total_hours": 0,
            "weekly_total_miles": 0,
            "weekly_total_elevation_ft": 0,
            "weekly_avg_weight": None,
            "chronic_weekly_cw": None,
            "ac_ratio": None,
            "ramp_pct": None,
            "ramp_pct_display": "",
            "status_level": None,
            "status_text": None,
        }
        conn = FakeConnection([row])

        with patch("routes.weekly.db_conn", return_value=conn):
            response = api_weekly(limit=10)

        payload = json.loads(response.body.decode("utf-8"))
        self.assertEqual(len(payload), 1)
        self.assertEqual(payload[0]["week_start"], "2026-10-05")
        for field in (
            "total_load",
            "weekly_total_hours",
            "weekly_total_miles",
            "weekly_total_elevation_ft",
        ):
            self.assertEqual(payload[0][field], 0)
        for field in (
            "weekly_avg_weight",
            "chronic_weekly_cw",
            "ac_ratio",
            "ramp_pct",
            "status_level",
            "status_text",
            "audit_grade",
        ):
            self.assertIsNone(payload[0][field])
        self.assertEqual(payload[0]["ramp_pct_display"], "")

        sql = conn.cursor_value.sql[0]
        self.assertIn("THEN COALESCE(daily_activity_week.weekly_total_hours, 0)", sql)
        self.assertIn("THEN COALESCE(daily_activity_week.weekly_total_miles, 0)", sql)
        self.assertIn("THEN COALESCE(daily_activity_week.weekly_total_elevation_ft, 0)", sql)
        self.assertIn("order by weeks.week_start desc", sql.lower())
        self.assertEqual(conn.cursor_value.params, [(10,)])


if __name__ == "__main__":
    unittest.main()
