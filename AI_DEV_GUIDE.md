## AI Dev Guide

### Current workflow
- Commit before using an agent.
- Use small, independently testable vertical slices.
- Ask the agent to inspect first if app wiring is unclear.
- Require exact validation commands and results.
- Review the diff before committing.
- Use a new agent session for each major phase.
- Stop after one speculative fix. If a live endpoint returns HTTP 500, obtain the exact container exception before editing again.

### Repository boundaries
- `training-web` owns the FastAPI web API, UI, static assets, and NAS web deployment.
- `training-etl` owns database DDL, ordered migrations, historical import scripts, ETL builders, and optional generated schema snapshots.
- Do not modify database schema from `training-web` unless the work is explicitly coordinated with `training-etl`.

### Schema authority and drift
- The live PostgreSQL schema is the deployed runtime truth.
- Versioned DDL and migrations in `training-etl` are the intended, reproducible schema and Git history.
- A read-only live-schema check verifies deployment and detects drift. It does not replace migrations or DDL.
- Treat a manually maintained schema copy as documentation only. Prefer an optional generated snapshot if a full current-schema file is retained.
- If repository DDL and the live schema disagree, stop and report the exact sanitized drift before changing application code.
- Never make schema changes during a read-only audit.

### Database access
- Use the repository's existing `.venv`, database helper, and environment configuration.
- Do not install packages, database clients, drivers, or extensions unless explicitly requested.
- Do not print database URLs, passwords, tokens, connection strings, or environment values.
- For audit sessions, run static or parameterized `SELECT` statements only.
- Use the supplied/versioned DDL as the intended contract and the live database only for verification and data checks.

### Suggested training-etl SQL layout
```text
sql/
├── migrations/
│   └── ordered schema changes
├── imports/
│   └── controlled historical or seed-data loads
└── schema/
    └── optional generated current-schema snapshot
```

### NAS validation
The real runtime is the NAS Docker container, not the local Mac `.venv`.

Useful checks:

```bash
./deploy_to_nas.sh
curl -sS "http://192.168.1.101:8088/api/gear/dashboard?limit=5" | jq .
```

After deploying Python route or app-registration changes, restart the web container when required by the existing deployment process.

If an endpoint returns HTTP 500:
1. Reproduce it once with `curl`.
2. Read the `training-web` container log.
3. Capture the exact exception type, message, Python line, and failing SQL expression or result key.
4. Make the smallest evidence-based correction.
5. Redeploy and rerun the focused endpoint checks.

Do not continue guessing at SQL or response-contract failures without the runtime exception.

### Agent completion report
Require the agent to report:
- Files changed
- Database tables and columns used
- Validation commands actually run
- Live endpoint status and key row counts
- Browser checks actually performed
- Console or container errors
- Any validation not performed
- Remaining limitations or risks

Do not accept claims for tests that were not actually performed.
## Local PostgreSQL Access

The application runs in Docker and uses:

DB_HOST=training-postgres

This hostname is Docker-network-only and will not resolve from macOS.

When running audit scripts directly from the local workstation
(rather than from inside the training-web container), use the
externally reachable PostgreSQL endpoint:

Host: 192.168.1.101
Port: 15432

Do not modify application configuration files to accommodate local audits.

For local audit and validation work:
- Use the existing database credentials.
- Use the external PostgreSQL endpoint.
- Do not print credentials in reports.
- Do not modify environment files.
## Python Validation Commands

Do not assume `python` exists.

This workstation may only expose `python3`.

Before running validation commands:

```bash
which python
which python3
## NAS Access Policy

Do not SSH to the NAS for normal implementation,
validation, debugging, or HTTP endpoint testing.

Do not execute:

- ssh
- scp
- rsync
- docker exec
- docker logs
- docker ps

against the NAS unless explicitly requested by the user.

Preferred debugging order:

1. Static code review
2. Local syntax validation
3. Deployment
4. HTTP response inspection
5. Browser validation

Only if the user explicitly requests NAS-level debugging
may SSH-based investigation be performed.
