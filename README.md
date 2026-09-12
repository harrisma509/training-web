# Training Web

FastAPI application and browser dashboard for the Training Web Application

## Purpose
This repo provides the web-facing presentation layer for a personal training system. It does not own the ingestion pipeline or the canonical database schema. Instead, it consumes processed data from the shared PostgreSQL database and presents it through API routes and a static frontend UI.

This app is responsible for:
- training dashboards and daily/weekly/yearly views
- gear and component status presentation
- sync status and operational health views
- user settings and app preferences
- web deployment for the local NAS runtime

## System architecture

### 1) ETL layer: training-etl
The separate `training-etl` repo owns:
- Strava ingestion and sync jobs
- data builders and summary generation
- zone, weekly audit, and yearly computations
- database writes and normalization
- schema and historical import logic
- operational scripts and backup/sync coordination

### 2) Web layer: training-web
This repo owns:
- FastAPI app setup and route registration
- API endpoints for dashboard data
- frontend static assets and browser UI
- status and sync presentation
- NAS deployment packaging

The web app should be treated as the read/query and presentation layer, not as the source of truth for ETL logic or schema evolution.

## Repository boundary
- `training-etl` owns data collection, schema intent, ETL builders, database writes, and operational ETL scripts.
- `training-web` owns the app layer, dashboard UI, and API surface for consuming already-processed data.
- Do not modify database schema from this repo unless explicitly requested and coordinated.
- Do not add ETL logic, transform logic, or warehouse/data-model work here unless the task explicitly requires it.
- If a request touches data collection, schema, builder logic, or audit rules, stop and route the work to the ETL repo.

## Production runtime
The real runtime is the HarrisServer Docker deployment, not the local macOS environment.

Typical model:
- PostgreSQL is the shared runtime database
- the web app runs as a Dockerized FastAPI service on HarrisServer
- ETL runs separately and writes to the same database
- the dashboard reads from the database and exposes the processed state

This matters because local syntax checks are useful, but they do not validate the true production environment.

## Deployment and validation
Use the repository's deployment flow for runtime validation:

```bash
./deploy_to_server.sh
```

Then validate the live app with a focused HTTP request, for example:

```bash
curl -sS -D - http://harrisserver:8088/api/gear/dashboard?limit=5
```

Important rules:
- prefer targeted endpoint validation over broad testing
- confirm HTTP status and JSON shape
- validate the impacted route, not just the app boot
- do not assume local Python execution is equivalent to the NAS runtime

## Security and operational safety
- Never commit or expose `.env`, credentials, tokens, or raw API payloads
- Never log secrets, database URLs, access tokens, refresh tokens, or password-like values
- Do not print raw request payloads, headers, or stack traces into normal app logs
- Keep logging operational and minimal; prefer structured, non-sensitive messages

## Coding expectations for future agent work
- Keep changes scoped and commit-friendly
- Prefer read-only investigation before editing
- Reuse the existing route and DB helper patterns
- Preserve current API contracts unless a task explicitly asks for a contract change
- Keep frontend behavior consistent with the dark dashboard theme and compact layout
- Do not make schema or ETL changes here without explicit approval

## What to avoid in this repo
- do not change the ETL pipeline, builder scripts, or schema SQL from here
- do not modify weekly audit logic, load rules, or sync behavior unless explicitly requested
- do not add service tables or heavy data-model work here
- do not rewrite broad route wiring or frontend architecture without specific need
- do not add noisy or duplicate logging that competes with uvicorn/container logs

## Local development guidance
This repo is a web app, but it depends on a live database and deployment environment.

Use local validation for:
- Python syntax checks
- focused file-level review
- route-level logic sanity

Use live validation for:
- endpoint behavior
- API contract checks
- runtime dependency checks
- deployment correctness

## Testing
Run the automated unit tests from the repository root with the repository-local virtual environment:

```bash
python3 -m pip install -r requirements-dev.txt
python3 -m pytest --collect-only -q
python3 -m pytest -q
```

For a focused run:

```bash
python3 -m pytest tests/test_coach_orchestration.py -q
python3 -m pytest -k budget -q
```

Existing `unittest.TestCase` tests run through pytest. The default suite uses fakes, mocks, and synthetic data; it must not contact OpenAI or other paid providers, Strava, production training-api, production PostgreSQL, Docker, SSH, or deployment operations. Automated unit tests are separate from manual runtime, provider, and deployment smoke tests.

On Windows, activate the repository virtual environment first and use `python -m pytest -q` when `python3` is unavailable.

## One-sentence rule for future sessions
This repo is the presentation and operational interface for training data; it reads shared database state and renders it, while the ETL repo owns the actual data pipeline and schema evolution.
