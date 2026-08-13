## Training Web

FastAPI + static frontend dashboard for Training Dashboard.

### Repo boundary
- This repo owns the web API, UI, static assets, and NAS web deployment.
- Database schema, migrations, historical imports, and ETL builders live in the separate `training-etl` repo.
- Do not create or change database schema from this repo unless explicitly coordinated with `training-etl`.
- The live PostgreSQL schema is the deployed runtime state.
- Versioned DDL and migrations in `training-etl` are the reproducible intended schema and source-control history.
- Read-only live-schema checks may verify deployment and detect drift, but they do not replace versioned DDL or migrations.
- If repository DDL and the live schema disagree, stop and report the drift before changing application code.
