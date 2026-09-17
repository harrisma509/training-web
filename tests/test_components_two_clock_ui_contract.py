from pathlib import Path
import json
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[1]
COMPONENTS_JS = (ROOT / "static" / "components.js").read_text()
COMPONENTS_CSS = (ROOT / "static" / "components.css").read_text()
INDEX_HTML = (ROOT / "index.html").read_text()


class ComponentsTwoClockUiContractTests(unittest.TestCase):
    def test_table_uses_additive_clocks_and_keeps_defensive_fallback(self):
        self.assertIn("function getComponentTableClocks(row)", COMPONENTS_JS)
        self.assertIn("row.component_clocks", COMPONENTS_JS)
        self.assertIn('primary: { ...primary, label: serviceEnabled ? "Service" : "Life" }', COMPONENTS_JS)
        self.assertIn("legacy.miles_since_service", COMPONENTS_JS)
        self.assertIn("renderComponentClockSummary(clocks)", COMPONENTS_JS)
        self.assertIn('colspan="7"', COMPONENTS_JS)
        self.assertIn('<th>Last Event</th>', COMPONENTS_JS)
        self.assertIn('<th>Usage / Status</th>', COMPONENTS_JS)
        self.assertNotIn('<th>Last Service</th>', COMPONENTS_JS)
        self.assertNotIn('<th>Action</th>', COMPONENTS_JS)
        for header in ("Miles Since", "Hours Since", "Rides Since", "Days Since"):
            self.assertNotIn(f'<th>{header}</th>', COMPONENTS_JS)
        header_order = ["Component", "Group", "Position", "Last Event", "Usage / Status", "Interval", "Notes"]
        header_source = COMPONENTS_JS[COMPONENTS_JS.index("<thead>"):COMPONENTS_JS.index("</thead>", COMPONENTS_JS.index("<thead>"))]
        self.assertEqual(
            [header_source.index(f"<th>{header}</th>") for header in header_order],
            sorted(header_source.index(f"<th>{header}</th>") for header in header_order),
        )
        self.assertIn('class="components-clock-disabled">Tracking unavailable</span>', COMPONENTS_JS)
        self.assertNotIn("nth-child(8)", COMPONENTS_CSS)
        self.assertNotIn("nth-child(9)", COMPONENTS_CSS)
        self.assertNotIn("nth-child(10)", COMPONENTS_CSS)
        self.assertNotIn("nth-child(11)", COMPONENTS_CSS)

    def test_clock_states_and_both_clock_summary_are_visible(self):
        for text in ("Tracking disabled", "No ${label.toLowerCase()} baseline", "Partial snapshot", "Review snapshot", 'aria-label="Component life and maintenance clocks"'):
            self.assertIn(text, COMPONENTS_JS)
        self.assertIn('class="components-clock-line"', COMPONENTS_JS)
        self.assertIn(".components-clock-summary", COMPONENTS_CSS)

    def test_frontend_action_sets_match_documented_v1_contract(self):
        script = f"""
const fs = require('fs');
const vm = require('vm');
global.window = {{}};
global.document = {{getElementById: () => null, querySelectorAll: () => []}};
vm.runInThisContext(fs.readFileSync({json.dumps((ROOT / 'static' / 'components.js').as_posix())}, 'utf8'));
process.stdout.write(JSON.stringify([
  [...COMPONENT_CLOCK_LIFECYCLE_ACTIONS].sort(),
  [...COMPONENT_CLOCK_MAINTENANCE_ACTIONS].sort(),
  ['Warranty', 'Tire', 'Brake Pads', 'Chain', 'Rotor', 'Wheel', 'Bearing', 'Other'].map(classifyComponentAction),
]));
"""
        result = subprocess.run(["node", "--eval", script], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        lifecycle, maintenance, ambiguous = json.loads(result.stdout)
        self.assertEqual(lifecycle, ["installation", "new", "replace", "replacement"])
        self.assertEqual(maintenance, ["adjustment", "bleed", "brake bleed", "cleaning", "inspection", "lowers", "lubrication", "rebuild", "refresh", "sealant", "suspension service"])
        self.assertEqual(ambiguous, ["unclassified"] * 8)

    def test_service_dropdown_and_effect_badge_preserve_single_payload_action(self):
        self.assertIn('<select id="componentServiceAction" name="action" required', COMPONENTS_JS)
        self.assertIn("const COMPONENT_ACTION_GROUPS = [", COMPONENTS_JS)
        self.assertIn("renderComponentActionOptions()", COMPONENTS_JS)
        self.assertIn('label: "Replacement / installation"', COMPONENTS_JS)
        self.assertIn('label: "Maintenance"', COMPONENTS_JS)
        self.assertIn('label: "Unclassified / other"', COMPONENTS_JS)
        self.assertIn('id="componentServiceEffect"', COMPONENTS_JS)
        self.assertIn('role="status" aria-live="polite"', COMPONENTS_JS)
        self.assertIn('action: String(formData.get("action") || "").trim()', COMPONENTS_JS)
        service_payload_start = COMPONENTS_JS.index('const payload = {', COMPONENTS_JS.index('drawer.querySelector("#componentServiceForm")'))
        service_payload_end = COMPONENTS_JS.index('const saveBtn', service_payload_start)
        self.assertNotIn("effect:", COMPONENTS_JS[service_payload_start:service_payload_end])

    def test_editor_add_edit_guidance_and_payload_fields_remain(self):
        for text in (
            "Track component life",
            "Track maintenance",
            "Component starting point",
            "Installed now",
            "Installed previously",
            "Maintenance targets",
            "Approaching-due threshold",
            "Recalculate from Strava",
            "setComponentEditorMode(\"add\")",
            "setComponentEditorMode(\"edit\")",
            'name="track_life"',
            'name="track_service"',
            'name="baseline_service_date"',
        ):
            self.assertIn(text, COMPONENTS_JS)
        self.assertIn('componentEditorTemplateGroup', COMPONENTS_JS)
        self.assertIn('componentEditorBaselineGroup', COMPONENTS_JS)
        self.assertIn('componentEditorEditHistoryHint', COMPONENTS_JS)
        self.assertIn("warning_percent: Number(formData.get(\"warning_percent\") || 80)", COMPONENTS_JS)

    def test_component_specific_styles_and_cache_versions_are_updated(self):
        self.assertIn(".components-service-effect", COMPONENTS_CSS)
        self.assertIn(".components-editor-guidance", COMPONENTS_CSS)
        self.assertIn("components.css?v=20260916-components-css-v11", INDEX_HTML)
        self.assertIn("components.js?v=20260916-components-ui-v17", INDEX_HTML)


if __name__ == "__main__":
    unittest.main()
