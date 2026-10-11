# Plan Persistence Service Boundary

## Status

Accepted.

## Scope

This decision applies to Plan persistence in `training-web`.

It establishes a focused service boundary for multi-table Plan writes. It does
not create a generic service or repository mandate for the rest of the
application, move schema ownership from `training-etl`, or change the
trusted-LAN security model.

## Context

Plan template mutations use two application layers:

- `routes/plan.py` owns the browser-facing HTTP contract.
- `services/plan_service.py` owns the transactional Plan persistence
  operations.

PostgreSQL remains the final relational integrity authority. This separation
keeps route handlers reviewable while preventing multi-table transaction
orchestration from being duplicated across future Plan workflows.

The same boundary is expected to support future template-to-item cloning,
item lifecycle operations, and durable batch operations. It must remain
narrow: the service is a Plan business-operation boundary, not a generic
database framework.

## Decision

Use a focused Plan persistence service for business operations that require
transactional, multi-table, locked, cloned, or lifecycle-aware persistence.

Routes parse and validate HTTP input, enforce the HTTP-layer mutation guard,
call a named service operation, map known domain errors to the API contract,
and shape the response.

The service owns the logical transaction, parameterized Plan SQL, lock order,
ownership checks, atomic child replacement, and domain errors independent of
FastAPI.

PostgreSQL owns final relational enforcement through keys, foreign keys,
unique constraints, check constraints, ownership discriminators, and
row-local lifecycle invariants.

## Responsibilities by layer

### Route layer

`routes/plan.py` owns:

- FastAPI endpoint declarations.
- Pydantic request models and HTTP-body parsing.
- Origin/Referer mutation protection and future HTTP authorization controls.
- Route-specific validation that is inherently HTTP or product-contract
  oriented.
- Calling named Plan service operations.
- HTTP status codes and safe error-body mapping.
- Response serialization and API contract shaping.
- Reuse of the established template-detail response shape.

Routes must not contain lock-order decisions, multi-step clone orchestration,
or partial-write recovery logic.

### Plan service layer

`services/plan_service.py` owns:

- Multi-table Plan transactions.
- Parameterized SQL for Plan-owned persistence operations.
- Transaction ownership and exactly one successful commit.
- Rollback-safe failure propagation.
- Row locking and consistent lock order.
- Template/item prescription-owner verification.
- Atomic segment replacement.
- Template-to-item prescription and segment cloning.
- Item lifecycle transitions.
- Batch commit and discard transitions.
- Domain exceptions that do not depend on FastAPI or HTTP status codes.

Service functions represent meaningful atomic operations, such as:

- `create_template`
- `update_template`
- `deactivate_template`
- `clone_template_to_item`
- `update_item`
- `cancel_item`
- `commit_batch`
- `discard_batch`

Avoid generic verbs such as `save_entity`, `generic_update`, or
`execute_transaction`.

The service must not import FastAPI response classes, `Request`, or HTTP status
codes.

### PostgreSQL

PostgreSQL owns:

- Primary-key and unique-key enforcement.
- Foreign-key referential integrity.
- Template/item prescription ownership discriminators.
- Lifecycle state and timestamp checks expressible at row scope.
- Segment-order uniqueness.
- Segment repeat and target consistency.
- Final defense-in-depth integrity enforcement.

Application validation improves error quality but does not replace these
database constraints.

## When service extraction is required

A write operation must use the Plan service layer when any of the following
are true:

- It touches more than one table.
- It requires a transaction across multiple statements.
- It requires `FOR UPDATE` or another row lock.
- It clones a prescription or segment collection.
- It replaces a complete child collection atomically.
- It performs a lifecycle transition involving multiple records.
- Failure after an intermediate write must roll back the whole operation.

A simple bounded GET may remain in `routes/plan.py` when it is one query or a
fixed small query count, contains no multi-table write transaction, and remains
readable and testable there. The resulting architecture is intentionally
asymmetric: simple reads do not require artificial service extraction.

## Transaction and locking rules

Each service function owns one logical transaction.

Rules:

1. Validate domain input before opening the transaction where practical.
2. Perform database-backed validation and state transitions inside the
   transaction.
3. A successful multi-table operation commits exactly once.
4. A failed operation propagates an exception so the connection context rolls
   back.
5. Lock order must be explicit and deterministic.
6. Do not add a lock without a concurrency invariant it protects.

The current template update lock order is:

1. owning template row;
2. owned prescription row;
3. child segments replaced within the same transaction.

Future item operations should follow the same ownership-first principle.
Batch transitions must lock the batch before included items and prescriptions
in a documented deterministic order.

Template-owned prescriptions and item-owned prescriptions must never be shared
as mutable state. A template change must not rewrite an item prescription.

Deactivation and cancellation are lifecycle transitions, not physical deletes,
when the product contract requires historical provenance to remain available.

## Error boundary

The service raises domain exceptions or sanitized persistence exceptions. It
does not choose HTTP responses.

Routes map known domain failures to the API contract, including appropriate
`400`, `404`, or `409` responses. Unknown persistence failures map to a
sanitized `503` or the repository-standard equivalent.

Client responses must never expose:

- raw SQL;
- SQLSTATE values;
- constraint names;
- SQL parameters;
- database credentials;
- database hosts;
- raw exception text.

Known ownership or integrity conflicts may map to `409` only when the service
can classify them deterministically. Do not broadly convert every database
exception into `409`.

## Data and table isolation

Plan service writes are limited to Plan-owned tables authorized by the
operation.

Plan mutations must not write to:

- Strava activity tables;
- Daily or Weekly training tables;
- Load, Fitness, Fatigue, or Form tables;
- check-in tables;
- other actual or derived training tables.

Planned target load and actual load remain separate authorities. A cross-domain
write or calculation requires a new explicit architecture decision; it must
not be introduced through an opportunistic join or helper.

## Testing requirements

Every new service transaction requires focused deterministic tests for:

- successful commit count;
- rollback and no successful commit after failure;
- deterministic lock order where locks are used;
- prescription ownership enforcement;
- SQL and table allowlists;
- absence of actual/derived table mutation;
- preservation of `NULL` versus numeric zero;
- response-contract reuse where relevant;
- idempotent lifecycle behavior where promised.

Mutation tests should use transaction-aware fakes or equivalent isolated
fixtures. Tests must prove that a failure after an intermediate write cannot
return a success-shaped response.

Route tests separately cover:

- request parsing and strict field behavior;
- mutation security controls;
- HTTP status and sanitized error mapping;
- response serialization.

## Rejected alternatives and anti-patterns

Reject:

- multi-table transaction orchestration inside route handlers;
- committing inside low-level SQL helpers;
- generic CRUD or repository abstractions created only for symmetry;
- service imports of FastAPI types or HTTP status codes;
- route-level lock-order or clone orchestration;
- SQL crossing from Plan persistence into actual or derived training tables;
- sharing mutable template prescriptions with items;
- hard deletion where the lifecycle contract requires deactivation or
  cancellation;
- destructive application rollback that deletes user-authored Plan data;
- moving every bounded GET into the service solely for architectural
  symmetry.

## Examples

The template mutation operations are the reference shape:

- `create_template` validates the active category, creates a template-owned
  prescription, inserts segments, creates the template, loads the detail, and
  commits once.
- `update_template` locks template then prescription, verifies ownership,
  updates scalar fields, replaces all segments, loads the detail, and commits
  once.
- `deactivate_template` locks the template, performs an idempotent lifecycle
  transition, and preserves the prescription, segments, and item provenance.

Future `clone_template_to_item` must create an independent item-owned
prescription and segment set in the same transaction. It must not point an item
at the mutable template prescription.

## Consequences

### Positive consequences

- Route handlers remain small and reviewable.
- Transaction logic is reusable from future UI and assistant workflows.
- Clone and ownership invariants have one implementation boundary.
- Focused transaction tests can prove rollback and isolation directly.
- Service code remains independent of FastAPI.

### Costs

- There is one additional module and boundary to maintain.
- Route models, domain exceptions, and service inputs require intentional
  coordination.
- Simple reads may remain in routes, so the architecture is deliberately
  asymmetric.
- The service must be actively kept narrow to avoid becoming a dumping ground.

## Scope and non-goals

This ADR does not:

- mandate a generic service layer for other features;
- move schema ownership from `training-etl`;
- change the trusted-LAN security model;
- authorize public or unauthenticated internet exposure;
- authorize Plan writes to actual or derived training tables;
- add item, batch, category, zone, or UI behavior;
- change database schema or migration ownership;
- require migration of existing non-Plan routes.

## References

- `routes/plan.py`
- `services/plan_service.py`
- `tests/test_plan.py`
- `db.py`
- `training-etl/docs/ARD/TRAINING_SYSTEM_SERVICE_BOUNDARIES.md`
- `training-etl/sql/Applied/plan_core_v1_slice_1.sql`
