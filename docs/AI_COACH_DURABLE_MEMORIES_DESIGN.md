# AI Coach Durable Memories Design

## Status and ownership

This document locks the V1.1 Durable Memories contract. Backend management,
deterministic routing, bounded selection, compilation, and paid-turn prompt
integration are implemented. The standalone DDL is
`training-etl/sql/ai_coach_memories_v1.sql`, and the authoritative definition
is in `training-etl/sql/training_postgress_db_schema.sql`. Mike applies the
standalone script manually through DBeaver. This slice does not implement the
Settings UI, extraction, or provider behavior.

Durable Memories are manually curated atomic facts that the Coach may need
across sessions but cannot reliably obtain from bounded context. Custom
Instructions remain the coaching constitution. Product policy remains
non-editable. Training Intelligence remains authoritative for current and
calculated data. Recent conversation remains bounded conversational context.
Activity descriptions and Strava private notes are a separate future
context-quality feature, not Durable Memories.

## Manual management

Settings > AI Coach will be the authoritative editor. V1.1 supports list,
create, edit, deactivate, and reactivate. There is no application hard-delete
route; SQL is an administrative escape hatch. There is no automatic extraction,
silent write, or conversation “remember this” action.

## Controlled metadata

Memory types are exactly: `medical`, `safety`, `training_goal`, `schedule`,
`event`, `equipment`, `preference`, and `lesson_learned`.

Applicability scopes are exactly: `all_training`, `planning`, `recovery`,
`strength`, `weight`, `mtb`, `emtb`, `bike_park`, `gravel`, and `skiing`.
`all_training` describes broad applicability; it is not blanket normal-memory
eligibility. The database enforces nonempty, non-NULL, approved scope arrays; the backend
rejects duplicate scopes. Priority is exactly `critical`, `high`, or `normal`,
defaulting to `normal`.

## Eligibility and storage contract

A memory is eligible only when `is_active = true`, its `effective_date` is NULL
or effective on the request's product-local date, its `expires_at` is NULL or
later than request generation, and stored content passes defensive application
validation. Expiration does not deactivate a row. `expires_at` is a
`timestamptz`; date-order validation compares it in `America/Denver`.

Titles are limited to 120 characters and memory text to 1,000 characters.
Memory text must be a standalone statement with relational context. No HTML,
compiled prompt text, secrets, SQL, or provider configuration belongs here.
The database does not enforce the 50-active-memory limit because that is a
cross-row rule. Backend creates, updates, and reactivations use a short
transaction-scoped PostgreSQL advisory lock and reject activation when 50
active, non-expired memories already exist. Editing an already-active row
without changing active state remains allowed. Management failures are
sanitized and make no provider call.

## Deterministic routing contract

The router uses the current question, the same bounded recent conversation
selected for provider inference, authoritative Training Intelligence signals,
supporting recent entities, and memory metadata. It must not retrieve
unlimited chat history or use a different history window from the provider
request.

Representative transparent scope matches are:

- `planning`: tomorrow, this week, next week, plan, schedule, what should I do, workout
- `recovery`: recovery, fatigue, sleep, HRV, soreness, illness, injury, pain, stitches, wound, surgery
- `strength`: strength, lifting, weights, arms, legs, core, press, row, prehab
- `bike_park`: bike park, Trestle, Keystone, Whistler, lift, downhill, jump, drop, Pro Line, Rallon
- `emtb`: e-MTB, emtb, Wild, battery, range extender, motor, Bosch
- `gravel`: gravel, Denna, road ride, pavement
- `mtb`: mountain bike, MTB, trail, technical, singletrack, descent, climbing
- `weight`: weight, weigh-in, calories, food, protein, diet, eating
- `skiing`: ski, skiing, powder, bumps, moguls

Generic words such as “park,” “hard,” or “ride” are not sufficient alone for
narrow-scope activation. Strong evidence is the current question, the last two
bounded messages, threshold-qualified older history, and explicit current-week
flags. Recent bike and activity entities are supporting evidence only: they can
improve ranking or corroborate a scope already activated by strong evidence,
but they do not independently make normal memories eligible. Always activate
`all_training`; ordinary memories need another strong scope, except for broad
planning or progress questions where general training memories can qualify.

Strong authoritative examples include `is_injury_week` -> recovery and
`is_bike_park_week` -> bike_park and mtb. Recent Rallon supports bike_park and
mtb, recent Wild supports emtb and mtb, and recent Denna supports gravel. A
recent bike does not by itself determine present intent.

The implementation examines up to 14 entries from the detailed `recent_days`
context for recent entities and activity names. Missing context keys are
unknown. It does not query history separately or scan unlimited context JSON.

## Safety, selection, and limits

Always include eligible `critical` memories and eligible high-priority
`medical` or `safety` memories scoped to `all_training`. If routing fails,
fall back to this bounded safety set plus applicable `all_training` memories;
do not send every active memory.

Rank deterministically by: critical priority; direct current-question scope
match; authoritative-context scope match; last-two-message scope match; high
priority; older bounded-history scope match; date relevance, including upcoming
eligible boundaries; most recently updated; stable `memory_id` tie-breaker.

Each paid request may receive at most 12 memories and 6,000 compiled memory
characters. Stored text remains limited to 1,000 characters. Never truncate a
memory midway. Preserve eligible critical memories first, then high-priority
and strongest scope matches; do not fill unused capacity with unrelated recent
memories.

## Compilation and precedence

The future server-controlled wrapper means:

> These Durable Memories are selected background facts about the athlete. Use
> them only when relevant. Current authoritative Training Intelligence, current
> clinician guidance, direct statements in the current conversation, and newer
> dated facts take precedence. Do not treat expired or inactive memories as
> current and do not use memories to recalculate persisted metrics.

Selected memories are compiled in deterministic ranked order with concise type,
scope, and date context where useful. The model-facing block excludes
`memory_id`, `created_at`, raw database metadata, inactive or expired memories,
and internal ranking scores.

The request order is: stable product Coach policy; Custom Instructions
wrapper and compiled Custom Instructions; Durable Memories wrapper and selected
memories; temporal reference and authoritative Training Intelligence context;
bounded recent conversation; current question.

Conflict precedence is: current direct statement from Mike; current clinician
guidance; current authoritative Training Intelligence; newer active dated
memory; older Durable Memory; model general knowledge. A conflict does not
rewrite a memory automatically; Mike edits or deactivates stale content later.

## Backend contract

The implemented routes are:

- `GET /api/settings/ai-coach/memories` with status and type filters
- `POST /api/settings/ai-coach/memories`
- `PUT /api/settings/ai-coach/memories/{memory_id}`
- `POST /api/settings/ai-coach/memories/{memory_id}/deactivate`
- `POST /api/settings/ai-coach/memories/{memory_id}/reactivate`

There is no DELETE route. Inputs are normalized and validated strictly, stored
rows are defensively validated, SQL is parameterized, and management operations
make no provider call. Durable Memory persistence failures during a paid turn
continue without a memory block; critical-memory selection overflow fails safely
before provider inference.

The selected block is included exactly once in provider instructions and is
therefore counted exactly once by existing cost preflight. It is not persisted
into messages or authoritative context.

## Future UI contract

Settings > AI Coach will contain the Memories editor. It will list active,
future, expired, and deactivated status; provide add/edit forms; type and
priority dropdowns; applicability checkboxes; title and multiline text; date
inputs; active/deactivate/reactivate controls; and character counts. It will
have no hard-delete button and no second editor in Coach Session Info.

No schema seed is included. Mike-specific memories will be added later through
the completed UI or a separately reviewed SQL artifact. The initial seed is
expected to be a small reviewed set of approximately 10-15 high-value training
memories, not a dump of the full Copilot memory collection.

## Explicitly deferred

Automatic extraction, conversation “remember this” tools, silent writes,
embeddings, vector search, Graph-RAG, a secondary intent-classifier model,
background garbage collection, automatic deduplication/merging/conflict
resolution/decay/pruning, hard delete, chat deletion UI, and Strava activity
description/private-note ingestion are all deferred.