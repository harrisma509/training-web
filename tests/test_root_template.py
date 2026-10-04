import base64
import json
import os
from pathlib import Path
import subprocess
import sys

from test_frontend_composition import (
    IDREF_ATTRIBUTES,
    KNOWN_UNRESOLVED_IDREFS,
    CompositionParser,
    all_elements,
    asset_path,
    by_id,
    by_tag,
    classes,
    parse_index,
)


REPO_ROOT = Path(__file__).resolve().parents[1]


ASGI_ROOT_SCRIPT = """
import asyncio
import base64
import json

import app


async def main():
    messages = []
    request_complete = False

    async def receive():
        nonlocal request_complete
        if request_complete:
            await asyncio.sleep(0)
            return {"type": "http.disconnect"}
        request_complete = True
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        messages.append(message)

    await app.app(
        {
            "type": "http",
            "asgi": {"version": "3.0", "spec_version": "2.4"},
            "http_version": "1.1",
            "method": "GET",
            "scheme": "http",
            "path": "/",
            "raw_path": b"/",
            "query_string": b"",
            "headers": [(b"host", b"testserver")],
            "client": ("testclient", 50000),
            "server": ("testserver", 80),
            "root_path": "",
        },
        receive,
        send,
    )
    start = next(message for message in messages if message["type"] == "http.response.start")
    body = b"".join(message["body"] for message in messages if message["type"] == "http.response.body")
    print(json.dumps({
        "status": start["status"],
        "headers": {key.decode().lower(): value.decode() for key, value in start["headers"]},
        "body": base64.b64encode(body).decode("ascii"),
    }))


asyncio.run(main())
"""


def rendered_root_from_working_directory(cwd: Path) -> tuple[int, dict[str, str], bytes]:
    environment = os.environ.copy()
    environment["PYTHONPATH"] = os.pathsep.join(
        [str(REPO_ROOT), environment.get("PYTHONPATH", "")]
    )
    result = subprocess.run(
        [sys.executable, "-c", ASGI_ROOT_SCRIPT],
        cwd=cwd,
        env=environment,
        capture_output=True,
        text=True,
        check=True,
    )
    payload = json.loads(result.stdout)
    return payload["status"], payload["headers"], base64.b64decode(payload["body"])


def parse_html(source: str):
    parser = CompositionParser()
    parser.feed(source)
    parser.close()
    return parser.document


def test_settings_partial_is_single_authority_at_the_original_composition_point() -> None:
    root_source = (REPO_ROOT / "templates" / "index.html").read_text(encoding="utf-8")
    partial_source = (REPO_ROOT / "templates" / "partials" / "settings" / "settings_drawer.html").read_text(
        encoding="utf-8"
    )
    rendered_source, document = parse_index()

    include = '{% include "partials/settings/settings_drawer.html" %}'
    assert root_source.count(include) == 1
    assert root_source.count('id="settingsDrawer"') == 0
    assert partial_source.count('id="settingsDrawer"') == 1

    body = next(element for element in by_tag(document, "body"))
    assert [child.tag for child in body.children[:3]] == ["header", "div", "main"]
    rendered_settings = next(element for element in all_elements(document) if element.attributes.get("id") == "settingsDrawer")
    partial_document = parse_html(partial_source)
    partial_settings = next(element for element in all_elements(partial_document) if element.attributes.get("id") == "settingsDrawer")
    assert normalized_tree(rendered_settings) == normalized_tree(partial_settings)
    assert rendered_source.count('id="settingsDrawer"') == 1


def test_search_partial_is_single_authority_at_the_original_composition_point() -> None:
    root_source = (REPO_ROOT / "templates" / "index.html").read_text(encoding="utf-8")
    partial_source = (REPO_ROOT / "templates" / "partials" / "panes" / "search_pane.html").read_text(
        encoding="utf-8"
    )
    rendered_source, document = parse_index()

    include = '{% include "partials/panes/search_pane.html" %}'
    assert root_source.count(include) == 1
    assert root_source.count('id="searchPane"') == 0
    assert partial_source.count('id="searchPane"') == 1

    main = next(element for element in by_tag(document, "main"))
    pane_order = [child.attributes.get("id") for child in main.children if child.tag == "section"]
    search_index = pane_order.index("searchPane")
    assert pane_order[search_index - 1 : search_index + 2] == ["dailyPane", "searchPane", "weeklyPane"]

    rendered_search = next(element for element in all_elements(document) if element.attributes.get("id") == "searchPane")
    partial_document = parse_html(partial_source)
    partial_search = next(element for element in all_elements(partial_document) if element.attributes.get("id") == "searchPane")
    assert normalized_tree(rendered_search) == normalized_tree(partial_search)
    assert rendered_source.count('id="searchPane"') == 1

    search_form = next(element for element in all_elements(rendered_search) if element.attributes.get("id") == "searchForm")
    assert search_form.tag == "form"
    assert [element.attributes.get("type") for element in all_elements(search_form) if element.tag == "button"] == [
        "submit",
        "button",
    ]
    assert next(element for element in all_elements(rendered_search) if element.attributes.get("id") == "searchResults").tag == "table"
    assert not any(element.attributes.get("open") is not None for element in all_elements(rendered_search) if element.tag == "details")


def test_charts_partial_is_single_authority_at_the_original_composition_point() -> None:
    root_source = (REPO_ROOT / "templates" / "index.html").read_text(encoding="utf-8")
    partial_source = (REPO_ROOT / "templates" / "partials" / "panes" / "charts_pane.html").read_text(
        encoding="utf-8"
    )
    rendered_source, document = parse_index()

    include = '{% include "partials/panes/charts_pane.html" %}'
    assert root_source.count(include) == 1
    assert root_source.count('id="chartsPane"') == 0
    assert partial_source.count('id="chartsPane"') == 1

    main = next(element for element in by_tag(document, "main"))
    pane_order = [child.attributes.get("id") for child in main.children if child.tag == "section"]
    charts_index = pane_order.index("chartsPane")
    assert pane_order[charts_index - 1 : charts_index + 2] == ["kpisPane", "chartsPane", "dailyPane"]

    rendered_charts = next(element for element in all_elements(document) if element.attributes.get("id") == "chartsPane")
    partial_document = parse_html(partial_source)
    partial_charts = next(element for element in all_elements(partial_document) if element.attributes.get("id") == "chartsPane")
    assert normalized_tree(rendered_charts) == normalized_tree(partial_charts)
    assert rendered_source.count('id="chartsPane"') == 1

    canvas_ids = [element.attributes.get("id") for element in all_elements(rendered_charts) if element.tag == "canvas"]
    assert canvas_ids == [
        "fitnessFatigueChartCanvas",
        "weeklyLoadChartCanvas",
        "weightChartCanvas",
        "volumeChartCanvas",
    ]

    category_tabs = [element for element in all_elements(rendered_charts) if element.attributes.get("role") == "tab"]
    assert [
        (element.attributes.get("id"), element.attributes.get("aria-selected"), element.attributes.get("aria-controls"))
        for element in category_tabs
    ] == [
        ("chartsFitnessTab", "true", "chartsFitnessPanel"),
        ("chartsLoadTab", "false", "chartsLoadPanel"),
        ("chartsHealthTab", "false", "chartsHealthPanel"),
        ("chartsVolumeTab", "false", "chartsVolumePanel"),
    ]
    assert "hidden" not in classes(by_id(rendered_charts, "chartsFitnessPanel"))
    for panel_id in ("chartsLoadPanel", "chartsHealthPanel", "chartsVolumePanel"):
        assert "hidden" in classes(by_id(rendered_charts, panel_id))

    for control_id in (
        "fitnessFatigueChartCanvasWrap",
        "weeklyLoadChartCanvasWrap",
        "weightChartMonthlyMode",
        "weightChartAnnualMode",
        "weightChartYearSelect",
        "volumeYearSelect",
    ):
        assert by_id(rendered_charts, control_id)

    scripts = [element.attributes.get("src") for element in by_tag(document, "script")]
    assert scripts.index("/static/vendor/chart.umd.min.js") < scripts.index("/static/charts.js") < scripts.index(
        "/static/app.js?v=20260914-service-nav"
    )


def test_service_partial_is_single_authority_at_the_original_composition_point() -> None:
    root_source = (REPO_ROOT / "templates" / "index.html").read_text(encoding="utf-8")
    partial_source = (REPO_ROOT / "templates" / "partials" / "panes" / "service_pane.html").read_text(
        encoding="utf-8"
    )
    rendered_source, document = parse_index()

    include = '{% include "partials/panes/service_pane.html" %}'
    assert root_source.count(include) == 1
    assert root_source.count('id="servicePane"') == 0
    assert partial_source.count('id="servicePane"') == 1

    main = next(element for element in by_tag(document, "main"))
    pane_order = [child.attributes.get("id") for child in main.children if child.tag == "section"]
    service_index = pane_order.index("servicePane")
    assert pane_order[service_index - 1 : service_index + 2] == ["zonesPane", "servicePane", "yearlyPane"]

    rendered_service = by_id(document, "servicePane")
    partial_document = parse_html(partial_source)
    partial_service = by_id(partial_document, "servicePane")
    assert normalized_tree(rendered_service) == normalized_tree(partial_service)
    assert rendered_source.count('id="servicePane"') == 1

    service_tabs = [element for element in all_elements(rendered_service) if element.attributes.get("role") == "tab"]
    assert [
        (element.attributes.get("id"), element.attributes.get("aria-selected"), element.attributes.get("aria-controls"), element.attributes.get("tabindex"))
        for element in service_tabs
    ] == [
        ("componentsSubtab", "true", "componentsPane", "0"),
        ("gearSubtab", "false", "gearPane", "-1"),
    ]

    service_panels = [element for element in all_elements(rendered_service) if element.attributes.get("role") == "tabpanel"]
    assert [element.attributes.get("id") for element in service_panels] == ["gearPane", "componentsPane"]
    assert [element.attributes.get("aria-labelledby") for element in service_panels] == ["gearSubtab", "componentsSubtab"]
    assert "hidden" in classes(by_id(rendered_service, "gearPane"))
    assert "hidden" not in classes(by_id(rendered_service, "componentsPane"))

    assert [element.attributes.get("id") for element in all_elements(rendered_service) if element.tag == "table"] == [
        "gearTable",
        "componentsTable",
    ]
    assert [element.attributes.get("id") for element in all_elements(rendered_service) if element.attributes.get("id") in {
        "hideShoesCheckbox",
        "hideRetiredCheckbox",
        "componentsControls",
        "componentsBikeSelect",
        "componentsSummary",
        "componentsAddButton",
        "componentsTableWrap",
    }] == [
        "hideShoesCheckbox",
        "hideRetiredCheckbox",
        "componentsControls",
        "componentsBikeSelect",
        "componentsSummary",
        "componentsAddButton",
        "componentsTableWrap",
    ]
    for class_name in ("gear-header-row", "gear-header-main", "gear-title", "gear-subtitle"):
        assert sum(class_name in classes(element) for element in all_elements(rendered_service)) == 2
    assert [element.tag for element in all_elements(rendered_service) if element.tag == "form"] == []

    scripts = [asset_path(element.attributes.get("src")) for element in by_tag(document, "script")]
    assert scripts.index("/static/gear.js") < scripts.index("/static/components.js")
    assert not any(
        attribute.lower().startswith("on")
        for element in all_elements(rendered_service)
        for attribute in element.attributes
    )


def test_core_pane_partials_are_single_authority_at_original_composition_points() -> None:
    root_source = (REPO_ROOT / "templates" / "index.html").read_text(encoding="utf-8")
    rendered_source, document = parse_index()
    pane_specs = (
        ("planPane", "plan_pane.html", ["planStrip"], [], True),
        ("goalsPane", "goals_pane.html", [], [], True),
        ("kpisPane", "kpis_pane.html", [], [], True),
        (
            "dailyPane",
            "daily_pane.html",
            ["dailySearchStatusWrap", "dailySearchStatusText", "dailySearchAdvanced", "dailyClearSearch", "dailyTable"],
            ["dailyTable"],
            False,
        ),
        ("weeklyPane", "weekly_pane.html", ["weeklyTable"], ["weeklyTable"], True),
        ("zonesPane", "zones_pane.html", ["zonesTable"], ["zonesTable"], True),
    )

    for pane_id, partial_name, expected_ids, expected_tables, expected_hidden in pane_specs:
        partial_source = (REPO_ROOT / "templates" / "partials" / "panes" / partial_name).read_text(
            encoding="utf-8"
        )
        include = f'{{% include "partials/panes/{partial_name}" %}}'
        assert root_source.count(include) == 1
        assert root_source.count(f'id="{pane_id}"') == 0
        assert partial_source.count(f'id="{pane_id}"') == 1

        rendered_pane = by_id(document, pane_id)
        partial_pane = by_id(parse_html(partial_source), pane_id)
        assert normalized_tree(rendered_pane) == normalized_tree(partial_pane)
        assert rendered_source.count(f'id="{pane_id}"') == 1
        assert [element.attributes.get("id") for element in all_elements(rendered_pane) if element.attributes.get("id")] == expected_ids
        assert [element.attributes.get("id") for element in by_tag(rendered_pane, "table")] == expected_tables
        assert ("hidden" in classes(rendered_pane)) is expected_hidden
        assert not any(
            attribute.lower().startswith("on")
            for element in all_elements(rendered_pane)
            for attribute in element.attributes
        )

    assert "Training Goals" in (REPO_ROOT / "templates" / "partials" / "panes" / "goals_pane.html").read_text(encoding="utf-8")
    assert "Key Performance Indicators" in (REPO_ROOT / "templates" / "partials" / "panes" / "kpis_pane.html").read_text(encoding="utf-8")
    assert by_id(document, "weeklyDrawer").parent is next(element for element in by_tag(document, "main"))
    assert "hidden" in classes(by_id(document, "weeklyDrawer"))


def normalized_tree(element):
    return (
        element.tag,
        tuple(sorted(element.attributes.items())),
        tuple(normalized_tree(child) for child in element.children),
    )


def test_root_renders_template_with_exact_normalized_dom_and_response_semantics(monkeypatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)

    status, headers, body = rendered_root_from_working_directory(tmp_path)
    rendered_source = body.decode("utf-8")
    _, template_document = parse_index()
    rendered_document = parse_html(rendered_source)

    assert status == 200
    assert headers["content-type"] == "text/html; charset=utf-8"
    assert normalized_tree(rendered_document) == normalized_tree(template_document)

    elements = all_elements(rendered_document)
    ids = [element.attributes["id"] for element in elements if element.attributes.get("id")]
    assert len(ids) == len(set(ids))

    id_set = set(ids)
    unresolved: set[tuple[str, str]] = set()
    for element in elements:
        label_target = element.attributes.get("for")
        if label_target and label_target not in id_set:
            unresolved.add(("for", label_target))
        for attribute in IDREF_ATTRIBUTES:
            value = element.attributes.get(attribute)
            if value:
                unresolved.update(
                    (attribute, target)
                    for target in value.split()
                    if target not in id_set
                )
    assert unresolved == KNOWN_UNRESOLVED_IDREFS

    stylesheet_paths = [
        asset_path(element.attributes.get("href"))
        for element in by_tag(rendered_document, "link")
        if element.attributes.get("rel") == "stylesheet"
    ]
    assert stylesheet_paths == [
        asset_path(element.attributes.get("href"))
        for element in by_tag(template_document, "link")
        if element.attributes.get("rel") == "stylesheet"
    ]
    script_paths = [
        asset_path(element.attributes.get("src"))
        for element in by_tag(rendered_document, "script")
        if element.attributes.get("src")
    ]
    assert script_paths == [
        asset_path(element.attributes.get("src"))
        for element in by_tag(template_document, "script")
        if element.attributes.get("src")
    ]

    assert not any(
        attribute.lower().startswith("on")
        for element in elements
        for attribute in element.attributes
    )
    assert "active" in classes(next(element for element in elements if element.attributes.get("id") == "dailyTab"))
    assert "hidden" in classes(next(element for element in elements if element.attributes.get("id") == "settingsDrawer"))