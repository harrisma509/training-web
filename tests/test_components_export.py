import csv
import io
import inspect
import json
import unittest
from datetime import date, datetime
from unittest.mock import patch

import psycopg
from fastapi import HTTPException
from fastapi.responses import JSONResponse, Response

from routes.components import COMPONENT_EXPORT_COLUMNS, export_gear_components, router


EXPECTED_HEADERS = [
    "bike_gear_id",
    "bike_name",
    "bike_brand",
    "bike_model_year",
    "bike_activity_count",
    "bike_ride_count",
    "bike_total_miles",
    "bike_total_hours",
    "bike_total_elevation_ft",
    "bike_last_activity_date",
    "gear_component_id",
    "component_key",
    "component_name",
    "component_group",
    "position",
    "component_active",
    "track_life",
    "track_service",
    "preferred_metric",
    "service_interval_miles",
    "service_interval_hours",
    "service_interval_days",
    "service_interval_rides",
    "warning_percent",
    "component_notes",
    "life_state",
    "life_baseline_event_id",
    "life_baseline_action",
    "life_baseline_service_date",
    "life_usage_miles",
    "life_usage_hours",
    "life_usage_rides",
    "life_usage_elevation_ft",
    "life_usage_days",
    "life_miles_available",
    "life_hours_available",
    "life_rides_available",
    "life_elevation_ft_available",
    "life_days_available",
    "life_miles_source",
    "life_hours_source",
    "life_rides_source",
    "life_elevation_ft_source",
    "life_days_source",
    "life_review_reasons",
    "service_state",
    "service_baseline_event_id",
    "service_baseline_action",
    "service_baseline_service_date",
    "service_usage_miles",
    "service_usage_hours",
    "service_usage_rides",
    "service_usage_elevation_ft",
    "service_usage_days",
    "service_miles_available",
    "service_hours_available",
    "service_rides_available",
    "service_elevation_ft_available",
    "service_days_available",
    "service_miles_source",
    "service_hours_source",
    "service_rides_source",
    "service_elevation_ft_source",
    "service_days_source",
    "service_review_reasons",
    "service_event_id",
    "service_date",
    "service_action",
    "service_product_name",
    "service_manufacturer",
    "service_model",
    "service_notes",
    "service_cost",
    "service_odometer_miles",
    "service_odometer_hours",
    "service_odometer_rides",
    "service_odometer_elevation_ft",
    "service_performed_by",
    "service_location",
]


def component(component_id, gear_id="bike-1", *, active=True, name=None):
    component_row = {
        "gear_component_id": component_id,
        "gear_id": gear_id,
        "component_key": f"component-{component_id}",
        "component_name": name or f"Component {component_id}",
        "component_group": "Drivetrain",
        "position": "Rear",
        "active": active,
        "track_life": True,
        "track_service": True,
        "preferred_metric": "miles",
        "service_interval_miles": 500,
        "service_interval_hours": None,
        "service_interval_days": None,
        "service_interval_rides": None,
        "warning_percent": 80,
        "notes": None,
    }
    if active:
        has_baseline = component_id == 11
        metrics = ("miles", "hours", "rides", "elevation_ft", "days")
        clock = {
            "enabled": True,
            "state": "partial" if has_baseline else "no_baseline",
            "baseline_event_id": 102 if has_baseline else None,
            "baseline_action": "Replacement" if has_baseline else None,
            "baseline_service_date": "2026-05-01" if has_baseline else None,
            "usage": {
                metric: 897.75 if metric == "miles" and has_baseline else None
                for metric in metrics
            },
            "metric_availability": {
                metric: metric == "miles" and has_baseline
                for metric in metrics
            },
            "snapshot_source": {
                metric: "event_snapshot" if metric == "miles" and has_baseline else "unavailable"
                for metric in metrics
            },
            "review_reasons": [] if has_baseline else ["no_qualifying_life_baseline"],
        }
        component_row["component_clocks"] = {"life": clock, "service": clock.copy()}
    return component_row


def service_event(event_id, component_id, service_date, *, created_at=None, notes=""):
    return {
        "service_event_id": event_id,
        "gear_component_id": component_id,
        "service_date": date.fromisoformat(service_date),
        "action": "Replacement",
        "product_name": "Trail part",
        "manufacturer": "Workshop",
        "model": f"Model {event_id}",
        "notes": notes,
        "cost": 0,
        "odometer_miles": event_id,
        "odometer_hours": None,
        "odometer_rides": 0,
        "odometer_elevation_ft": None,
        "performed_by": "Mechanic",
        "service_location": "Home shop",
        "created_at": created_at or datetime(2026, 1, 1),
    }


def bike_payload(components, archived_components=(), *, gear_id="bike-1"):
    selected_bike = {
        "gear_id": gear_id,
        "gear_name": "Trail bike",
        "brand": "Example",
        "model_year": 2024,
        "activity_count": 9,
        "ride_count": 8,
        "miles": 1000,
        "hours": 42,
        "elevation_ft": 12000,
        "last_activity_date": "2026-10-01",
    }
    return {
        "selected_gear_id": gear_id,
        "selected_bike": selected_bike,
        "available_bikes": [{"gear_id": gear_id}],
        "components": list(components),
        "archived_components": list(archived_components),
    }


class FakeCursor:
    def __init__(self, rows=()):
        self.rows = list(rows)
        self.executions = []

    def execute(self, sql, params=()):
        self.executions.append((sql, params))

    def fetchall(self):
        return self.rows

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


class FakeConnection:
    def __init__(self, cursor):
        self.cursor_value = cursor

    def cursor(self):
        return self.cursor_value

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


def csv_records(response):
    return list(csv.reader(io.StringIO(response.body.decode("utf-8-sig"), newline="")))


class ComponentsExportTests(unittest.TestCase):
    def export_with(self, payload, events=()):
        cursor = FakeCursor(events)
        connection = FakeConnection(cursor)
        with (
            patch("routes.components.api_gear_components", return_value=JSONResponse(payload)),
            patch("routes.components.db_conn", return_value=connection) as db_conn,
        ):
            response = export_gear_components(payload["selected_gear_id"])
        return response, cursor, db_conn

    def test_selected_bike_guard_and_route_are_narrow(self):
        route = next(
            route
            for route in router.routes
            if getattr(route, "path", None) == "/api/gear/components/export"
        )
        self.assertEqual(route.methods, {"GET"})
        self.assertEqual(tuple(inspect.signature(route.endpoint).parameters), ("gear_id",))
        with self.assertRaises(HTTPException) as raised:
            export_gear_components("")
        self.assertEqual(raised.exception.status_code, 422)

        with patch(
            "routes.components.api_gear_components",
            return_value=JSONResponse({"detail": "Invalid or ineligible gear_id."}, status_code=400),
        ) as roster:
            response = export_gear_components("not-a-bike")
        self.assertEqual(response.status_code, 400)
        roster.assert_called_once_with("not-a-bike")

    def test_filename_uses_the_canonical_bike_name_and_is_safe_bounded_and_deterministic(self):
        cases = (
            ("2025 Orbea Wild", "training-components-2025-orbea-wild.csv"),
            ("  2025///Orbea---Wild?!  ", "training-components-2025-orbea-wild.csv"),
            ("Café Vélo", "training-components-cafe-velo.csv"),
            (
                '../../2025\\Orbea" Wild\r\nX:\x01',
                "training-components-2025-orbea-wild-x.csv",
            ),
            ("", "training-components-bike.csv"),
            ("\U0001F6B5", "training-components-bike.csv"),
            ("A" * 200, f"training-components-{'a' * 80}.csv"),
        )
        for bike_name, filename in cases:
            with self.subTest(bike_name=bike_name):
                payload = bike_payload([])
                payload["selected_bike"]["gear_name"] = bike_name

                response, _, _ = self.export_with(payload)
                repeated_response, _, _ = self.export_with(payload)

                expected_disposition = f'attachment; filename="{filename}"'
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers["content-disposition"], expected_disposition)
                self.assertEqual(repeated_response.headers["content-disposition"], expected_disposition)
                self.assertTrue(filename.isascii())
                self.assertLessEqual(len(filename), 104)

    def test_exports_all_events_in_canonical_order_and_archived_rows_with_blank_clocks(self):
        active = [component(11), component(12)]
        archived = [component(21, active=False)]
        payload = bike_payload(active, archived)
        payload["selected_bike"]["gear_name"] = "2025 Orbea Wild"
        events = [
            service_event(102, 11, "2026-05-01", created_at=datetime(2026, 5, 1, 11), notes="=SUM(1,1)"),
            service_event(201, 21, "2026-06-01"),
            service_event(100, 11, "2026-01-01"),
            service_event(101, 11, "2026-05-01", created_at=datetime(2026, 5, 1, 10)),
            service_event(999, 999, "2026-07-01", notes="must not leak"),
        ]

        response, cursor, _ = self.export_with(payload, events)

        self.assertIsInstance(response, Response)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "text/csv; charset=utf-8")
        self.assertEqual(
            response.headers["content-disposition"],
            'attachment; filename="training-components-2025-orbea-wild.csv"',
        )
        self.assertTrue(response.body.startswith(b"\xef\xbb\xbf"))
        records = csv_records(response)
        headers = records[0]
        self.assertEqual(headers, EXPECTED_HEADERS)
        self.assertEqual(len(headers), 79)
        self.assertEqual([row[headers.index("gear_component_id")] for row in records[1:]], ["11", "11", "11", "12", "21"])
        self.assertEqual([row[headers.index("service_event_id")] for row in records[1:]], ["102", "101", "100", "", "201"])
        self.assertIn("join public.gear_component gc", cursor.executions[0][0])
        self.assertIn("where gc.gear_id = %s", cursor.executions[0][0])
        self.assertIn("gse.gear_component_id = any(%s)", cursor.executions[0][0])
        self.assertEqual(cursor.executions[0][1], ("bike-1", [11, 12, 21]))

        first_event_row = records[1]
        second_event_row = records[2]
        self.assertEqual(first_event_row[headers.index("life_baseline_event_id")], "102")
        self.assertEqual(first_event_row[headers.index("life_usage_miles")], "897.75")
        self.assertEqual(second_event_row[headers.index("life_usage_miles")], "897.75")
        self.assertEqual(first_event_row[headers.index("life_miles_available")], "true")
        self.assertEqual(first_event_row[headers.index("life_hours_available")], "false")
        self.assertEqual(first_event_row[headers.index("life_miles_source")], "event_snapshot")
        self.assertEqual(first_event_row[headers.index("life_hours_source")], "unavailable")
        self.assertEqual(first_event_row[headers.index("service_odometer_miles")], "102")
        self.assertEqual(second_event_row[headers.index("service_odometer_miles")], "101")
        self.assertEqual(first_event_row[headers.index("service_cost")], "0")
        self.assertEqual(first_event_row[headers.index("service_notes")], "'=SUM(1,1)")
        self.assertEqual(records[4][headers.index("life_state")], "no_baseline")
        self.assertEqual(records[4][headers.index("life_usage_miles")], "")
        self.assertEqual(records[4][headers.index("life_miles_available")], "false")
        self.assertEqual(records[4][headers.index("service_event_id")], "")

        archived_row = records[-1]
        clock_headers = headers[headers.index("life_state"):headers.index("service_event_id")]
        self.assertTrue(all(archived_row[headers.index(name)] == "" for name in clock_headers))
        self.assertEqual(archived_row[headers.index("component_active")], "false")
        self.assertNotIn("must not leak", response.body.decode("utf-8-sig"))

    def test_cross_bike_roster_is_rejected_and_event_query_failure_is_bounded(self):
        payload = bike_payload([component(11, gear_id="other-bike")])
        response, cursor, db_conn = self.export_with(payload)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(cursor.executions, [])
        db_conn.assert_not_called()

        payload = bike_payload([component(11)])
        with (
            patch("routes.components.api_gear_components", return_value=JSONResponse(payload)),
            patch("routes.components.db_conn", side_effect=psycopg.OperationalError("offline")),
        ):
            response = export_gear_components("bike-1")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(json.loads(response.body), {"detail": "Components export is temporarily unavailable."})

    def test_empty_roster_exports_only_headers_and_serialization_errors_are_bounded(self):
        response, cursor, db_conn = self.export_with(bike_payload([]))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(csv_records(response)), 1)
        self.assertEqual(cursor.executions, [])
        db_conn.assert_not_called()

        with (
            patch("routes.components.api_gear_components", return_value=JSONResponse(bike_payload([component(11)]))),
            patch("routes.components.db_conn", return_value=FakeConnection(FakeCursor())),
            patch("routes.components.csv_response", side_effect=TypeError("unsupported")),
        ):
            response = export_gear_components("bike-1")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(json.loads(response.body), {"detail": "Components export is temporarily unavailable."})


if __name__ == "__main__":
    unittest.main()
