## Training Web

FastAPI + static frontend dashboard for the Training Dashboard system.

### What this application does
This repo provides the browser-based dashboard and API layer for a personal training intelligence platform. It is the presentation and operational surface for a larger data pipeline that ingests training data, processes it into summaries, and exposes it in a usable dashboard.

In practical terms, this app shows:
- daily training summaries
- weekly performance and audit views
- zone distribution analysis
- yearly trends and annual review data
- gear usage and maintenance status
- component lifecycle tracking
- sync health and system status
- user preferences and dashboard settings

The app is not the source of truth for raw data collection or schema design. It consumes the processed data created by the ETL pipeline and renders the user-facing dashboard.

### System overview
The overall system has two main layers:

1. ETL layer (`training-etl`)
   - fetches Strava and related source data
   - builds daily/weekly/yearly summaries
   - computes training zones and audits
   - writes normalized data to the database
   - handles sync and operational processing

2. Web layer (`training-web`)
   - reads the processed data from the database
   - provides the dashboard UI and API routes
   - exposes system status, syncing, and settings flows
   - delivers the front-end experience for training data inspection

### Repo boundary
- This repo owns the web API, UI, static assets, dashboard behavior, and NAS web deployment.
- Database schema, migrations, historical imports, ETL builders, and data-processing logic live in the separate `training-etl` repo.
- Do not create or change database schema from this repo unless explicitly coordinated with `training-etl`.
- The live PostgreSQL schema is the deployed runtime state.
- Versioned DDL and migrations in `training-etl` are the reproducible intended schema and source-control history.
- Read-only live-schema checks may verify deployment and detect drift, but they do not replace versioned DDL or migrations.
- If repository DDL and the live schema disagree, stop and report the drift before changing application code.

### Product intent
This is effectively a training analytics and maintenance dashboard: it blends workout performance tracking with gear/component lifecycle awareness and operational health checks, giving a single place to review training quality, maintenance needs, and live system state.
