import os
import unittest
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Lock
from time import sleep
from unittest.mock import patch

from ai_provider import AIProviderError
from coach_model_catalog import MODEL_CATALOG, model_status
from coach_model_status import ModelListCache, get_model_status


class CoachModelCatalogTests(unittest.TestCase):
    def test_catalog_is_immutable_and_preserves_approved_pricing(self):
        gpt_5_6 = MODEL_CATALOG["gpt-5.6-luna"]
        gpt_6 = MODEL_CATALOG["gpt-6-luna"]

        self.assertEqual(
            gpt_5_6.pricing_rates(),
            (
                Decimal("0.0000002"),
                Decimal("0.00000002"),
                Decimal("0.0000012"),
            ),
        )
        self.assertEqual(
            gpt_6.pricing_rates(),
            (
                Decimal("0.0000001"),
                Decimal("0.00000001"),
                Decimal("0.0000005"),
            ),
        )
        self.assertEqual(gpt_6.long_context_token_threshold, 272_000)
        self.assertEqual(gpt_6.long_context_input_multiplier, Decimal("2"))
        self.assertEqual(gpt_6.long_context_output_multiplier, Decimal("1.5"))
        with self.assertRaises(TypeError):
            MODEL_CATALOG["future-model"] = gpt_6

    def test_status_only_announces_newer_provider_accessible_approved_same_family(self):
        provider_models = frozenset({"gpt-5.6-luna", "gpt-6-luna"})

        status = model_status("gpt-5.6-luna", provider_models)
        self.assertTrue(status["configured_model_available"])
        self.assertEqual(status["newer_approved_model"], "gpt-6-luna")
        self.assertTrue(status["newer_approved_model_available"])

        alias_status = model_status("gpt-5.6-luna-standard", provider_models)
        self.assertEqual(alias_status["newer_approved_model"], "gpt-6-luna")

        current_status = model_status("gpt-6-luna", provider_models)
        self.assertIsNone(current_status["newer_approved_model"])

        unknown_status = model_status("future-family-model", provider_models)
        self.assertFalse(unknown_status["pricing_supported"])
        self.assertIsNone(unknown_status["newer_approved_model"])

    def test_status_failure_is_sanitized_and_does_not_expose_provider_details(self):
        with patch(
            "coach_model_status._model_list_cache.get",
            side_effect=AIProviderError("hidden provider detail"),
        ):
            status = get_model_status("gpt-5.6-luna")

        self.assertEqual(status["availability_status"], "unavailable")
        self.assertIsNone(status["configured_model_available"])
        self.assertIsNone(status["newer_approved_model"])
        self.assertNotIn("hidden provider detail", str(status))

    def test_model_list_cache_serializes_concurrent_refreshes(self):
        cache = ModelListCache()
        calls = 0
        calls_lock = Lock()

        def fetch():
            nonlocal calls
            with calls_lock:
                calls += 1
            sleep(0.02)
            return {"gpt-6-luna"}

        with ThreadPoolExecutor(max_workers=8) as executor:
            results = list(executor.map(lambda _: cache.get(fetch), range(8)))

        self.assertEqual(calls, 1)
        self.assertTrue(all(result == frozenset({"gpt-6-luna"}) for result in results))

    def test_model_list_cache_expires_and_failure_cooldown_is_sanitized(self):
        cache = ModelListCache(ttl_seconds=10, failure_ttl_seconds=3)
        calls = []

        with patch("coach_model_status.time.monotonic", side_effect=[1, 2, 12]):
            self.assertEqual(cache.get(lambda: calls.append("first") or {"gpt-6-luna"}), frozenset({"gpt-6-luna"}))
            self.assertEqual(cache.get(lambda: calls.append("cached") or set()), frozenset({"gpt-6-luna"}))
            self.assertEqual(cache.get(lambda: calls.append("refresh") or {"gpt-5.6-luna"}), frozenset({"gpt-5.6-luna"}))
        self.assertEqual(calls, ["first", "refresh"])

        failing_cache = ModelListCache(failure_ttl_seconds=3)
        with patch("coach_model_status.time.monotonic", side_effect=[20, 21]):
            for _ in range(2):
                with self.assertRaises(AIProviderError) as raised:
                    failing_cache.get(
                        lambda: (_ for _ in ()).throw(AIProviderError("secret provider response"))
                    )
                self.assertEqual(str(raised.exception), "Model availability could not be checked.")


class CoachModelStatusRouteTests(unittest.TestCase):
    def test_endpoint_uses_environment_selector_and_returns_sanitized_status(self):
        from routes import coach_model_status as route

        expected = {
            "configured_model": "gpt-5.6-luna",
            "availability_status": "unavailable",
        }
        with patch.dict(os.environ, {"TRAINING_AI_MODEL": "gpt-5.6-luna"}), patch.object(
            route, "get_model_status", return_value=expected
        ) as get_status:
            response = route.coach_model_status()

        get_status.assert_called_once_with("gpt-5.6-luna")
        self.assertEqual(response, expected)


if __name__ == "__main__":
    unittest.main()
