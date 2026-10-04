from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HANDOFF = (ROOT / "docs" / "FRONTEND_REFACTOR_HANDOFF.md").read_text(encoding="utf-8")
APP = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
INDEX = (ROOT / "templates" / "index.html").read_text(encoding="utf-8")


def test_frontend_handoff_defines_lifecycle_and_compatibility_contract() -> None:
    for method in ("init(context)", "activate(context)", "refresh(context, reason)", "canDeactivate(context)", "deactivate(context)"):
        assert f"`{method}`" in HANDOFF
    for phrase in (
        "idempotent",
        "generation/request guard",
        "fails closed",
        "canonical call",
        "must not call both the new\n   method",
        "unhandled Promise rejection",
    ):
        assert phrase in HANDOFF


def test_frontend_handoff_covers_required_observed_surfaces_and_navigation() -> None:
    for surface in (
        "Service History",
        "Component editor",
        "Weekly commentary",
        "Yearly commentary",
        "Coach delete confirmation",
        "Settings drawer",
    ):
        assert f"| {surface} |" in HANDOFF
    for interaction in ("Outside click", "Escape", "Explicit close/cancel", "Dirty changes", "Tab navigation", "Browser Back", "Focus return"):
        assert interaction in HANDOFF
    assert "No Save, Delete permanently," in HANDOFF
    assert "Record Service, Recalculate" in HANDOFF


def test_runtime_composition_still_matches_the_documented_bridge_boundary() -> None:
    assert "window.TrainingApp.features = window.TrainingApp.features || {};" in APP
    assert "window.TrainingApp.registerFeature = window.TrainingApp.registerFeature || function" in APP
    assert 'window.TrainingApp.registerFeature("plan", window.PlanController);' in APP
    assert "function createFeatureActivationDispatcher" in APP
    assert "window.TrainingApp.activateFeature = activateFeature;" in APP
    assert "window.activateFeature = activateFeature;" in APP
    assert "else if (typeof window.loadPlan === \"function\")" in APP
    assert "window.TrainingApp.TransientSurface" in INDEX or "window.TrainingApp.TransientSurface" in APP
    assert INDEX.index('/static/app.js?v=20260914-service-nav') > INDEX.index('/static/coach.js')