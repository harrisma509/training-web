from pathlib import Path
import json
import subprocess
import unittest


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
COMPONENTS_JS = (REPOSITORY_ROOT / "static" / "components.js").read_text()
COMPONENTS_CSS = (REPOSITORY_ROOT / "static" / "components.css").read_text()


class ComponentsLifespanContractTests(unittest.TestCase):
    def run_node(self, expression):
        script = f"""
const fs = require('fs');
const vm = require('vm');
global.window = {{}};
global.document = {{getElementById: () => null, querySelectorAll: () => []}};
vm.runInThisContext(fs.readFileSync({json.dumps((REPOSITORY_ROOT / 'static' / 'components.js').as_posix())}, 'utf8'));
process.stdout.write(JSON.stringify({expression}));
"""
        result = subprocess.run(["node", "--eval", script], cwd=REPOSITORY_ROOT, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_boundary_mapping_and_maintenance_exclusion(self):
        result = self.run_node('[" Replace ", "replacement", "INSTALLATION", "new", "inspection", "brake bleed", "warranty"].map(isComponentLifecycleBoundary.bind(null))')
        self.assertEqual(result, [True, True, True, True, False, False, False])

    def test_pairing_sorting_and_newest_boundary(self):
        result = self.run_node('Array.from(deriveComponentLifespans([{service_event_id: "30", service_date: "2026-09-11", service_type: "Replacement", odometer_miles: 300}, {service_event_id: "10", service_date: "2026-02-04", service_type: "Replace", odometer_miles: 100}, {service_event_id: "20", service_date: "2026-05-31", service_type: "installation", odometer_miles: 220}, {service_event_id: "40", service_date: "2026-09-12", service_type: "inspection", odometer_miles: 400}]).entries()).map(([id, value]) => [id, value.metrics.map(metric => metric.text), value.days])')
        self.assertEqual(result, [["10", ["120.0 mi"], 116], ["20", ["80.0 mi"], 103]])

    def test_missing_zero_negative_partial_and_review_states(self):
        result = self.run_node('['
            'deriveComponentLifespans([{service_event_id: "1", service_date: "2026-01-01", service_type: "replace", odometer_miles: 10}, {service_event_id: "2", service_date: "2026-01-02", service_type: "replacement", odometer_miles: 10}]).get("1").state,'
            'deriveComponentLifespans([{service_event_id: "3", service_date: "2026-01-01", service_type: "replace", odometer_miles: 20}, {service_event_id: "4", service_date: "2026-01-02", service_type: "replacement", odometer_miles: 10}]).get("3").state,'
            'deriveComponentLifespans([{service_event_id: "5", service_date: "2026-01-01", service_type: "replace", odometer_miles: 20}, {service_event_id: "6", service_date: "2026-01-02", service_type: "replacement", odometer_miles: 30}]).get("5").state'
            ']')
        self.assertEqual(result, ["partial", "review", "partial"])

    def test_rendering_attaches_lasted_only_to_earlier_event(self):
        result = self.run_node('renderComponentLifespan(deriveComponentLifespans([{service_event_id: "2", service_date: "2026-02-01", service_type: "replacement", product_name: "New", odometer_miles: 20}, {service_event_id: "1", service_date: "2026-01-01", service_type: "replace", product_name: "Old", odometer_miles: 10}]).get("1"))')
        self.assertIn("LASTED", result)
        self.assertIn("10.0 mi", result)
        self.assertIn("1 day", result)
        self.assertIn("Completed lifespan for Old", result)
        self.assertEqual(self.run_node('renderComponentLifespan(deriveComponentLifespans([{service_event_id: "2", service_date: "2026-02-01", service_type: "replacement", odometer_miles: 20}, {service_event_id: "1", service_date: "2026-01-01", service_type: "replace", odometer_miles: 10}]).get("2"))'), "")

        def test_current_usage_reuses_authoritative_values_and_formats_singular_zero_and_missing(self):
                result = self.run_node('renderComponentCurrentUsage({miles_since_service: 13.24, hours_since_service: 1.24, rides_since_service: 1, days_since_service: 5}, "Rear Tire")')
                self.assertIn('CURRENT', result)
                self.assertIn('13.2 mi · 1.2 hr · 1 ride · 5 days', result)
                self.assertIn('Current usage for Rear Tire', result)

                zero_result = self.run_node('renderComponentCurrentUsage({miles_since_service: 0, hours_since_service: 0, rides_since_service: 0, days_since_service: 0})')
                self.assertIn('0.0 mi · 0.0 hr · 0 rides · 0 days', zero_result)

                missing_result = self.run_node('renderComponentCurrentUsage({miles_since_service: null, hours_since_service: undefined, rides_since_service: 2, days_since_service: null})')
                self.assertIn('2 rides', missing_result)
                self.assertNotIn('mi', missing_result)
                self.assertNotIn('hr', missing_result)

                unavailable_result = self.run_node('renderComponentCurrentUsage({})')
                self.assertIn('Current usage unavailable', unavailable_result)

        def test_current_attaches_only_to_newest_boundary_when_latest_event_matches(self):
                services = '[{service_event_id: "maintenance", service_date: "2026-09-12", service_type: "inspection"}, {service_event_id: "2", service_date: "2026-09-11", service_type: "replacement", odometer_miles: 20}, {service_event_id: "1", service_date: "2026-05-31", service_type: "replace", odometer_miles: 10}]'
                result = self.run_node(f'''(() => {{
                    const source = {services};
                    const newest = getComponentCurrentLifecycleEventId(source, "2");
                    return {{
                        matching: newest === "2" && renderComponentCurrentUsage({{miles_since_service: 13.2}}, "Rear Tire").includes("CURRENT"),
                        older: renderComponentLifespan(deriveComponentLifespans(source).get("1")).includes("LASTED"),
                        maintenanceBoundary: isComponentLifecycleBoundary(source[0]),
                        gated: getComponentCurrentLifecycleEventId(source, "maintenance") === ""
                    }};
                }})()''')
                self.assertEqual(result, {"matching": True, "older": True, "maintenanceBoundary": False, "gated": True})

        def test_history_rendering_contract_keeps_current_out_of_components_table(self):
                self.assertIn('currentUsage: currentComponent?.usage_since_latest_event || null', COMPONENTS_JS)
                self.assertIn('currentBaselineEventId: currentComponent?.latest_event?.service_event_id || ""', COMPONENTS_JS)
                self.assertIn('currentBaselineMatchesBoundary', COMPONENTS_JS)
                self.assertIn('currentMarkup || lifespanMarkup', COMPONENTS_JS)
                self.assertIn('CURRENT', COMPONENTS_JS)
                self.assertNotIn('Current life', COMPONENTS_JS)

    def test_history_markup_and_styles_preserve_existing_contracts(self):
        self.assertIn('class="components-history-edit-button"', COMPONENTS_JS)
        self.assertIn('Bike snapshot at event', COMPONENTS_JS)
        self.assertNotIn('Current life', COMPONENTS_JS)
        self.assertIn('components-history-lifespan', COMPONENTS_JS)
        self.assertIn('.components-history-lifespan', COMPONENTS_CSS)
        self.assertIn('grid-template-columns: 1fr', COMPONENTS_CSS)


if __name__ == "__main__":
    unittest.main()
