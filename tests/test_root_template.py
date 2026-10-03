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