import asyncio
import json
import re
from pathlib import Path

import pytest
from jinja2 import Environment, FileSystemLoader

import app
from asset_version import load_asset_version


REPO_ROOT = Path(__file__).resolve().parents[1]
ASSET_REF = re.compile(r'(?:src|href)="(/static/[^"?]+\.(?:js|css)(?:\?[^" ]+)?)"')
EXPECTED_ASSET_ORDER = [
    "style.css",
    "daily.css",
    "gear.css",
    "zones.css",
    "search.css",
    "components.css",
    "plan.css",
    "goals.css",
    "kpis.css",
    "charts.css",
    "settings.css",
    "weekly.css",
    "yearly.css",
    "coach-layout.css",
    "coach-sessions.css",
    "coach-conversation.css",
    "coach-composer.css",
    "coach-context.css",
    "coach-responsive.css",
    "constants.js",
    "app-state.js",
    "utils.js",
    "transient-surface.js",
    "api.js",
    "weekly.js",
    "zones.js",
    "gear.js",
    "components.js",
    "sync.js",
    "yearly.js",
    "ai-coach-settings-validation.js",
    "ai-coach-custom-instructions-validation.js",
    "coach-memories.js",
    "settings.js",
    "daily.js",
    "search.js",
    "plan.js",
    "goals.js",
    "kpis.js",
    "vendor/chart.umd.min.js",
    "charts.js",
    "coach.js",
    "app.js",
]


def render_index(asset_version: str) -> str:
    environment = Environment(loader=FileSystemLoader(str(REPO_ROOT / "templates")))
    return environment.get_template("index.html").render(asset_version=asset_version)


def asset_urls(asset_version: str) -> list[str]:
    return ASSET_REF.findall(render_index(asset_version))


def call_app(path: str, query_string: bytes = b"") -> tuple[int, dict[str, str], bytes]:
    async def run() -> tuple[int, dict[str, str], bytes]:
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
                "path": path,
                "raw_path": path.encode("ascii"),
                "query_string": query_string,
                "headers": [(b"host", b"testserver")],
                "client": ("testserver", 50000),
                "server": ("testserver", 80),
                "root_path": "",
            },
            receive,
            send,
        )
        start = next(message for message in messages if message["type"] == "http.response.start")
        body = b"".join(message["body"] for message in messages if message["type"] == "http.response.body")
        return (
            start["status"],
            {key.decode().lower(): value.decode() for key, value in start["headers"]},
            body,
        )

    return asyncio.run(run())


def test_asset_version_loads_metadata_and_rejects_unsafe_values(tmp_path, monkeypatch) -> None:
    metadata_path = tmp_path / ".deployment-version.json"
    metadata_path.write_text(json.dumps({"asset_version": "abc123.v1"}), encoding="utf-8")
    monkeypatch.delenv("TRAINING_WEB_ASSET_VERSION", raising=False)
    monkeypatch.setenv("TRAINING_WEB_ENV", "production")

    assert load_asset_version(tmp_path) == "abc123.v1"

    monkeypatch.setenv("TRAINING_WEB_ASSET_VERSION", "bad version")
    with pytest.raises(RuntimeError, match="Invalid asset version"):
        load_asset_version(tmp_path)

    metadata_path.write_text("[]", encoding="utf-8")
    monkeypatch.delenv("TRAINING_WEB_ASSET_VERSION", raising=False)
    with pytest.raises(RuntimeError, match="Invalid asset version"):
        load_asset_version(tmp_path)


def test_missing_production_metadata_fails_and_development_uses_explicit_fallback(tmp_path, monkeypatch) -> None:
    monkeypatch.delenv("TRAINING_WEB_ASSET_VERSION", raising=False)
    monkeypatch.setenv("TRAINING_WEB_ENV", "production")
    with pytest.raises(RuntimeError, match="required in production"):
        load_asset_version(tmp_path)

    monkeypatch.setenv("TRAINING_WEB_ENV", "development")
    assert load_asset_version(tmp_path) == "dev"


def test_every_first_party_javascript_and_css_url_has_one_safe_shared_version() -> None:
    version = "abc123.v1"
    urls = asset_urls(version)
    paths = [url.split("?", 1)[0].removeprefix("/static/") for url in urls]

    assert paths == EXPECTED_ASSET_ORDER
    assert len(urls) == len(EXPECTED_ASSET_ORDER)
    assert all(url.endswith(f"?v={version}") for url in urls)
    assert re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", version)


def test_same_version_is_stable_and_changed_version_changes_urls() -> None:
    first = asset_urls("release-a")
    second = asset_urls("release-a")
    changed = asset_urls("release-b")

    assert first == second
    assert first != changed
    assert "datetime" not in Path(REPO_ROOT / "asset_version.py").read_text(encoding="utf-8")
    assert "random" not in Path(REPO_ROOT / "asset_version.py").read_text(encoding="utf-8")


def test_root_and_static_cache_policy() -> None:
    root_status, root_headers, root_body = call_app("/")
    versioned_status, versioned_headers, _ = call_app(
        "/static/app.js", f"v={app.ASSET_VERSION}".encode("ascii")
    )
    unversioned_status, unversioned_headers, _ = call_app("/static/app.js")

    assert root_status == 200
    assert f"/static/app.js?v={app.ASSET_VERSION}" in root_body.decode("utf-8")
    assert root_headers["cache-control"] == "no-cache, no-store, must-revalidate"
    assert versioned_status == 200
    assert versioned_headers["cache-control"] == "public, max-age=31536000, immutable"
    assert unversioned_status == 200
    assert unversioned_headers["cache-control"] == "no-cache, must-revalidate"
