from pathlib import Path
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
        self.assertIn('components.js?v=20260915-components-service-form-v6', INDEX_HTML)


if __name__ == "__main__":
    unittest.main()
