import ast
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ROUTES = {
    "routes/activities.py": ("get", "/api/activities/search/export", "training-search.csv"),
    "routes/weekly.py": ("get", "/api/weekly/export", "training-weekly.csv"),
    "routes/components.py": ("get", "/api/gear/components/export", "training-components.csv"),
    "routes/zones.py": ("post", "/api/zones/export", "training-zones.csv"),
}
FEATURE_MODULES = (
    "static/search.js",
    "static/weekly.js",
    "static/components.js",
    "static/zones.js",
)


def read(relative_path: str) -> str:
    return (ROOT / relative_path).read_text(encoding="utf-8")


def route_decorators(source: str) -> set[tuple[str, str]]:
    tree = ast.parse(source)
    found = set()
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            if (
                isinstance(decorator, ast.Call)
                and isinstance(decorator.func, ast.Attribute)
                and isinstance(decorator.func.value, ast.Name)
                and decorator.func.value.id == "router"
                and decorator.args
                and isinstance(decorator.args[0], ast.Constant)
                and isinstance(decorator.args[0].value, str)
            ):
                found.add((decorator.func.attr, decorator.args[0].value))
    return found


class CsvExportArchitectureTests(unittest.TestCase):
    def test_each_feature_route_uses_the_shared_serializer_and_fixed_route(self):
        for path, (method, endpoint, filename) in ROUTES.items():
            with self.subTest(path=path):
                source = read(path)
                tree = ast.parse(source)
                imports_csv_response = any(
                    isinstance(node, ast.ImportFrom)
                    and node.module == "csv_export"
                    and any(alias.name == "csv_response" for alias in node.names)
                    for node in ast.walk(tree)
                )
                calls_csv_response = any(
                    isinstance(node, ast.Call)
                    and isinstance(node.func, ast.Name)
                    and node.func.id == "csv_response"
                    for node in ast.walk(tree)
                )
                self.assertTrue(imports_csv_response)
                self.assertTrue(calls_csv_response)
                self.assertIn((method, endpoint), route_decorators(source))
                self.assertIn(filename, source)

    def test_runtime_has_one_csv_writer_and_no_etl_csv_writer_import(self):
        runtime_files = [*ROOT.glob("*.py"), *(ROOT / "routes").rglob("*.py")]
        writers = []
        for path in runtime_files:
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if (
                    isinstance(node, ast.Call)
                    and isinstance(node.func, ast.Attribute)
                    and isinstance(node.func.value, ast.Name)
                    and node.func.value.id == "csv"
                    and node.func.attr == "writer"
                ):
                    writers.append(path.relative_to(ROOT).as_posix())
                if isinstance(node, ast.ImportFrom):
                    module = node.module or ""
                    names = " ".join(alias.name for alias in node.names)
                    target = f"{module} {names}".casefold()
                    self.assertFalse(
                        "etl" in target and ("csv" in target or "export" in target),
                        f"Runtime ETL CSV import found in {path.relative_to(ROOT)}",
                    )
                elif isinstance(node, ast.Import):
                    for alias in node.names:
                        target = alias.name.casefold()
                        self.assertFalse(
                            "etl" in target and ("csv" in target or "export" in target),
                            f"Runtime ETL CSV import found in {path.relative_to(ROOT)}",
                        )

        self.assertEqual(writers, ["csv_export.py"])

    def test_api_js_is_the_only_generic_browser_download_helper(self):
        definitions = []
        for path in (ROOT / "static").glob("*.js"):
            source = path.read_text(encoding="utf-8")
            if re.search(r"\b(?:async\s+)?function\s+downloadCsv\s*\(", source):
                definitions.append(path.relative_to(ROOT).as_posix())

        self.assertEqual(definitions, ["static/api.js"])
        for path in FEATURE_MODULES:
            with self.subTest(path=path):
                self.assertIn("window.api.downloadCsv(", read(path))
        app = read("static/app.js")
        self.assertNotRegex(app, r"downloadCsv|csv_export|training-(?:search|weekly|components|zones)\.csv")
        self.assertNotRegex(app, r"/api/(?:activities/search|weekly|gear/components|zones)/export")

    def test_documented_cross_export_contract_and_search_privacy_contract(self):
        architecture = read("docs/CSV_EXPORTS.md")
        for endpoint in (
            "/api/activities/search/export",
            "/api/weekly/export",
            "/api/gear/components/export",
            "/api/zones/export",
        ):
            self.assertIn(endpoint, architecture)
        for filename in (
            "training-search.csv",
            "training-weekly.csv",
            "training-components.csv",
            "training-zones.csv",
        ):
            self.assertIn(filename, architecture)
        for owner in (
            "routes/activities.py",
            "routes/weekly.py",
            "routes/components.py",
            "routes/zones.py",
            "static/search.js",
            "static/weekly.js",
            "static/components.js",
            "static/zones.js",
            "templates/partials/panes/search_pane.html",
            "templates/partials/panes/weekly_pane.html",
            "templates/partials/panes/service_pane.html",
            "templates/partials/panes/zones_pane.html",
            "static/search.css",
            "static/weekly.css",
            "static/components.css",
            "static/zones.css",
            "tests/test_activity_search.py",
            "tests/test_activity_search_ui.js",
            "tests/test_weekly_export.py",
            "tests/test_weekly_export_ui.js",
            "tests/test_components_export.py",
            "tests/test_components_export_ui.js",
            "tests/test_zones_export.py",
            "tests/test_zones_export_ui.js",
        ):
            self.assertTrue((ROOT / owner).is_file(), owner)
            self.assertIn(owner, architecture)
        for contract in (
            "csv_export.py",
            "static/api.js",
            "training-etl",
            "private_note",
            "50,000",
            "10, 52, or 520",
            "26, 60, or 260",
            "do not depend on the browser's separate Blob/object-URL",
        ):
            self.assertIn(contract, architecture)

        constitution = read("docs/ENGINEERING_CONSTITUTION.md")
        self.assertNotIn("Sensitive fields remain excluded by default", constitution)
        for contract in (
            "Sensitive fields require an explicit, documented product contract and visible user control.",
            "Each export must document its inclusion default, privacy boundary, and exclusions.",
            "Search currently includes Private Note by default and provides an explicit control to exclude it.",
        ):
            self.assertIn(contract, constitution)
        for safeguard in (
            "Never expose secrets or sensitive payloads.",
            "arbitrary SQL surface",
            "typed, allowlisted, bounded retrieval",
        ):
            self.assertIn(safeguard, constitution)

        search_prd = read("docs/PRD/Search.md")
        self.assertIn("Private Note is included by default", search_prd)
        self.assertIn("Description is included", search_prd)
        self.assertIn("uncheck it to omit `private_note` entirely", search_prd)
        self.assertIn("The checkbox resets to checked after every export attempt and is not persisted.", search_prd)
        self.assertIn("all matching rows up to 50,000", search_prd)
        self.assertIn("Sensitive-field defaults and user controls match the documented fixed-schema export contract.", search_prd)
        self.assertNotIn("Sensitive fields are excluded by default", search_prd)
        self.assertNotIn("Sanitized exports can be safely supplied to trusted AI tools.", search_prd)
        self.assertIn("No sanitized or AI-specific export preset is part of the current fixed-schema Search CSV V1.", search_prd)
        self.assertIn(
            "Any future sanitized or AI-specific export requires a separately approved privacy and field contract.",
            search_prd,
        )
        self.assertNotIn("private note remains opt-in", search_prd.casefold())
        self.assertNotIn("Search → Filter → Preview → Open → Export", search_prd)
        self.assertIn("does not use a separate preview or column picker", search_prd)
        self.assertIn("does not offer column selection, presets, or an export preview", search_prd)

    def test_testing_guide_documents_automatic_csv_response_capture(self):
        guide = read("docs/TESTING_GUIDE.md")
        self.assertIn("Get-ChildItem -Path tests -Filter 'test_*.js'", guide)
        self.assertIn("node --test $nodeTests", guide)
        self.assertIn("same-origin `text/csv` network", guide)
        self.assertIn("Do not rely on Playwright's separate", guide)
        self.assertIn("one bounded,", guide)


if __name__ == "__main__":
    unittest.main()
