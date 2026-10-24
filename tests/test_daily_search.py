import json
import unittest
from datetime import date, timedelta
from unittest.mock import patch

from fastapi import HTTPException

from routes.daily import api_daily, api_ride_search


class FakeCursor:
    def __init__(self, rows, total_count):
        self.rows = rows
        self.total_count = total_count
        self.executed = []

    def execute(self, sql, params=()):
        self.executed.append((sql, params))
        return None

    def fetchone(self):
        return {"total_count": self.total_count}

    def fetchall(self):
        return self.rows

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False


class FakeConn:
    def __init__(self, rows, total_count):
        self.rows = rows
        self.total_count = total_count
        self.cursor_value = FakeCursor(rows, total_count)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False

    def cursor(self):
        return self.cursor_value


class RideSearchRouteTests(unittest.TestCase):
    def _load_json(self, response):
        return json.loads(response.body.decode("utf-8"))

    def test_partial_match_and_case_insensitive(self):
        rows = [{
            "date": "2024-05-05",
            "main_ride_name": "Floyd Hill",
            "main_ride_bike_name": "Road Bike",
            "main_ride_miles": 24.7,
            "main_ride_elevation_ft": 890,
            "main_ride_time": "1:15:00",
            "main_ride_load": 90,
            "main_ride_id": "12345",
        }]

        with patch("routes.daily.db_conn", return_value=FakeConn(rows, 1)):
            response = api_ride_search("floyd")

        payload = self._load_json(response)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["rows"][0]["main_ride_name"], "Floyd Hill")
        self.assertEqual(payload["total_count"], 1)

    def test_empty_and_too_short_queries_are_rejected(self):
        with patch("routes.daily.db_conn", return_value=FakeConn([], 0)):
            response = api_ride_search("")
            payload = self._load_json(response)
            self.assertEqual(payload["rows"], [])
            self.assertEqual(payload["total_count"], 0)

            response = api_ride_search(" ")
            payload = self._load_json(response)
            self.assertEqual(payload["rows"], [])
            self.assertEqual(payload["total_count"], 0)

            response = api_ride_search("a")
            payload = self._load_json(response)
            self.assertEqual(payload["rows"], [])
            self.assertEqual(payload["total_count"], 0)

    def test_wildcards_and_special_characters_are_treated_as_literal_search_text(self):
        rows = [{
            "date": "2024-03-03",
            "main_ride_name": "Lair O' The Bear 100%",
            "main_ride_bike_name": "Trail Bike",
            "main_ride_miles": 29.1,
            "main_ride_elevation_ft": 1600,
            "main_ride_time": "2:05:00",
            "main_ride_load": 120,
            "main_ride_id": "98765",
        }]

        with patch("routes.daily.db_conn", return_value=FakeConn(rows, 1)):
            response = api_ride_search("bear 100%")
            payload = self._load_json(response)
            self.assertEqual(payload["rows"][0]["main_ride_name"], "Lair O' The Bear 100%")

    def test_null_optional_field_and_total_count(self):
        rows = [{
            "date": "2024-02-01",
            "main_ride_name": "Town Climb",
            "main_ride_bike_name": None,
            "main_ride_miles": 12.5,
            "main_ride_elevation_ft": None,
            "main_ride_time": None,
            "main_ride_load": None,
            "main_ride_id": None,
        }]

        with patch("routes.daily.db_conn", return_value=FakeConn(rows, 3)):
            response = api_ride_search("climb")
            payload = self._load_json(response)
            self.assertIsNone(payload["rows"][0]["main_ride_bike_name"])
            self.assertIsNone(payload["rows"][0]["main_ride_id"])
            self.assertEqual(payload["total_count"], 3)


class DailyDateRouteTests(unittest.TestCase):
    def test_plan_window_range_is_accepted_and_uses_exclusive_end(self):
        start_date = date(2026, 8, 24)
        end_date = start_date + timedelta(days=119)
        connection = FakeConn([], 0)

        with patch("routes.daily.db_conn", return_value=connection):
            response = api_daily(limit=365, start_date=start_date, end_date=end_date)

        self.assertEqual(response.status_code, 200)
        sql, params = connection.cursor_value.executed[0]
        self.assertIn("dates.date >= %s", sql)
        self.assertIn("dates.date < %s", sql)
        self.assertEqual(params[-3:], (start_date, end_date, 365))

    def test_ranges_over_limit_and_existing_invalid_ranges_are_rejected(self):
        start_date = date(2026, 8, 24)
        invalid_ranges = (
            ({"start_date": start_date, "end_date": start_date + timedelta(days=120)},
             "date range must not exceed 119 days"),
            ({"start_date": start_date}, "start_date and end_date must be provided together"),
            ({"start_date": start_date, "end_date": start_date},
             "start_date must be before end_date"),
            ({"date": start_date, "start_date": start_date, "end_date": start_date + timedelta(days=1)},
             "date cannot be combined with a date range"),
        )

        for parameters, expected_detail in invalid_ranges:
            with self.subTest(parameters=parameters), patch("routes.daily.db_conn") as db_conn:
                with self.assertRaises(HTTPException) as raised:
                    api_daily(**parameters)
                self.assertEqual(raised.exception.status_code, 422)
                self.assertEqual(raised.exception.detail, expected_detail)
                db_conn.assert_not_called()

    def test_exact_date_is_parameterized_for_default_and_text_filtered_reads(self):
        requested_date = date(2012, 7, 15)
        rows = [{"date": requested_date, "main_ride_name": "Historic Ride"}]
        connection = FakeConn(rows, 1)

        with patch("routes.daily.db_conn", return_value=connection):
            response = api_daily(limit=1, date=requested_date)

        self.assertEqual(response.status_code, 200)
        payload = json.loads(response.body.decode("utf-8"))
        self.assertEqual(payload[0]["date"], "2012-07-15")
        daily_sql, daily_params = connection.cursor_value.executed[0]
        self.assertIn("where dates.date = %s", daily_sql)
        self.assertEqual(daily_params, (requested_date, 1))

        connection = FakeConn(rows, 1)
        with patch("routes.daily.db_conn", return_value=connection):
            response = api_daily(limit=1, q="Historic", date=requested_date)

        self.assertEqual(response.status_code, 200)
        count_sql, count_params = connection.cursor_value.executed[0]
        search_sql, search_params = connection.cursor_value.executed[1]
        self.assertIn("from daily_training", search_sql)
        self.assertIn("and date = %s", count_sql)
        self.assertIn("and daily_training.date = %s", search_sql)
        self.assertEqual(count_params, ("%Historic%", requested_date))
        self.assertEqual(search_params, ("%Historic%", requested_date, 1))


if __name__ == "__main__":
    unittest.main()
