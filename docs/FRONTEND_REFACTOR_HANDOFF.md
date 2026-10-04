# Frontend Refactor Handoff

## Status and scope

This document records the current `training-web` frontend architecture for F19.
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

- `TrainingApp` registry population from module globals;
- top-level tab visibility and active-tab state;
- URL and `popstate` handling;
- shared header controls, mobile navigation, service subtabs, and chart/yearly
  view selection;
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
| Plan | `plan.js` / `PlanController` | `loadData()` does not load it; initial `showTab()` calls `load` | `showTab()` calls `load` | Plan request counters | No app-level deactivation |
| Goals, KPIs | respective module | No-op render/load controllers | No-op | None needed | None |
| Charts | `charts.js` / `ChartsController` | `loadData()` does not load it; category activation loads selected data | `showChartsCategory()` loads selected category | Per-data request IDs and chart destruction | Charts are destroyed when their replacement/status path requires it; no tab deactivation hook |
| Daily | `daily.js` / `DailyController` | `loadData()` calls `load` | `popstate` may call `load` for an exact date; no normal tab hook | Daily request ID; narrative request ID/cache | Local menus/dialogs/drawers close locally; no tab deactivation hook |
| Search | `search.js` / `SearchController` | `loadData()` does not load results | `showTab()` calls `activate`; URL restore occurs on `popstate` | Search request ID; stale-result preservation | Dynamic action menus close locally; no general deactivate hook |
| Weekly | `weekly.js` / `WeeklyController` | `loadData()` calls `load` | No normal tab activation load | Weekly request ID | Commentary and audit drawers close locally; no tab deactivation hook |
| Zones | `zones.js` / `ZonesController` | `loadData()` calls `load` | No normal tab activation load | Zones request ID | No app-level deactivation |
| Service / Gear | `components.js`, `gear.js` | `loadData()` loads both | Subtab switch changes visibility; does not load | Components has no shared request token; Gear has no request token | Component menus/drawers close locally; no tab deactivation hook |
| Yearly | `yearly.js` plus app-owned `loadYearly` | `loadData()` calls `loadYearly` | View switch changes visibility; no normal activation load | No shared request token | Commentary drawer is dynamically created and locally closed |
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
- `search.js`: Search delegated controls and URL synchronization;
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
- Plan remains a legacy `load` fallback when no `activate` method exists.
- Charts keeps `showChartsCategory` as its legacy nested-view/load fallback;
  the dispatcher updates category visibility without loading twice.
- Daily keeps its existing `load` fallback only for exact-date `popstate`.
- Goals, KPIs, Weekly, Zones, Service/Gear, Yearly, and Settings retain their
  existing no-op or initial-load behavior; no fake lifecycle methods were
  added.
- `TrainingApp.features`, `TrainingApp.registerFeature`, `window.showTab`,
  `window.activateFeature`, legacy controller globals, and legacy loaders such
  as `window.loadPlan` and `window.loadDaily` remain available.

Registration is idempotent: an existing feature entry is not overwritten by a
second registration. The dispatcher is the only shell transition entry point;
legacy functions are invoked only when the destination has no lifecycle
`activate` method.

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