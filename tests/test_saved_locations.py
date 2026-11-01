import unittest
from decimal import Decimal
from unittest.mock import patch

from fastapi.testclient import TestClient

from app import app as training_app
from services.saved_locations_service import (
    SavedLocationConfigurationError,
    SavedLocationNotFoundError,
    create_saved_location,
    list_active_saved_locations,
    resolve_home_location,
    update_saved_location,
)


class FakeCursor:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.queries = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def execute(self, query, params=None):
        self.queries.append((query, params))

    def fetchone(self):
        return next(self.responses)

    def fetchall(self):
        return next(self.responses)


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


class SavedLocationTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(training_app)

    def test_create_first_location_normalizes_coordinates_and_makes_home(self):
        created = {
            "location_id": 41,
            "display_name": "Home",
            "timezone_name": "America/Denver",
            "location_type": "home",
            "lifecycle_state": "active",
            "is_home": True,
        }
        connection = FakeConnection(FakeCursor([None, created]))
        with patch(
            "services.saved_locations_service.db_conn",
            return_value=connection,
        ):
            result = create_saved_location(
                display_name=" Home ",
                latitude="39.7392127",
                longitude="-104.9903031",
                timezone_name=" America/Denver ",
                location_type="HOME",
            )

        self.assertEqual(result, created)
        insert_query, insert_params = connection.fake_cursor.queries[-1]
        self.assertIn("INSERT INTO public.saved_location", insert_query)
        self.assertEqual(
            insert_params,
            (
                "Home",
                Decimal("39.739213"),
                Decimal("-104.990303"),
                "America/Denver",
                "home",
                "active",
                True,
            ),
        )
        self.assertEqual(connection.commits, 1)
        self.assertEqual(connection.rollbacks, 0)
        self.assertNotIn("latitude", result)
        self.assertNotIn("longitude", result)

    def test_create_rejects_non_home_first_and_second_home(self):
        cases = (
            (None, "training", "The first saved location must be Home."),
            ({"location_id": 41}, "home", "Only one Home saved location is allowed."),
        )
        for home_row, location_type, message in cases:
            with self.subTest(location_type=location_type), patch(
                "services.saved_locations_service.db_conn"
            ) as db_conn:
                connection = FakeConnection(FakeCursor([home_row]))
                db_conn.return_value = connection
                with self.assertRaisesRegex(ValueError, message):
                    create_saved_location(
                        display_name="Location",
                        latitude=40,
                        longitude=-105,
                        timezone_name="America/Denver",
                        location_type=location_type,
                    )
                self.assertEqual(connection.commits, 0)
                self.assertEqual(connection.rollbacks, 1)

    def test_invalid_fields_are_rejected_before_database_access(self):
        invalid_fields = (
            {"latitude": 91},
            {"longitude": float("nan")},
            {"timezone_name": "Not/A_Timezone"},
            {"location_type": "airport"},
            {"lifecycle_state": "deleted"},
        )
        for override in invalid_fields:
            values = {
                "display_name": "Location",
                "latitude": 40,
                "longitude": -105,
                "timezone_name": "America/Denver",
                "location_type": "training",
            }
            values.update(override)
            with self.subTest(override=override), patch(
                "services.saved_locations_service.db_conn"
            ) as db_conn:
                with self.assertRaises(ValueError):
                    create_saved_location(**values)
                db_conn.assert_not_called()

    def test_update_preserves_identity_for_rename_and_lifecycle_change(self):
        updated = {
            "location_id": 52,
            "display_name": "Trailhead",
            "timezone_name": "America/Denver",
            "location_type": "training",
            "lifecycle_state": "hidden",
            "is_home": False,
        }
        connection = FakeConnection(
            FakeCursor([{"is_home": False}, updated])
        )
        with patch(
            "services.saved_locations_service.db_conn",
            return_value=connection,
        ):
            result = update_saved_location(
                52,
                display_name=" Trailhead ",
                lifecycle_state="hidden",
            )

        self.assertEqual(result["location_id"], 52)
        self.assertEqual(result["display_name"], "Trailhead")
        self.assertEqual(result["lifecycle_state"], "hidden")
        update_query, params = connection.fake_cursor.queries[-1]
        normalized_query = " ".join(update_query.split())
        self.assertIn("WHERE location_id = %s", normalized_query)
        set_clause = normalized_query.split(" SET ", 1)[1].split(" WHERE ", 1)[0]
        self.assertNotIn("location_id", set_clause)
        self.assertEqual(params, ("Trailhead", "hidden", 52))
        self.assertEqual(connection.commits, 1)

    def test_update_rejects_archiving_home_and_missing_id(self):
        connection = FakeConnection(FakeCursor([{"is_home": True}]))
        with patch(
            "services.saved_locations_service.db_conn",
            return_value=connection,
        ):
            with self.assertRaisesRegex(ValueError, "must remain active"):
                update_saved_location(
                    52,
                    display_name="Home",
                    lifecycle_state="archived",
                )
        self.assertEqual(connection.rollbacks, 1)

        connection = FakeConnection(FakeCursor([None]))
        with patch(
            "services.saved_locations_service.db_conn",
            return_value=connection,
        ):
            with self.assertRaises(SavedLocationNotFoundError):
                update_saved_location(
                    52,
                    display_name="Missing",
                    lifecycle_state="active",
                )

    def test_list_query_returns_only_active_metadata_not_coordinates(self):
        row = {
            "location_id": 41,
            "display_name": "Home",
            "timezone_name": "America/Denver",
            "location_type": "home",
            "lifecycle_state": "active",
            "is_home": True,
        }
        connection = FakeConnection(FakeCursor([[row]]))
        with patch(
            "services.saved_locations_service.db_conn",
            return_value=connection,
        ):
            result = list_active_saved_locations()

        self.assertEqual(result, [row])
        query, _ = connection.fake_cursor.queries[0]
        self.assertIn("WHERE lifecycle_state = 'active'", query)
        self.assertNotIn("latitude", query)
        self.assertNotIn("longitude", query)
        self.assertNotIn("latitude", result[0])
        self.assertNotIn("longitude", result[0])

    def test_home_resolution_requires_one_valid_home_and_keeps_coordinates_server_side(self):
        home = {
            "location_id": 41,
            "display_name": "Home",
            "latitude": Decimal("39.739212"),
            "longitude": Decimal("-104.990303"),
            "timezone_name": "America/Denver",
            "location_type": "home",
            "lifecycle_state": "active",
            "is_home": True,
        }
        connection = FakeConnection(FakeCursor([[home]]))
        with patch(
            "services.saved_locations_service.db_conn",
            return_value=connection,
        ):
            self.assertEqual(resolve_home_location(), home)

        for rows in ([], [home, home]):
            connection = FakeConnection(FakeCursor([rows]))
            with patch(
                "services.saved_locations_service.db_conn",
                return_value=connection,
            ):
                with self.assertRaises(SavedLocationConfigurationError):
                    resolve_home_location()

    def test_api_excludes_coordinates_and_sanitizes_database_errors(self):
        public_location = {
            "location_id": 41,
            "display_name": "Home",
            "timezone_name": "America/Denver",
            "location_type": "home",
            "lifecycle_state": "active",
            "is_home": True,
        }
        with patch(
            "routes.saved_locations.list_active_saved_locations",
            return_value=[public_location],
        ):
            response = self.client.get("/api/saved-locations")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"locations": [public_location]})
        self.assertNotIn("latitude", response.text)
        self.assertNotIn("longitude", response.text)

        with patch(
            "routes.saved_locations.list_active_saved_locations",
            side_effect=RuntimeError("database internals"),
        ):
            response = self.client.get("/api/saved-locations")
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("database internals", response.text)


if __name__ == "__main__":
    unittest.main()
