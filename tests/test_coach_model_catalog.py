import os
import unittest
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Lock
from time import sleep
from unittest.mock import call, patch

from ai_provider import AIProviderError
from coach_model_catalog import MODEL_CATALOG, model_status
from coach_model_status import ModelListCache, get_model_status


class CoachModelCatalogTests(unittest.TestCase):
    def test_catalog_is_immutable_and_preserves_approved_pricing(self):
        gpt_5_6 = MODEL_CATALOG["gpt-5.6-luna"]
        gpt_5_6_standard = MODEL_CATALOG["gpt-5.6-luna-standard"]
        gpt_6 = MODEL_CATALOG["gpt-6-luna"]

        self.assertEqual(
            (gpt_5_6.input_rate, gpt_5_6.cached_input_rate, gpt_5_6.output_rate),
            (
                Decimal("0.0000002"),
                Decimal("0.00000002"),
                Decimal("0.0000012"),
            ),
        )
        self.assertEqual(
            (gpt_6.input_rate, gpt_6.cached_input_rate, gpt_6.output_rate),
            (
                Decimal("0.0000001"),
                Decimal("0.00000001"),
                Decimal("0.0000005"),
            ),
        )
        self.assertEqual(gpt_6.long_context_token_threshold, 272_000)
        self.assertEqual(gpt_6.long_context_input_multiplier, Decimal("2"))
        self.assertEqual(gpt_6.long_context_output_multiplier, Decimal("1.5"))
        self.assertEqual(gpt_5_6.approval_order, gpt_5_6_standard.approval_order)
        self.assertLess(gpt_5_6.approval_order, gpt_6.approval_order)
        with self.assertRaises(TypeError):
            MODEL_CATALOG["future-model"] = gpt_6

    def test_update_requires_approved_newer_same_family_model_to_be_provider_accessible(self):
        provider_models = frozenset(
            {
                "gpt-5.6-luna",
                "gpt-5.6-luna-standard",
                "gpt-6-luna",
                "other-unrelated-model",
            }
        )

        status = model_status("gpt-5.6-luna", provider_models)
        self.assertEqual(status["status"], "update_available")
        self.assertEqual(status["newer_approved_model"], "gpt-6-luna")
        self.assertTrue(status["available_to_provider"])
        self.assertTrue(status["pricing_supported"])

        alias_status = model_status("gpt-5.6-luna-standard", provider_models)
        self.assertEqual(alias_status["status"], "update_available")
        self.assertEqual(alias_status["newer_approved_model"], "gpt-6-luna")

        alias_only_status = model_status(
            "gpt-5.6-luna-standard",
            frozenset({"gpt-5.6-luna", "gpt-5.6-luna-standard"}),
        )
        self.assertEqual(alias_only_status["status"], "current")
        self.assertIsNone(alias_only_status["newer_approved_model"])

        current_status = model_status("gpt-6-luna", provider_models)
        self.assertEqual(current_status["status"], "current")
        self.assertIsNone(current_status["newer_approved_model"])

        gpt_6_unavailable = model_status("gpt-5.6-luna", frozenset({"gpt-5.6-luna"}))
        self.assertEqual(gpt_6_unavailable["status"], "current")
        self.assertIsNone(gpt_6_unavailable["newer_approved_model"])

        configured_unavailable = model_status("gpt-5.6-luna", frozenset({"gpt-6-luna"}))
        self.assertEqual(configured_unavailable["status"], "configured_model_unavailable")
        self.assertFalse(configured_unavailable["available_to_provider"])

    def test_unknown_model_is_pricing_unavailable_and_provider_list_is_not_returned(self):
        status = model_status("future-family-model", frozenset({"future-family-model", "gpt-6-luna"}))

        self.assertEqual(status["status"], "pricing_unavailable")
        self.assertFalse(status["configured_model_known"])
        self.assertFalse(status["pricing_supported"])
        self.assertTrue(status["available_to_provider"])
        self.assertNotIn("provider_model_ids", status)
        self.assertNotIn("other-unrelated-model", str(status))
        self.assertNotIn("gpt-6-luna", str(status))

    def test_provider_failure_is_status_unavailable_and_sanitized(self):
        with patch(
            "coach_model_status._model_list_cache.get",
            side_effect=AIProviderError("hidden provider detail"),
        ):
            status = get_model_status("gpt-6-luna")

        self.assertEqual(status["status"], "status_unavailable")
        self.assertIsNone(status["available_to_provider"])
        self.assertNotIn("hidden provider detail", str(status))

    def test_normal_status_uses_fresh_cache_without_another_provider_call(self):
        cache = ModelListCache()
        with patch("coach_model_status._model_list_cache", cache), patch(
            "coach_model_status._fetch_provider_model_ids",
            return_value=frozenset({"gpt-5.6-luna"}),
        ) as fetch:
            first = get_model_status("gpt-5.6-luna")
            second = get_model_status("gpt-5.6-luna")

        self.assertEqual(first["status"], "current")
        self.assertEqual(second["status"], "current")
        fetch.assert_called_once_with()

    def test_manual_refresh_bypasses_cache_repopulates_it_and_is_used_by_next_read(self):
        cache = ModelListCache()
        with patch("coach_model_status._model_list_cache", cache), patch(
            "coach_model_status._fetch_provider_model_ids",
            side_effect=[
                frozenset({"gpt-5.6-luna"}),
                frozenset({"gpt-5.6-luna", "gpt-6-luna"}),
            ],
        ) as fetch:
            initial = get_model_status("gpt-5.6-luna")
            refreshed = get_model_status("gpt-5.6-luna", force_refresh=True)
            cached = get_model_status("gpt-5.6-luna")

        self.assertEqual(initial["status"], "current")
        self.assertEqual(refreshed["status"], "update_available")
        self.assertEqual(refreshed["newer_approved_model"], "gpt-6-luna")
        self.assertEqual(cached["status"], "update_available")
        self.assertEqual(fetch.call_count, 2)

    def test_failed_manual_refresh_preserves_last_good_cache(self):
        cache = ModelListCache()
        with patch("coach_model_status._model_list_cache", cache), patch(
            "coach_model_status._fetch_provider_model_ids",
            side_effect=[
                frozenset({"gpt-6-luna"}),
                AIProviderError("sensitive provider failure"),
            ],
        ) as fetch:
            initial = get_model_status("gpt-6-luna")
            refreshed = get_model_status("gpt-6-luna", force_refresh=True)
            normal_read = get_model_status("gpt-6-luna")

        self.assertEqual(initial["status"], "current")
        self.assertEqual(refreshed["status"], "status_unavailable")
        self.assertEqual(normal_read["status"], "current")
        self.assertEqual(fetch.call_count, 2)
        self.assertNotIn("sensitive provider failure", str(refreshed))

    def test_concurrent_refreshes_share_one_provider_lookup(self):
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
            results = list(executor.map(
                lambda _: cache.get(fetch, force_refresh=True),
                range(8),
            ))

        self.assertEqual(calls, 1)
        self.assertTrue(all(result == frozenset({"gpt-6-luna"}) for result in results))

    def test_expired_cache_refreshes_once(self):
        cache = ModelListCache(ttl_seconds=10)
        calls = []

        with patch("coach_model_status.time.monotonic", side_effect=[1, 1, 2, 12, 12]):
            cache.get(lambda: calls.append("initial") or {"gpt-6-luna"})
            cache.get(lambda: calls.append("cached") or set())
            cache.get(lambda: calls.append("expired") or {"gpt-5.6-luna"})

        self.assertEqual(calls, ["initial", "expired"])


class CoachModelStatusRouteTests(unittest.TestCase):
    def test_get_and_refresh_endpoints_use_environment_selector(self):
        from routes import coach_model_status as route

        expected = {"configured_model": "gpt-5.6-luna", "status": "status_unavailable"}
        with patch.dict(os.environ, {"TRAINING_AI_MODEL": "gpt-5.6-luna"}), patch.object(
            route, "get_model_status", return_value=expected
        ) as get_status:
            self.assertEqual(route.coach_model_status(), expected)
            self.assertEqual(route.refresh_coach_model_status(), expected)

        self.assertEqual(
            get_status.call_args_list,
            [
                call("gpt-5.6-luna"),
                call("gpt-5.6-luna", force_refresh=True),
            ],
        )


if __name__ == "__main__":
    unittest.main()
