from pathlib import Path
import unittest


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
COMPONENTS_JS = (REPOSITORY_ROOT / "static" / "components.js").read_text()
COMPONENTS_CSS = (REPOSITORY_ROOT / "static" / "components.css").read_text()


class ComponentsRowActionsContractTests(unittest.TestCase):
    def test_rows_use_one_inline_trigger_and_action_column_is_summary_only(self):
        self.assertIn('class="components-overflow-trigger"', COMPONENTS_JS)
        self.assertIn('aria-label="Actions for ${componentEscapeHtml', COMPONENTS_JS)
        self.assertIn('aria-haspopup="menu"', COMPONENTS_JS)
        self.assertIn('aria-expanded="false"', COMPONENTS_JS)
        self.assertNotIn('class="components-record-service-button"', COMPONENTS_JS)
        self.assertNotIn('class="components-edit-button"', COMPONENTS_JS)
        self.assertNotIn('class="components-archive-button"', COMPONENTS_JS)
        self.assertNotIn('class="components-restore-button"', COMPONENTS_JS)
        self.assertIn('<td><div class="components-action-stack"><span>${componentEscapeHtml(formatLatestAction(latestEvent))}</span></div></td>', COMPONENTS_JS)

    def test_active_and_archived_menu_labels_and_separator_are_explicit(self):
        self.assertIn('Record Service', COMPONENTS_JS)
        self.assertIn('Service History', COMPONENTS_JS)
        self.assertIn('Edit Component', COMPONENTS_JS)
        self.assertIn('Archive Component', COMPONENTS_JS)
        self.assertIn('Restore Component', COMPONENTS_JS)
        self.assertIn('<div role="separator"></div>', COMPONENTS_JS)
        self.assertIn('data-archived="true"', COMPONENTS_JS)
        self.assertIn('data-archived="false"', COMPONENTS_JS)
        self.assertIn('class="components-overflow-menu-destructive"', COMPONENTS_JS)

    def test_menu_is_singleton_keyboard_accessible_and_viewport_positioned(self):
        self.assertIn('id = "componentsOverflowMenu"', COMPONENTS_JS)
        self.assertIn('componentOverflowMenuState', COMPONENTS_JS)
        self.assertIn('closeComponentOverflowMenu({ restoreFocus: true })', COMPONENTS_JS)
        self.assertIn('event.key === "ArrowDown"', COMPONENTS_JS)
        self.assertIn('event.key === "ArrowUp"', COMPONENTS_JS)
        self.assertIn('event.key === "Home"', COMPONENTS_JS)
        self.assertIn('event.key === "End"', COMPONENTS_JS)
        self.assertIn('event.key === "Escape"', COMPONENTS_JS)
        self.assertIn('event.key === "Tab"', COMPONENTS_JS)
        self.assertIn('window.innerWidth - menuRect.width', COMPONENTS_JS)
        self.assertIn('triggerRect.top - menuRect.height', COMPONENTS_JS)
        self.assertIn('window.addEventListener("resize"', COMPONENTS_JS)
        self.assertIn('document.addEventListener("scroll"', COMPONENTS_JS)

    def test_menu_reuses_existing_action_paths_without_new_api_calls(self):
        self.assertIn('openComponentServiceDrawer(state.componentId, state.componentName)', COMPONENTS_JS)
        self.assertIn('openComponentHistoryDrawer(state.componentId, state.componentName)', COMPONENTS_JS)
        self.assertIn('openComponentEditor(state.componentId)', COMPONENTS_JS)
        self.assertIn('archiveComponentFromRow(state.componentId, state.componentName)', COMPONENTS_JS)
        self.assertIn('restoreComponentFromRow(state.componentId, state.componentName)', COMPONENTS_JS)
        self.assertIn('window.api.archiveComponent(componentId)', COMPONENTS_JS)
        self.assertIn('window.api.restoreComponent(componentId)', COMPONENTS_JS)
        self.assertIn('colspan="11"', COMPONENTS_JS)

    def test_menu_styles_are_owned_by_components_css(self):
        self.assertIn('.components-overflow-trigger', COMPONENTS_CSS)
        self.assertIn('.components-overflow-menu', COMPONENTS_CSS)
        self.assertIn('position: fixed', COMPONENTS_CSS)
        self.assertIn('.components-overflow-menu [role="separator"]', COMPONENTS_CSS)


if __name__ == "__main__":
    unittest.main()
