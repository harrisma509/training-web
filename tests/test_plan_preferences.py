import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app import app as training_app
from services.plan_preferences_service import (
    get_plan_view_preferences,
    update_plan_view_preferences,
)


class FakeCursor:
    def __init__(self, row=None, execute_error=None):
        self.row = row
        self.execute_error = execute_error
        self.queries = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def execute(self, query, params=None):
        self.queries.append((query, params))
        if self.execute_error:
            raise self.execute_error
        if "UPDATE public.app_settings" in query and self.row is not None:
            plan_settings = dict(self.row["plan_settings"])
            plan_settings["hide_past_planned"] = params[0]
            self.row = {"plan_settings": plan_settings}

    def fetchone(self):
        return self.row


class FakeConnection:
    def __init__(self, cursor):
        self.fake_cursor = cursor
        self.commits = 0
        self.rollbacks = 0

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def cursor(self):
        return self.fake_cursor

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


class PlanPreferencesTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(training_app)

    def test_get_returns_stored_boolean_and_defaults_when_key_is_missing(self):
        for value in (True, False):
            with self.subTest(value=value):
                connection = FakeConnection(FakeCursor({"plan_settings": {
                    "hide_past_planned": value,
                    "server_owned_future_key": "preserved",
                }}))
                with patch(
                    "services.plan_preferences_service.db_conn",
                    return_value=connection,
                ):
                    self.assertEqual(
                        get_plan_view_preferences(),
                        {"hide_past_planned": value},
                    )
                query, params = connection.fake_cursor.queries[0]
                self.assertIn("FROM public.app_settings", query)
                self.assertIn("WHERE settings_id = 1", query)
                self.assertNotIn("public.app_preference", query)
                self.assertIsNone(params)
                self.assertEqual(connection.commits, 0)
                self.assertEqual(connection.rollbacks, 0)

        connection = FakeConnection(FakeCursor({"plan_settings": {
            "server_owned_future_key": "preserved",
        }}))
        with patch(
            "services.plan_preferences_service.db_conn",
            return_value=connection,
        ):
            self.assertEqual(
                get_plan_view_preferences(),
                {"hide_past_planned": True},
            )

        connection = FakeConnection(FakeCursor(None))
        with patch(
            "services.plan_preferences_service.db_conn",
            return_value=connection,
        ):
            with self.assertRaisesRegex(RuntimeError, "singleton row is missing"):
                get_plan_view_preferences()

    def test_get_rejects_corrupt_stored_preference_type(self):
        connection = FakeConnection(FakeCursor({"plan_settings": {
            "hide_past_planned": "false",
        }}))
        with patch(
            "services.plan_preferences_service.db_conn",
            return_value=connection,
        ):
            with self.assertRaises(ValueError):
                get_plan_view_preferences()

    def test_put_updates_only_plan_key_and_commits_once(self):
        connection = FakeConnection(FakeCursor({"plan_settings": {
            "hide_past_planned": True,
            "server_owned_future_key": "preserved",
        }}))
        with patch(
            "services.plan_preferences_service.db_conn",
            return_value=connection,
        ):
            self.assertEqual(
                update_plan_view_preferences(False),
                {"hide_past_planned": False},
            )

        query, params = connection.fake_cursor.queries[0]
        normalized_query = " ".join(query.split())
        self.assertIn("UPDATE public.app_settings", normalized_query)
        self.assertIn("SET plan_settings = jsonb_set( plan_settings,", normalized_query)
        self.assertIn("'{hide_past_planned}'", normalized_query)
        self.assertIn("updated_at = now()", normalized_query)
        self.assertIn("WHERE settings_id = 1", normalized_query)
        self.assertNotIn("public.app_preference", normalized_query)
        self.assertNotIn("||", normalized_query)
        self.assertEqual(params, (False,))
        self.assertFalse(
            connection.fake_cursor.row["plan_settings"]["hide_past_planned"]
        )
        self.assertEqual(
            connection.fake_cursor.row["plan_settings"]["server_owned_future_key"],
            "preserved",
        )
        self.assertEqual(connection.commits, 1)
        self.assertEqual(connection.rollbacks, 0)
        self.assertRegex(normalized_query, r"^UPDATE public\.app_settings\b")
        for table_name in (
            "plan_item",
            "plan_template",
            "strava_activities",
            "daily_training",
            "weekly_training",
            "load",
        ):
            self.assertNotIn(table_name, normalized_query)

    def test_put_rejects_non_boolean_before_database_access(self):
        for value in ("false", 0, None):
            with self.subTest(value=value), patch(
                "services.plan_preferences_service.db_conn"
            ) as db_conn:
                with self.assertRaisesRegex(ValueError, "must be a boolean"):
                    update_plan_view_preferences(value)
                db_conn.assert_not_called()

    def test_put_rolls_back_when_persistence_fails(self):
        connection = FakeConnection(FakeCursor(execute_error=RuntimeError("db failure")))
        with patch(
            "services.plan_preferences_service.db_conn",
            return_value=connection,
        ):
            with self.assertRaisesRegex(RuntimeError, "db failure"):
                update_plan_view_preferences(True)
        self.assertEqual(connection.commits, 0)
        self.assertEqual(connection.rollbacks, 1)

    def test_get_endpoint_returns_strict_preferences_and_sanitizes_errors(self):
        with patch(
            "routes.plan.get_plan_view_preferences",
            return_value={"hide_past_planned": False},
        ):
            response = self.client.get("/api/plan/preferences")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"hide_past_planned": False})

        with patch(
            "routes.plan.get_plan_view_preferences",
            side_effect=RuntimeError("database internals"),
        ):
            response = self.client.get("/api/plan/preferences")
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("database internals", response.text)

    def test_put_accepts_only_strict_boolean_contract(self):
        for value in (True, False):
            with self.subTest(value=value), patch(
                "routes.plan.update_plan_view_preferences",
                return_value={"hide_past_planned": value},
            ) as update:
                response = self.client.put(
                    "/api/plan/preferences",
                    json={"hide_past_planned": value},
                )
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), {"hide_past_planned": value})
                update.assert_called_once_with(value)

        invalid_payloads = (
            {},
            {"hide_past_planned": "false"},
            {"hide_past_planned": 0},
            {"hide_past_planned": None},
            {"hide_past_planned": []},
            {"hide_past_planned": True, "unknown": False},
            [],
        )
        with patch("routes.plan.update_plan_view_preferences") as update:
            for payload in invalid_payloads:
                with self.subTest(payload=payload):
                    response = self.client.put("/api/plan/preferences", json=payload)
                    self.assertEqual(response.status_code, 400)

            response = self.client.put(
                "/api/plan/preferences",
                content=b"{not-json",
                headers={"content-type": "application/json"},
            )
            self.assertEqual(response.status_code, 400)
            update.assert_not_called()

    def test_put_uses_plan_mutation_guard_and_sanitizes_persistence_errors(self):
        with patch("routes.plan.update_plan_view_preferences") as update:
            response = self.client.put(
                "/api/plan/preferences",
                json={"hide_past_planned": False},
                headers={"origin": "https://untrusted.example"},
            )
            update.assert_not_called()
        self.assertEqual(response.status_code, 403)

        with patch(
            "routes.plan.update_plan_view_preferences",
            side_effect=RuntimeError("sensitive database detail"),
        ):
            response = self.client.put(
                "/api/plan/preferences",
                json={"hide_past_planned": False},
            )
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("sensitive database detail", response.text)


if __name__ == "__main__":
    unittest.main()
