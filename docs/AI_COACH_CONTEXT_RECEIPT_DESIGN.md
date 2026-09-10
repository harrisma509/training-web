# AI Coach Context Receipt Design

## Status and ownership

This document locks the Slice A V1.1 Context Receipt contract. Slice A created
reviewed DDL and design documentation; the standalone SQL was applied manually
through DBeaver. Slice B adds application persistence and historical retrieval;
UI and callback implementation remain future work.

`training-etl` owns the authoritative PostgreSQL schema and training context.
`training-web` owns Coach sessions, messages, turn lifecycle, orchestration,
and receipt persistence and historical retrieval.

## Purpose and non-goals

A Context Receipt supports the user-facing **Why this answer?** experience for
a completed Coach response. It records what bounded context influenced the
historical turn at request time, so the UI does not rerun current memory
routing against changed records.

The receipt is a separate optional one-to-one table because this is separation
of responsibility and optional loading, not a material-storage-bloat concern.
Normal turn, session, usage, and cost queries do not need receipt JSON. The
receipt shape can evolve independently through `receipt_version`, and older
turns naturally have no receipt row.

The receipt is not a raw prompt archive, full Training Intelligence snapshot,
copy of full memory text, provider payload log, general debug framework,
tool-call event log, or replacement for turn usage, cost, model, latency, or
token fields.

## Lean 1:1 table contract

Table: `public.ai_coach_turn_context_receipts`

- `coach_turn_id bigint NOT NULL`: both primary key and foreign key to
  `public.coach_turn(coach_turn_id)`, enforcing zero or one receipt per turn.
- `receipt_version smallint NOT NULL DEFAULT 1`: V1 application writes exactly
  version 1 and the database requires a value of at least 1.
- `receipt_json jsonb NOT NULL`: one required JSONB document with a database
  check that its top-level value is an object.
- `created_at timestamptz NOT NULL DEFAULT now()`.

There is deliberately no `updated_at`, trigger, second JSONB column, seed row,
or receipt field on `coach_turn`. The foreign key uses `ON DELETE CASCADE`,
matching the existing `coach_tool_call -> coach_turn` child convention and
because a receipt has no meaning without its turn.

The future model is:

```text
coach_turn
  1 -> 0..1 ai_coach_turn_context_receipts
  1 -> 0..N future ai_coach_turn_context_events
```

The future event table is intentionally not created here.

## Receipt JSON V1 contract

The V1 document has exactly these top-level keys:

```json
{
  "selected_memories": [
    {
      "memory_id": 8,
      "title": "Returning injured has worsened injuries",
      "memory_type": "lesson_learned",
      "priority": "critical",
      "selection_reasons": ["critical_memory"]
    }
  ],
  "active_scopes": ["all_training", "planning", "recovery"],
  "context_coverage": {
    "data_through_date": "2026-09-09",
    "detailed_activity_days": 10,
    "weekly_rows": 12,
    "fitness_fatigue_form_days": 90,
    "recovery_days": 28,
    "current_audit_available": true,
    "completed_audit_available": true,
    "missing_sources": []
  },
  "recent_message_count": 12,
  "custom_instructions_included": true,
  "additional_data_requested": []
}
```

The example is documentation-only; no production receipt is seeded. The
receipt stores memory IDs for internal correlation, but the normal UI will not
display them. It stores selected memory title, type, priority, and controlled
selection reasons, but never full memory text. `additional_data_requested` is
included as an always-empty V1 array so the viewer can explicitly show that no
additional data was requested; it is not a future callback-event container.

`context_coverage` is a compact allowlist, not a copied `context.coverage`
object or full authoritative context. `custom_instructions_included` is only a
boolean. No character counts are stored.

## Controlled selection reasons

Future application code may use only these provider-neutral reason values:

- `critical_memory`
- `high_all_training_medical`
- `high_all_training_safety`
- `current_question_match`
- `authoritative_context_match`
- `recent_conversation_match`
- `older_bounded_history_match`
- `all_training_match`

Each selected memory must have at least one reason. Numeric relevance scores
are not stored.

## Receipt limits and excluded data

Future application validation must enforce:

- receipt version exactly 1
- exactly the approved V1 top-level keys
- no more than 12 selected memories
- approved memory type, priority, and selection-reason values
- unique approved active scopes
- `recent_message_count` as an integer from 0 through the verified history
  message limit
- only approved bounded context-coverage keys and JSON-safe values
- maximum serialized receipt size of 16,000 characters

The database intentionally enforces only essential structural checks and does
not duplicate the evolving JSON contract with complex JSONPath or serialized
length checks.

The receipt excludes full memory text, full Custom Instructions, section or
character telemetry, recent-history character counts, provider-instruction
characters, authoritative-context characters, prompts, raw provider payloads,
SQL, authentication data, routing scores, inactive or unselected memory
snapshots, provider usage/cost/latency fields, and future callback results.

## Immutability and old-turn behavior

A receipt is inserted at most once for a Coach turn. There is no normal update
or delete route. Slice B must use an insert conflict behavior that never
silently replaces an existing receipt. No receipt is backfilled for old turns;
turns created before this feature simply have no receipt row.

Slice B must determine exact insertion timing from the real lifecycle. The
current lifecycle creates a started turn before context assembly and provider
execution, then completes the turn in a transaction with the assistant message
and usage metadata. The receipt must not claim provider use if a request never
reached the provider. Slice B must distinguish assembled context from
provider-submitted context as needed before choosing its insertion boundary.

## Slice B: persistence and retrieval

Slice B builds the receipt from the actual selected memories and routing
evidence, preserve human-readable deterministic reasons, capture compact
allowlisted coverage from the actual Training Intelligence payload, record the
actual bounded recent-message count, and record whether compiled Custom
Instructions were nonblank.

It validates the exact V1 document and 16,000-character limit, then admits the
turn to `provider_capacity()`, persists the receipt with one immutable INSERT
and commit, and only then calls `provider.complete()`. A capacity rejection or
receipt failure therefore cannot leave a receipt for a provider call that did
not begin. The retrieval route never reruns routing, calls a provider, or
exposes raw JSON as the normal UI contract.

When Durable Memory storage is unavailable, no memories are selected and no
memory block is added to provider instructions. Routing evidence is still
derived from the question, exact bounded history, and authoritative context so
the receipt preserves truthful active topic scopes. Receipt failures use the
internal categories `context_receipt_invalid`, `context_receipt_conflict`, and
`context_receipt_unavailable`; client-facing details remain sanitized.

## Planned Slice C: Settings and per-response UI

Slice C will add the server-backed Durable Memories Settings surface and a
read-only per-response Context viewer. Each completed response will have a
click/tap Context control, optionally showing the selected-memory count. The
Why this answer panel will show selected memory titles, types, priorities,
dates when useful, friendly reasons, active scopes, compact Training
Intelligence coverage, bounded recent-message count, Custom Instructions
included, and **Additional data requested: None**.

The UI will not expose memory IDs, raw JSON, full prompts, full memory text by
default, routing scores, SQL, or internal endpoint details. Settings will
remain server-backed with no hard-delete control.

## Future Training Intelligence callback compatibility

A future separate child table may tentatively be named
`public.ai_coach_turn_context_events`. It would have 1:N cardinality from a
Coach turn and represent additional Training Intelligence requested during a
turn, with bounded validated request/result summaries and status metadata.

That future event table is not finalized or created in Slice A. Callback event
arrays will not be embedded in `receipt_json`, and the receipt will not be
mutated after successful persistence except through an explicit future
migration or repair process.
