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


if __name__ == "__main__":
    unittest.main()