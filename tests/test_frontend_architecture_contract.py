from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
ARCHITECTURE = (ROOT / "docs" / "FRONTEND_ARCHITECTURE.md").read_text(encoding="utf-8")
APP = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
YEARLY = (ROOT / "static" / "yearly.js").read_text(encoding="utf-8")
INDEX = (ROOT / "templates" / "index.html").read_text(encoding="utf-8")
STATIC = "\n".join(path.read_text(encoding="utf-8") for path in (ROOT / "static").glob("*.js"))


def test_frontend_architecture_defines_lifecycle_and_compatibility_contract() -> None:
    for method in ("init(context)", "activate(context)", "refresh(context, reason)", "canDeactivate(context)", "deactivate(context)"):
        assert f"`{method}`" in ARCHITECTURE
    for phrase in (
        "idempotent",
        "Request IDs,\ngenerations, or keyed caches",
        "fails closed",
        "canonical composed-runtime call surface",
        "Same-key activation is coalesced",
        "stale responses",
    ):
        assert phrase in ARCHITECTURE


def test_frontend_architecture_covers_required_observed_surfaces_and_navigation() -> None:
    for surface in (
        "Service History",
            "Components",
        "Weekly commentary",
        "Yearly commentary",
            "Coach delete/session",
            "Settings",
    ):
        assert surface in ARCHITECTURE
    for interaction in ("backdrop", "Escape", "explicit close/cancel", "dirty-state", "focus", "navigation"):
        assert interaction in ARCHITECTURE
    assert "dirty-state" in ARCHITECTURE
    assert "backdrop" in ARCHITECTURE


def test_runtime_composition_still_matches_the_documented_bridge_boundary() -> None:
    assert "window.TrainingApp.features = window.TrainingApp.features || {};" in APP
    assert "window.TrainingApp.registerFeature = window.TrainingApp.registerFeature || function" in APP
    assert 'window.TrainingApp.registerFeature("plan", window.PlanController);' in APP
    assert "function createFeatureActivationDispatcher" in APP
    assert "window.TrainingApp.activateFeature = activateFeature;" in APP
    assert "window.activateFeature = activateFeature;" in APP
    assert 'if (featureName === "plan")' not in APP
    assert "window.TrainingApp.TransientSurface" in INDEX or "window.TrainingApp.TransientSurface" in APP or "window.TrainingApp.TransientSurface" in YEARLY
    assert INDEX.index('/static/app.js?v={{ asset_version }}') > INDEX.index('/static/coach.js?v={{ asset_version }}')


def test_documented_registry_matches_composed_runtime_registrations() -> None:
    expected = {
        "plan", "goals", "kpis", "components", "service", "charts", "coach",
        "daily", "gear", "search", "settings", "sync", "weekly", "zones", "yearly",
    }
    registered = set(re.findall(r'registerFeature\("([^"]+)"', STATIC))
    assert registered == expected
    assert len(registered) == 15
    assert "Components/Service" in ARCHITECTURE
    assert "Compatibility key for the same" in ARCHITECTURE
    assert "all first-party asset references discovered from the rendered root" in ARCHITECTURE
    assert "Documentation-only repository commits may advance `HEAD` without" in ARCHITECTURE
    assert "F35 runtime remains deployed" not in ARCHITECTURE
    assert "all 43 first-party assets" not in ARCHITECTURE
    assert "## Historical closeout context" in ARCHITECTURE