from pathlib import Path
import json
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[1]
COMPONENTS_JS = (ROOT / "static" / "components.js").read_text()


class ComponentsEditActionContractTests(unittest.TestCase):
    def test_edit_uses_shared_grouped_action_select_and_preserves_legacy_values(self):
        self.assertIn('id="historyEditorAction" name="action" required', COMPONENTS_JS)
        self.assertNotIn('id="historyEditorAction" name="action" type="text"', COMPONENTS_JS)
        self.assertIn('renderComponentActionOptions(normalizedHistoryData.service_type, true)', COMPONENTS_JS)
        self.assertIn('<optgroup label="Legacy / custom">', COMPONENTS_JS)
        self.assertIn('id="historyEditorActionEffect"', COMPONENTS_JS)
        self.assertIn('id="historyEditorActionImpact"', COMPONENTS_JS)
        self.assertIn('Changing this Action changes which usage clock this event resets.', COMPONENTS_JS)

    def test_shared_options_keep_group_order_and_custom_value(self):
        script = f"""
const fs = require('fs');
const vm = require('vm');
global.window = {{}};
global.document = {{getElementById: () => null, querySelectorAll: () => []}};
vm.runInThisContext(fs.readFileSync({json.dumps((ROOT / 'static' / 'components.js').as_posix())}, 'utf8'));
const standard = renderComponentActionOptions();
const custom = renderComponentActionOptions('Drivetrain Plus', true);
process.stdout.write(JSON.stringify({{standard, custom}}));
"""
        result = subprocess.run(["node", "--eval", script], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        output = json.loads(result.stdout)
        standard = output["standard"]
        custom = output["custom"]
        self.assertLess(standard.index('label="Replacement / installation"'), standard.index('label="Maintenance"'))
        self.assertLess(standard.index('label="Maintenance"'), standard.index('label="Unclassified / other"'))
        self.assertNotIn("Legacy / custom", standard)
        self.assertIn('label="Legacy / custom"', custom)
        self.assertIn('value="Drivetrain Plus" selected', custom)

    def test_effects_cover_tracking_modes_and_semantic_keys(self):
        script = f"""
const fs = require('fs');
const vm = require('vm');
global.window = {{}};
global.document = {{getElementById: () => null, querySelectorAll: () => []}};
vm.runInThisContext(fs.readFileSync({json.dumps((ROOT / 'static' / 'components.js').as_posix())}, 'utf8'));
const component = {{track_life: true, track_service: true}};
const lifeOnly = componentEffectMarkup('New', {{track_life: true, track_service: false}});
const serviceOnly = componentEffectMarkup('Inspection', {{track_life: false, track_service: true}});
const both = componentEffectMarkup('Replacement', component);
const unknown = componentEffectMarkup('Imported action', component, true);
process.stdout.write(JSON.stringify([lifeOnly, serviceOnly, both, unknown]));
"""
        result = subprocess.run(["node", "--eval", script], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        life_only, service_only, both, unknown = json.loads(result.stdout)
        self.assertEqual(life_only["category"], "Resets component life")
        self.assertEqual(service_only["category"], "Resets maintenance interval")
        self.assertEqual(both["category"], "Resets component life and maintenance interval")
        self.assertEqual(unknown["category"], "Unclassified")
        self.assertIn("remains in history", unknown["detail"])
        self.assertNotEqual(life_only["key"], service_only["key"])

    def test_action_change_does_not_recalculate_or_add_effect_payload_field(self):
        action_region_start = COMPONENTS_JS.index('historyActionInput.addEventListener("change"')
        action_region_end = COMPONENTS_JS.index('const finish = () =>', action_region_start)
        action_region = COMPONENTS_JS[action_region_start:action_region_end]
        self.assertNotIn("fetchComponentServiceSnapshot", action_region)
        self.assertNotIn("recalculateHistoryEditorSnapshot", action_region)
        self.assertNotIn("updateComponentService", action_region)
        self.assertIn('action: String(formData.get("action") || "").trim()', COMPONENTS_JS)
        self.assertNotIn("effect:", COMPONENTS_JS[COMPONENTS_JS.index('const payload = {', COMPONENTS_JS.index('formData.get("action")')):COMPONENTS_JS.index('const payload = {', COMPONENTS_JS.index('formData.get("action")')) + 500])


if __name__ == "__main__":
    unittest.main()
