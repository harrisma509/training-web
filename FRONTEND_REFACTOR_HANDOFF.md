# Frontend refactor handoff

This note is for the next coding session. It captures the current state of the Training Dashboard web app and the safest next refactor steps without broadening scope or changing behavior.

## Scope and intent

This repo is a lightweight vanilla-JS dashboard served by FastAPI. The app is intentionally small and stable; the goal of the refactor is to reduce ownership drift, not to rewrite the app or convert it to a framework.

Important boundaries:
- Do not change API contracts.
- Do not add features.
- Do not broaden into backend or ETL work.
- Preserve the existing UI behavior and tab flow.
- Keep the app shell thin and feature modules explicit.

## Current architecture

### App shell
- [index.html](index.html): main HTML shell, tabs, settings drawer, and header controls
- [app.py](app.py): FastAPI bootstrap, router registration, static file mount

### Shared layers
- [static/app-state.js](static/app-state.js): canonical state and preference owner
- [static/api.js](static/api.js): shared fetch wrappers and endpoint contract
- [static/utils.js](static/utils.js): shared formatting and safe-rendering helpers
- [static/constants.js](static/constants.js): constants and threshold data only

### Feature modules
- [static/daily.js](static/daily.js): daily table and data loading
- [static/weekly.js](static/weekly.js): weekly table, commentary, audit drawer
- [static/zones.js](static/zones.js): zone rendering and threshold highlighting
- [static/yearly.js](static/yearly.js): yearly table and maintenance preview/calc
- [static/gear.js](static/gear.js): gear filters and gear table rendering
- [static/components.js](static/components.js): component view and gear selection
- [static/settings.js](static/settings.js): settings drawer, preferences, system status
- [static/sync.js](static/sync.js): sync pill and sync request flow
- [static/app.js](static/app.js): tab switching and app-level shell wiring

## What is already in good shape

- State is centralized in AppState rather than duplicated across feature files.
- Fetch logic is centralized behind the shared API object.
- Feature modules are mostly scoped to their own rendering logic.
- The app shell is relatively thin and does not own data logic beyond tab behavior.
- The recent TrainingApp namespace work is a good direction because it provides one public application registry without deleting working compatibility code.

## Main risk areas

### 1. Compatibility globals still create drift
There are still numerous legacy globals such as:
- loadWeekly
- loadDaily
- loadZones
- renderGearTable
- persistPreferences
- syncFormCheckboxes
- loadSystemStatus

This is the biggest maintenance hazard.

Why it matters:
- multiple access patterns reach the same behavior
- startup order matters more than it should
- future refactors can accidentally bypass the canonical app entrypoints

Recommendation:
- keep TrainingApp as the app-wide public registry
- retain compatibility aliases only as a temporary bridge
- prioritize removing or reducing ad hoc global access in a narrow, prove-it-safe cleanup

### 2. Lifecycle ownership is split across layers
The app shell and feature modules both own initialization behavior.

Examples:
- app.js wires tab clicks and refresh buttons
- feature files also perform module-level setup and direct render calls
- some code still assumes global availability instead of explicit controller access

Recommendation:
- standardize one feature lifecycle pattern:
  - init
  - bindEvents
  - load
  - render
- drive feature calls via TrainingApp.features.<name> where possible

### 3. Settings controller is too broad
Settings logic covers:
- appearance
- preference persistence
- row limits
- default bike
- system status refresh
- yearly maintenance actions

This works, but it is doing multiple jobs.

Recommendation:
- split settings into smaller controller groups or helpers
- keep preference syncing separate from yearly maintenance logic and system status

### 4. Large modules are still doing too much
The largest files are likely:
- weekly.js
- yearly.js
- settings.js

These files combine fetch flow, state mutation, rendering, and drawer behavior in one place.

Recommendation:
- split by concern: comment drawer, audit drawer, preview status, yearly maintenance panel, settings subviews

## Suggested next refactor sequence

Do not do a broad rewrite. Use this order:

1. Make TrainingApp the canonical app registry
2. Reduce compatibility globals to a thin compatibility layer only
3. Split settings into smaller concerns
4. Break large feature modules by drawer or panel
5. Add safer contract-level boundaries for API payloads

This sequence avoids a risky front-end rewrite while still improving ownership clarity.

## Guardrails for the next session

- Do not change API contracts.
- Do not change the DB or backend route structure.
- Do not add new features or UI polish that is not already part of the app shell.
- Do not remove compatibility aliases until a clear replacement path is proven.
- Keep use of AppState and api as the canonical owners.
- Keep TrainingApp as the public registry, not a second state system.

## Fresh validation evidence

The last validation run succeeded with exit code 0:

```bash
cd /Users/mikeharris/Code/training-web && node --check static/api.js && node --check static/app-state.js && node --check static/app.js && node --check static/components.js && node --check static/constants.js && node --check static/daily.js && node --check static/gear.js && node --check static/settings.js && node --check static/sync.js && node --check static/utils.js && node --check static/weekly.js && node --check static/yearly.js && node --check static/zones.js && ./deploy_to_nas.sh
```

Result:
- all JavaScript syntax checks passed
- NAS deploy succeeded
- output reported: "Deploy complete."

## How to use this note in a new session

Read this note first, then:
1. confirm the current app shell and shared layers are the same as described
2. start with the compatibility-global cleanup
3. keep the app registry and AppState boundaries intact
4. stop after the smallest safe cleanup milestone, not after a broad rewrite

This note is meant to be a safe starter document for a future refactor session, not a mandate for a big conversion.

## Short version

The app is already more organized than a typical vanilla front-end, but the remaining work is mostly about reducing drift and standardizing ownership.

If a next session wants to do more, the correct target is: a smaller, safer ownership cleanup, not a framework migration.
