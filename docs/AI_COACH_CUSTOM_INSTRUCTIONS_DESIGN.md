# AI Coach Custom Instructions Design

## Status and ownership

This document locks the V1.1 Custom Instructions contract. The standalone DDL
is `training-etl/sql/ai_coach_custom_instructions_v1.sql`; Mike reviewed and
executed it manually through DBeaver. Backend persistence, paid-turn prompt
assembly, and the seven-textarea Settings UI are implemented.

`training-etl` owns the authoritative schema definition. `training-web` owns
backend loading, validation, compilation, and the future Settings editor.
Custom Instructions are not Durable Memories, product policy, or a replacement
for authoritative Training Intelligence context.

## Seven-section profile

The singleton is `public.ai_coach_custom_instructions`, identified by
`instructions_id = 1`. All seven text fields are `NOT NULL DEFAULT ''`:

1. `coaching_priorities`: stable priorities when goals conflict, including safety, consistency, availability, enjoyment, strength, and sustainable performance.
2. `safety_progression_rules`: stable thresholds and overrides, including ramp review above 15%, poor-sleep protection, travel recovery, and injury or clinician overrides.
3. `training_approach`: durable training model and preferences, including volume, strength, intentional Z2-Z3 riding, technical demands, and avoidance of generic ride-more advice.
4. `recovery_adjustment_rules`: stable adjustments for poor sleep, soreness, illness, travel, missing subjective context, weight changes, and reduced training.
5. `communication_style`: response tone and format, including concise summaries, actionable bullets, direct language, meaningful Risk sections, explicit dates, and concise-format requests.
6. `planning_preferences`: practical planning preferences, including time estimates, preserving strength, life stress, modified alternatives, fueling cues, enjoyment, and sustainable progression.
7. `other_instructions`: an optional bounded escape hatch, not a memory dump, weekly plan, temporary injury note, or unlimited second prompt.

The seed contains seven empty strings. Mike-specific content is intentionally
not embedded in schema.

## Size and normalization contract

The database enforces `char_length` of at most 1,500 for each section and at
most 8,000 characters across exactly the seven fields. Blank sections are
allowed. PostgreSQL owns structural storage bounds only; HTML, Markdown,
prompt-safety, and line-ending policy belong to the future application layer.

The backend converts CRLF and CR to LF, trims surrounding whitespace, preserves
internal Markdown and blank lines, rejects non-string values and unknown fields,
and validates after normalization. It does not silently delete content. The
database uses `smallint` for the singleton ID, a primary key,
`CHECK (instructions_id = 1)`, and `updated_at timestamptz DEFAULT now() NOT NULL`.
Updates set `updated_at = now()` explicitly. No triggers, versioning, or
optimistic concurrency are part of this contract.

## Editor and API contract

Settings > AI Coach is the authoritative editor. It uses seven labeled
textareas, per-section character counts, one combined count, Save, Cancel, and
Retry actions, and a server-backed draft domain. There is no second Custom
Instructions editor in Coach Session Info.

Implemented backend routes:

- `training-web/routes/coach_custom_instructions.py`
- `GET /api/settings/ai-coach/custom-instructions`
- `PUT /api/settings/ai-coach/custom-instructions`

The PUT accepts one complete profile, uses a parameterized singleton update,
returns sanitized values and `updated_at`, rejects unknown or missing fields,
normalizes before validation, and fails closed for malformed or unavailable
stored instructions on paid turns. Loading and saving make no provider call. A
successful save affects the next paid Coach turn without a service restart.

The UI keeps the last successful profile as its clean baseline, normalizes
drafts before counting and saving, prevents duplicate loads and saves, keeps a
failed-save draft, and never stores the profile in localStorage. The returned
`updated_at` is shown as local readable metadata. Backend persistence accepts
only database date/datetime objects; arbitrary stored timestamp strings fail
closed.

## Deterministic prompt compilation

The backend compiles nonblank sections in this fixed order with stable labels:

1. Coaching priorities
2. Safety and progression rules
3. Training approach
4. Recovery adjustment rules
5. Communication style
6. Planning preferences
7. Other instructions

The request assembly order is:

1. Stable non-editable product Coach policy
2. Server-controlled wrapper stating that Custom Instructions cannot override safety, clinician guidance, authoritative data, privacy, or missing-data semantics
3. Compiled Custom Instructions
4. Relevant Durable Memories after that feature exists
5. Fresh authoritative Training Intelligence context
6. Bounded recent conversation
7. Current user question

Provider calls are stateless and use `store=False`, so compiled Custom
Instructions must be sent on every real paid Coach turn. They are not sent by
Settings management operations.

## Existing guard compatibility

The existing 120,000-character guard applies only to authoritative Training
API context and remains unchanged. The existing 24-message / 24,000-character
guard applies only to recent conversation and remains unchanged. The existing
output-token setting remains unrelated to Custom Instructions input size.

The combined 8,000-character Custom Instructions bound fits the current
architecture. Per-turn preflight accounting includes the final provider
instructions string, including the compiled Custom Instructions, exactly once.
No existing limit was raised and no new assembled-input ceiling was added.

## Authority boundaries

Custom Instructions may define stable preferences and interpretation rules,
but must not:

- Recalculate Weekly Audit, Load, TID, Fitness, Fatigue, Form, or recovery scoring.
- Store current weekly calculated values.
- Store temporary injuries or clinician restrictions that belong in current narrative or Durable Memories.
- Store dated travel, surgery, or events that belong in Durable Memories.
- Override product safety policy, clinician guidance, or authoritative Training Intelligence facts.
- Introduce provider-owned memory.

## Initial content and validation status

The initial database row remains blank. Initial coaching content will be added
later through the implemented Settings UI or a separately reviewed seed/update
artifact.

Focused backend and Node tests cover the route contract, normalization, limits,
compilation, prompt hierarchy, preflight accounting, UI API wrappers, client
validation, and fail-closed reconciliation. Browser, deployed API, runtime,
migration, and real-provider validation were not performed in this slice.
