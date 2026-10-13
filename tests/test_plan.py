import json
import unittest
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError
from starlette.requests import Request

from app import app as training_app
from routes.plan import (
    PlanTemplatePayload,
    _mutation_guard,
    _validate_semantic_payload,
    api_plan_categories,
    api_plan_template_create,
    api_plan_template_detail,
    api_plan_template_deactivate,
    api_plan_templates,
    api_plan_template_update,
)
from services.plan_service import create_template, deactivate_template, update_template
from services.plan_service import PlanOwnershipCorrupt


def category_row(**overrides):
    row = {
        "plan_category_id": 1,
        "category_key": "endurance",
        "category_name": "Endurance",
        "color_key": None,
        "icon_key": None,
        "sort_order": 1,
    }
    row.update(overrides)
    return row


def template_row(**overrides):
    row = {
        "plan_template_id": 12,
        "template_name": "Tempo Ride",
        "template_description": "Controlled sustained effort.",
        "sort_order": 1,
        "is_favorite": False,
        "is_active": True,
        **category_row(),
        "category_sort_order": 1,
        "plan_prescription_id": 42,
        "owner_kind": "template",
        "title": "Tempo Ride",
        "description": "Controlled sustained effort.",
        "sport_type": "Unlisted Future Sport",
        "activity_category": "custom",
        "trainer": False,
        "target_duration_min": Decimal("90.00"),
        "target_load": 0,
        "target_load_source": None,
        "target_distance_mi": Decimal("0.000"),
        "target_elevation_ft": None,
        "instruction_text": None,
        "segment_count": 2,
    }
    row.update(overrides)
    return row


def segment_row(order, **overrides):
    row = {
        "plan_prescription_segment_id": 100 + order,
        "segment_order": order,
        "segment_name": f"Segment {order}",
        "repeat_group_key": None,
        "repeat_count": 1,
        "target_duration_min": Decimal("15.00") if order == 1 else None,
        "target_metric": "none",
        "zone_min": None,
        "zone_max": None,
        "target_value_min": None,
        "target_value_max": None,
        "instruction_text": None,
    }
    row.update(overrides)
    return row


def mutation_payload(**overrides):
    payload = {
        "template_name": "Tempo Ride",
        "template_description": "Controlled sustained effort.",
        "category_id": 1,
        "sort_order": 1,
        "is_favorite": False,
        "prescription": {
            "title": "Tempo Ride",
            "description": "Controlled sustained effort.",
            "sport_type": "Ride",
            "activity_category": "tempo",
            "trainer": False,
            "target_duration_min": 90.0,
            "target_load": 0,
            "target_load_source": None,
            "target_distance_mi": None,
            "target_elevation_ft": None,
            "instruction_text": "Ride steadily.",
        },
        "segments": [],
    }
    payload.update(overrides)
    return payload


def physical_therapy_payload():
    payload = mutation_payload()
    payload["prescription"]["sport_type"] = "PhysicalTherapy"
    payload["prescription"]["activity_category"] = "physical_therapy"
    return payload


def request_with_headers(headers=()):
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/plan/templates",
            "headers": [
                (key.lower().encode("ascii"), value.encode("ascii"))
                for key, value in headers
            ],
            "scheme": "http",
            "server": ("192.168.1.100", 8088),
            "client": ("192.168.1.20", 50000),
        }
    )


class FakeCursor:
    def __init__(self, *, rows=None, one=None, error=None):
        self.rows = list(rows or [])
        self.one = one
        self.error = error
        self.executed = []

    def execute(self, sql, params=()):
        if self.error:
            raise self.error
        self.executed.append((sql, params))

    def fetchall(self):
        return self.rows

    def fetchone(self):
        return self.one

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
    def __init__(self, results, error_on=None):
        self.results = list(results)
        self.error_on = error_on
        self.executed = []

    def execute(self, sql, params=()):
        self.executed.append((sql, params))
        if self.error_on and self.error_on in sql.lower():
            raise RuntimeError("planned failure")

    def fetchone(self):
        return self.results.pop(0)

    def fetchall(self):
        return self.results.pop(0)

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


def response_json(response):
    return json.loads(response.body.decode("utf-8"))


class PlanRouteTests(unittest.TestCase):
    def test_categories_are_active_ordered_and_preserve_null_styles(self):
        cursor = FakeCursor(rows=[category_row()])
        with patch("routes.plan.db_conn", return_value=FakeConnection(cursor)):
            response = api_plan_categories()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response_json(response)["categories"][0]["color_key"], None)
        sql = cursor.executed[0][0].lower()
        self.assertIn("where is_active = true", sql)
        self.assertIn("order by sort_order asc, category_name asc, plan_category_id asc", sql)
        self.assertNotIn("plan_item", sql)
        self.assertNotIn("plan_batch", sql)

    def test_categories_empty_and_database_failure_are_safe(self):
        with patch("routes.plan.db_conn", return_value=FakeConnection(FakeCursor())):
            response = api_plan_categories()
        self.assertEqual(response_json(response), {"categories": []})

        with patch("routes.plan.db_conn", side_effect=RuntimeError("secret connection detail")):
            response = api_plan_categories()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response_json(response), {"detail": "Plan categories are unavailable."})
        self.assertNotIn("secret", response.body.decode("utf-8"))

    def test_template_collection_is_bounded_parameterized_and_one_query(self):
        cursor = FakeCursor(rows=[template_row()])
        with patch("routes.plan.db_conn", return_value=FakeConnection(cursor)):
            response = api_plan_templates(category_id=3, limit=200)

        payload = response_json(response)["templates"][0]
        self.assertEqual(response.status_code, 200)
        self.assertFalse(payload["is_favorite"])
        self.assertEqual(payload["prescription"]["sport_type"], "Unlisted Future Sport")
        self.assertEqual(payload["prescription"]["target_load"], 0)
        self.assertEqual(payload["prescription"]["target_distance_mi"], 0.0)
        self.assertIsNone(payload["prescription"]["target_elevation_ft"])
        self.assertEqual(payload["prescription"]["segment_count"], 2)
        self.assertEqual(len(cursor.executed), 1)
        sql, params = cursor.executed[0]
        self.assertIn("pt.is_active = true", sql)
        self.assertIn("pt.plan_category_id = %s", sql)
        self.assertIn("order by pt.sort_order asc, pt.template_name asc, pt.plan_template_id asc", sql.lower())
        self.assertEqual(params, [3, 200])
        self.assertNotIn("daily_training", sql)
        self.assertNotIn("strava_activities", sql)

    def test_physical_therapy_identity_round_trips_in_template_list_and_detail(self):
        row = template_row(
            sport_type="PhysicalTherapy",
            activity_category="physical_therapy",
        )
        with patch(
            "routes.plan.db_conn",
            return_value=FakeConnection(FakeCursor(rows=[row])),
        ):
            list_response = api_plan_templates()

        listed = response_json(list_response)["templates"][0]["prescription"]
        self.assertEqual(listed["sport_type"], "PhysicalTherapy")
        self.assertEqual(listed["activity_category"], "physical_therapy")

        with patch(
            "routes.plan.db_conn",
            return_value=FakeConnection(
                FakeCursor(one=row, rows=[segment_row(1)])
            ),
        ):
            detail_response = api_plan_template_detail(12)

        detailed = response_json(detail_response)["prescription"]
        self.assertEqual(detailed["sport_type"], "PhysicalTherapy")
        self.assertEqual(detailed["activity_category"], "physical_therapy")

    def test_template_collection_defaults_and_rejects_invalid_bounds_before_db(self):
        cursor = FakeCursor()
        with patch("routes.plan.db_conn", return_value=FakeConnection(cursor)):
            response = api_plan_templates()
        self.assertEqual(cursor.executed[0][1], [100])

        with patch("routes.plan.db_conn") as db_conn:
            for category_id, limit in ((0, 100), (-1, 100), (None, 0), (None, 201)):
                with self.subTest(category_id=category_id, limit=limit):
                    response = api_plan_templates(category_id=category_id, limit=limit)
                    self.assertEqual(response.status_code, 400)
            db_conn.assert_not_called()

    def test_template_collection_empty_and_database_failure_are_safe(self):
        with patch("routes.plan.db_conn", return_value=FakeConnection(FakeCursor())):
            response = api_plan_templates()
        self.assertEqual(response_json(response), {"templates": []})

        with patch("routes.plan.db_conn", side_effect=RuntimeError("secret connection detail")):
            response = api_plan_templates()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response_json(response), {"detail": "Plan templates are unavailable."})

    def test_template_detail_has_ordered_segments_and_exactly_two_queries(self):
        cursor = FakeCursor(
            one=template_row(),
            rows=[segment_row(1), segment_row(2)],
        )
        with patch("routes.plan.db_conn", return_value=FakeConnection(cursor)):
            response = api_plan_template_detail(12)

        payload = response_json(response)
        self.assertEqual(response.status_code, 200)
        self.assertEqual([segment["segment_order"] for segment in payload["prescription"]["segments"]], [1, 2])
        self.assertFalse(payload["is_favorite"])
        self.assertEqual(len(cursor.executed), 2)
        self.assertEqual(cursor.executed[1][1], (42,))
        self.assertEqual(payload["prescription"]["target_load"], 0)
        self.assertEqual(payload["prescription"]["sport_type"], "Unlisted Future Sport")

    def test_template_detail_missing_inactive_and_invalid_ids(self):
        with patch("routes.plan.db_conn", return_value=FakeConnection(FakeCursor(one=None))):
            response = api_plan_template_detail(999999)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response_json(response), {"detail": "Plan template not found."})

        with patch("routes.plan.db_conn") as db_conn:
            response = api_plan_template_detail(0)
            self.assertEqual(response.status_code, 400)
            db_conn.assert_not_called()

    def test_template_detail_database_failure_is_safe(self):
        cursor = FakeCursor(error=RuntimeError("secret connection detail"))
        with patch("routes.plan.db_conn", return_value=FakeConnection(cursor)):
            response = api_plan_template_detail(12)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response_json(response), {"detail": "Plan templates are unavailable."})


class PlanMutationRouteTests(unittest.TestCase):
    def test_mutation_guard_accepts_same_origin_and_missing_headers(self):
        self.assertIsNone(
            _mutation_guard(
                request_with_headers(
                    [("Origin", "http://192.168.1.100:8088")]
                )
            )
        )
        self.assertIsNone(_mutation_guard(request_with_headers()))
        for referer in (
            "http://192.168.1.100:8088/",
            "http://192.168.1.100:8088/?tab=plan",
            "http://192.168.1.100:8088/calendar/plan",
            "http://192.168.1.100:8088/calendar/plan?tab=plan#today",
        ):
            with self.subTest(referer=referer):
                self.assertIsNone(
                    _mutation_guard(request_with_headers([("Referer", referer)]))
                )

    def test_mutation_guard_rejects_cross_origin_before_database(self):
        for header_name, value in (
            ("Origin", "http://evil.example"),
            ("Referer", "http://192.168.1.100:8089/"),
            ("Referer", "https://192.168.1.100:8088/"),
            ("Referer", "http://192.168.1.100.evil:8088/x"),
            ("Referer", "http://user:password@192.168.1.100:8088/x"),
            ("Referer", "http://192.168.1.100:bad-port/x"),
        ):
            with self.subTest(header_name=header_name, value=value):
                response = _mutation_guard(
                    request_with_headers([(header_name, value)])
                )
                self.assertEqual(response.status_code, 403)

    def test_favorite_field_is_strict_and_create_defaults_false(self):
        payload = PlanTemplatePayload.model_validate(mutation_payload())
        self.assertFalse(payload.is_favorite)
        self.assertTrue(
            PlanTemplatePayload.model_validate(
                mutation_payload(is_favorite=True)
            ).is_favorite
        )
        for value in (None, "true", 1):
            with self.subTest(value=value):
                with self.assertRaises(ValidationError):
                    PlanTemplatePayload.model_validate(
                        mutation_payload(is_favorite=value)
                    )

    def test_structural_errors_use_fastapi_422_and_semantic_order_uses_400(self):
        client = TestClient(training_app)
        with patch("routes.plan.create_template") as create:
            response = client.post(
                "/api/plan/templates",
                json={
                    key: value
                    for key, value in mutation_payload().items()
                    if key != "prescription"
                },
            )
            self.assertEqual(response.status_code, 422)
            create.assert_not_called()

            response = client.post(
                "/api/plan/templates",
                json={**mutation_payload(), "category_id": "1"},
            )
            self.assertEqual(response.status_code, 422)
            response = client.post(
                "/api/plan/templates",
                json={
                    **mutation_payload(),
                    "prescription": {
                        **mutation_payload()["prescription"],
                        "target_duration_min": 1.234,
                    },
                },
            )
            self.assertEqual(response.status_code, 422)
            response = client.post(
                "/api/plan/templates",
                json={
                    **mutation_payload(),
                    "segments": [
                        {
                            "segment_order": 2,
                            "segment_name": "Segment",
                            "repeat_group_key": None,
                            "repeat_count": 1,
                            "target_duration_min": 15.0,
                            "target_metric": "none",
                            "zone_min": None,
                            "zone_max": None,
                            "target_value_min": None,
                            "target_value_max": None,
                            "instruction_text": None,
                        }
                    ],
                },
            )
            self.assertEqual(response.status_code, 400)
            create.assert_not_called()

    def test_mutation_payload_rejects_forbidden_fields_and_semantic_errors(self):
        payload = PlanTemplatePayload.model_validate(
            mutation_payload(
                segments=[
                    {
                        "segment_order": 1,
                        "segment_name": "Segment",
                        "repeat_group_key": None,
                        "repeat_count": 1,
                        "target_duration_min": 15.0,
                        "target_metric": "none",
                        "zone_min": None,
                        "zone_max": None,
                        "target_value_min": None,
                        "target_value_max": None,
                        "instruction_text": None,
                    }
                ]
            )
        )
        payload.segments[0].segment_order = 2
        with self.assertRaises(HTTPException) as raised:
            _validate_semantic_payload(payload)
        self.assertEqual(raised.exception.status_code, 400)

        client = TestClient(training_app)
        response = client.post(
            "/api/plan/templates",
            json={**mutation_payload(), "owner_kind": "template"},
        )
        self.assertEqual(response.status_code, 422)

    def test_create_route_returns_full_detail_and_201(self):
        detail = SimpleNamespace(row=template_row(), segments=[segment_row(1)])
        with patch("routes.plan.create_template", return_value=detail):
            response = api_plan_template_create(
                request_with_headers(),
                PlanTemplatePayload.model_validate(mutation_payload()),
            )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response_json(response)["plan_template_id"], 12)
        self.assertFalse(response_json(response)["is_favorite"])

    def test_create_and_update_routes_round_trip_physical_therapy_identity(self):
        payload = PlanTemplatePayload.model_validate(physical_therapy_payload())
        detail = SimpleNamespace(
            row=template_row(
                sport_type="PhysicalTherapy",
                activity_category="physical_therapy",
            ),
            segments=[],
        )
        with patch("routes.plan.create_template", return_value=detail) as create:
            created = api_plan_template_create(request_with_headers(), payload)
        self.assertEqual(created.status_code, 201)
        created_prescription = response_json(created)["prescription"]
        self.assertEqual(created_prescription["sport_type"], "PhysicalTherapy")
        self.assertEqual(created_prescription["activity_category"], "physical_therapy")
        create.assert_called_once_with(payload)

        with patch("routes.plan.update_template", return_value=detail) as update:
            updated = api_plan_template_update(12, request_with_headers(), payload)
        self.assertEqual(updated.status_code, 200)
        updated_prescription = response_json(updated)["prescription"]
        self.assertEqual(updated_prescription["sport_type"], "PhysicalTherapy")
        self.assertEqual(updated_prescription["activity_category"], "physical_therapy")
        update.assert_called_once_with(12, payload)

    def test_cross_origin_create_is_rejected_without_service_call(self):
        with patch("routes.plan.create_template") as create:
            response = api_plan_template_create(
                request_with_headers([("Origin", "http://evil.example")]),
                PlanTemplatePayload.model_validate(mutation_payload()),
            )
        self.assertEqual(response.status_code, 403)
        create.assert_not_called()

    def test_update_and_deactivate_reject_nonpositive_ids(self):
        request = request_with_headers()
        response = api_plan_template_update(
            0,
            request,
            PlanTemplatePayload.model_validate(mutation_payload()),
        )
        self.assertEqual(response.status_code, 400)
        response = api_plan_template_deactivate(0, request)
        self.assertEqual(response.status_code, 400)

    def test_mutation_errors_are_narrow_and_sanitized(self):
        payload = PlanTemplatePayload.model_validate(mutation_payload())
        with patch(
            "routes.plan.create_template",
            side_effect=PlanOwnershipCorrupt(),
        ):
            response = api_plan_template_create(request_with_headers(), payload)
        self.assertEqual(response.status_code, 409)
        self.assertNotIn("PlanOwnershipCorrupt", response.body.decode())

        with patch(
            "routes.plan.create_template",
            side_effect=RuntimeError("secret database detail"),
        ):
            response = api_plan_template_create(request_with_headers(), payload)
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("secret database detail", response.body.decode())


class PlanServiceTransactionTests(unittest.TestCase):
    def test_create_commits_once_after_detail_load(self):
        cursor = TransactionCursor(
            [
                {"plan_category_id": 1},
                {"plan_prescription_id": 42},
                {"plan_template_id": 12},
                template_row(),
                [segment_row(1)],
            ]
        )
        conn = TransactionConnection(cursor)
        with patch("services.plan_service.db_conn", return_value=conn):
            detail = create_template(
                PlanTemplatePayload.model_validate(mutation_payload())
            )
        self.assertEqual(detail.row["plan_template_id"], 12)
        self.assertEqual(conn.commit_count, 1)
        self.assertEqual(conn.rollback_count, 0)
        sql = "\n".join(statement for statement, _ in cursor.executed).lower()
        self.assertNotIn("plan_item", sql)
        self.assertNotIn("plan_batch", sql)

    def test_create_persists_physical_therapy_sport_and_activity_category(self):
        cursor = TransactionCursor(
            [
                {"plan_category_id": 1},
                {"plan_prescription_id": 42},
                {"plan_template_id": 12},
                template_row(
                    sport_type="PhysicalTherapy",
                    activity_category="physical_therapy",
                ),
                [],
            ]
        )
        conn = TransactionConnection(cursor)
        payload = PlanTemplatePayload.model_validate(physical_therapy_payload())
        with patch("services.plan_service.db_conn", return_value=conn):
            detail = create_template(payload)

        insert_params = next(
            params
            for statement, params in cursor.executed
            if "insert into public.plan_prescription" in statement.lower()
        )
        self.assertEqual(insert_params[2:4], ("PhysicalTherapy", "physical_therapy"))
        self.assertEqual(detail.row["sport_type"], "PhysicalTherapy")
        self.assertEqual(detail.row["activity_category"], "physical_therapy")
        self.assertEqual(conn.commit_count, 1)

    def test_create_failure_rolls_back_without_commit(self):
        cursor = TransactionCursor(
            [
                {"plan_category_id": 1},
                {"plan_prescription_id": 42},
            ],
            error_on="insert into public.plan_prescription_segment",
        )
        conn = TransactionConnection(cursor)
        payload = mutation_payload(
            segments=[
                {
                    "segment_order": 1,
                    "segment_name": "Warm-up",
                    "repeat_group_key": None,
                    "repeat_count": 1,
                    "target_duration_min": 15.0,
                    "target_metric": "none",
                    "zone_min": None,
                    "zone_max": None,
                    "target_value_min": None,
                    "target_value_max": None,
                    "instruction_text": None,
                }
            ]
        )
        with patch("services.plan_service.db_conn", return_value=conn):
            with self.assertRaises(RuntimeError):
                create_template(PlanTemplatePayload.model_validate(payload))
        self.assertEqual(conn.commit_count, 0)
        self.assertEqual(conn.rollback_count, 1)

    def test_update_locks_template_then_prescription_and_replaces_segments(self):
        cursor = TransactionCursor(
            [
                {
                    "plan_template_id": 12,
                    "plan_prescription_id": 42,
                    "prescription_owner_kind": "template",
                    "is_active": True,
                },
                {"plan_prescription_id": 42, "owner_kind": "template"},
                {"plan_category_id": 1},
                template_row(),
                [],
            ]
        )
        conn = TransactionConnection(cursor)
        with patch("services.plan_service.db_conn", return_value=conn):
            detail = update_template(
                12,
                PlanTemplatePayload.model_validate(mutation_payload()),
            )
        self.assertEqual(detail.row["plan_template_id"], 12)
        self.assertEqual(conn.commit_count, 1)
        statements = [statement.lower() for statement, _ in cursor.executed]
        self.assertIn("for update", statements[0])
        self.assertIn("for update", statements[1])
        self.assertIn(
            "delete from public.plan_prescription_segment",
            statements[5],
        )
        self.assertNotIn("plan_item", "\n".join(statements))

    def test_update_persists_physical_therapy_sport_and_activity_category(self):
        cursor = TransactionCursor(
            [
                {
                    "plan_template_id": 12,
                    "plan_prescription_id": 42,
                    "prescription_owner_kind": "template",
                    "is_active": True,
                },
                {"plan_prescription_id": 42, "owner_kind": "template"},
                {"plan_category_id": 1},
                template_row(
                    sport_type="PhysicalTherapy",
                    activity_category="physical_therapy",
                ),
                [],
            ]
        )
        conn = TransactionConnection(cursor)
        payload = PlanTemplatePayload.model_validate(physical_therapy_payload())
        with patch("services.plan_service.db_conn", return_value=conn):
            detail = update_template(12, payload)

        update_params = next(
            params
            for statement, params in cursor.executed
            if "update public.plan_prescription" in statement.lower()
        )
        self.assertEqual(update_params[2:4], ("PhysicalTherapy", "physical_therapy"))
        self.assertEqual(detail.row["sport_type"], "PhysicalTherapy")
        self.assertEqual(detail.row["activity_category"], "physical_therapy")
        self.assertEqual(conn.commit_count, 1)

    def test_update_omitting_favorite_preserves_existing_value(self):
        cursor = TransactionCursor(
            [
                {
                    "plan_template_id": 12,
                    "plan_prescription_id": 42,
                    "prescription_owner_kind": "template",
                    "is_active": True,
                },
                {"plan_prescription_id": 42, "owner_kind": "template"},
                {"plan_category_id": 1},
                template_row(is_favorite=True),
                [],
            ]
        )
        payload = mutation_payload()
        payload.pop("is_favorite")
        conn = TransactionConnection(cursor)
        with patch("services.plan_service.db_conn", return_value=conn):
            update_template(
                12,
                PlanTemplatePayload.model_validate(payload),
            )
        template_update = next(
            statement for statement, _ in cursor.executed
            if "update public.plan_template" in statement.lower()
        )
        self.assertNotIn("is_favorite", template_update.lower())

    def test_deactivate_already_inactive_does_not_update_or_commit(self):
        cursor = TransactionCursor([{"is_active": False}])
        conn = TransactionConnection(cursor)
        with patch("services.plan_service.db_conn", return_value=conn):
            result = deactivate_template(12)
        self.assertEqual(result, {"plan_template_id": 12, "is_active": False})
        self.assertEqual(conn.commit_count, 0)
        self.assertFalse(
            any(
                "update public.plan_template" in sql.lower()
                for sql, _ in cursor.executed
            )
        )


if __name__ == "__main__":
    unittest.main()
