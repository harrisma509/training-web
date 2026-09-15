import json
import sys
import types
import unittest
from datetime import date
from decimal import Decimal
from unittest.mock import patch

if "fastapi" in sys.modules and not hasattr(sys.modules["fastapi"], "Body"):
    sys.modules["fastapi"].Body = lambda default=None, **kwargs: default
    sys.modules["fastapi"].HTTPException = type("HTTPException", (Exception,), {})

if "fastapi.responses" in sys.modules and not hasattr(sys.modules["fastapi.responses"], "JSONResponse"):
    fake_responses = types.ModuleType("fastapi.responses")

    class FakeJSONResponse:
        def __init__(self, content, status_code=200):
            self.content = content
            self.status_code = status_code
            self.body = json.dumps(content).encode("utf-8")

    fake_responses.JSONResponse = FakeJSONResponse
    sys.modules["fastapi.responses"] = fake_responses

from routes.components import (
    _calculate_component_snapshot,
    api_component_service_snapshot,
    api_create_component_service,
    api_update_component_service,
)


class FakeCursor:
    def __init__(self, rows):
        self.rows = list(rows)
        self.executed = []

    def execute(self, query, params=()):
        self.executed.append((query, params))

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False

    def fetchone(self):
        return self.rows.pop(0) if self.rows else None


class FakeConnection:
    def __init__(self, cursor):
        self.cursor_value = cursor

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False

    def cursor(self):
        return self.cursor_value


def response_json(response):
    return json.loads(response.body)


class ComponentServiceContractTests(unittest.TestCase):
    def test_snapshot_is_inclusive_and_preserves_mixed_metric_lower_bound(self):
        cursor = FakeCursor(
            [
                {"gear_component_id": 12, "gear_id": "b123"},
                {
                    "qualifying_activity_count": 3,
                    "known_miles_count": 2,
                    "total_miles": Decimal("2217.71"),
                    "known_moving_count": 2,
                    "total_moving_sec": 778644,
                    "known_elevation_count": 1,
                    "total_elevation_ft": 400417,
                    "total_rides": 2,
                },
            ]
        )

        snapshot = _calculate_component_snapshot(cursor, 12, date(2026, 9, 13))

        self.assertEqual(snapshot["odometer_miles"], Decimal("2217.71"))
        self.assertEqual(snapshot["odometer_hours"], Decimal("216.29"))
        self.assertEqual(snapshot["odometer_rides"], 2)
        self.assertEqual(snapshot["odometer_elevation_ft"], 400417)
        self.assertEqual(snapshot["metric_availability"]["odometer_miles"], True)
        self.assertIn("sa.date_local <= %s", cursor.executed[1][0])
        self.assertEqual(cursor.executed[1][1], ("b123", date(2026, 9, 13)))

    def test_snapshot_with_no_activities_returns_available_zeroes(self):
        cursor = FakeCursor(
            [
                {"gear_component_id": 12, "gear_id": "b123"},
                {
                    "qualifying_activity_count": 0,
                    "known_miles_count": 0,
                    "total_miles": None,
                    "known_moving_count": 0,
                    "total_moving_sec": None,
                    "known_elevation_count": 0,
                    "total_elevation_ft": None,
                    "total_rides": 0,
                },
            ]
        )

        snapshot = _calculate_component_snapshot(cursor, 12, date(2026, 9, 13))

        self.assertEqual(snapshot["odometer_miles"], Decimal("0"))
        self.assertEqual(snapshot["odometer_hours"], Decimal("0"))
        self.assertEqual(snapshot["odometer_rides"], 0)
        self.assertEqual(snapshot["odometer_elevation_ft"], 0)
        self.assertTrue(all(snapshot["metric_availability"].values()))

    def test_preview_rejects_future_date_without_opening_database(self):
        with patch("routes.components.db_conn") as db_conn:
            response = api_component_service_snapshot(12, "2099-01-01")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response_json(response), {"detail": "service_date cannot be in the future."})
        db_conn.assert_not_called()

    def test_preview_returns_not_found_for_missing_component(self):
        cursor = FakeCursor([None])
        with patch("routes.components.db_conn", return_value=FakeConnection(cursor)):
            response = api_component_service_snapshot(12, "2026-09-13")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response_json(response), {"detail": "Component not found."})

    def test_create_persists_canonical_full_field_contract_and_server_snapshot(self):
        cursor = FakeCursor(
            [
                {"gear_component_id": 12, "gear_id": "b123"},
                {
                    "qualifying_activity_count": 1,
                    "known_miles_count": 1,
                    "total_miles": Decimal("12.5"),
                    "known_moving_count": 1,
                    "total_moving_sec": 3600,
                    "known_elevation_count": 1,
                    "total_elevation_ft": 400,
                    "total_rides": 1,
                },
                {
                    "service_event_id": 88,
                    "gear_component_id": 12,
                    "gear_id": "b123",
                    "service_date": date(2026, 9, 13),
                    "action": "Replacement",
                    "product_name": "Trail Tire",
                    "manufacturer": "Acme",
                    "model": "X1",
                    "notes": "Installed",
                    "cost": Decimal("0.00"),
                    "odometer_miles": Decimal("12.5"),
                    "odometer_hours": Decimal("1"),
                    "odometer_rides": 1,
                    "odometer_elevation_ft": 400,
                    "performed_by": "Shop",
                    "service_location": "Workshop",
                    "created_at": None,
                    "updated_at": None,
                },
            ]
        )
        payload = {
            "service_date": "2026-09-13",
            "action": "Replacement",
            "product_name": "Trail Tire",
            "manufacturer": "Acme",
            "model": "X1",
            "notes": "Installed",
            "cost": "0",
            "performed_by": "Shop",
            "service_location": "Workshop",
        }

        with patch("routes.components.db_conn", return_value=FakeConnection(cursor)):
            response = api_create_component_service(12, payload)

        body = response_json(response)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(body["action"], "Replacement")
        self.assertEqual(body["service_type"], "Replacement")
        self.assertEqual(body["product_name"], "Trail Tire")
        self.assertEqual(body["odometer_elevation_ft"], 400)
        self.assertEqual(body["elevation_at_service"], 400)
        insert_params = cursor.executed[-1][1]
        self.assertEqual(insert_params[1], "b123")
        self.assertEqual(insert_params[8], Decimal("0"))
        self.assertEqual(insert_params[9], Decimal("12.5"))
        self.assertNotIn("service_type", cursor.executed[-1][0])

    def test_create_rejects_client_snapshot_fields(self):
        with patch("routes.components.db_conn") as db_conn:
            response = api_create_component_service(
                12,
                {"service_date": "2026-09-13", "action": "Inspection", "odometer_miles": 99},
            )

        self.assertEqual(response.status_code, 400)
        self.assertIn("calculated by the server", response_json(response)["detail"])
        db_conn.assert_not_called()

    def test_update_rejects_decimal_integer_snapshot_values(self):
        cursor = FakeCursor(
            [
                {"gear_component_id": 12, "gear_id": "b123"},
                {
                    "service_event_id": 88,
                    "gear_component_id": 12,
                    "gear_id": "b123",
                    "service_date": date(2026, 9, 13),
                    "action": "Inspection",
                    "product_name": None,
                    "manufacturer": None,
                    "model": None,
                    "notes": None,
                    "cost": None,
                    "odometer_miles": Decimal("1"),
                    "odometer_hours": Decimal("1"),
                    "odometer_rides": 1,
                    "odometer_elevation_ft": 1,
                    "performed_by": None,
                    "service_location": None,
                },
            ]
        )

        with patch("routes.components.db_conn", return_value=FakeConnection(cursor)):
            response = api_update_component_service(12, 88, {"odometer_rides": "2.5"})

        self.assertEqual(response.status_code, 400)
        self.assertIn("integer", response_json(response)["detail"])
        self.assertEqual(len(cursor.executed), 2)

    def test_create_rejects_future_date(self):
        with patch("routes.components.db_conn") as db_conn:
            response = api_create_component_service(
                12,
                {"service_date": "2099-01-01", "action": "Inspection"},
            )

        self.assertEqual(response.status_code, 400)
        db_conn.assert_not_called()


if __name__ == "__main__":
    unittest.main()
