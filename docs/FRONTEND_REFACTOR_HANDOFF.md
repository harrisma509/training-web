# Frontend Refactor Handoff

## Status and scope

This document records the current `training-web` frontend architecture through F30.
It is an architecture handoff, not an approval to introduce a framework or
rewrite the dashboard. The current implementation is server-rendered HTML
with vanilla JavaScript modules, modular CSS, shared `AppState`, and a shared
API wrapper.

The browser talks to `training-web` only. ETL-owned calculations, ingestion,
schema meaning, and rebuild behavior remain outside this document and belong
to `training-etl`.

## Current composition

`templates/index.html` is the composition root. It renders all top-level panes
and the static Settings, Coach delete, and Weekly commentary surfaces. Feature
modules are loaded as scripts in a deliberate order; `app.js` is loaded last.
Dynamic surfaces remain module-owned when their markup depends on runtime data.

`static/app.js` is the app-shell owner. It owns:

- `TrainingApp` registry population and shell wiring;
- top-level tab visibility and active-tab state;
- URL and `popstate` handling;
- shared header controls, mobile navigation, service subtabs, and chart view
   selection;
- initial all-feature data loading through `loadData()`.

`static/app-state.js` owns shared preferences and cross-feature state.
`static/api.js` owns fetch boilerplate and endpoint wrappers. Feature modules
own their rendering, feature-local state, and feature-specific event handlers.

The shell now owns one lifecycle-aware activation dispatcher and one queued
transition path. There is still no router-owned unmount, and controllers remain
compatibility objects with different method sets. A controller may expose
`init`, `activate`, `load`, `render`, or only legacy globals; callers must not
infer that a missing method means the feature has no initialization work.

## Activation and loading facts

The following behavior is current and intentional unless a later architecture
decision changes it:

| Area | Current owner | Initial load | Later activation | Request protection | Cleanup/deactivation |
| --- | --- | --- | --- | --- | --- |
| Plan | `plan.js` / `PlanController` | Startup activation calls canonical `activate` | Same-key activation coalesces; `refresh` forces authoritative reload | Plan request counters | No app-level deactivation |
| Goals, KPIs | respective module | No-op render/load controllers | No-op | None needed | None |
| Charts | `charts.js` / `TrainingApp.features.charts` | Startup/direct-link activation selects the persisted category and loads it | Same-category activation follows dispatcher coalescing; category changes load only the selected category; `refresh` forces reload | Per-data request IDs, category cache guards, and chart destruction | Charts owns replacement/status destruction and the theme observer; no tab deactivation hook |
| Daily | `daily.js` / `DailyController` | `loadData()` calls `load` | `popstate` may call `load` for an exact date; no normal tab hook | Daily request ID; narrative request ID/cache | Local menus/dialogs/drawers close locally; no tab deactivation hook |
| Search | `search.js` / `TrainingApp.features.search` | `init` wires listeners; activation loads the current URL-backed query when needed | Same query preserves results; `refresh` reloads the current query | Search request ID; stale-result preservation | Dynamic action menus close locally; no general deactivate hook |
| Weekly | `weekly.js` / `TrainingApp.features.weekly` | `init` wires handlers; startup preload and activation share in-flight work | Same-key activation reuses loaded rows; `refresh` forces reload | Weekly request ID and coalesced loader | Commentary and audit drawers close locally; no tab deactivation hook |
| Zones | `zones.js` / `TrainingApp.features.zones` | `init` binds the limit selector; startup preload and activation share in-flight work | Same-key activation reuses loaded rows; `refresh` forces reload | Zones request ID and coalesced loader | No app-level deactivation |
| Service / Gear | `components.js`, `gear.js` | Components remains F21 lifecycle-owned; Gear `init` binds filters and its startup preload is coalesced with activation | Gear activation reuses loaded rows; `refresh` forces reload | Components F21 guards; Gear request ID and stale-response protection | Component menus/drawers close locally; no tab deactivation hook |
| Yearly | `yearly.js` / `TrainingApp.features.yearly` | Startup preload and activation share in-flight work | Same-key activation reuses loaded rows; `refresh` forces reload; view selection delegates to the feature | Yearly request coalescing and freshness guard | Commentary drawer uses `TrainingApp.TransientSurface`; Settings maintenance remains separate |
| Coach | `coach.js` / `CoachController` | Not loaded by `loadData()` | `showTab()` calls `activate` once | Session load token; interval only during response stages | Local close methods; loading interval stops on completion and `beforeunload`, but no tab deactivation hook |
| Sync status | `sync.js` / `SyncController` | `loadData()` calls status load and app starts a 60-second interval | Not tab-scoped | None for the interval's individual fetches | Interval is app-global and has no teardown |
| Settings | `settings.js` / `SettingsController` | Module wiring is immediate; drawer data loads on demand | Drawer opens locally | Feature-local loading flags/promises | Drawer close is local; no app-level deactivation |

The important boundary is that hiding a pane is not unmounting it. DOM nodes,
module state, listeners, caches, timers, and in-flight requests generally
survive tab changes. New code must not assume that a tab change cancels work.

## Lifecycle contract for future adapters

The target controller shape is deliberately small. It is a compatibility
adapter around the existing modules, not a framework component model:

| Method | Required semantics |
| --- | --- |
| `init(context)` | One-time wiring and reference acquisition. It is called before the first activation, is idempotent, installs no duplicate listeners, and does not reset user state. It may start owned prerequisite loading, but must return a Promise when it does so and must surface failure through the feature's existing error state. Repeated calls return the same settled result or in-flight Promise. |
| `activate(context)` | Makes the feature active and may load or render the current view. It is idempotent for the same activation key; a changed key may refresh intentionally. It must not assume that another feature was deactivated. Async work uses a generation/request guard before every shared-state or DOM commit. Feature errors are rendered locally; callers receive a settled result describing failure rather than an uncaught rejection. |
| `refresh(context, reason)` | Explicitly requests current authoritative data again. It is safe to call while active or during initialization, serializes or supersedes overlapping work by documented policy, and never commits an older response over newer state. Refresh does not open transient UI, discard drafts, or change navigation. |
| `canDeactivate(context)` | Optional, side-effect-free guard evaluated before a tab or route transition. It may return a boolean or Promise of a boolean. `false` means the transition is blocked; dirty drafts, pending destructive decisions, or an explicitly documented unsafe in-flight action are the only reasons to block. A rejected guard fails closed and reports the error locally. |
| `deactivate(context)` | Optional post-approval cleanup. It is idempotent, closes or preserves transient surfaces according to the feature contract, invalidates stale request generations, clears feature timers/listeners that are activation-scoped, and does not erase durable state. It does not run when `canDeactivate` blocks. It may return a Promise when cleanup is asynchronous. |

For all five methods, `context` identifies the feature, activation key, route
state, and shared services without exposing a second global state store. A
method must be safe when its DOM is already hidden or its close path has
already run. `init` owns page-lifetime listeners; `activate`/`deactivate` own
activation-lifetime work. A controller must never use `deactivate` as a hidden
refresh or use `refresh` to discard a draft.

### Compatibility bridge rules

During migration, `window.TrainingApp.features[name]` is the canonical call
surface. Existing globals such as `window.loadDaily` and legacy controller
objects remain aliases until all callers move. The bridge has these rules:

1. `app.js` calls the registered adapter once. It must not call both the new
   method and its legacy alias for one activation.
2. An adapter may delegate to the legacy function internally, but the legacy
   function must not discover or call the adapter back.
3. Missing optional methods are no-ops, not evidence that the feature needs a
   second initialization path. The app shell may use a legacy `load` fallback
   only for a feature with no registered adapter method, and that fallback must
   be covered by a contract test.
4. Registration is idempotent and must preserve existing public names and
   behavior. Removing a legacy alias requires a separate approved increment.
5. Errors are normalized at the adapter boundary; compatibility callers must
   not receive an unhandled Promise rejection merely because the implementation
   became asynchronous.

F24 retired the proven-internal `window.SearchController` compatibility global.
`search.js` registers its controller in `TrainingApp.features.search` before
`app.js` loads, and the shell, Daily, Gear, and Search contract harness use
that canonical reference. Search request construction, URL/history state,
filters, form state, pagination, stale-result protection, and visible behavior
remain unchanged.

F29 consolidated the active Yearly dashboard runtime in `yearly.js`. The
feature module now owns Yearly loading, annual/monthly rendering, view state,
commentary API usage, request freshness, and the F20 transient surface. It
self-registers one stable controller at `TrainingApp.features.yearly`; the
retained `window.YearlyController` and `window.showYearlyView` names are
compatibility aliases to that controller. `app.js` retains only pane and
transition coordination plus the startup preload call through the registry.
Yearly maintenance remains outside the dashboard lifecycle and is not part of
the shell's data-loading path.

F30 consolidated the active Charts runtime in `charts.js`. The feature now owns
category state and tab/panel visibility, category-specific loading, Chart.js
instances, replacement destruction, request freshness, feature controls, and
theme redraw behavior. It self-registers one stable controller at
`TrainingApp.features.charts`; `window.ChartsController` and
`window.showChartsCategory` remain compatibility aliases because the existing
public surface is still part of the tracked runtime contract. `app.js` retains
only top-level Charts pane visibility and transition coordination.

## Listener and async ownership

Listeners attached to static controls are installed during script evaluation
or one-time module initialization. Listeners attached to rendered rows or
dynamic controls are recreated when that module rerenders. Document/window
listeners are module-owned and currently process events for the lifetime of
the page:

- `app.js`: mobile navigation, tab controls, service-subtab keyboard handling,
  and mobile-navigation outside-click/Escape handling;
- `coach.js`: Coach Escape/outside-click handling and `beforeunload` timer
  cleanup;
- `components.js`: menu outside-click, scroll, resize, and service-drawer
  Escape handling;
- `daily.js`: day-menu/narrative delegated table handling, dialog handling,
  and `beforeunload` status-timer cleanup;
- `search.js`: Search delegated controls, URL synchronization, and canonical
   registry registration;
- other modules: static-control listeners and dynamic-render listeners local to
  their feature.

Request IDs are stale-result guards, not cancellation. They prevent an older
response from mutating current state, but the request still runs. `AbortController`
is not the shared contract. A future cancellation change must be explicit about
whether it is only a performance optimization or also changes user-visible
loading/error behavior.

## Transient-surface inventory

Every transient surface has one feature owner. Static markup may be composed in
the template, but open/close state and dirty-data policy remain in the owning
module.

| Surface | Markup owner | State and behavior |
| --- | --- | --- |
| Settings drawer and AI Coach forms | `partials/settings/settings_drawer.html` + `settings.js` | Open/close locally; AI Coach and Custom Instructions keep a loaded baseline and draft; Cancel restores the draft boundary; save is explicit |
| Weekly commentary drawer | `partials/overlays/weekly_drawer.html` + `weekly.js` | Static shell with dynamic fields; dirty state prompts before close; Save persists and closes; Cancel/close discard only after confirmation |
| Weekly audit drawer | `weekly.js` dynamic creation | Read-only, locally opened/closed; async audit details use module-owned loading/error state |
| Daily activity narrative | `daily.js` dynamic row drawer | One active activity ID; cache plus request ID; retry is local; closing invalidates the active target |
| Daily day-actions menu/dialog/status | `daily.js` dynamic | Menu and dialog are removed on close; resync status is dismissible and success auto-dismisses after 10 seconds; polling is operation-scoped |
| Service component overflow menu | `components.js` dynamic | One open menu; closes on outside pointer, scroll, resize, or Escape |
| Component editor/service/history drawers | `components.js` dynamic | Local mode/editor state; explicit Cancel/Close; service/history operations own loading, error, and stale-snapshot guards |
| Yearly commentary drawer | `app.js` dynamic helper used by yearly rendering + `transient-surface.js` | Created once on demand; owner routes backdrop, close-button, and Escape requests; read-only close restores a connected/focusable opener when valid; async failure remains local empty-state text |
| Coach mobile session drawer | `coach_pane.html` + `coach.js` | Previous focus is saved/restored; backdrop and Escape close; session selection closes it |
| Coach overflow/session menus | static/dynamic Coach markup + `coach.js` | One menu state; outside click/Escape close; session delete uses a static dialog and focus trap |
| Search advanced filters and result action menus | `search_pane.html` + `search.js` | Filter draft is URL-backed when active; action menus are dynamic and locally closed; in-flight search keeps last valid results visible |

Transient surfaces must not become a second persistence layer. Durable values
remain in the owning API/database contract; drafts, open state, focus targets,
loading state, and dirty state remain transient module state.

## Observed interaction matrix

This matrix records live, non-destructive characterization of
`http://192.168.1.100:8088` on 2026-10-04. No Save, Delete permanently,
Record Service, Recalculate, or other mutating action was submitted. “No focus
return” means the browser focus target was not a named control after close; it
is an observed gap, not a desired contract.

| Surface | Open/focus | Outside click | Escape | Explicit close/cancel | Dirty changes | Tab navigation | Browser Back | Focus return |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Service History | Components action menu → Service History; close button received focus | Closes the drawer | Closes the drawer | Close button closes; editor Cancel returns to the edited event button | Read-only history is not dirty; editor changes are separate | Editor keeps focus within its controls, but live sequence exposed repeated/hidden date-control stops; do not treat as a polished focus contract | Not intercepted; route/page transition removes the surface | No focus return after backdrop, Escape, or close; Cancel from editor returns to the edited event button |
| Component editor | Components action menu → Edit Component; `componentEditorName` received focus | Closes immediately | Closes locally | Cancel/close closes without saving | No mutation was made; dirty protection is owned by the editor close path and must be preserved by adapters | Editor controls are keyboard reachable; exact focus loop is not yet a stable contract | Not intercepted; route/page transition removes the surface | No focus return after outside click in live characterization |
| Weekly commentary | Row edit control; drawer opens with `aria-hidden=false` | Current static drawer has no separate outside-click observation in this run | Close path is local; dirty discard must remain guarded | Cancel/close hides the drawer; source contract prompts when dirty | Input changes set dirty; discard confirmation protects unsaved fields; Save is the only persistence path | Fields are normal document controls; no dedicated focus trap observed | Not intercepted; route/page transition removes the drawer | No stable focus-return behavior observed |
| Yearly commentary | Year row click creates/opens one dynamic drawer; no focus move observed | Current dynamic helper closes by backdrop | No dedicated Escape close observed | Close button hides the drawer | Read-only; no dirty state | Normal document tab order; no focus trap | Not intercepted; route/page transition removes the drawer | No focus return after close |
| Coach delete confirmation | Session actions → Delete chat; Cancel receives focus | Dialog backdrop cancel path is available while not pending | Escape closes while not pending | Cancel closes; Delete permanently was not activated | Delete is a pending destructive decision, not a dirty draft | Static dialog owns a two-button Tab loop while open | Not intercepted; Browser Back changed to prior Search URL and removed the dialog through navigation | Cancel focus is established on open; Escape did not restore focus in live characterization |
| Settings drawer | Settings button opens the static drawer; the opening button remained focused | No outside-click close was assumed or relied on | No dedicated Escape close observed | Close settings hides the drawer | AI Coach and Custom Instructions drafts have module-owned dirty/baseline policies; General settings are immediate controls | Normal document tab order; no focus trap observed | Not intercepted; route/page transition removes the drawer | Opening focus remained on Settings; close left no named focus target |

The matrix is a characterization of the current vanilla implementation. Future
adapter work may improve focus return or route coordination only through an
explicit behavior change with a focused test and browser validation.

## Required contracts for future refactors

Until a separate implementation increment introduces lifecycle interfaces, keep
these rules:

1. A feature has one owner for its pane, state, API calls, rendering, and
   transient surfaces. `app.js` may coordinate activation but must not recreate
   feature business logic.
2. Static markup has one template authority. Dynamic markup has one feature
   renderer. Do not duplicate IDs or move a dynamic surface into a partial just
   because it visually resembles a static drawer.
3. A load path must guard stale responses before mutating shared state or the
   DOM. A request ID is acceptable current practice; document any new guard.
4. A close path must define dirty-data behavior, focus restoration, async
   status behavior, and whether dynamic nodes are removed or merely hidden.
5. Tab switching must preserve current behavior: hiding a pane does not imply
   deactivation, cancellation, reset, or refetch unless the caller explicitly
   does that work.
6. Cross-feature calls use a registered controller or a documented shared
   shell function. New direct calls through unrelated module globals require a
   written ownership reason.
7. New persistent user data requires an API and durable owner. Do not use
   `AppState`, `localStorage`, a drawer, or a rendered row as its source of
   truth.

## Safe refactor sequence

Future lifecycle work should proceed in small, behavior-preserving increments:

1. Add or update a source-level ownership contract for one feature or surface.
2. Expose the smallest controller method needed, preserving legacy globals
   while callers migrate.
3. Add a deterministic contract test for composition, activation, stale-result
   protection, or close behavior.
4. Run `node --check` on changed JavaScript and the focused test first.
5. Validate the affected browser workflow, including desktop and mobile when
   the surface is responsive.
6. Only after repeated feature-level contracts exist, consider a shared
   lifecycle adapter. Do not introduce a framework, global event bus, or
   universal modal manager as a prerequisite for ordinary feature work.

## F18 decision

F18 establishes the ownership and lifecycle record only. It does not change
runtime behavior, controller APIs, templates, CSS, database contracts, or ETL.
The first implementation candidate for a later increment is a narrow,
backward-compatible `activate`/`deactivate` contract for one high-risk feature
with measurable cleanup needs, most likely Coach or Components. That work must

## F19 implementation: shell activation dispatcher

F19 introduces `createFeatureActivationDispatcher` and the shell-owned
`activateFeature(name, options)` entry point in `static/app.js`. The public
`showTab` compatibility function delegates to that entry point, so desktop tab
clicks, mobile navigation, startup/default selection, direct URLs, programmatic
calls, and `popstate` all use the same queued transition path.

The dispatcher performs this order:

1. Resolve the registered destination controller and build a context containing
   `featureName`, `previousFeatureName`, `source`, `reason`, `activationKey`,
   route/query state, and history mode.
2. Run and cache optional `init(context)` once per registered feature,
   including overlapping activation attempts. An initialization rejection is
   caught and reported without an unhandled rejection.
3. For a feature change, await optional `canDeactivate(context)`. A false or
   rejected guard fails closed before URL, state, or pane visibility changes;
   a blocked `popstate` restores the last accepted URL without dispatching a
   new navigation event.
4. Run optional `deactivate(context)` only after approval.
5. Commit active state, URL/history, pane visibility, active tab state, mobile
   navigation state, and nested Service/Charts/Yearly view state.
6. Run destination `activate(context)` when present. Otherwise use exactly one
   documented legacy fallback, with no adapter-plus-fallback double invocation.

The dispatcher serializes overlapping transitions and coalesces same-feature
activations unless the route changed or the caller explicitly forces a
transition. The supported source values are `startup`, `direct-url`,
`tab-click`, `mobile-nav`, `popstate`, and `programmatic`.

### Migrated and bridged features

- Search and Coach retain their existing `activate` methods and now receive
  the shell context. Search owns its established query normalization while
  honoring the shell-selected push/replace mode exactly once.
- Plan, Weekly, Zones, Gear, and Search now expose idempotent `init`, canonical
   `activate`, and explicit `refresh` methods. Their controller `load` methods
   retain reload-on-call behavior; retired compatibility globals are removed
   where the consumer inventory permits.
- Plan no longer relies on a legacy activation fallback.
- Charts exposes `init`, `activate`, `refresh`, and `showCategory` through its
   canonical registry entry; the dispatcher updates category visibility without
   loading twice.
- Daily keeps its existing `load` fallback only for exact-date `popstate`.
- Goals and KPIs remain no-op placeholders. Components/Service remains on its
   F21 lifecycle adapter. Charts, Daily, Yearly, Coach, Settings, and Sync retain
   their existing compatibility paths and were intentionally excluded from F22
   because their loading, transient, or nested-view behavior has higher risk.
- `TrainingApp.features`, `TrainingApp.registerFeature`, `window.showTab`,
  `window.activateFeature`, legacy controller globals, and remaining legacy
  loaders such as `window.loadDaily` remain available.

Registration is idempotent: an existing feature entry is not overwritten by a
second registration. The dispatcher is the only shell transition entry point;
legacy functions are invoked only when the destination has no lifecycle
`activate` method.

### F22 low-risk lifecycle migration

F22 migrates Plan, Search, Zones, Gear, and Weekly to the canonical lifecycle
surface without changing routes, APIs, schema, persistence, calculations,
templates, CSS, or transient-surface behavior. `init` owns one-time listeners;
`activate` uses the current cached result or shares an in-flight request;
`refresh` explicitly reloads authoritative data. Existing request-generation
guards remain in place, and Gear now has the same stale-response protection
before committing rows, filters, or summaries. Failed and superseded loads do
not become permanently cached as successful initialization.

Legacy globals are retained for compatibility where repository consumers still
exist. Controller `load` methods continue to mean an explicit reload, while
the dispatcher calls the cache-aware lifecycle `activate` method.
Search keeps its URL-backed filters, paging, sorting, action menus, and stale
result preservation; its `refresh` reloads the current query without changing
navigation or drafts.

The remaining high-risk migrations are Daily, Charts, Yearly, Coach, Settings,
Sync, and any broader transient-surface coordination. F23 prerequisites
include an explicit owner and freshness policy for each remaining feature,
deterministic tests for any transient or dirty-state behavior it changes, and
a browser validation plan that proves no duplicate requests or compatibility
regressions.

### F23 implementation: Plan loader retirement

F23 retires exactly one proven-internal compatibility alias: `window.loadPlan`.
Repository search found no template, inline-handler, feature-local, test-harness,
deployment, or external integration consumer. The only application reference
was the Plan branch of `activateLegacyFeature`; that branch was unreachable
once `PlanController.activate` became canonical in F22 and is now removed.

Plan startup and tab activation continue through the registered
`TrainingApp.features.plan` controller. `activate` remains cache-aware and
coalesced, `refresh` and controller `load` remain forced reloads, request
generation protection is unchanged, and `PlanController` remains available
because the shell registry still consumes it. The F23 contract test proves the
removed loader is absent, canonical lifecycle methods remain present, and the
unrelated F22 compatibility globals remain unchanged.

### F25 implementation: Zones preload-global retirement

F25 retires the proven-internal Zones compatibility family: `window.loadZones`
and `window.ZonesController`. Repository search found only app-shell startup
refresh, Settings and feature-local limit-change refreshes, lifecycle
registration, and tests; there were no template handlers, deployment/browser
scripts, external integrations, or unknown consumers. `zones.js` now keeps its
loader private and registers `TrainingApp.features.zones` through the existing
identity-preserving bootstrap pattern.

Startup still calls the canonical forced `refresh`; activation remains
cache-aware and shares an in-flight preload; explicit refresh and limit changes
still force requests; request-generation protection, limits, persistence,
threshold rendering, empty/error behavior, and CSS ownership are unchanged.
The F25 contract covers registration, registry identity, preload/activation
coalescing, cached activation, forced refresh, limit reloads, stale responses,
rendering, and the absence of the retired globals.

Remaining compatibility debt includes Weekly's `WeeklyController` and loader
paths, plus the unmigrated feature families listed above. F27 completed the
next bounded Gear slice after a fresh external-consumer check.

### F26 implementation: deterministic static-asset versioning

F26 gives each rendered root document one immutable asset version. The standard
deployment script derives the exact clean Git `HEAD`, writes it to the generated
untracked `.deployment-version.json` metadata included in the archive, and
removes the local temporary file after packaging. The application reads that
metadata once at startup and passes `asset_version` to the root template. Local
development without deployment metadata uses the explicit `dev` fallback;
production startup fails closed when metadata is missing or unsafe.

Every first-party JavaScript and CSS URL in the root template uses the same
`?v={{ asset_version }}` value, with script and stylesheet order unchanged.
Root HTML and unversioned static paths are revalidated; matching versioned
static assets use long-lived immutable caching. Rollback means deploying the
rollback commit, which regenerates metadata and causes the root HTML to point
back to that commit's asset version. Deployment requires a clean Git worktree
and does not mutate tracked source files.

### F27 implementation: Gear compatibility-global retirement

F27 retires the proven-internal Gear compatibility globals `window.GearController`
and `window.renderGearTable`. Gear now creates the same identity-preserving
`TrainingApp` bootstrap used by Zones and registers one canonical
`TrainingApp.features.gear` controller before `app.js` loads. Its public methods
are `init`, cache-aware `activate`, forced `refresh`, forced `load`, `render` for
the Settings filter contract, and `syncFilters` for the existing Gear filter
wiring. The private `loadGear` loader, renderer, filter helpers, request ID,
and in-flight promise remain module-owned.

The app shell uses the canonical Gear controller for startup preload and the
header refresh button. Settings uses its narrow canonical `render` method for
appearance/filter preference changes. Gear continues to refresh Search options
through `TrainingApp.features.search.refreshGearOptions()` after successful
loads. No template, endpoint, API, CSS, table, filter, Service/Gear subtab, or
Search query behavior changed. The F27 contract proves registry identity,
preload/activation coalescing, cached activation, forced refresh, stale-response
protection, filter and table rendering, Service summary updates, and Search
refresh integration.

### F28 implementation: Weekly compatibility-global retirement

F28 retires the Weekly compatibility globals `window.WeeklyController` and
`window.loadWeekly`; no other Weekly global exports were found in the tracked
repository. `weekly.js` now keeps its state, loader, renderer, commentary
drawer, and audit drawer helpers lexical and registers one identity-preserving
`TrainingApp.features.weekly` controller. The controller exposes only the
existing lifecycle, render, and drawer methods needed by feature-local and
shell behavior.

The app shell and Settings row-limit reload use the canonical Weekly registry.
Startup preload, cache-aware activation, forced refresh, request coalescing,
request-generation protection, table rendering, commentary dirty-close/save
behavior, and audit loading/error behavior are unchanged. The F28 contract
covers registry identity, lifecycle request policy, retired-global absence,
private helper retention, shell/Settings consumers, and overlay ownership.

The remaining compatibility debt is the higher-risk feature families and
feature-local transient/deactivation coordination listed below. F29 should
address only an explicitly approved next slice; no broader cleanup is implied
by F28.

### Remaining inconsistencies and F20/F21 prerequisites

Feature controllers still do not all implement `init`, `activate`,
`refresh`, `canDeactivate`, and `deactivate`. Hiding a pane still does not
unmount it, cancel requests, or close feature-owned transient surfaces. Service
History, Component editor, Weekly commentary, Coach delete focus restoration,
Settings close focus, outside-click behavior, and shared dirty-editor
navigation remain feature-local and inconsistent as characterized in F18.

F20 defines the shared transient-surface and dirty-close contract before
the dispatcher gains broad dirty-editor coordination. F21 may then address
focus return, outside-click consistency, activation-scoped cleanup, or further
controller migration. F19 intentionally does not remove legacy globals,
normalize fetch calls, add a shared modal manager, or migrate every controller.
prove a user-visible defect or resource leak before expanding to other modules.

## F20 implementation: transient-surface close and focus contract

F20 adds `static/transient-surface.js`, a small `TrainingApp.TransientSurface`
primitive loaded before feature modules. It owns only transient opener state and
an open-generation token. `open({ opener })` intentionally replaces the opener
when a surface is reopened; `requestClose(reason)` is the supported close entry
point; `close(reason)` is idempotent; and `isOpen()` reports current transient
state. An optional synchronous or asynchronous `canClose(reason)` hook may
veto a request. Guard rejection fails closed and is reported without an
unhandled rejection. Accepted close runs the feature-owned close callback
before restoring focus, and focus is restored only to a connected, visible,
enabled, focusable opener. The primitive stores no durable data and installs no
document listeners.

The Yearly commentary drawer is the single F20 reference migration. The active
shell-owned drawer captures the clicked or keyboard-activated Yearly row and
routes close-button, backdrop, and Escape events through the shared request
path. Yearly continues to own dynamic markup, loading text, commentary API
loading, content rendering, empty/error rendering, and hidden-state updates.
Navigation does not restore focus into a hidden Yearly pane because the shared
focus check rejects detached or hidden openers. The drawer remains read-only;
no dirty confirmation policy is added.

The deferred policy seam is `canClose(reason)`: future clean editors may allow
close, while dirty editors may veto or confirm in their owning module. Dirty
state is not inferred or persisted by the primitive, and destructive
confirmation remains feature-owned. F21 may migrate Components and Service
History only after focused contracts cover their editor/history ownership,
dirty behavior, navigation cleanup, and focus targets. Weekly commentary,
Settings, Coach delete, Daily narrative, and other transient surfaces remain
unmigrated and retain their existing behavior.