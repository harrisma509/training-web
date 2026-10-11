import json
import unittest
from decimal import Decimal
from unittest.mock import patch

from fastapi import HTTPException

from routes.plan import (
    api_plan_categories,
    api_plan_template_detail,
    api_plan_templates,
)


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


if __name__ == "__main__":
    unittest.main()
