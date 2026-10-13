import json
import unittest
from datetime import date, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient
from starlette.requests import Request

from app import app as training_app
from routes.plan_items import (
    CreateFromTemplatePayload,
    CreateManualItemPayload,
    api_plan_item_from_template,
    api_plan_item_manual,
    api_plan_items,
)
from services.plan_service import (
    PlanDateNotFuture,
    create_item_from_template,
    create_manual_item,
)


def future_planned_date():
    return datetime.now(ZoneInfo("America/Denver")).date() + timedelta(days=1)


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


def prescription_row(**overrides):
    row = {
        "plan_prescription_id": 42,
        "owner_kind": "template",
        "title": "Z2 Endurance Ride",
        "description": "Steady aerobic endurance ride.",
        "sport_type": "Ride",
        "activity_category": "endurance",
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


def manual_payload(**overrides):
    payload = {
        "planned_date": "2026-10-12",
        "category_id": 1,
        "sort_order": 0,
        "user_note": None,
        "prescription": {
            "title": "Manual Endurance Ride",
            "description": None,
            "sport_type": "Ride",
            "activity_category": "endurance",
            "trainer": False,
            "target_duration_min": 45.0,
            "target_load": 0,
            "target_load_source": None,
            "target_distance_mi": None,
            "target_elevation_ft": None,
            "instruction_text": "Keep this conversational.",
        },
        "segments": [],
    }
    payload.update(overrides)
    return payload


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


class TransactionCursor:
    def __init__(self, *, one=None, many=None, error_on=None):
        self.one = list(one or [])
        self.many = list(many or [])
        self.error_on = error_on
        self.executed = []

    def execute(self, sql, params=()):
        self.executed.append((sql, params))
        if self.error_on and self.error_on in sql.lower():
            raise RuntimeError("raw database failure")

    def fetchone(self):
        return self.one.pop(0)

    def fetchall(self):
        return self.many.pop(0)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class TransactionConnection:
    def __init__(self, cursor):
        self.cursor_value = cursor
        self.commit_count = 0
        self.rollback_count = 0

    def cursor(self):
        return self.cursor_value

    def commit(self):
        self.commit_count += 1

    def rollback(self):
        self.rollback_count += 1

    def __enter__(self):
        return self

    def __exit__(self, exc_type, *_):
        if exc_type is not None:
            self.rollback()
        return False


def request_with_headers(headers=()):
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/plan/items/manual",
            "headers": [
                (key.lower().encode("ascii"), value.encode("ascii"))
                for key, value in headers
            ],
            "scheme": "http",
            "server": ("192.168.1.100", 8088),
            "client": ("192.168.1.20", 50000),
        }
    )


def response_json(response):
    return json.loads(response.body.decode("utf-8"))


class PlanItemRouteTests(unittest.TestCase):
    def test_manual_route_rejects_today_before_service(self):
        payload = manual_payload(planned_date="2026-10-11")
        with (
            patch("routes.plan_items._denver_today", return_value=date(2026, 10, 11)),
            patch("routes.plan_items.create_manual_item") as create,
        ):
            response = api_plan_item_manual(
                request_with_headers(),
                CreateManualItemPayload.model_validate(payload),
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response_json(response)["detail"], "planned_date must be after today.")
        create.assert_not_called()

    def test_manual_route_rejects_cross_origin_before_service(self):
        payload = CreateManualItemPayload.model_validate(manual_payload())
        with patch("routes.plan_items.create_manual_item") as create:
            response = api_plan_item_manual(
                request_with_headers(
                    (("origin", "https://evil.example"),),
                ),
                payload,
            )

        self.assertEqual(response.status_code, 403)
        create.assert_not_called()

    def test_manual_route_returns_full_item_shape(self):
        planned_date = future_planned_date()
        detail = SimpleNamespace(
            row=item_row(plan_item_id=101, planned_date=planned_date, item_source="manual"),
            segments=[],
        )
        payload = CreateManualItemPayload.model_validate(
            manual_payload(planned_date=planned_date.isoformat()),
        )
        with patch(
            "routes.plan_items.create_manual_item",
            return_value=detail,
        ) as create:
            response = api_plan_item_manual(request_with_headers(), payload)

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response_json(response)["plan_item_id"], 101)
        self.assertEqual(response_json(response)["item_source"], "manual")
        create.assert_called_once_with(payload)

    def test_clone_route_returns_created_item(self):
        planned_date = future_planned_date()
        detail = SimpleNamespace(
            row=item_row(plan_item_id=102, planned_date=planned_date),
            segments=[segment_row()],
        )
        payload = CreateFromTemplatePayload(
            plan_template_id=7,
            planned_date=planned_date,
            sort_order=0,
            user_note="Clone",
        )
        with patch(
            "routes.plan_items.create_item_from_template",
            return_value=detail,
        ) as create:
            response = api_plan_item_from_template(
                request_with_headers(),
                payload,
            )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response_json(response)["plan_item_id"], 102)
        create.assert_called_once_with(payload)

    def test_clone_service_locks_template_then_prescription_and_commits_once(self):
        detail = item_row(plan_item_id=101, plan_prescription_id=201)
        cursor = TransactionCursor(
            one=[
                {
                    "plan_template_id": 7,
                    "plan_category_id": 1,
                    "plan_prescription_id": 42,
                    "prescription_owner_kind": "template",
                    "is_active": True,
                },
                {"plan_category_id": 1, "is_active": True},
                prescription_row(),
                {"is_future": True},
                {"plan_prescription_id": 201},
                {"plan_item_id": 101},
                detail,
            ],
            many=[[segment_row()], []],
        )
        conn = TransactionConnection(cursor)
        payload = CreateFromTemplatePayload(
            plan_template_id=7,
            planned_date=date(2026, 10, 12),
            sort_order=0,
            user_note="Clone",
        )

        with patch("services.plan_service.db_conn", return_value=conn):
            result = create_item_from_template(payload)

        self.assertEqual(result.row["plan_item_id"], 101)
        self.assertEqual(conn.commit_count, 1)
        self.assertEqual(conn.rollback_count, 0)
        sql = [statement.lower() for statement, _ in cursor.executed]
        self.assertIn("from public.plan_template", sql[0])
        self.assertIn("for update", sql[0])
        self.assertIn("from public.plan_prescription", sql[2])
        self.assertIn("for update", sql[2])
        future_index = next(
            index
            for index, statement in enumerate(sql)
            if "current_timestamp at time zone" in statement
        )
        first_insert = next(
            index for index, statement in enumerate(sql) if "insert into" in statement
        )
        self.assertLess(future_index, first_insert)

    def test_clone_service_rejects_nonfuture_date_before_any_insert(self):
        cursor = TransactionCursor(
            one=[
                {
                    "plan_template_id": 7,
                    "plan_category_id": 1,
                    "plan_prescription_id": 42,
                    "prescription_owner_kind": "template",
                    "is_active": True,
                },
                {"plan_category_id": 1, "is_active": True},
                prescription_row(),
                {"is_future": False},
            ],
            many=[[segment_row()]],
        )
        conn = TransactionConnection(cursor)
        payload = CreateFromTemplatePayload(
            plan_template_id=7,
            planned_date=date(2026, 10, 11),
            sort_order=0,
        )

        with patch("services.plan_service.db_conn", return_value=conn):
            with self.assertRaises(PlanDateNotFuture):
                create_item_from_template(payload)

        self.assertEqual(conn.commit_count, 0)
        self.assertEqual(conn.rollback_count, 1)
        self.assertFalse(
            any("insert into" in statement.lower() for statement, _ in cursor.executed)
        )

    def test_manual_service_inserts_item_owned_prescription_and_segments(self):
        detail = item_row(plan_item_id=103, plan_prescription_id=203, item_source="manual")
        cursor = TransactionCursor(
            one=[
                {"plan_category_id": 1, "is_active": True},
                {"is_future": True},
                {"plan_prescription_id": 203},
                {"plan_item_id": 103},
                detail,
            ],
            many=[[]],
        )
        conn = TransactionConnection(cursor)
        payload = CreateManualItemPayload.model_validate(manual_payload())

        with patch("services.plan_service.db_conn", return_value=conn):
            result = create_manual_item(payload)

        self.assertEqual(result.row["item_source"], "manual")
        self.assertEqual(conn.commit_count, 1)
        insert_sql = "\n".join(statement.lower() for statement, _ in cursor.executed)
        self.assertIn("values ('item'", insert_sql)
        self.assertIn("values (", insert_sql)
        self.assertIn("'committed'", insert_sql)

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
