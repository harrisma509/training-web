import unittest
from decimal import Decimal
from unittest.mock import patch

from fastapi.testclient import TestClient

from app import app as training_app
from services.saved_locations_service import (
    SavedLocationConfigurationError,
    SavedLocationInUseError,
    SavedLocationNotFoundError,
    create_saved_location,
    delete_saved_location,
    list_active_saved_locations,
    list_saved_locations_for_management,
    resolve_home_location,
    set_home_location,
    update_saved_location,
)
from services.geocoding_service import (
    GeoapifyConfigurationError,
    GeoapifyTimezoneUnavailableError,
    resolve_place,
    search_places,
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

    def test_management_list_returns_reference_state_without_coordinates(self):
        row = {
            "location_id": 41,
            "display_name": "Home",
            "timezone_name": "America/Denver",
            "location_type": "home",
            "lifecycle_state": "active",
            "is_home": True,
            "is_referenced": True,
        }
        connection = FakeConnection(FakeCursor([[row]]))
        with patch(
            "services.saved_locations_service.db_conn",
            return_value=connection,
        ):
            result = list_saved_locations_for_management()

        self.assertEqual(result, [row])
        query, _ = connection.fake_cursor.queries[0]
        self.assertIn("AS is_referenced", query)
        self.assertNotIn("latitude", query)
        self.assertNotIn("longitude", query)

    def test_set_home_moves_home_designation_atomically(self):
        updated = {
            "location_id": 52,
            "display_name": "Trailhead",
            "timezone_name": "America/Denver",
            "location_type": "home",
            "lifecycle_state": "active",
            "is_home": True,
        }
        connection = FakeConnection(
            FakeCursor([{"location_id": 52, "lifecycle_state": "active"}, updated])
        )
        with patch(
            "services.saved_locations_service.db_conn",
            return_value=connection,
        ):
            result = set_home_location(52)

        self.assertEqual(result, updated)
        self.assertIn("LOCK TABLE", connection.fake_cursor.queries[0][0])
        self.assertIn("SET is_home = false", connection.fake_cursor.queries[2][0])
        self.assertIn("SET is_home = true", connection.fake_cursor.queries[3][0])
        self.assertEqual(connection.commits, 1)

    def test_delete_refuses_referenced_location(self):
        connection = FakeConnection(
            FakeCursor([{"location_id": 52}, {"is_referenced": True}])
        )
        with patch(
            "services.saved_locations_service.db_conn",
            return_value=connection,
        ):
            with self.assertRaises(SavedLocationInUseError):
                delete_saved_location(52)

        self.assertEqual(connection.commits, 0)
        self.assertEqual(connection.rollbacks, 1)
        self.assertNotIn(
            "DELETE FROM public.saved_location",
            "\n".join(query for query, _ in connection.fake_cursor.queries),
        )

    def test_geoapify_search_normalizes_candidates_without_coordinates(self):
        provider_response = {
            "features": [
                {
                    "properties": {
                        "place_id": "geoapify-place-1",
                        "name": "Central Park",
                        "city": "Example City",
                        "country": "Example Country",
                        "lat": 40.7,
                        "lon": -73.9,
                    }
                }
            ]
        }
        with patch(
            "services.geocoding_service._request_json",
            return_value=provider_response,
        ) as request:
            results = search_places("  Central Park  ")

        self.assertEqual(
            results,
            [
                {
                    "place_id": "geoapify-place-1",
                    "display_name": "Central Park",
                    "subtitle": "Example City, Example Country",
                }
            ],
        )
        self.assertEqual(request.call_args.args[0], "/v1/geocode/autocomplete")
        self.assertNotIn("lat", results[0])
        self.assertNotIn("lon", results[0])

    def test_geoapify_place_resolution_validates_timezone_with_reverse_lookup(self):
        details = {
            "features": [
                {
                    "properties": {
                        "place_id": "geoapify-place-1",
                        "lat": 39.7392,
                        "lon": -104.9903,
                        "timezone": {"name": "Not/A_Timezone"},
                    }
                }
            ]
        }
        reverse = {
            "features": [
                {"properties": {"timezone": {"name": "America/Denver"}}}
            ]
        }
        with patch(
            "services.geocoding_service._request_json",
            side_effect=[details, reverse],
        ) as request:
            resolved = resolve_place("geoapify-place-1")

        self.assertEqual(resolved["timezone_name"], "America/Denver")
        self.assertEqual(resolved["latitude"], Decimal("39.7392"))
        self.assertEqual(resolved["longitude"], Decimal("-104.9903"))
        self.assertEqual(request.call_args_list[0].args[0], "/v2/place-details")
        self.assertEqual(request.call_args_list[1].args[0], "/v1/geocode/reverse")

    def test_geoapify_missing_key_fails_before_network_request(self):
        with patch.dict("os.environ", {}, clear=True), patch(
            "services.geocoding_service.urlopen"
        ) as urlopen:
            with self.assertRaises(GeoapifyConfigurationError):
                search_places("Central Park")
        urlopen.assert_not_called()

    def test_geoapify_rejects_unverifiable_timezone(self):
        details = {
            "features": [
                {
                    "properties": {
                        "place_id": "geoapify-place-1",
                        "lat": 39.7392,
                        "lon": -104.9903,
                    }
                }
            ]
        }
        reverse = {"features": [{"properties": {"timezone": {"name": "Bad/Zone"}}}]}
        with patch(
            "services.geocoding_service._request_json",
            side_effect=[details, reverse],
        ):
            with self.assertRaises(GeoapifyTimezoneUnavailableError):
                resolve_place("geoapify-place-1")

    def test_saved_location_routes_search_and_reject_client_coordinates(self):
        candidate = {
            "place_id": "geoapify-place-1",
            "display_name": "Central Park",
            "subtitle": "Example City",
        }
        with patch(
            "routes.saved_locations.search_saved_locations",
            return_value=[candidate],
        ):
            response = self.client.get(
                "/api/saved-locations/search",
                params={"q": "Central Park"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"results": [candidate]})
        self.assertNotIn("latitude", response.text)
        self.assertNotIn("longitude", response.text)

        with patch(
            "routes.saved_locations.search_saved_locations",
            side_effect=GeoapifyConfigurationError(),
        ):
            response = self.client.get(
                "/api/saved-locations/search",
                params={"q": "Central Park"},
            )
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("GEOAPIFY_API_KEY", response.text)

        created = {
            "location_id": 42,
            "display_name": "Central Park",
            "timezone_name": "America/New_York",
            "location_type": "training",
            "lifecycle_state": "active",
            "is_home": False,
        }
        with patch(
            "routes.saved_locations.create_saved_location_from_place",
            return_value=created,
        ) as create:
            response = self.client.post(
                "/api/saved-locations",
                json={
                    "provider_place_id": "geoapify-place-1",
                    "display_name": "Central Park",
                    "location_type": "training",
                },
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"location": created})
        self.assertNotIn("latitude", response.text)
        self.assertNotIn("longitude", response.text)
        create.assert_called_once_with(
            provider_place_id="geoapify-place-1",
            display_name="Central Park",
            location_type="training",
        )

        with patch(
            "routes.saved_locations.create_saved_location_from_place"
        ) as create:
            response = self.client.post(
                "/api/saved-locations",
                headers={"Origin": "http://evil.example"},
                json={
                    "provider_place_id": "geoapify-place-1",
                    "display_name": "Central Park",
                    "location_type": "training",
                },
            )
        self.assertEqual(response.status_code, 403)
        create.assert_not_called()

        with patch(
            "routes.saved_locations.create_saved_location_from_place"
        ) as create:
            response = self.client.post(
                "/api/saved-locations",
                json={
                    "provider_place_id": "geoapify-place-1",
                    "display_name": "Central Park",
                    "location_type": "training",
                    "latitude": 40.7,
                    "longitude": -73.9,
                    "timezone_name": "America/New_York",
                },
            )
        self.assertEqual(response.status_code, 422)
        create.assert_not_called()

    def test_saved_location_management_routes_sanitize_and_protect_references(self):
        location = {
            "location_id": 41,
            "display_name": "Home",
            "timezone_name": "America/Denver",
            "location_type": "home",
            "lifecycle_state": "active",
            "is_home": True,
            "is_referenced": True,
        }
        with patch(
            "routes.saved_locations.list_saved_locations_for_management",
            return_value=[location],
        ):
            response = self.client.get("/api/saved-locations/manage")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"locations": [location]})
        self.assertNotIn("latitude", response.text)
        self.assertNotIn("longitude", response.text)

        with patch(
            "routes.saved_locations.update_saved_location",
            return_value=location,
        ) as update:
            response = self.client.patch(
                "/api/saved-locations/41",
                json={
                    "display_name": "Home",
                    "lifecycle_state": "active",
                },
            )
        self.assertEqual(response.status_code, 200)
        update.assert_called_once_with(
            41,
            display_name="Home",
            lifecycle_state="active",
        )

        with patch(
            "routes.saved_locations.set_home_location",
            return_value=location,
        ) as set_home:
            response = self.client.put("/api/saved-locations/41/home")
        self.assertEqual(response.status_code, 200)
        set_home.assert_called_once_with(41)

        with patch(
            "routes.saved_locations.delete_saved_location",
            side_effect=SavedLocationInUseError(),
        ):
            response = self.client.delete("/api/saved-locations/41")
        self.assertEqual(response.status_code, 409)


if __name__ == "__main__":
    unittest.main()
