# Browser CSV exports

## Purpose and ownership

Training Intelligence browser CSV delivery is a `training-web` capability.
This document records the shared boundary; stable feature fields and behavior
remain in their owning contracts.

| Export | Route owner and endpoint | Row grain and bound | Filename | Authoritative feature contract |
| --- | --- | --- | --- | --- |
| Search | `routes/activities.py` — `GET /api/activities/search/export` | One row per activity; up to 50,000. The route detects row 50,001 and rejects the entire export. | `training-search.csv` | [Search PRD](PRD/Search.md) |
| Weekly | `routes/weekly.py` — `GET /api/weekly/export` | One row per available week, newest first; uses the selected 10, 52, or 520-row limit. | `training-weekly.csv` | [Weekly PRD](PRD/Weekly.md) |
| Components / Service History | `routes/components.py` — `GET /api/gear/components/export?gear_id=<selected-bike-id>` | Selected bike only; one row per service event, or one blank-event row for a component with no events. Includes active and archived components. | `training-components.csv` | [Components Service API](COMPONENTS_SERVICE_API.md) |
| Zones | `routes/zones.py` — `POST /api/zones/export` | One row per currently visible table row, in visible order; bounded by the UI limits 26, 60, or 260. | `training-zones.csv` | [Zones PRD](PRD/Zones.md) |

The feature routes own their query or posted-row scope, validation, bounds,
ordering, privacy choices, row construction, and fixed ordered field
allowlists. The authoritative feature documents above own detailed field
contracts; do not copy those lists into this shared document.

## Feature implementation surfaces

| Feature | UI module | Template | CSS | Focused route and UI tests |
| --- | --- | --- | --- | --- |
| Search | `static/search.js` | `templates/partials/panes/search_pane.html` | `static/search.css` | `tests/test_activity_search.py`, `tests/test_activity_search_ui.js` |
| Weekly | `static/weekly.js` | `templates/partials/panes/weekly_pane.html` | `static/weekly.css` | `tests/test_weekly_export.py`, `tests/test_weekly_export_ui.js` |
| Components / Service History | `static/components.js` | `templates/partials/panes/service_pane.html` | `static/components.css` | `tests/test_components_export.py`, `tests/test_components_export_ui.js` |
| Zones | `static/zones.js` | `templates/partials/panes/zones_pane.html` | `static/zones.css` | `tests/test_zones_export.py`, `tests/test_zones_export_ui.js` |

## Runtime ownership

- `csv_export.py` is the sole shared Python serializer and attachment-response
  owner. It accepts explicit ordered `CsvColumn` values and row mappings.
- `static/api.js` owns the sole generic same-origin browser CSV download helper,
  `window.api.downloadCsv`.
- `static/search.js`, `static/weekly.js`, `static/components.js`, and
  `static/zones.js` call that helper and own feature-specific button state,
  selected UI state, success/error presentation, and state preservation.
- Feature routes own CSV product behavior. Templates own structure, and
  feature CSS owns presentation.
- `static/app.js` owns shell navigation and history only; it contains no CSV
  export business logic.
- `training-etl` owns ingestion, authoritative transforms, training
  calculations, schema, and ETL-managed writes. ETL CSV writers may be
  implementation precedent only; they do not own browser-facing CSV delivery.
  Web runtime code must not import an ETL CSV writer.

There is no generic arbitrary export endpoint. Callers cannot select columns,
SQL, tables, filenames, or filesystem paths.

## Shared serialization and delivery contract

All four routes use `csv_export.py` and return an in-memory `text/csv;
charset=utf-8` attachment with a safe deterministic `.csv` basename. No
temporary or server-retained file is created.

The serializer provides:

- UTF-8 with BOM and CRLF record endings.
- Explicit header order and standard CSV quoting for commas, quotes, and
  embedded CR, LF, or CRLF.
- Blank cells for `None` and unavailable values; numeric zero remains `0`.
- Lowercase `true` / `false`, ISO dates and timestamps, and locale-independent
  numeric text.
- Spreadsheet formula neutralization for text whose first significant
  character, after leading whitespace or control characters, is `=`, `+`, `-`,
  or `@`. Typed negative numbers remain numeric.
- Safe ASCII attachment filenames and `Content-Disposition`.

The browser helper sends same-origin requests, rejects non-2xx and non-CSV
responses, downloads the response through an object URL, and revokes that URL.
It does not serialize CSV in JavaScript.

## Product privacy and state

- Search keeps `description` and `private_note` separate. Description is
  included; Private Note is included by default under the current approved
  contract and can be excluded with the Search checkbox. The checkbox resets
  checked after every export attempt and is not persisted. Narrative search's
  explicit Private Note source selection is a separate control.
- Weekly excludes coach/task notes, audit-item details, display/source
  metadata, and operational fields. Its existing canonical Weekly values and
  pre-aggregated joins are reused; it does not recalculate training metrics.
- Components includes selected-bike history only, repeats current component
  and clock values beside event snapshots, and excludes event source/reference,
  timestamps, raw lineage, and operational fields. Snapshot values remain
  distinct from current clocks.
- Zones accepts only the exact bounded visible-row schema. It does not export
  hidden fields or expanded history.
- All exports exclude raw provider payloads, credentials, tokens, exact
  coordinates/geometry, AI Coach data, arbitrary SQL, unrestricted tables or
  columns, and operational run data.

Each feature preserves its selected result set, limit, bike, or visible-row
state through export. Feature-owned status presents success and sanitized
failure without exposing private-note contents or provider payloads.

## Tests and release validation

The shared serializer contract is tested in `tests/test_csv_export.py`; the
shared browser helper in `tests/test_api_csv_download.js`. Feature route and UI
contracts remain in the Search, Weekly, Components, and Zones focused test
files. `tests/test_csv_export_architecture.py` protects cross-export ownership
and documentation boundaries. Tests use synthetic data and do not call paid
providers, production databases, Docker, SSH, or deployment.

From the repository root on Windows, use the repository-local interpreter:

```powershell
.\.venv\Scripts\python.exe -m py_compile tests\test_csv_export_architecture.py
node --check tests\test_deployment_parity_contract.js
node --check tests\test_f36_documentation_contract.js
.\.venv\Scripts\python.exe -m pytest tests\test_csv_export.py tests\test_activity_search.py tests\test_weekly_export.py tests\test_components_export.py tests\test_zones_export.py tests\test_csv_export_architecture.py -q
node --test tests\test_api_csv_download.js tests\test_activity_search_ui.js tests\test_weekly_export_ui.js tests\test_components_export_ui.js tests\test_zones_export_ui.js
$nodeTests = @(Get-ChildItem -Path tests -Filter 'test_*.js' -File | ForEach-Object { $_.FullName })
node --test $nodeTests
.\.venv\Scripts\python.exe -m pytest -q
git diff --check
```

The exact-commit release process is `.\deploy_training_web.ps1` on Windows
(`./deploy_to_server_from_mac.sh` on macOS/Linux). It requires a clean worktree
whose `HEAD` equals its configured upstream. Verify the deployed root's full
commit, asset-version references, cache headers, changed-asset hashes, and
affected live responses. Restart only `training-web` if startup-derived
metadata remains stale.
The permanent release and validation owners are
`.github/copilot-instructions.md`, `docs/FRONTEND_ARCHITECTURE.md`, and
`docs/TESTING_GUIDE.md`.

Record and compare the tested local commit with its configured upstream before
deploying:

```powershell
git status --short --branch
git rev-parse HEAD
git rev-parse '@{u}'
.\deploy_training_web.ps1
curl.exe -sS -D - http://192.168.1.100:8088/
```

### Live CSV response capture

Use one independent fresh-page scenario per export, with console, page-error,
failed-request, and response monitoring attached before navigation. Click the
real feature-owned `Export CSV` button and capture its same-origin `text/csv`
network response; do not depend on the browser's separate Blob/object-URL
download event. Inspect status, content type, content disposition, and response
bytes in memory. Check the BOM, header, row count/order, and relevant contract
without printing private-note contents or other sensitive values. Also verify
the feature reports success and preserves its UI state.

If the managed browser cannot expose the response body, use at most one bounded,
direct, non-mutating endpoint probe and report what remains unverified. Do not
change product code solely because the download harness did not expose a Blob
download, and do not require manual user confirmation.
