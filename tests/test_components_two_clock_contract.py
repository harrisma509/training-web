import unittest
from datetime import date, datetime
from decimal import Decimal

from routes.components import (
    derive_component_clocks,
    event_resets_life,
    event_resets_service,
    normalize_component_event_action,
)


def event(event_id, action, service_date="2026-01-01", miles=1000, hours=100, rides=10, elevation=10000, created_at=None):
    return {
        "service_event_id": event_id,
        "gear_component_id": 1,
        "gear_id": "bike",
        "service_date": date.fromisoformat(service_date) if service_date else None,
        "action": action,
        "product_name": None,
        "manufacturer": None,
        "model": None,
        "notes": None,
        "cost": None,
        "odometer_miles": Decimal(str(miles)) if miles is not None else None,
        "odometer_hours": Decimal(str(hours)) if hours is not None else None,
        "odometer_rides": rides,
        "odometer_elevation_ft": elevation,
        "performed_by": None,
        "service_location": None,
        "source": "test",
        "source_reference": None,
        "created_at": created_at,
        "updated_at": None,
    }


TOTALS = {
    "total_miles": Decimal("1200"),
    "total_hours": Decimal("120"),
    "total_rides": 20,
    "total_elevation_ft": 12000,
}


class ComponentsTwoClockContractTests(unittest.TestCase):
    def test_normalization_and_action_sets(self):
        self.assertEqual(normalize_component_event_action("  Brake Bleed "), "brake bleed")
        self.assertTrue(event_resets_life(" Replacement "))
        self.assertTrue(event_resets_service(" Suspension Service "))
        for action in ("Warranty", "Tire", "Brake Pads", "Chain", "Rotor", "Wheel", "Bearing", "Other"):
            self.assertFalse(event_resets_life(action))
            self.assertFalse(event_resets_service(action))

    def test_life_only_ignores_later_inspection_and_sealant(self):
        events = [event(1, "Replacement", miles=1000), event(2, "Inspection", "2026-01-02", miles=1100)]
        clocks = derive_component_clocks({"track_life": True, "track_service": False}, events, TOTALS, today=date(2026, 1, 3))
        self.assertEqual(clocks["life"]["baseline_event_id"], 1)
        self.assertEqual(clocks["life"]["usage"]["miles"], Decimal("200"))
        self.assertEqual(clocks["service"]["state"], "disabled")

        events[1]["action"] = "Sealant"
        clocks = derive_component_clocks({"track_life": True, "track_service": False}, events, TOTALS, today=date(2026, 1, 3))
        self.assertEqual(clocks["life"]["usage"]["miles"], Decimal("200"))

    def test_service_only_uses_latest_maintenance_event(self):
        events = [event(1, "Rebuild", miles=900, hours=100), event(2, "Suspension Service", "2026-01-02", miles=1100, hours=110)]
        clocks = derive_component_clocks({"track_life": False, "track_service": True}, events, TOTALS, today=date(2026, 1, 3))
        self.assertEqual(clocks["life"]["state"], "disabled")
        self.assertEqual(clocks["service"]["baseline_event_id"], 2)
        self.assertEqual(clocks["service"]["usage"]["hours"], Decimal("10"))
        self.assertEqual(clocks["service"]["state"], "ready")

    def test_both_clocks_are_independent(self):
        events = [event(1, "Installation", miles=500, hours=50), event(2, "Lowers", "2026-01-02", miles=1000, hours=100)]
        clocks = derive_component_clocks({"track_life": True, "track_service": True}, events, TOTALS, today=date(2026, 1, 3))
        self.assertEqual(clocks["life"]["baseline_event_id"], 1)
        self.assertEqual(clocks["service"]["baseline_event_id"], 2)
        self.assertEqual(clocks["life"]["usage"]["miles"], Decimal("700"))
        self.assertEqual(clocks["service"]["usage"]["miles"], Decimal("200"))

    def test_replacement_resets_both_and_ambiguous_warranty_has_no_baseline(self):
        events = [event(1, "Installation", miles=500), event(2, "Inspection", "2026-01-02", miles=1000), event(3, "Replacement", "2026-01-03", miles=1100)]
        clocks = derive_component_clocks({"track_life": True, "track_service": True}, events, TOTALS, today=date(2026, 1, 4))
        self.assertEqual(clocks["life"]["baseline_event_id"], 3)
        self.assertEqual(clocks["service"]["baseline_event_id"], 3)

        warranty = derive_component_clocks({"track_life": True, "track_service": False}, [event(4, "Warranty")], TOTALS, today=date(2026, 1, 2))
        self.assertEqual(warranty["life"]["state"], "no_baseline")
        self.assertIsNone(warranty["life"]["baseline_event"])

    def test_missing_and_backward_metrics_are_not_fallback_or_clamped(self):
        missing = event(1, "Replacement", miles=1000, hours=None, rides=None, elevation=None)
        clocks = derive_component_clocks({"track_life": True, "track_service": False}, [missing], TOTALS, today=date(2026, 1, 2))
        life = clocks["life"]
        self.assertEqual(life["usage"]["miles"], Decimal("200"))
        self.assertIsNone(life["usage"]["hours"])
        self.assertFalse(life["metric_availability"]["hours"])
        self.assertEqual(life["snapshot_source"]["hours"], "unavailable")
        self.assertEqual(life["state"], "partial")

        backward = event(2, "Replacement", miles=1300)
        clocks = derive_component_clocks({"track_life": True, "track_service": False}, [backward], TOTALS, today=date(2026, 1, 2))
        life = clocks["life"]
        self.assertIsNone(life["usage"]["miles"])
        self.assertEqual(life["state"], "review")
        self.assertIn("newer_current_total_below_baseline_snapshot", life["review_reasons"])

    def test_zero_and_same_day_ordering_are_deterministic(self):
        events = [
            event(1, "Installation", miles=1200, created_at=datetime(2026, 1, 1, 8)),
            event(2, "Replacement", miles=1200, created_at=datetime(2026, 1, 1, 9)),
        ]
        clocks = derive_component_clocks({"track_life": True, "track_service": False}, events, TOTALS, today=date(2026, 1, 1))
        self.assertEqual(clocks["life"]["baseline_event_id"], 2)
        self.assertEqual(clocks["life"]["usage"]["miles"], Decimal("0"))
        self.assertTrue(clocks["life"]["metric_availability"]["miles"])

    def test_disabled_and_no_baseline_states_are_explicit(self):
        clocks = derive_component_clocks({"track_life": False, "track_service": True}, [event(1, "Cleaning")], TOTALS, today=date(2026, 1, 2))
        self.assertEqual(clocks["life"]["state"], "disabled")
        self.assertEqual(clocks["service"]["state"], "ready")
        self.assertEqual(clocks["service"]["baseline_action"], "Cleaning")


if __name__ == "__main__":
    unittest.main()
