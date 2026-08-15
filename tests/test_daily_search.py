import json
import unittest
from unittest.mock import patch

from routes.daily import api_ride_search


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

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False

    def cursor(self):
        return FakeCursor(self.rows, self.total_count)


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


if __name__ == "__main__":
    unittest.main()
