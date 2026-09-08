# AI Coach Settings Persistence Design

## Status

DDL design and backend persistence are complete for this slice. The SQL has
not been executed by this implementation, and Mike must still review and apply
the standalone DDL manually through DBeaver. The browser Settings tab is now
implemented; runtime deployment validation remains pending.

## Ownership and table strategy

- `training-web` owns the Settings route, Settings UI, and Coach settings loading/enforcement.
- `training-etl/sql/training_postgress_db_schema.sql` is the authoritative monolithic schema artifact.
- `public.ai_coach_settings` is a dedicated typed singleton table; it does not widen `app_settings` or introduce generic key/value storage.
- `settings_id = 1` is enforced by a primary key plus singleton check constraint.

## Column contract

| Column | Type | Default | Purpose |
|---|---|---:|---|
| `settings_id` | `smallint` | required | Singleton identifier, always `1`. |
| `monthly_cost_limit_usd` | `numeric(10,2)` | `5.00` | Monthly application-recorded cost ceiling. |
| `max_turn_cost_usd` | `numeric(10,2)` | `0.25` | Maximum estimated cost for one Coach turn. |
| `max_output_tokens` | `integer` | `1200` | Maximum normal Coach response output. |
| `reasoning_effort` | `text` | `low` | Supported values: `none`, `low`, `medium`, `high`. |
| `updated_at` | `timestamptz` | `now()` | Last settings update timestamp. |

The database bounds are conservative validity bounds, not application hard ceilings: monthly cost is `0.00..100.00`, turn cost is `0.01..5.00`, and output tokens are `1..10000`. Monthly and per-turn limits are independent; `max_turn_cost_usd` may exceed the monthly limit.

## Backend contract

`training-web/routes/coach_settings.py` provides `GET /api/settings/ai-coach`
and `PUT /api/settings/ai-coach`. The route reads and updates only the
`settings_id = 1` row, validates incoming editable values against the server
hard ceilings, sets `updated_at = now()`, and returns sanitized typed values.
Money values are serialized as strings to preserve exact decimal values.
Secrets and deployment configuration remain environment-only.

The backend fails closed if the table is unavailable, missing, or malformed.
Paid turns return a sanitized 503 and reconcile the started turn as
`settings_unavailable`; they do not fall back to constants or call the
provider. Server hard ceilings remain stricter than the database validity
bounds.

Budget enforcement also distinguishes an intentionally disabled `$0.00`
monthly limit, a reached monthly limit, and a per-turn estimate above its
configured cap. These rejected requests return sanitized actionable messages,
reconcile the failed turn, and do not call the provider. Accounting and
unknown-pricing failures remain `budget_unavailable`.

## Settings tab integration

The existing Settings shell now provides an `AI Coach` tab with:

- `index.html` for the AI Coach tab and four editable controls.
- `static/settings.js` for load, edit, save, cancel, retry, validation, and status handling.
- `static/settings.css` for the existing settings visual language and responsive layout.
- `static/api.js` for the dedicated GET/PUT settings methods.

The browser keeps only a module-local loaded baseline and draft while the drawer
is open. It does not write authoritative Coach settings to localStorage. Do not
put secrets, provider credentials, or deployment values in browser state or
database settings.

## Orchestration integration

`coach_orchestrator.py` loads validated settings before paid-turn enforcement
and passes the effective values into:

- `coach_cost.py` for monthly and per-turn cost checks.
- `AIRequest.max_output_tokens` for output limits.
- `validate_reasoning_effort()` and the provider request for reasoning effort.

The existing provider timeout, concurrency limit, provider/model configuration, pricing lookup, persistence, and transaction boundaries remain separate controls.

## Required manual gate

1. Review `training-etl/sql/ai_coach_settings_v1.sql`.
2. Apply it manually through DBeaver.
3. Run the included read-only verification queries and confirm one row with the expected defaults.
4. Implement and test backend persistence and orchestration loading/enforcement.
5. Perform API, browser, and runtime validation.
6. Update `docs/AI_COACH.md` after verified behavior changes.
