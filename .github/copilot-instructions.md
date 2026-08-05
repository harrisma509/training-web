# GitHub Copilot Instructions for training-web

## Project

This repo contains the FastAPI web app and browser dashboard for the Training Dashboard.

The separate `training-etl` repo owns Strava ingestion, ETL builders, database writes, schema SQL, weekly audit computation, and future service-log import work.

## Repo boundary

This repo owns:

- FastAPI app setup
- API routes
- Static frontend JavaScript and CSS
- Health ingestion API
- Sync UI/status
- NAS web deployment
- Dashboard presentation

Do not modify `training-etl` files from this repo unless explicitly requested.

Do not change database schema from this repo unless explicitly requested.

## Runtime

- The app runs in Docker on the home NAS.
- Live app: `http://192.168.1.188:8088`
- Local `.venv` may not have runtime dependencies.
- Local `py_compile` is syntax-only.
- Real validation must happen against the NAS runtime.

## Deployment

Deploy with:

```bash
./deploy_to_nas.sh
```

After deploy, validate live endpoints with `curl`.

Example:

```bash
curl -sS -D - http://192.168.1.188:8088/api/gear/dashboard?limit=5
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

1. Run `python -m py_compile` on touched Python files.
2. Deploy with `./deploy_to_nas.sh`.
3. Test affected live endpoint with `curl`.
4. Confirm HTTP 200.
5. Confirm JSON shape.
6. Confirm no secrets or raw JSON appear.

For frontend changes:

1. Deploy to NAS.
2. Hard refresh browser with `Cmd+Shift+R`.
3. Confirm changed tab loads.
4. Confirm Daily, Weekly, Zones, Sync still work.
5. Confirm no console errors.
6. Confirm no blank page.
7. Confirm no `null`, `undefined`, or `NaN`.

## Failure rule

If something fails:

- Stop feature work.
- Reproduce the failure.
- Read the exact error.
- Fix the smallest exact cause.
- Remove temporary debug output before final.
- Report files changed and validation commands run.
