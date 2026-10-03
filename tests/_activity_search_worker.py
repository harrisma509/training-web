import asyncio
import json
import subprocess
import sys
import unittest
from datetime import date, datetime, time, timezone
from decimal import Decimal
from pathlib import Path
from urllib.parse import urlencode
from unittest.mock import patch

from fastapi import FastAPI
from routes.activities import ActivitySort, ActivitySortBy, ActivitySortDirection, router as activities_router


app = FastAPI()
app.include_router(activities_router)


class FakeCursor:
    def __init__(self, rows=None, total_count=None):
        self.rows = list(rows or [])
        self.total_count = len(self.rows) if total_count is None else total_count
        self.sql = None
        self.params = None
        self.executions = []
        self.events = []

    def execute(self, sql, params=()):
        self.sql = sql
        self.params = params
        self.executions.append((sql, params))
        self.events.append(("execute", sql, params))

    def fetchone(self):
        self.events.append(("fetchone", self.sql, self.params))
        return {"total_count": self.total_count}

    def fetchall(self):
        self.events.append(("fetchall", self.sql, self.params))
        if "LIMIT %s OFFSET %s" in (self.sql or ""):
            return self.rows[:self.params[-2]]
        return self.rows

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


class FakeConnection:
    def __init__(self, rows=None, total_count=None):
        self.cursor_value = FakeCursor(rows, total_count)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def cursor(self):
        return self.cursor_value


def asgi_get(path="/api/activities/search", params=None, headers=None):
    messages = []
    query_string = urlencode(params or [], doseq=True).encode("utf-8")
    request_headers = [(b"host", b"testserver")]
    request_headers.extend((name.lower().encode("ascii"), value.encode("latin-1")) for name, value in (headers or {}).items())
    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": path,
        "raw_path": path.encode("ascii"),
        "query_string": query_string,
        "root_path": "",
        "headers": request_headers,
        "client": ("testclient", 50000),
        "server": ("testserver", 80),
    }

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        messages.append(message)

    asyncio.run(app(scope, receive, send))
    response_start = next(message for message in messages if message["type"] == "http.response.start")
    response_body = b"".join(
        message.get("body", b"")
        for message in messages
        if message["type"] == "http.response.body"
    )
    return response_start["status"], json.loads(response_body)


def activity_row(**updates):
    row = {
        "activity_id": "101",
        "date_local": date(2026, 9, 24),
        "start_at_local": datetime(2026, 9, 24, 7, 30),
        "start_at_utc": datetime(2026, 9, 24, 13, 30, tzinfo=timezone.utc),
        "timezone": "(GMT-06:00) America/Denver",
        "utc_offset_seconds": -21600,
        "name": "Morning Ride",
        "sport_type": "MountainBikeRide",
        "activity_category": "ride",
        "gear_id": "bike-1",
        "gear_name": "Trail Bike",
        "distance_mi": Decimal("12.50"),
        "elevation_ft": 1250,
        "moving_sec": 3600,
        "elapsed_sec": 3900,
        "activity_load": 85,
    }
    row.update(updates)
    return row


class ActivitySearchRouteTests(unittest.TestCase):
    def response(self, params=None, rows=None, *, total_count=None, db_error=None, headers=None):
        if db_error is not None:
            database = patch("routes.activities.db_conn", side_effect=db_error)
        else:
            self.connection = FakeConnection(rows, total_count)
            database = patch("routes.activities.db_conn", return_value=self.connection)
        with database as db_mock:
            result = asgi_get(params=params, headers=headers)
        return result, db_mock

    def test_route_is_registered_and_default_search_means_all_history(self):
        route = next(route for route in app.routes if getattr(route, "path", None) == "/api/activities/search")
        self.assertIn("GET", route.methods)
        registration = subprocess.run(
            [
                sys.executable,
                "-c",
                "from app import app; assert any(getattr(route, 'path', None) == '/api/activities/search' for route in app.routes)",
            ],
            cwd=Path(__file__).resolve().parents[1],
            capture_output=True,
            text=True,
        )
        self.assertEqual(registration.returncode, 0, registration.stderr)
        (status, payload), _ = self.response(rows=[activity_row()])

        self.assertEqual(status, 200)
        self.assertEqual(payload["total_count"], 1)
        self.assertEqual(payload["applied_sort_by"], "date")
        self.assertEqual(payload["applied_sort_direction"], "desc")
        self.assertIsNone(payload["applied_start_date"])
        self.assertIsNone(payload["applied_end_date"])
        self.assertEqual(payload["limit"], 50)
        self.assertEqual(payload["offset"], 0)
        self.assertEqual(payload["items"][0]["start_at_local"], "2026-09-24T07:30:00")
        self.assertEqual(payload["items"][0]["start_at_utc"], "2026-09-24T13:30:00+00:00")
        self.assertEqual(payload["items"][0]["distance_mi"], 12.5)
        self.assertEqual(payload["items"][0]["gear_name"], "Trail Bike")
        self.assertEqual(payload["items"][0]["activity_load"], 85)
        self.assertEqual([event[0] for event in self.connection.cursor_value.events], [
            "execute", "fetchone", "execute", "fetchall",
        ])
        count_sql, count_params = self.connection.cursor_value.executions[0]
        item_sql, item_params = self.connection.cursor_value.executions[1]
        self.assertNotIn("sa.date_local >= %s", item_sql)
        self.assertNotIn("sa.date_local <= %s", item_sql)
        self.assertTrue(count_sql.lstrip().startswith("SELECT COUNT(*)"))
        self.assertEqual(count_params, ())
        self.assertEqual(item_params[-2:], (50, 0))

    def test_activity_type_options_are_distinct_sorted_bounded_values(self):
        self.connection = FakeConnection([{"sport_type": "Ride"}, {"sport_type": "MountainBikeRide"}])
        with patch("routes.activities.db_conn", return_value=self.connection):
            status, payload = asgi_get("/api/activities/search/types")

        self.assertEqual(status, 200)
        self.assertEqual(payload, {"sport_types": ["Ride", "MountainBikeRide"]})
        sql, params = self.connection.cursor_value.executions[0]
        self.assertIn("SELECT DISTINCT sport_type", sql)
        self.assertIn("ORDER BY sport_type", sql)
        self.assertIn("LIMIT %s", sql)
        self.assertEqual(params, (100,))

    def test_explicit_date_range_is_inclusive_and_single_or_reversed_bounds_fail(self):
        (status, payload), database = self.response(
            params={"start_date": "2026-09-01", "end_date": "2026-09-30"},
            rows=[],
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["total_count"], 0)
        self.assertEqual(payload["applied_start_date"], "2026-09-01")
        count_sql, count_params = self.connection.cursor_value.executions[0]
        item_sql, item_params = self.connection.cursor_value.executions[1]
        self.assertIn("sa.date_local >= %s", count_sql)
        self.assertIn("sa.date_local <= %s", count_sql)
        self.assertIn("sa.date_local >= %s", item_sql)
        self.assertIn("sa.date_local <= %s", item_sql)
        self.assertEqual(count_params, item_params[:-2])
        self.assertEqual(database.call_count, 1)

        for params in (
            {"start_date": "2026-09-01"},
            {"end_date": "2026-09-30"},
            {"start_date": "2026-10-01", "end_date": "2026-09-30"},
            {"start_date": "not-a-date", "end_date": "2026-09-30"},
        ):
            with self.subTest(params=params):
                (_, _), database = self.response(params=params)
                database.assert_not_called()

    def test_text_is_trimmed_literal_case_insensitive_and_parameterized(self):
        (status, _), _ = self.response(
            params=[("start_date", "2026-09-01"), ("end_date", "2026-09-30"), ("text", "  Bear%_  ")],
            rows=[],
        )
        self.assertEqual(status, 200)
        sql = self.connection.cursor_value.sql
        params = self.connection.cursor_value.params
        self.assertIn('lower(sa."name") LIKE lower(%s)', sql)
        self.assertNotIn("Bear", sql)
        self.assertIn("%Bear\\%\\_%", params)
        self.assertIn("ESCAPE '\\'", sql)

    def test_injection_shaped_text_does_not_change_sql_structure(self):
        text = "x%' OR 1=1 --"
        (status, _), _ = self.response(params={"text": text}, rows=[])
        self.assertEqual(status, 200)
        self.assertNotIn(text, self.connection.cursor_value.sql)
        escaped_text = text.replace("%", "\\%")
        self.assertIn(f"%{escaped_text}%", self.connection.cursor_value.params)

    def test_text_length_is_checked_after_trimming(self):
        (_, _), database = self.response(params={"text": f"  {'x' * 201}  "})
        database.assert_not_called()
        (status, _), _ = self.response(params={"text": " " + "x" * 200 + " "}, rows=[])
        self.assertEqual(status, 200)

    def test_repeatable_sport_category_and_gear_filters_use_allowlisted_columns(self):
        (status, _), _ = self.response(
            params=[
                ("sport_type", " MountainBikeRide "),
                ("sport_type", "Run"),
                ("activity_category", "RIDE"),
                ("activity_category", "walk"),
                ("gear_id", "bike-1"),
                ("gear_id", "bike-2"),
            ],
            rows=[],
        )
        self.assertEqual(status, 200)
        sql = self.connection.cursor_value.sql
        self.assertIn("lower(sa.sport_type) IN (%s, %s)", sql)
        self.assertIn("sa.activity_category IN (%s, %s)", sql)
        self.assertIn("sa.gear_id IN (%s, %s)", sql)
        self.assertEqual(
            self.connection.cursor_value.params[:6],
            ("mountainbikeride", "run", "ride", "walk", "bike-1", "bike-2"),
        )

    def test_unknown_category_and_empty_filter_values_are_rejected(self):
        for params in ({"activity_category": "cycling"}, {"sport_type": "   "}, {"gear_id": ""}):
            with self.subTest(params=params):
                (_, _), database = self.response(params=params)
                database.assert_not_called()

    def test_numeric_ranges_are_parameterized_and_reversed_ranges_fail(self):
        (status, _), _ = self.response(
            params={
                "min_distance_mi": "1.5",
                "max_distance_mi": "20",
                "min_elevation_ft": "10",
                "max_elevation_ft": "5000",
                "min_duration_sec": "60",
                "max_duration_sec": "7200",
            },
            rows=[],
        )
        self.assertEqual(status, 200)
        sql = self.connection.cursor_value.sql
        self.assertIn("sa.distance_mi >= %s", sql)
        self.assertIn("sa.distance_mi <= %s", sql)
        self.assertIn("sa.elevation_ft >= %s", sql)
        self.assertIn("sa.elevation_ft <= %s", sql)
        self.assertIn("sa.moving_sec >= %s", sql)
        self.assertIn("sa.moving_sec <= %s", sql)
        self.assertEqual(self.connection.cursor_value.params[:6], (1.5, 20.0, 10.0, 5000.0, 60, 7200))

        for params in (
            {"min_distance_mi": "-1"},
            {"min_distance_mi": "5", "max_distance_mi": "4"},
            {"min_elevation_ft": "20", "max_elevation_ft": "10"},
            {"min_duration_sec": "30", "max_duration_sec": "20"},
        ):
            with self.subTest(params=params):
                (_, _), database = self.response(params=params)
                database.assert_not_called()

    def test_time_filters_use_local_wall_clock_and_exclude_missing_starts(self):
        (status, _), _ = self.response(
            params={"start_time_from": "06:00:00", "start_time_to": "11:30:00"},
            rows=[],
        )
        self.assertEqual(status, 200)
        sql = self.connection.cursor_value.sql
        self.assertIn("sa.start_at_local IS NOT NULL", sql)
        self.assertIn("sa.start_at_local::time >= %s", sql)
        self.assertIn("sa.start_at_local::time <= %s", sql)
        self.assertIn(time(6), self.connection.cursor_value.params)
        self.assertIn(time(11, 30), self.connection.cursor_value.params)

        for params in (
            {"start_time_from": "18:00", "start_time_to": "06:00"},
            {"start_time_from": "06:00-06:00"},
            {"start_time_from": "not-a-time"},
        ):
            with self.subTest(params=params):
                (_, _), database = self.response(params=params)
                database.assert_not_called()

    def test_every_sort_field_and_direction_uses_fixed_null_safe_tie_broken_sql(self):
        expected = {
            "date": "sa.date_local",
            "start": "sa.start_at_local",
            "activity": 'sa."name"',
            "type": "sa.sport_type",
            "category": "sa.activity_category",
            "bike": "g.gear_name",
            "distance": "sa.distance_mi",
            "elevation": "sa.elevation_ft",
            "moving": "sa.moving_sec",
            "elapsed": "sa.elapsed_sec",
            "load": "d.main_ride_load",
        }
        self.assertEqual(set(expected), {sort.value for sort in ActivitySortBy})
        for sort_by, expression in expected.items():
            for direction, sql_direction in (("asc", "ASC"), ("desc", "DESC")):
                with self.subTest(sort_by=sort_by, direction=direction):
                    (status, payload), _ = self.response(
                        params={"sort_by": sort_by, "sort_direction": direction},
                        rows=[],
                    )
                    self.assertEqual(status, 200)
                    self.assertEqual(payload["applied_sort_by"], sort_by)
                    self.assertEqual(payload["applied_sort_direction"], direction)
                    order_clause = self.connection.cursor_value.sql.split("ORDER BY ", 1)[1].splitlines()[0]
                    self.assertEqual(
                        order_clause,
                        f"{expression} {sql_direction} NULLS LAST, sa.activity_id {sql_direction}",
                    )

    def test_default_sort_is_newest_and_legacy_sorts_map_to_fixed_pairs(self):
        self.response(rows=[])
        self.assertEqual(self.connection.cursor_value.executions[1][0].split("ORDER BY ", 1)[1].splitlines()[0],
                         "sa.date_local DESC NULLS LAST, sa.activity_id DESC")
        expected = {
            "newest": ("date", "desc"),
            "oldest": ("date", "asc"),
            "start_time": ("start", "asc"),
            "highest_elevation": ("elevation", "desc"),
            "longest_distance": ("distance", "desc"),
            "longest_duration": ("moving", "desc"),
        }
        self.assertEqual(set(expected), {sort.value for sort in ActivitySort})
        for legacy_sort, pair in expected.items():
            with self.subTest(legacy_sort=legacy_sort):
                (status, payload), _ = self.response(params={"sort": legacy_sort}, rows=[])
                self.assertEqual(status, 200)
                self.assertEqual(payload["applied_sort"], legacy_sort)
                self.assertEqual((payload["applied_sort_by"], payload["applied_sort_direction"]), pair)

        for params in (
            {"sort_by": "date; DROP TABLE strava_activities"},
            {"sort_direction": "desc; DROP TABLE strava_activities"},
            {"sort": "newest", "sort_by": "load"},
            {"sort": "newest", "sort_direction": "asc"},
        ):
            with self.subTest(params=params):
                (_, _), database = self.response(params=params)
                database.assert_not_called()

    def test_count_and_item_queries_share_filter_sql_without_count_joins_or_paging(self):
        (status, payload), _ = self.response(
            params={
                "start_date": "2026-09-01",
                "end_date": "2026-09-30",
                "text": "bike park",
                "sport_type": "Ride",
                "activity_category": "ride",
                "gear_id": "bike-1",
                "min_distance_mi": "10",
                "max_elevation_ft": "5000",
                "min_duration_sec": "600",
                "start_time_from": "06:00",
                "start_time_to": "10:00",
                "limit": "2",
                "offset": "100",
            },
            rows=[activity_row(activity_id="101"), activity_row(activity_id="102")],
            total_count=162,
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["total_count"], 162)
        count_sql, count_params = self.connection.cursor_value.executions[0]
        item_sql, item_params = self.connection.cursor_value.executions[1]
        count_where = count_sql.partition("WHERE")[2].strip()
        item_where = item_sql.partition("WHERE")[2].split("ORDER BY", 1)[0].strip()
        self.assertEqual(count_where, item_where)
        self.assertEqual(count_params, item_params[:-2])
        self.assertTrue(count_sql.lstrip().startswith("SELECT COUNT(*)"))
        self.assertNotRegex(count_sql, r"(?i)\b(ORDER\s+BY|LIMIT|OFFSET)\b")
        self.assertNotIn("JOIN", count_sql.upper())
        self.assertIn("%bike park%", count_params)
        self.assertEqual(count_params[-2:], (time(6), time(10)))

    def test_limit_offset_and_has_more_are_derived_from_exact_total(self):
        (status, payload), _ = self.response(
            params={"limit": "2", "offset": "10"},
            rows=[activity_row(activity_id=str(value)) for value in (1, 2, 3)],
            total_count=13,
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["returned_count"], 2)
        self.assertEqual(payload["total_count"], 13)
        self.assertEqual(payload["limit"], 2)
        self.assertEqual(payload["offset"], 10)
        self.assertTrue(payload["has_more"])
        self.assertEqual(payload["next_offset"], 12)
        self.assertEqual(len(payload["items"]), 2)
        self.assertEqual(self.connection.cursor_value.params[-2:], (2, 10))

        for params in ({"limit": "101"}, {"limit": "0"}, {"offset": "-1"}, {"offset": "bad"}):
            with self.subTest(params=params):
                (_, _), database = self.response(params=params)
                database.assert_not_called()

    def test_final_page_and_empty_results_report_exact_totals(self):
        (status, payload), _ = self.response(
            params={"limit": "100", "offset": "100"},
            rows=[activity_row()],
            total_count=101,
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["limit"], 100)
        self.assertEqual(payload["total_count"], 101)
        self.assertFalse(payload["has_more"])
        self.assertIsNone(payload["next_offset"])

        (status, payload), _ = self.response(rows=[], total_count=0)
        self.assertEqual(status, 200)
        self.assertEqual(payload["returned_count"], 0)
        self.assertEqual(payload["total_count"], 0)
        self.assertFalse(payload["has_more"])
        self.assertIsNone(payload["next_offset"])

    def test_explicit_result_shape_json_safety_and_null_semantics(self):
        row = activity_row(
            start_at_local=None,
            start_at_utc=None,
            timezone=None,
            utc_offset_seconds=None,
            gear_id=None,
            gear_name=None,
            distance_mi=None,
            elevation_ft=None,
            activity_load=None,
            description="private narrative",
            private_note="private note",
            raw_json={"secret": True},
            narrative_observed_at=datetime(2026, 9, 24, tzinfo=timezone.utc),
        )
        (status, payload), _ = self.response(
            params={"start_date": "2026-09-24", "end_date": "2026-09-24"},
            rows=[row],
        )
        self.assertEqual(status, 200)
        item = payload["items"][0]
        self.assertEqual(
            set(item),
            {
                "activity_id", "date_local", "start_at_local", "start_at_utc", "timezone",
                "utc_offset_seconds", "name", "sport_type", "activity_category", "gear_id",
                "gear_name", "distance_mi", "elevation_ft", "moving_sec", "elapsed_sec", "activity_load",
            },
        )
        self.assertEqual(item["date_local"], "2026-09-24")
        self.assertIsNone(item["start_at_local"])
        self.assertIsNone(item["start_at_utc"])
        self.assertIsNone(item["timezone"])
        self.assertIsNone(item["gear_name"])
        self.assertIsNone(item["distance_mi"])
        self.assertIsNone(item["activity_load"])
        self.assertNotIn("description", item)
        self.assertNotIn("private_note", item)
        self.assertNotIn("raw_json", item)
        self.assertNotIn("narrative_observed_at", item)

    def test_selected_columns_and_joins_use_only_trusted_persisted_sources(self):
        (status, payload), _ = self.response(rows=[activity_row(activity_load=None)])
        self.assertEqual(status, 200)
        sql = self.connection.cursor_value.sql
        self.assertIn("sa.activity_id", sql)
        self.assertIn("sa.start_at_local", sql)
        self.assertIn("sa.start_at_utc", sql)
        self.assertIn("g.gear_name", sql)
        self.assertIn("LEFT JOIN public.gear AS g", sql)
        self.assertIn("LEFT JOIN public.daily_training AS d", sql)
        self.assertIn("d.date = sa.date_local", sql)
        self.assertIn("d.main_ride_id = sa.activity_id", sql)
        self.assertIn("d.main_ride_load AS activity_load", sql)
        self.assertNotIn("SELECT *", sql.upper())
        for forbidden in ("description", "private_note", "raw_json", "latitude", "longitude", "power", "cadence"):
            self.assertNotIn(forbidden, sql.lower())
        self.assertIsNone(payload["items"][0]["activity_load"])

    def test_database_failure_is_sanitized(self):
        (status, payload), database = self.response(db_error=RuntimeError("private SQL and parameters"))
        self.assertEqual(status, 503)
        self.assertEqual(payload, {"detail": "Activity search is temporarily unavailable."})
        self.assertNotIn("private SQL", json.dumps(payload))
        database.assert_called_once()


if __name__ == "__main__":
    unittest.main()
