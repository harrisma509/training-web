# AI Coach Personalization Contract

This focused contract defines Custom Instructions and Durable Memories. Shared
authority, request order, safety policy, provider behavior, and general Coach
limits are owned by [AI_COACH.md](AI_COACH.md). This document does not redefine
those shared rules.

`training-etl` owns the authoritative schema artifacts. `training-web` owns
personalization loading, validation, compilation, routing, and the Settings
editor. The Custom Instructions DDL is
`training-etl/sql/ai_coach_custom_instructions_v1.sql`; Durable Memories are
defined by `training-etl/sql/ai_coach_memories_v1.sql` and the authoritative
`training-etl/sql/training_postgress_db_schema.sql`.

## Custom Instructions

Custom Instructions are a manually maintained seven-section profile in the
`public.ai_coach_custom_instructions` singleton. The sections are coaching
priorities, safety and progression rules, training approach, recovery and
adjustment rules, communication style, planning preferences, and other
instructions. The seeded profile is blank; personal content is not embedded in
schema or code.

Each normalized field is limited to 1,500 characters and the complete profile
to 8,000 characters. The backend converts CRLF and CR to LF, trims surrounding
whitespace, preserves internal Markdown and blank lines, and rejects
non-string values and unknown or missing fields. Blank fields are valid.

The Settings > AI Coach editor is server-backed and provides load, edit, save,
cancel, and retry behavior. The complete profile is managed through
`GET /api/settings/ai-coach/custom-instructions` and
`PUT /api/settings/ai-coach/custom-instructions`. Management makes no provider
call and the profile is never stored in browser `localStorage`. A successful
save affects the next paid turn without a service restart.

Nonblank fields compile deterministically in the seven-section order above.
The server-controlled wrapper prevents the profile from overriding product
safety policy, clinician guidance, authoritative Training Intelligence,
privacy controls, or missing-data semantics. A blank profile adds no
instructions. The compiled profile is included once in provider instructions
and once in preflight input accounting. Missing, malformed, oversized, or
unavailable persisted instructions fail closed before provider inference.

Custom Instructions describe stable preferences. They are not a place for
current calculated values, temporary injuries, dated events, or provider
memory. Current facts remain with Training Intelligence or Durable Memories
according to their lifecycle.

## Durable Memories

Durable Memories are manually curated atomic facts that may remain useful
across sessions but cannot reliably be obtained from bounded context. Product
policy is non-editable; Custom Instructions define stable coaching preferences;
Training Intelligence remains authoritative for current and calculated facts;
recent conversation remains conversational context. Activity narratives are
not Durable Memories and are never routed into memory storage.

### Management and stored fields

The Settings > AI Coach editor supports list, create, edit, deactivate, and
reactivate. There is no application hard-delete route, automatic extraction,
silent write, or conversation “remember this” action. Management operations use
parameterized SQL, short transactions, and make no provider call.

Approved types are `medical`, `safety`, `training_goal`, `schedule`, `event`,
`equipment`, `preference`, and `lesson_learned`. Approved scopes are
`all_training`, `planning`, `recovery`, `strength`, `weight`, `mtb`, `emtb`,
`bike_park`, `gravel`, and `skiing`. Priority is `critical`, `high`, or
`normal` (the default). `all_training` indicates broad applicability; by
itself it does not make ordinary memories eligible.

Titles are limited to 120 characters and memory text to 1,000 characters.
Memory text must be a standalone statement with relational context. Secrets,
SQL, provider configuration, compiled prompt text, and HTML do not belong in a
memory. Effective dates use the product-local date; expiration is compared to
request generation, with date-order validation in `America/Denver`. Expired
rows are not automatically deactivated. The backend rejects activation when
50 active, non-expired memories already exist; editing an already-active row
without changing active state remains allowed.

### Eligibility and routing

A memory is eligible only when active, effective on the request's product-local
date (or undated), unexpired at request generation (or without an expiry), and
valid under defensive application checks.

Routing uses the current question, user-authored messages from the same bounded
history sent to the provider, authoritative Training Intelligence signals,
supporting recent entities, and memory metadata. Assistant, system, tool, and
unknown-role messages remain available to the provider as applicable but do
not contribute memory-routing evidence. The router does not fetch additional
chat history or scan unlimited context.

The current question is primary. Explicit current topics suppress unrelated
ordinary historical topics; ambiguous follow-ups may use the latest
user-established topic. Strong evidence from the question is considered before
recent user-authored history, then threshold-qualified older user history when
recent user context cannot resolve ambiguity, along with explicit current-week
flags. Recent bike or activity entities are supporting evidence only; they
cannot alone activate normal memories. Generic words such as “park,” “hard,”
“ride,” or “bike” do not independently activate narrow scopes or match a
memory title. Memory text itself is not scanned for relevance.

Always activate the `all_training` routing scope, but do not treat it as a
blanket ordinary-memory match. A clear broad planning or progress question may
admit directly relevant general training memories. Ordinary memory eligibility
requires deterministic direct relevance from the current question or eligible
user-authored history. Always include eligible critical memories and eligible
high-priority `medical` or `safety` memories scoped to `all_training`. If
routing fails, fail closed to this bounded safety set rather than sending every
active memory.

Selection ranks critical priority, direct current-question scope, authoritative
context, the most recent two user-authored messages, high priority, older
bounded-history scope, date relevance, update time, and stable `memory_id` in
that order. Each paid request may include at most 12 memories and 6,000 compiled
memory characters. Never truncate a memory midway or fill unused capacity with
unrelated recent memories; these values are ceilings, not targets.

The implementation uses normalized title tokens, phrase boundaries, and a
small reviewed alias list. Strong authoritative examples include an injury
week mapping to recovery and a bike-park week mapping to bike-park and MTB.
Missing context keys are unknown. The router examines up to 14 entries from
the detailed `recent_days` context for supporting entities and activity names;
it does not query history separately.

### Compilation, precedence, and failures

Selected memories are compiled in deterministic ranked order with concise
type, scope, and date context where useful. The model-facing block excludes
`memory_id`, creation time, raw database metadata, inactive or expired rows,
and internal ranking scores. The global request assembly order is defined only
in [AI_COACH.md](AI_COACH.md); Durable Memories follow Custom Instructions and
the selected mode strategy there.

The server wrapper says to use memories only when relevant and not to let them
override current authoritative Training Intelligence, clinician guidance,
direct statements in the current conversation, or newer dated facts. A
conflict does not rewrite a memory; the user edits or deactivates stale content.

If Durable Memory storage is unavailable during a paid turn, the turn continues
without memory context while truthful routing scopes may still be recorded in
the Context Receipt. Critical-memory selection overflow fails safely before
provider inference. Management errors are sanitized. Memory text and routing
scores are not persisted into Coach messages or authoritative context.
