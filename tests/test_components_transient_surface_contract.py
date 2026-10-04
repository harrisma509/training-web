from pathlib import Path
import unittest


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
COMPONENTS_JS = (REPOSITORY_ROOT / "static" / "components.js").read_text()


class ComponentsTransientSurfaceContractTests(unittest.TestCase):
    def test_components_uses_shared_transient_surface_for_top_level_drawers(self):
        self.assertIn("window.TrainingApp.TransientSurface.create", COMPONENTS_JS)
        self.assertIn("componentEditorSurface", COMPONENTS_JS)
        self.assertIn("componentServiceSurface", COMPONENTS_JS)
        self.assertIn("componentHistorySurface", COMPONENTS_JS)

    def test_dirty_close_is_owned_by_components(self):
        self.assertIn("componentEditorDirty", COMPONENTS_JS)
        self.assertIn("componentServiceDirty", COMPONENTS_JS)
        self.assertIn("historyEditorDirty", COMPONENTS_JS)
        self.assertIn("canClose", COMPONENTS_JS)
        self.assertIn("Discard unsaved changes?", COMPONENTS_JS)

    def test_surface_close_paths_request_close_and_preserve_history_mode(self):
        self.assertIn("componentEditorSurface.requestClose", COMPONENTS_JS)
        self.assertIn("componentServiceSurface.requestClose", COMPONENTS_JS)
        self.assertIn("componentHistorySurface.requestClose", COMPONENTS_JS)
        self.assertIn("closeComponentHistoryEditor", COMPONENTS_JS)
        self.assertIn("setComponentHistoryMode(\"history\")", COMPONENTS_JS)

    def test_component_editor_backdrop_does_not_request_close(self):
        editor_handler = COMPONENTS_JS.split('drawer.addEventListener("click", event => {', 1)[1].split(
            'if (form.dataset.submitBound === "1")', 1
        )[0]
        self.assertNotIn("event.target === drawer", editor_handler)
        self.assertNotIn("closeComponentEditor()", editor_handler)

    def test_history_backdrop_only_closes_read_only_parent(self):
        history_handler = COMPONENTS_JS.split(
            'drawer.addEventListener("click", event => {'
        )[-1].split("document.addEventListener(\"keydown\"", 1)[0]
        self.assertIn('const eventEditor = drawer.querySelector("#componentHistoryEventEditor")', history_handler)
        self.assertIn("eventEditor.classList.contains(\"hidden\")", history_handler)
        self.assertIn("closeComponentHistoryDrawer()", history_handler)


if __name__ == "__main__":
    unittest.main()