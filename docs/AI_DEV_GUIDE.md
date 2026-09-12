# AI Dev Guide

## Mission
This repo is the web dashboard and API layer for the Training Dashboard. It consumes already-processed data from the shared PostgreSQL database and presents it to the browser. The ETL repo owns data collection, schema evolution, and data-building logic.

Future agent work should respect that boundary and keep the web repo focused on presentation, API behavior, and deployment.

## Repo boundary
- `training-web` owns FastAPI app setup, route registration, frontend assets, app presentation, and NAS deployment.
- `training-etl` owns Strava ingestion, ETL builders, database writes, summary calculations, schema SQL, and operational ETL scripts.
- Do not modify database schema from this repo unless there is a clear, explicit coordination request.
- Do not move ETL logic into this repo unless the task specifically asks for it.

## Architectural rule
Treat this repo as the read/query + presentation layer.

The web app should:
- read processed state from Postgres
- expose stable API routes
- render dashboard data cleanly
- show operational status and settings

This repo should not:
- own the source-of-truth schema
- implement raw ingestion logic
- rewrite weekly or daily training math
- silently change database semantics

## Safe default workflow
1. Inspect the relevant route, frontend module, and database access pattern.
2. Keep the scope small and vertical.
3. Prefer read-only inspection before file edits.
4. Preserve the current route contract.
5. Validate the changed behavior with the smallest real runtime check.
6. Report exactly what was validated and what was not.

## Secrets and logging policy
- Never log secrets, bearer tokens, access tokens, refresh tokens, env values, or raw database credentials.
- Never log request headers, raw payloads, or full JSON response bodies unless the user explicitly asks for diagnostic debugging.
- Keep logs minimal, stdout-friendly, and operationally useful.
- Do not add duplicate noisy logging on top of the existing uvicorn/container logs.

## Database policy
- The live PostgreSQL schema is the deployed runtime truth.
- `training-etl` is the canonical repo for DDL, data processing, and schema-affecting work.
- If a request appears to require schema change, stop and confirm the intended source-of-truth repo before editing.
- Read-only DB checks are acceptable for investigation and validation.
- Do not rely on local schema assumptions when the live deployment is the real system.

## Deployment policy
The HarrisServer Docker deployment is the real runtime. Local checks are useful, but they are not enough.

Typical flow:

```bash
./deploy_to_server.sh
curl -sS -D - http://192.168.1.100:8088/api/gear/dashboard?limit=5
```

When a route or app-registration change is made, validate the live endpoint after deployment.

## Error-handling policy
If an endpoint returns HTTP 500:
1. Reproduce it once with a focused request.
2. Read the exact exception from the container/runtime output.
3. Identify the precise failing SQL, route logic, or response contract.
4. Fix the root cause with the smallest change.
5. Redeploy and rerun the same request.

Do not guess. Do not broaden the patch while debugging a failing request.

## Python validation
Use the available interpreter on this machine. Prefer `python3` if `python` is not present.

```bash
which python
which python3
python3 -m py_compile app.py routes/*.py
```

Local syntax checks are required for Python changes, but they are not a substitute for deployment and live endpoint checks.

## Frontend expectations
- Preserve the current dark theme and compact dashboard styling
- keep tables and cards consistent with existing layout patterns
- do not add charts or major UX rewrites unless explicitly requested
- do not introduce `null`, `undefined`, or `NaN` values into the UI display layer
- avoid broad refactors unrelated to the target bug or feature

## What to report at the end of a task
Every task should include:
- files changed
- routes or modules touched
- whether a schema change was required
- validation commands actually run
- live endpoint status or runtime evidence
- browser or UI checks performed
- unresolved risks or limitations

Do not claim validation that was not actually performed.

## NAS access rule
Do not perform normal implementation, validation, or debugging via SSH unless the user explicitly requests it.

Preferred sequence:
1. local code review
2. local syntax validation
3. deploy to NAS runtime
4. targeted live endpoint check
5. browser validation if required

## Working principle for future sessions
Keep this repo focused on the user-facing app and data presentation layer. The ETL repo owns the deeper processing and schema reality; the web repo should remain a stable, narrow, operational interface on top of that system.
