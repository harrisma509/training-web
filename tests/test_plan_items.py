import json
import unittest
from datetime import date
from decimal import Decimal
from unittest.mock import patch

from fastapi.testclient import TestClient

from app import app as training_app
from routes.plan_items import api_plan_items


def item_row(**overrides):
    row = {
        "plan_item_id": 41,
        "planned_date": date(2026, 10, 12),
        "sort_order": 10,
        "item_state": "committed",
        "item_source": "template",
        "user_note": "Keep this controlled.",
        "plan_category_id": 1,
        "category_key": "endurance",
        "category_name": "Endurance",
        "color_key": None,
        "icon_key": None,
        "source_template_id": 7,
        "template_name": "Z2 Endurance Ride",
        "template_is_active": False,
        "plan_batch_id": None,
        "batch_status": None,
        "batch_type": None,
        "batch_name": None,
        "plan_prescription_id": 81,
        "title": "Z2 Endurance Ride",
        "description": "Steady aerobic endurance ride.",
        "sport_type": "Unknown Sport",
        "activity_category": "unknown-category",
        "trainer": False,
        "target_duration_min": Decimal("90.00"),
        "target_load": 0,
        "target_load_source": None,
        "target_distance_mi": Decimal("0.000"),
        "target_elevation_ft": None,
        "instruction_text": "Stay conversational.",
    }
    row.update(overrides)
    return row


def segment_row(order=1, **overrides):
    row = {
        "plan_prescription_segment_id": 101 + order,
        "plan_prescription_id": 81,
        "segment_order": order,
        "segment_name": "Work",
        "repeat_group_key": None,
        "repeat_count": 1,
        "target_duration_min": Decimal("15.00"),
        "target_metric": "future-metric",
        "zone_min": None,
        "zone_max": None,
        "target_value_min": Decimal("0.00"),
        "target_value_max": Decimal("10.00"),
        "instruction_text": "Ride steadily.",
    }
    row.update(overrides)
    return row


class FakeCursor:
    def __init__(self, *, results=None, error_on=None):
        self.results = list(results or [])
        self.error_on = error_on
        self.executed = []

    def execute(self, sql, params=()):
        self.executed.append((sql, params))
        if self.error_on is not None and self.error_on == len(self.executed):
            raise RuntimeError("raw database failure")

    def fetchall(self):
        return self.results.pop(0)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class FakeConnection:
    def __init__(self, cursor):
        self.cursor_value = cursor

    def cursor(self):
        return self.cursor_value

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def response_json(response):
    return json.loads(response.body.decode("utf-8"))


class PlanItemRouteTests(unittest.TestCase):
    def test_required_and_invalid_ranges_return_422(self):
        client = TestClient(training_app)

        for params in (
            {},
            {"start_date": "2026-10-05"},
            {"end_date": "2026-11-02"},
            {"start_date": "not-a-date", "end_date": "2026-11-02"},
        ):
            with self.subTest(params=params):
                response = client.get("/api/plan/items", params=params)
                self.assertEqual(response.status_code, 422)

        for start_date, end_date in (
            ("2026-10-05", "2026-10-05"),
            ("2026-11-02", "2026-10-05"),
            ("2026-10-01", "2026-11-03"),
        ):
            with self.subTest(start_date=start_date, end_date=end_date):
                response = client.get(
                    "/api/plan/items",
                    params={"start_date": start_date, "end_date": end_date},
                )
                self.assertEqual(response.status_code, 422)

    def test_valid_empty_range_echoes_boundaries_and_uses_one_query(self):
        cursor = FakeCursor(results=[[]])
        with patch(
            "routes.plan_items.db_conn",
            return_value=FakeConnection(cursor),
        ):
            response = api_plan_items(date(2026, 10, 5), date(2026, 11, 2))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response_json(response),
            {
                "start_date": "2026-10-05",
                "end_date": "2026-11-02",
                "items": [],
            },
        )
        self.assertEqual(len(cursor.executed), 1)

    def test_maximum_range_and_visibility_sql_contract(self):
        cursor = FakeCursor(results=[[]])
        with patch(
            "routes.plan_items.db_conn",
            return_value=FakeConnection(cursor),
        ):
            response = api_plan_items(date(2026, 10, 1), date(2026, 11, 1))

        self.assertEqual(response.status_code, 200)
        sql = cursor.executed[0][0].lower()
        self.assertIn("pi.item_state = 'committed'", sql)
        self.assertIn("pi.item_state = 'draft'", sql)
        self.assertIn("pb.batch_status = 'open'", sql)
        self.assertNotIn("cancelled", sql)
        for table in (
            "strava_activities",
            "daily_training",
            "weekly_training",
            "load",
            "fitness",
            "fatigue",
            "form",
            "daily_checkins",
        ):
            self.assertNotIn(f"public.{table}", sql)

    def test_items_are_shaped_with_full_segments_and_two_queries(self):
        rows = [
            item_row(
                plan_item_id=42,
                planned_date=date(2026, 10, 6),
                sort_order=0,
                plan_prescription_id=82,
                source_template_id=None,
                template_name=None,
                template_is_active=None,
                item_state="draft",
                item_source="manual",
                user_note=None,
                plan_batch_id=12,
                batch_status="open",
                batch_type="manual",
                batch_name="October planning",
                trainer=None,
                target_duration_min=Decimal("30.00"),
                target_distance_mi=None,
                sport_type="Open Sport",
                activity_category="open-category",
            ),
            item_row(
                plan_item_id=41,
                planned_date=date(2026, 10, 12),
                sort_order=10,
            ),
        ]
        segments = [
            segment_row(
                plan_prescription_id=81,
                segment_order=2,
                segment_name="Cooldown",
            ),
            segment_row(
                plan_prescription_id=81,
                segment_order=1,
                segment_name="Warmup",
            ),
        ]
        cursor = FakeCursor(results=[rows, segments])
        with patch(
            "routes.plan_items.db_conn",
            return_value=FakeConnection(cursor),
        ):
            response = api_plan_items(date(2026, 10, 5), date(2026, 11, 2))

        payload = response_json(response)
        self.assertEqual(response.status_code, 200)
        self.assertEqual([item["plan_item_id"] for item in payload["items"]], [42, 41])
        self.assertEqual(payload["items"][0]["batch"]["batch_name"], "October planning")
        self.assertIsNone(payload["items"][0]["source_template"])
        self.assertEqual(payload["items"][1]["source_template"]["is_active"], False)
        self.assertEqual(
            [segment["segment_order"] for segment in payload["items"][1]["prescription"]["segments"]],
            [1, 2],
        )
        self.assertEqual(payload["items"][0]["prescription"]["trainer"], None)
        self.assertEqual(payload["items"][1]["prescription"]["target_load"], 0)
        self.assertEqual(payload["items"][1]["prescription"]["target_distance_mi"], 0.0)
        self.assertEqual(len(cursor.executed), 2)

        parent_sql, parent_params = cursor.executed[0]
        segment_sql, segment_params = cursor.executed[1]
        self.assertEqual(parent_params, (date(2026, 10, 5), date(2026, 11, 2)))
        self.assertEqual(segment_params, ([82, 81],))
        self.assertIn("pi.planned_date >= %s", parent_sql)
        self.assertIn("pi.planned_date < %s", parent_sql)
        self.assertIn("pi.prescription_owner_kind = 'item'", parent_sql)
        self.assertIn("pp.owner_kind = 'item'", parent_sql)
        self.assertIn("order by", parent_sql.lower())
        self.assertIn("order by", segment_sql.lower())
        self.assertNotIn("select *", parent_sql.lower())
        self.assertNotIn("select *", segment_sql.lower())
        self.assertNotIn("idempotency_key", parent_sql.lower())
        self.assertNotIn("source_reference", parent_sql.lower())

    def test_database_failures_return_safe_503_without_raw_error(self):
        for error_on in (1, 2):
            cursor = FakeCursor(
                results=[[] if error_on == 1 else [item_row()], []],
                error_on=error_on,
            )
            with patch(
                "routes.plan_items.db_conn",
                return_value=FakeConnection(cursor),
            ):
                response = api_plan_items(
                    date(2026, 10, 5),
                    date(2026, 11, 2),
                )

            self.assertEqual(response.status_code, 503)
            self.assertEqual(
                response_json(response),
                {"detail": "Plan items are unavailable."},
            )
            self.assertNotIn("raw database failure", response.body.decode())

    def test_router_is_registered(self):
        paths = {
            route.path
            for route in training_app.routes
            if hasattr(route, "path")
        }
        self.assertIn("/api/plan/items", paths)
