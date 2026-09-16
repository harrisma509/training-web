from pathlib import Path
import json
import subprocess
import unittest


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
COMPONENTS_JS = (REPOSITORY_ROOT / "static" / "components.js").read_text()
COMPONENTS_CSS = (REPOSITORY_ROOT / "static" / "components.css").read_text()
INDEX_HTML = (REPOSITORY_ROOT / "index.html").read_text()


class ComponentsEditorLayoutContractTests(unittest.TestCase):
    def test_editor_footer_is_panel_sibling_after_scroll_body(self):
        body_end = COMPONENTS_JS.index("      </div>\n      <div class=\"components-history-editor-footer")
        editor_footer = COMPONENTS_JS.index("components-history-editor-footer", body_end)
        history_footer = COMPONENTS_JS.index("components-history-footer", editor_footer)

        self.assertLess(body_end, editor_footer)
        self.assertLess(editor_footer, history_footer)
        self.assertNotIn("components-history-editor-footer", COMPONENTS_JS[COMPONENTS_JS.index('id=\"componentHistoryEventForm\"'):COMPONENTS_JS.index("</form>", COMPONENTS_JS.index('id=\"componentHistoryEventForm\"'))])

    def test_editor_footer_has_exact_actions_and_mode_sync(self):
        footer_start = COMPONENTS_JS.index('<div class="components-history-editor-footer')
        footer_end = COMPONENTS_JS.index("</div>", footer_start)
        footer_markup = COMPONENTS_JS[footer_start:footer_end]

        self.assertIn('id="componentHistoryEditorCancelBtn"', footer_markup)
        self.assertIn('id="componentHistoryEditorSaveBtn"', footer_markup)
        self.assertNotIn("Refresh", footer_markup)
        self.assertNotIn("Close", footer_markup)
        self.assertIn('const editorFooterEl = drawer.querySelector(".components-history-editor-footer")', COMPONENTS_JS)
        self.assertIn('editorFooterEl.classList.toggle("hidden", !isEditor)', COMPONENTS_JS)
        self.assertIn('footerEl.classList.toggle("hidden", isEditor)', COMPONENTS_JS)

    def test_history_body_owns_scroll_and_editor_footer_is_not_sticky(self):
        body_rule_start = COMPONENTS_CSS.index(".components-history-body")
        body_rule_end = COMPONENTS_CSS.index("}", body_rule_start)
        body_rule = COMPONENTS_CSS[body_rule_start:body_rule_end]

        self.assertIn("flex: 1", body_rule)
        self.assertIn("overflow-y: auto", body_rule)
        self.assertNotIn("position: sticky", COMPONENTS_CSS[COMPONENTS_CSS.index(".components-history-footer"):])

    def test_editor_fields_and_cache_version_remain_intact(self):
        self.assertIn('name="odometer_miles" type="number" min="0" step="0.01"', COMPONENTS_JS)
        self.assertIn('name="odometer_hours" type="number" min="0" step="0.01"', COMPONENTS_JS)
        self.assertIn('name="odometer_rides" type="number" min="0" step="1"', COMPONENTS_JS)
        self.assertIn('name="odometer_elevation_ft" type="number" min="0" step="1"', COMPONENTS_JS)
        self.assertIn('components.js?v=20260915-components-service-form-v14', INDEX_HTML)

    def test_advanced_settings_disclosure_contract(self):
        self.assertEqual(COMPONENTS_JS.count('id="componentEditorAdvancedToggle"'), 1)
        self.assertEqual(COMPONENTS_JS.count('id="componentEditorAdvancedFields"'), 1)
        self.assertIn('aria-expanded="false"', COMPONENTS_JS)
        self.assertIn('aria-controls="componentEditorAdvancedFields"', COMPONENTS_JS)
        self.assertIn('toggle.setAttribute("aria-expanded", String(visible))', COMPONENTS_JS)
        self.assertIn('toggle.textContent = visible ? "Hide advanced settings" : "Show advanced settings"', COMPONENTS_JS)
        self.assertIn('body.scrollTop += fieldsRect.bottom - bodyRect.bottom + 12', COMPONENTS_JS)
        self.assertIn('id="componentEditorWarning" name="warning_percent" type="number" min="0.01" max="100" step="0.01"', COMPONENTS_JS)
        self.assertIn('id="componentEditorOrder" name="display_order" type="number" min="0" step="1"', COMPONENTS_JS)
        self.assertIn('id="componentEditorNotes" name="notes" rows="4"', COMPONENTS_JS)
        self.assertIn('setComponentEditorAdvancedVisibility(false)', COMPONENTS_JS)
        self.assertIn('.components-editor-grid {', COMPONENTS_CSS)

    def test_editor_recalculation_is_explicit_and_comparison_precedes_apply(self):
        editor_start = COMPONENTS_JS.index("async function openComponentHistoryEventEditor")
        editor_source = COMPONENTS_JS[editor_start:]

        self.assertIn('id="historyEditorRecalculateBtn"', editor_source)
        self.assertIn("Recalculate from Strava", editor_source)
        self.assertIn('id="historyEditorSnapshotComparison"', editor_source)
        self.assertIn('id="historyEditorKeepSavedBtn"', editor_source)
        self.assertIn('id="historyEditorUseCalculatedBtn"', editor_source)
        self.assertIn("window.api.fetchComponentServiceSnapshot(componentId, serviceDate)", COMPONENTS_JS)
        self.assertIn("renderHistoryEditorSnapshotComparison", COMPONENTS_JS)
        self.assertIn("Calculated snapshot applied. Save Changes to update this event.", editor_source)

        open_editor_body = editor_source[:editor_source.index("recalculateBtn.addEventListener")]
        self.assertNotIn("fetchComponentServiceSnapshot", open_editor_body)

    def test_editor_recalculation_preserves_unavailable_values_and_rejects_stale_responses(self):
        self.assertIn("historyEditorSnapshotAvailable", COMPONENTS_JS)
        self.assertIn("snapshot[key] !== null", COMPONENTS_JS)
        self.assertIn("metric_availability", COMPONENTS_JS)
        self.assertIn("drawer.dataset.historyEditorSnapshotRequest", COMPONENTS_JS)
        self.assertIn("drawer.dataset.historyEditorEventId === String(serviceEventId)", COMPONENTS_JS)
        self.assertIn("serviceDate > componentServiceLocalDate()", COMPONENTS_JS)
        self.assertIn("Some calculated metrics are unavailable", COMPONENTS_JS)
        self.assertIn("Keep Saved Values", COMPONENTS_JS)

    def test_calculated_snapshot_values_are_normalized_for_editor_steps(self):
        script = f"""
const fs = require('fs');
const vm = require('vm');
global.window = {{}};
global.document = {{getElementById: () => null}};
vm.runInThisContext(fs.readFileSync({json.dumps((REPOSITORY_ROOT / 'static' / 'components.js').as_posix())}, 'utf8'));
process.stdout.write(JSON.stringify([
  historyEditorSnapshotInputValue(216.28722222222223, 'odometer_hours'),
  historyEditorSnapshotInputValue(2217.71, 'odometer_miles'),
  historyEditorSnapshotInputValue(0, 'odometer_rides'),
  historyEditorSnapshotInputValue(147.4, 'odometer_rides'),
  historyEditorSnapshotInputValue(400417, 'odometer_elevation_ft'),
  historyEditorSnapshotInputValue(null, 'odometer_miles')
]));
"""
        result = subprocess.run(
            ["node", "--eval", script],
            cwd=REPOSITORY_ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            json.loads(result.stdout),
            ["216.29", "2217.71", "0", None, "400417", None],
        )
        self.assertIn("historyEditorSnapshotInputValue(calculated[key], key)", COMPONENTS_JS)
        self.assertNotIn("editorEl.querySelector(selector).value = String(calculated[key])", COMPONENTS_JS)


if __name__ == "__main__":
    unittest.main()
