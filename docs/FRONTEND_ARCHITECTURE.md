# Frontend Architecture

## Status and authority

This is the permanent current architecture guide for the `training-web`
frontend. It describes the deployed V4 architecture after F35 and the F36
closeout. It is not a migration handoff or permission to introduce a framework.

The authority hierarchy and required-reading order are defined by
`docs/ENGINEERING_CONSTITUTION.md`; this guide is the detailed frontend
contract within that hierarchy. Executable contracts validate the guide and
current source. Temporary prompts and chat transcripts are not sources of
truth.

## Application shape

The browser application is:

- FastAPI and server-rendered Jinja2 templates
- modular CSS
- synchronous vanilla JavaScript feature modules
- shared `AppState` and `api` wrappers
- a small `TrainingApp.features` registry
- shell-owned navigation, URL/history, and activation coordination
- bounded browser-facing API routes over processed data

`templates/index.html` is the composition root and loads feature scripts in a
deliberate order, with `app.js` last. The browser calls `training-web` only.
`training-etl` owns ingestion, schema meaning, ETL writes, authoritative
calculations, rebuilds, and the `training-runner`/`training-api` services. The
accepted cross-repository boundary is documented in
`training-etl/docs/ARD/TRAINING_SYSTEM_SERVICE_BOUNDARIES.md`.

## Registry and ownership

`TrainingApp.features.<feature>` is the canonical composed-runtime call surface.
Each entry is the narrow public contract for one feature; it is not a second
state store and it does not imply that every lifecycle method exists.

The current composed application has 15 registry keys:

| Key | Owner | Public contract and notes |
| --- | --- | --- |
| `plan` | `static/plan.js` | Shell consumes the intentional `PlanController` registration bridge; `init`, `activate`, `refresh`, `load`, `render`. |
| `goals` | `static/goals.js` | Shell consumes the intentional `GoalsController` registration bridge; no-op `load`/`render` placeholder. |
| `kpis` | `static/kpis.js` | Shell consumes the intentional `KPIsController` registration bridge; no-op `load`/`render` placeholder. |
| `components` | `static/components.js` | F21 Components/Service lifecycle adapter and guarded editors; registered through the intentional `ComponentsController` bridge. |
| `charts` | `static/charts.js` | Category state, Chart.js instances, loading, replacement, freshness, and theme redraw; `init`, `activate`, `refresh`, `showCategory`. |
| `daily` | `static/daily.js` | Daily rows, exact-date route state, narrative, day actions, resync polling, timers, and cleanup; `init`, `activate`, `refresh`, `load`, `render`. |
| `search` | `static/search.js` | URL-backed filters, paging, sorting, results, and stale-result protection; `init`, `activate`, `refresh` and Search actions. |
| `weekly` | `static/weekly.js` | Weekly rows, commentary, audit surfaces, limits, and freshness; `init`, `activate`, `refresh`, `load`, `render`. |
| `zones` | `static/zones.js` | Zone rows, limits, and freshness; `init`, `activate`, `refresh`, `load`, `render`. |
| `service` | `static/components.js` | Compatibility key for the same F21 Components/Service lifecycle adapter and guarded editors; it points to the intentional `ComponentsController` bridge. |
| `gear` | `static/gear.js` | Gear filters, rows, freshness, and Search option refresh; `init`, `activate`, `refresh`, `load`, `render`. |
| `yearly` | `static/yearly.js` | Annual/monthly rows, view state, commentary surface, and maintenance coordination; `init`, `activate`, `refresh`, `showView`. |
| `coach` | `static/coach.js` | Sessions, messages, menus, delete confirmation, response stages, and cleanup; `init`, `activate`, `refresh`, `render`. |
| `sync` | `static/sync.js` | Global status, manual request action, 60-second polling, coalescing, stale protection, timers, and cleanup; `init`, `loadStatus`, `refresh`, `runSync`, `cleanup`. |
| `settings` | `static/settings.js` | Preferences, appearance, drawer, system status, settings controls, and narrow cross-feature coordination; `init`, `open`, `requestClose`, `applyAppearance`, `updateLimitPreference`, plus the two consumed Settings helper methods. |

The only intentional shell registration exceptions are Plan, Goals, KPIs, and
Components/Service. Those modules still publish controller globals that
`app.js` consumes because they do not yet self-register. No deleted feature
alias is a current compatibility surface. The dispatcher accepts an injected
legacy fallback for isolated contract harnesses, but the composed shell passes
no empty legacy implementation.

The ownership rule is:

- Templates define structure.
- CSS defines presentation.
- Feature modules own feature behavior and local state.
- `TrainingApp.features.<feature>` exposes the narrow public contract.
- `app.js` coordinates shell navigation/history and does not own feature business logic.
- API modules own browser fetch boilerplate and server operations.
- `training-etl` owns ingestion, schema meaning, writes, and authoritative calculations.
- Tests preserve behavior and architecture contracts.

### CSV export ownership

Browser-facing CSV delivery is owned by `training-web`: `csv_export.py` is the
sole Python serializer/attachment-response helper, and `static/api.js` is the
sole generic same-origin browser download helper. Feature routes own export
scope, validation, bounds, ordering, privacy, row construction, and fixed
field allowlists; feature modules own export-button state and UI-state
preservation. Templates and feature CSS retain their normal structure and
presentation roles. `app.js` remains shell-only and contains no export
business logic. ETL CSV writers are precedent only, not browser-delivery
owners. See [CSV_EXPORTS.md](CSV_EXPORTS.md) for the four current contracts.

## Lifecycle contract

Lifecycle methods exist only when real consumers need them; a feature may expose
some, all, or none of the following:

- `init(context)`: idempotent page-lifetime wiring and prerequisite setup.
- `activate(context)`: makes a feature active and may load/render its current key.
- `refresh(context, reason)`: explicitly reloads authoritative current data.
- `canDeactivate(context)`: optional side-effect-free guard; rejection fails closed.
- `deactivate(context)`: optional approved cleanup; it does not erase durable state.

Initialization is cached by the shell. Same-key activation is coalesced; a
changed route key may load intentionally. Async feature work guards every shared
state or DOM commit against stale responses. Missing optional methods are no-op
capabilities, not evidence for a second ownership path. A tab becoming hidden is
not an unmount: caches, listeners, timers, and in-flight requests normally
survive navigation.

## Transient surfaces and focus

`TrainingApp.TransientSurface` provides common close and focus mechanics, while
feature-specific policy remains with the feature. A surface captures its opener,
checks dirty-state or destructive-action guards before closing, supports
backdrop, Escape, and explicit close/cancel reasons, and restores focus to the
opener after an approved close when that opener remains usable. Components,
Service History, Weekly commentary, Yearly commentary, Coach delete/session
surfaces, Daily dialogs, and Settings retain their local policy and markup.
Dirty drafts fail closed or require explicit discard confirmation. A close path
is idempotent and must work when the DOM is already hidden or removed.

## Requests, timers, and coordination

Feature loaders coalesce compatible in-flight work. Explicit `refresh` forces a
new authoritative request according to the feature policy. Request IDs,
generations, or keyed caches prevent an older response from committing over
newer state; they do not claim to cancel the underlying request.

The module that creates a timer owns its interval/timeout and cleanup. Cleanup
is deterministic and idempotent, including `beforeunload` paths. A feature must
not be initialized or refreshed through both its registry entry and a legacy
global for one operation.

Settings is a coordinator, not the owner of Daily, Weekly, Zones, Gear, Yearly,
or other feature behavior. Its limit and preference methods call canonical
registry contracts. Global Sync status is separate from Daily single-day
activity resync: `sync.js` owns global status/polling, while `daily.js` owns its
preview, enqueue, status polling, and reload behavior. Shell routing/history is
separate from feature data/rendering behavior.

## Assets and deployment

Every first-party static asset URL uses the full clean Git commit in `?v=`.
Versioned assets are served with immutable long-lived caching; unversioned
assets must revalidate. Static-only deployment can leave startup-derived asset
metadata in the running process, so restart only the `training-web` application
process when the deployed root still advertises an older version.

Ordinary code or static deployment:

1. Test a clean, pushed commit.
2. Run `deploy_training_web.ps1` on Windows or `deploy_to_server_from_mac.sh` on macOS/Linux for that exact commit.
3. If runtime metadata is stale, perform only the scoped `training-web` restart: `cd /opt/training/web && docker compose restart training-web`.
4. Verify the root advertises the commit, all first-party asset references discovered from the rendered root use it, changed-asset hashes match, cache headers are correct, and root/API health is 200.

Container recreation is reserved for Compose, environment, mount, port,
network, or command configuration changes. An image rebuild is reserved for a
Dockerfile, requirements/dependency, system-package, or image-content change.
Routine source/static changes do not require recreation or image rebuild.
Documentation-only changes do not require deployment or restart.

The two supported scripts use the same archive include/exclude policy and
destination. They exclude Git metadata, secrets, virtual environments, caches,
tests, local databases, temporary archives, and deployment-only files. Both
require a clean worktree and local `HEAD` equal to its configured upstream
revision. Use the platform-native dry-run option to
inspect the archive without upload. No supported NAS deployment path remains.

## Testing and release evidence

The current complete-suite baseline is Python `268 passed, 85 subtests` and
Node `45/45` tests across 39 `test_*.js` files.
Tests are isolated from paid providers, production databases,
Docker, SSH, deployment, and mutating operations.

A release check records local/remote equality, clean status, the exact deployed
commit, rollback commit, root/API health, asset-version consistency,
changed-asset hash parity, bounded fresh-page browser scenarios, and final Git
status. Documentation-only repository commits may advance `HEAD` without
changing the deployed runtime commit; record both explicitly.

## Historical closeout context

The F17-F36 frontend architecture work established the current server-rendered
composition, lifecycle, transient-surface, ownership, compatibility, and
asset-versioning contracts. This historical note does not override the
current registry and ownership rules above. Future work must begin from this
permanent guide, current source, executable contracts, and repository
instructions; it must not resurrect deleted globals.
