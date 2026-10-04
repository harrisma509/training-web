## Required Engineering Grounding

Before planning, investigating, or changing code, read:

1. `docs/ENGINEERING_CONSTITUTION.md`
2. The relevant architecture or feature document
3. `docs/TESTING_GUIDE.md`

The Engineering Constitution defines cross-repository principles.
This file defines repository-specific mandatory instructions.
Feature documents define detailed contracts and current behavior.

# GitHub Copilot Instructions for training-web

## Project

This repo contains the FastAPI web app and browser dashboard for the Training Dashboard.

The separate `training-etl` repo owns Strava ingestion, ETL builders, database writes, schema SQL, weekly audit computation, and future service-log import work.

## Repo boundary

This repo owns:
- The browser-facing FastAPI application and browser-facing routes
- Static frontend assets and product presentation
- Bounded, parameterized, server-side read-only PostgreSQL queries over processed data
- Search, reporting, lookup, narrative, and approved export workflows
- Web-owned records and bounded CRUD
- Coach sessions, messages, turns, settings, memories, receipts, orchestration, and provider integration
- Sync request orchestration and status presentation

The separate `training-etl` repo owns:
- External-source ingestion and provider credentials
- Normalization and authoritative field semantics
- Schema SQL, migrations, and schema evolution
- ETL-managed writes
- Authoritative calculations and builders
- Backfills, rebuilds, reconciliation, and repair logic
- `training-runner` and `training-api`

Do not modify `training-etl` files from this repo unless explicitly requested.

For repository, service, database, Search, ETL orchestration, or internal API decisions, read `training-etl/docs/ARD/TRAINING_SYSTEM_SERVICE_BOUNDARIES.md`.

`training-web` is the browser-facing application and server-side read/query layer. Its server-side routes may perform bounded, parameterized, read-only PostgreSQL queries over processed data for ordinary dashboard, Search, reporting, lookup, narrative, and export workflows. This does not grant schema ownership or permission to duplicate ETL calculations.

The separate `training-api` container is an internal authenticated ETL facade for explicitly approved synchronous ETL operations and coordinated ETL-owned contracts. It is not the mandatory path for every database read, and browser JavaScript must never call it directly. `training-runner` executes scheduled, queued, and background ETL work.
Do not change database schema from this repo unless explicitly requested.

## Runtime

- The app runs in Docker on HarrisServer.
- Live app: `http://192.168.1.100:8088`
- Local `.venv` may not have runtime dependencies.
- Local `py_compile` is syntax-only.
- Real validation must happen against the HarrisServer runtime.

## Deployment

Deploy from macOS or Linux with:

```bash
./deploy_to_server_from_mac.sh
```

On Windows, use `.\deploy_training_web.ps1`. Both supported scripts require
a clean worktree whose `HEAD` equals its configured upstream revision, package
the same exact commit, and support `-DryRun` on Windows or `--dry-run` on
macOS/Linux to inspect the archive without uploading it.

After deployment, verify the rendered root advertises the expected full commit.
If startup-derived commit or asset metadata remains stale, restart only
`training-web`, then repeat health, version, cache, and changed-asset hash
verification. Documentation-only changes are not deployed or restarted.

After deploy, validate live endpoints with `curl`.

Example:

```bash
curl -sS -D - http://192.168.1.100:8088/api/gear/dashboard?limit=5
```

## Safety rules

- Keep changes scoped and commit-friendly.
- Do not refactor unrelated code.
- Do not touch Daily, Weekly, Zones, Sync, Weekly Audit, or Health ingestion unless the task requires it.
- Do not expose or log `.env`, tokens, secrets, raw Strava JSON, credentials, access tokens, or refresh tokens.
- Prefer read-only features first.
- Add write/edit UI only when explicitly requested.
- If more files are needed than expected, stop and explain before broad edits.

## Frontend rules

- Preserve the existing dark theme.
- Use compact cards, tables, badges, and dots.
- Do not color entire table rows unless requested.
- Do not add charts unless requested.
- Avoid `null`, `undefined`, and `NaN` in UI.
- Do not rewrite tab wiring unless required.
- If a tab renders but data is blank, check:
  - browser console
  - network request
  - API response
  - server logs

## Backend rules

- Reuse existing route and DB helper patterns.
- Keep route paths stable.
- Use simple readable SQL.
- Do not return `raw_json` unless requested.
- Do not expose secret-like values in API responses.
- Be careful with psycopg percent signs in SQL. Literal LIKE patterns may need escaped percent signs, such as `LIKE '%%bike%%'`.
- If an endpoint returns 500, inspect the exact exception before guessing.

## Gear and service rules

- `gear` is the canonical gear registry.
- `strava_activities` is the source for activity-level gear usage.
- `gear_id` is the stable join key.
- `gear_name` is display text.
- Service components are not gear rows.
- Do not create service tables unless explicitly requested.
- Do not add service write/edit UI unless explicitly requested.

## Validation required

For backend changes:

1. Run `.\.venv\Scripts\python.exe -m py_compile` on touched Python files on Windows, or `./.venv/bin/python -m py_compile` on macOS/Linux.
2. Deploy with the platform-native supported deployment script.
3. Test affected live endpoint with `curl`.
4. Confirm HTTP 200.
5. Confirm JSON shape.
6. Confirm no secrets or raw JSON appear.

For frontend changes:

1. Deploy to `http://192.168.1.100:8088` HarrisServer.
2. Hard refresh browser with `Cmd+Shift+R`.
3. Confirm changed tab loads.
4. Confirm Daily, Weekly, Zones, Sync still work.
5. Confirm no console errors.
6. Confirm no blank page.
7. Confirm no `null`, `undefined`, or `NaN`.

## Automated testing

- Read [docs/TESTING_GUIDE.md](../docs/TESTING_GUIDE.md) before changing Python behavior.
- Every new or changed Python behavior and every bug fix should add or update focused deterministic tests unless the completion report documents a concrete exception.
- When Mike says he is done with manual edits and asks GHC to update tests, inspect and preserve his uncommitted diff, add the smallest tests that prove the intended behavior, and do not merely update expectations to force green.
- Run focused tests first, then the full suite using the platform-native repository-local interpreter documented in `docs/TESTING_GUIDE.md`.
- Default tests must not access paid providers, external services, production data, Docker, SSH, or deployment.
- `rg` is available on Mike's Mac for focused repository searches. Use it when helpful, but fall back to `grep` or `find` rather than treating it as a required dependency.
- Report exact commands and results.

## Failure rule

If something fails:

- Stop feature work.
- Reproduce the failure.
- Read the exact error.
- Fix the smallest exact cause.
- Remove temporary debug output before final.
- Report files changed and validation commands run.

## Permanent architecture and execution budget

For frontend ownership, lifecycle, registry keys, transient surfaces, asset
versioning, deployment modes, and release verification, read
`docs/FRONTEND_ARCHITECTURE.md`. It is the permanent architecture source for
the vanilla-JavaScript frontend. Temporary prompts and chat transcripts are
not sources of truth.

The execution policy is single-pass rigor: discover once, patch narrowly,
validate in order, deploy deterministically when required, and stop when the
evidence is green.

Discovery:

- Maximum one ownership inventory per slice.
- Maximum one focused follow-up search per unclear boundary.
- Do not repeat discovery after context compaction; reuse recorded findings.
- Do not broaden search after editing begins unless a failing check exposes a
  specific unknown.

Implementation:

- Use at most two narrow patch attempts per boundary.
- If formatter, indentation, or line-ending churn appears, restore the
  affected file immediately and reapply narrowly.
- Do not repeatedly reread entire modules or rebuild source through broad
  PowerShell/string replacement.
- Stop and report when a bounded change requires a broad rewrite.

Validation order:

1. Focused new contract.
2. Changed-file syntax.
3. Adjacent regression contracts.
4. Complete Node inventory.
5. Complete Python suite.
6. `git diff --check`.
7. Scope and staged-diff review.

Once full suites are green, do not rerun them unless source or test code
changes again. Before editing, always check Git cleanliness, local/remote
equality, ancestry, and the live version. Trust an unchanged green baseline.

Live validation uses small independent fresh-page scenarios with monitoring
attached before navigation, at most two harness retries per scenario, and no
mutating production actions. Fix a harness-only failure locally; if it remains
blocked after two retries, report it. Do not change production source because
of an unproven browser observation.

After commit, the boundary is: push, deploy only when runtime files changed,
restart only when startup metadata must refresh, verify version and hashes,
run bounded live scenarios, verify final Git status, and report. No post-commit
architecture discovery or speculative cleanup. Corrections require a new
normal commit.
