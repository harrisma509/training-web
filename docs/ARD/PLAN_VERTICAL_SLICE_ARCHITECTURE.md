# Plan Vertical Slice Architecture

## Status

Accepted.

## Scope

This decision applies to complex Plan features implemented in `training-web`
against Plan-owned PostgreSQL tables.

It governs features that cross browser UI, HTTP routes, Plan services, and
database contracts. It is not a generic architecture mandate for every
application feature.

The persistence-specific boundary is defined separately in
`docs/ARD/PLAN_PERSISTENCE_SERVICE_BOUNDARY.md`. That ADR owns SQL,
transactions, locking, persistence domain errors, and database boundaries.
This ADR owns the cooperation of those layers from user intent through the
authoritative saved response.

## Context

Plan features include template management, planned-item placement, item
lifecycle operations, calendar overlays, durable drafts, and batch workflows.
These features can drift when browser state, HTTP contracts, transactions, and
database authority are designed independently.

A vertical slice must therefore establish ownership and recovery behavior
before implementation begins. Each slice should deliver one bounded,
testable product capability without combining unrelated schema, service, UI,
and production-data changes.

## Decision

Use this end-to-end flow as the authoritative Plan feature pattern:

```text
User interaction
  -> browser validates and submits intent
  -> HTTP route validates the API contract and security boundary
  -> Plan service performs one atomic business operation when required
  -> PostgreSQL enforces final integrity
  -> API returns the authoritative saved representation
  -> browser replaces local assumptions with the server response
```

The browser must not recreate server-side cloning, generated IDs, ownership
fields, lifecycle timestamps, normalization, or transaction outcomes.

## Browser UI responsibilities

The browser UI owns:

- Rendering and interaction.
- Flyout, modal, and form lifecycle.
- Loading, empty, saving, success, and error states.
- Transient form state.
- Immediate validation for user feedback.
- Selected date, template, item, and category state.
- Calendar range and navigation state.
- Request cancellation or generation guards.
- Stale-response rejection.
- Separate rendering of planned and actual records.
- Replacement of local entity state with the authoritative API response.

The browser UI must not own:

- Generated database IDs.
- Prescription clone semantics.
- `owner_kind` values.
- Lifecycle timestamps or transitions.
- SQL-shaped assumptions.
- Multi-table atomicity.
- Durable batch state unless written through a defined API.
- Authoritative planned-load calculations.
- Actual training calculations.

Each major Plan surface must have one clear UI owner. Shared components may be
used by multiple surfaces, but they must have one implementation and one
persistence contract:

- The template flyout owns template library and template editing.
- The calendar owns date/range display and item-placement interaction.
- Settings may link to shared management components but must not fork them.

Plan view preferences are presentation state, not Plan-item lifecycle state.
The Plan Options controller owns the strict browser preference contract and
the active view setting; the Plan item controller retains the complete
authoritative item collection and filters only when rendering day sections.
The Plan view option is stored in the `hide_past_planned` key of the existing
`public.app_settings.plan_settings` object. `training-web` owns this key's
strict API contract and updates it without replacing other settings. Hiding a
past item must never mutate its record.

Use the shared application lifecycle and API conventions documented in
`docs/FRONTEND_ARCHITECTURE.md`. Do not extract modules merely for file-count
symmetry; extract when a product responsibility is stable and testable.

## HTTP route responsibilities

The HTTP route layer owns:

- Route declarations.
- Pydantic request and response contracts.
- Structural validation.
- Origin/Referer mutation protection or later authorization controls.
- Product-contract status codes.
- Safe error mapping.
- Invocation of one named business operation.
- Response shaping and serialization.

Routes must not own:

- Multi-table transaction choreography.
- Lock ordering.
- Prescription or segment cloning.
- Batch transition orchestration.
- Actual or derived training calculations.

Request models must reject undocumented fields. Nullable values remain
distinct from numeric zero. IDs, ownership discriminators, and lifecycle
timestamps are server-controlled. Create and update responses should return
the authoritative saved representation so the browser does not reconstruct it.

Collection reads remain bounded and deterministically ordered. Detail reads
use a fixed query count and must not introduce N+1 behavior.

## Plan service responsibilities

The Plan service follows
`docs/ARD/PLAN_PERSISTENCE_SERVICE_BOUNDARY.md`.

It owns:

- Atomic business operations.
- Multi-table transactions.
- Deterministic lock order.
- Template-to-item clone semantics.
- Item lifecycle transitions.
- Batch transitions.
- Domain errors independent of FastAPI.
- Exactly one successful commit.
- Rollback-safe failure propagation.

The service must not import browser or FastAPI concepts. Routes must not
duplicate service transaction behavior.

## PostgreSQL responsibilities

PostgreSQL owns:

- Durable Plan records.
- Foreign keys and ownership enforcement.
- Uniqueness.
- Lifecycle constraints.
- Final data integrity.
- Durable drafts and batches.
- Preservation of user-authored Plan data across browser closure and ETL
  rebuilds.

Schema meaning and schema evolution remain owned by `training-etl`. This ADR
does not authorize schema changes or move ownership of the Plan schema.

## Server state and UI state

### Transient UI state

Transient UI state includes:

- Open or closed flyouts.
- Unsaved field edits before durability is promised.
- Selected cards, dates, or tabs.
- Validation messages.
- In-flight and saving flags.

### Authoritative server state

Authoritative state includes:

- Saved templates.
- Saved prescriptions and segments.
- Planned items.
- Item lifecycle state.
- Open durable batches.
- Committed or discarded batch state.
- Generated IDs and timestamps.

Server state must come from API responses or bounded refetches. UI state must
not silently become durable by implication.

When product behavior promises persistence across browser closure, the state
must be saved to PostgreSQL through a defined batch or item API. Browser
navigation must not silently discard a durable draft.

`localStorage` and `sessionStorage` must not become a second database for Plan
entities. Client caches may optimize reads, but they are never authoritative.

## Mutation state rules

Default to server-confirmed mutations, not optimistic success.

- Show a saving state while awaiting the server.
- On success, replace local entity state with the returned representation.
- On failure, retain or restore the last confirmed server state.
- Show an actionable, sanitized error.
- Allow optimistic mutation only after rollback and reconciliation behavior is
  explicitly designed and tested.
- Never infer successful cloning, commit, cancellation, or deactivation before
  the server responds.
- Make mutation requests safe against duplicate UI event firing where practical.
- Preserve end-to-end idempotency for lifecycle endpoints that promise it.

## Reads and stale responses

Every bounded asynchronous UI surface must own its request state.

- Calendar and range reads use generation tokens, abort controllers, or an
  equivalent stale-response guard.
- Older range, filter, or entity responses must not overwrite newer state.
- Loading a Plan surface must not reset unrelated actual-training state.
- Template library, item range, batch, and actual-calendar data use separate
  request and state ownership.
- Query bounds and ordering are fixed and explicit.
- Avoid N+1 browser and server query patterns.

## Planned versus actual authority

Planned records are not actual records. Planned load is not actual load.

Plan writes remain owned by the Plan feature and its service boundary.
Authoritative actual calculations remain owned by the ETL system and its
actual/derived tables.

A planned-versus-actual display is a read composition, not a merged write
model. The UI may visually combine the information while the datasets retain
separate persistence and calculation authority.

Future reconciliation or matching requires a separate approved design.
ETL rebuilds may rebuild actual or derived tables but must preserve
user-authored Plan tables.

## Complex-feature investigation rule

Before implementing a feature that crosses two or more of these boundaries:

- browser UI;
- HTTP API;
- service transaction;
- PostgreSQL schema or constraints;

GHC must perform one bounded ownership investigation unless an existing ADR
and current API contract fully resolve the feature.

The investigation must settle:

- Layer ownership.
- Source of truth.
- Request and response contracts.
- Transaction boundaries.
- Lock order where needed.
- Durable versus transient state.
- Failure and recovery behavior.
- Test boundaries.
- Live-validation data lifecycle.

Do not make these decisions ad hoc while coding.

## Ordered slice implementation

Complex features should be implemented in small ordered slices:

1. Schema or constraint prerequisite, if needed, owned by `training-etl`.
2. Read API and response contract.
3. Write service and API transaction.
4. UI read and render shell.
5. UI mutation workflow.
6. Durable draft or autosave behavior.
7. Calendar or other Plan-surface integration.
8. Live validation and documentation cleanup.

Not every feature requires every step. A single session must not combine
schema, API, service, complex UI, and production migration work without an
explicit bounded reason.

## Durable drafts and batches

Future batch architecture follows these rules:

- Opening Plan does not create a batch.
- The first staged mutation creates or resumes an open batch.
- Multiple open batches may exist.
- Autosave persists draft changes through the API.
- Browser closure must not lose persisted drafts.
- Resume identifies batches by durable ID, not browser-session identity.
- Batch commit and discard are atomic service operations.
- The UI distinguishes local unsaved edits from server-saved draft state.
- Leaving a dirty local form requires explicit save or discard behavior.
- Repeated requests use idempotency where the API contract promises it.

## Error and recovery rules

Use the following boundary:

- Structural request errors: `422` where FastAPI/Pydantic owns validation.
- Semantic request errors: documented `400` behavior.
- Missing or inactive records: documented `404` behavior.
- Narrow integrity or lifecycle conflicts: documented `409` behavior.
- Unknown persistence failures: sanitized `503` or the repository-standard
  server failure.

Client errors must not expose SQL, credentials, internal hosts, raw exception
text, or sensitive payloads.

Partial browser workflows recover from authoritative server state, not from
assumptions about which SQL statements ran.

## Security boundary

Current Plan mutations are trusted-LAN-only with Origin/Referer risk
reduction. This is not authentication.

Public, tunneled, or untrusted exposure requires a separate security decision
covering authentication, authorization, CSRF appropriate to that model, and
rate limiting.

Browser code must never receive server-to-server internal tokens. Future Plan
mutation routes inherit the current security boundary unless an approved
architecture replaces it.

## Testing pyramid

Every complex vertical slice includes the applicable layers.

### UI/browser contract tests

Cover:

- Rendering.
- Loading, empty, error, and saving states.
- Stale-response protection.
- Replacement of local state from responses.
- Duplicate event-registration prevention.
- Responsive behavior and accessibility.

### Route tests

Cover:

- Request parsing.
- Security guard behavior.
- Status codes.
- Safe errors.
- Response shape.
- No database access after pre-database rejection.

### Service tests

Cover:

- Exactly one successful commit.
- Rollback and no commit after failure.
- Deterministic lock order.
- Ownership enforcement.
- Clone independence.
- Lifecycle idempotency.
- SQL/table allowlists.
- No actual or derived writes.

### Schema and database tests

Cover keys, foreign keys, uniqueness, checks, lifecycle constraints,
canonical schema parity, and migration behavior when schema changes exist.

### Live validation

Cover:

- Exact tested/deployed commit parity.
- The smallest realistic fresh-page scenario.
- A controlled validation-record lifecycle for writes.
- No actual or derived contamination.
- Console, page, request, and server error monitoring.
- No destructive cleanup of user-authored evidence without approval.

## Deployment and rollback

Deploy only the exact tested commit and verify live metadata parity.

Use small, non-destructive validation scenarios. Application rollback and
data rollback are separate. Rolling application code back must not delete or
rewrite Plan data.

After user-authored Plan data exists, correct database behavior through
additive forward fixes. Preserve rollback points and changed-file reports.

## AI execution discipline

Future GHC sessions should follow the current repository execution policy:

- one ownership inventory;
- focused follow-up searches only;
- no broad discovery after editing begins unless a test exposes a real unknown;
- bounded patch attempts;
- ordered validation;
- no post-commit architecture discovery;
- final changed-files and Git summary.

## Rejected alternatives and anti-patterns

Reject:

- UI duplication of server-side clone or lifecycle logic.
- `localStorage` as the durable Plan database.
- Optimistic success without rollback design.
- Stale responses overwriting current UI state.
- One API request per card when a bounded collection contract exists.
- Route handlers performing multi-table transactions.
- Services importing browser or FastAPI concepts.
- Plan writes to actual or derived tables.
- Hidden coupling between template edits and existing item prescriptions.
- Giant cross-layer implementation sessions without a settled contract.
- Duplicate editors or component forks.
- Automatic destructive cleanup during application rollback.
- An invented generic state-management or repository framework without
  demonstrated need.

## Consequences

### Positive consequences

- Clear source-of-truth ownership.
- Less UI and server drift.
- Safer transactions and durable drafts.
- Reusable authoritative API responses.
- Smaller implementation slices.
- Easier tests at each boundary.
- Preserved separation of planned and actual data.

### Costs

- Cross-layer contract work is required before complex coding.
- Loading, saving, and error states must be explicit.
- Simple reads and complex writes remain intentionally asymmetric.
- Stable UI and service boundaries may require additional focused modules.
- Live-validation data must be handled more deliberately.

## Scope and non-goals

This ADR does not:

- define every endpoint field;
- duplicate the persistence-service ADR;
- prescribe a frontend framework rewrite;
- mandate a global state library;
- introduce authentication;
- define zone-profile calculations;
- define planned-to-actual matching;
- specify product styling;
- replace feature PRDs or executable tests;
- establish generic architecture for unrelated application domains.

## References

- `docs/ARD/PLAN_PERSISTENCE_SERVICE_BOUNDARY.md`
- `docs/FRONTEND_ARCHITECTURE.md`
- `docs/ENGINEERING_CONSTITUTION.md`
- `docs/TESTING_GUIDE.md`
- `routes/plan.py`
- `services/plan_service.py`
- `static/plan.js`
- `tests/test_plan.py`
- `tests/test_plan_calendar_contract.js`
- `training-etl/docs/ARD/TRAINING_SYSTEM_SERVICE_BOUNDARIES.md`
- `training-etl/sql/Applied/plan_core_v1_slice_1.sql`
