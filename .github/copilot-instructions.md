## Required Engineering Grounding

Before work, classify the turn as **fresh implementation**, **continuing implementation**, or **release-only continuation**. Read only the smallest authoritative context required.

For fresh implementation, read:

1. This file.
2. Only the directly relevant sections of `docs/ENGINEERING_CONSTITUTION.md`.
3. The directly relevant architecture, feature, testing, and ADR sections.

For continuing implementation, reuse unchanged context already established in the current GHC session. For release-only continuation, use the fast path below and do not reread implementation or architecture material.

The Engineering Constitution defines cross-repository principles.
This file defines repository-specific mandatory instructions.
Feature documents define detailed contracts and current behavior.

## Execution modes and release-only fast path

### Fresh implementation

Use when the session is new, prior governance reads cannot be established, or the task enters a new ownership boundary. Run the fresh-session Git gate, perform one bounded ownership inventory, and read only targeted governance sections.

### Continuing implementation

Use when the current session already established the relevant governance and ownership boundaries. Do not repeat the Git gate, ownership inventory, broad searches, or unchanged document reads merely because another prompt was pasted. Reread only when Git shows a relevant document changed, a boundary is unclear, or a test exposes an unknown.

### Release-only continuation

Use when implementation is complete, the approved worktree was already tested in the current session, and the user asks to commit, push, deploy, or finish release.

Do not reread the implementation prompt, architecture documents, testing guide, or unchanged governance. Do not rediscover ownership. Do not rerun source tests unless source or test code changed after the recorded green validation.

Release-only sequence:

1. Verify modified paths exactly match the approved list and no unrelated or untracked files exist.
2. Run `git diff --check` and review the bounded diff.
3. Stage only approved files and run `git diff --cached --check`.
4. Commit with required attribution and push `main`.
5. Fetch once and verify a clean worktree, no active Git operation, and `HEAD == origin/main`.
6. Deploy with the documented platform-native script.
7. Restart only `training-web` if startup-derived revision metadata is proven stale.
8. Verify root HTTP 200 and the advertised full revision equals `HEAD`.
9. Stop and report. Mike performs product acceptance unless the current prompt explicitly authorizes browser automation.

Release-only limits:

- No full suites when no source or test code changed.
- No Playwright, browser automation, cross-tab tour, or manual-style UI checks unless explicitly requested in the current prompt.
- Do not hash every asset when full revision verification succeeds. Hash only changed assets when revision verification fails, metadata is inconsistent, or the prompt requires hashes.
- One pre-commit Git inspection and one post-push synchronization check are enough unless either fails.


# GitHub Copilot Instructions for training-web

## Mandatory fresh-session Git gate

Before any implementation edit in a fresh session, run the
[Fresh-Session Git Synchronization Gate](../docs/ENGINEERING_CONSTITUTION.md#fresh-session-git-synchronization-gate)
in this repository and every affected sibling repository. Run `git fetch
origin` as part of the preflight; stale remote-tracking refs are not proof of
current state. A dirty, divergent, active-operation, cross-repository mismatch,
or unverifiable remote state is a hard STOP, not a warning. Do not
automatically pull, rebase, merge, reset, clean, stash, overwrite, or
force-push unpreserved work.

This clean-tree rule applies before GHC starts editing. After GHC intentionally edits approved files, a dirty worktree is expected. Before commit, verify every changed path belongs to the approved scope and no unrelated or untracked files appeared. Do not misapply the pre-edit clean-tree rule to GHC's own tested changes.

Before deployment, the tested commit MUST be on the intended release branch,
the worktree MUST be clean, no Git operation may be active, and local `HEAD`
MUST equal freshly fetched `origin/main` exactly. Record the preflight and
release hashes.

## Session-Aware Documentation Policy

Determine whether the current work is occurring in a fresh GHC session or a continuing GHC session.

### Fresh session

Before editing:

1. Read this repository instruction file.
2. Read only the directly relevant sections of the Engineering Constitution, Frontend Architecture, Testing Guide, and applicable ADRs.
3. Run the required fresh-session Git synchronization gate.
4. Do not broadly read unrelated documentation or source modules.

A fresh session must establish enough authoritative context to work safely, but it must use targeted section reads rather than automatic whole-document reads.

### Continuing session

If the relevant governance documents were already read during the current GHC session and have not changed:

- Reuse the established session context.
- Do not reread unchanged governance documents.
- Do not repeat the fresh-session architecture inventory.
- Do not repeat broad source or documentation searches.
- Do not reread documents merely because a new prompt was pasted into the same session.

Reread a document only when:

1. Git shows that the document changed since it was last read;
2. the task reaches an unclear ownership, architecture, testing, security, data, or deployment boundary; or
3. a test or live validation exposes an assumption that requires authoritative verification.

When rereading is necessary, read only the relevant section rather than the complete document.

### Session determination

Use available conversation and tool history to determine whether the current GHC session already read the relevant documents.

- If the current session history clearly shows that the documents were read, treat the session as continuing.
- If the session is new, history is unavailable, or prior reads cannot be established confidently, treat the session as fresh.
- Never rely on a persistent repository marker claiming that a prior session read the documents. Such a marker could become stale and cause a fresh session to skip required guidance.

### Change detection

When useful, check whether governance documents changed since the current session's starting commit with a narrow command equivalent to:

```bash
git diff --name-only <session-start-commit>..HEAD -- \
  .github/copilot-instructions.md \
  docs/ENGINEERING_CONSTITUTION.md \
  docs/FRONTEND_ARCHITECTURE.md \
  docs/TESTING_GUIDE.md \
  docs/ARD
```

Adapt paths to the repository's actual structure. Do not run this command repeatedly when no relevant commit or document change occurred.

### Prohibited context waste

- No repeated whole-document reads in the same session.
- No repeated whole-module reads after editing begins.
- No broad architecture discovery after the implementation boundary is known.
- No broad searches after editing begins unless a test exposes an unknown.
- No rereading deployment documentation immediately before deployment when the current session already established the applicable process and the document has not changed.
- No repeated full-suite execution unless source changed or repository policy explicitly requires another run.

### Targeted-read rule

When a document must be consulted:

- search for the relevant heading or term first;
- read the smallest useful line range;
- expand once only if the first range is insufficient;
- avoid reading an entire long document when one section answers the boundary question.

## GHC Autonomy and Server-Safety Guardrails

GHC should move approved work forward autonomously inside a clearly bounded scope. GHC must not turn a narrow defect, test failure, deployment issue, or server observation into an unapproved cleanup or redesign project.

### Autonomy allowed without additional approval

GHC may make a discovered fix without stopping for approval only when all of the following are true:

1. The issue is concrete and directly blocks or invalidates the currently approved task.
2. The fix is narrow, reversible, and within the same ownership boundary.
3. The behavior can be proven with a deterministic test, parity check, syntax check, or read-only validation.
4. The fix does not change production data, schema, security boundaries, lifecycle semantics, public API contracts, or product architecture.
5. The fix does not create a new user-visible capability beyond the approved slice.
6. The exact tested commit can be deployed and rolled back through the documented process.
7. The change avoids unrelated cleanup and formatter churn.

Examples of acceptable autonomous fixes:

- excluding `.pytest_cache`, coverage files, or equivalent local test residue from deployment packaging when those files are clearly non-runtime artifacts;
- correcting deployment-script parity when both documented deployment paths must package the same application content;
- fixing a directly related stale asset-version check;
- correcting a typo, selector, test fixture, or narrow lifecycle hook that directly prevents the approved feature from working;
- adding a focused regression test for the discovered blocking defect.

### Approval required before proceeding

Stop and request a Product Owner decision when any of the following is true:

1. Scope crosses into another repository unexpectedly.
2. A schema, migration, SQL execution, or production-data mutation is required.
3. A security, authentication, authorization, secret-management, or network boundary would change.
4. A public API, persistence contract, lifecycle model, or architecture decision would change.
5. Multiple materially different fixes are plausible and product behavior would differ.
6. The proposed change adds, removes, or substantially alters user-visible behavior outside the approved slice.
7. A deployment or rollback process requires redesign rather than repair.
8. The proposed cleanup is useful but unrelated to the blocking issue.
9. Production state is unknown, ambiguous, or cannot be verified safely.
10. The change would cancel, delete, rewrite, backfill, or bulk-modify production records.
11. Validation would require more production writes than the prompt explicitly authorized.
12. The implementation would exceed the approved file, module, service, or repository boundary.

### Mandatory stop conditions

Stop immediately and report the evidence when:

- the worktree is dirty, unexpectedly diverged, or an active Git operation exists;
- the live or database state is unclear;
- a test exposes a real unrelated defect;
- two narrow patch attempts fail at the same ownership boundary;
- formatter, generated-file, or dependency churn begins;
- implementation would require architecture discovery after the approved boundary is already known;
- repeated browser or test-harness retries are not producing new evidence;
- the exact tested commit cannot be proven equal to the deployed commit;
- a rollback point cannot be preserved;
- actual, derived, financial, health, security, or other protected data could be changed unexpectedly.

### Narrow-fix execution rule

When an autonomous fix is allowed:

1. State the concrete defect and why it blocks the approved task.
2. Identify the smallest ownership boundary and exact files involved.
3. Make no more than two narrow patch attempts at that boundary.
4. Add or update the smallest deterministic regression test.
5. Run focused validation first.
6. Run complete required suites only after the final source change.
7. Review the bounded diff and confirm no unrelated files changed.
8. Include the discovered fix in the final Changed Files and deviation report.
9. Do not use the fix as permission for adjacent cleanup.

### Server and deployment guardrails

GHC may inspect and validate server state through documented read-only commands, health checks, logs, asset metadata, container status, and documented deployment scripts.

GHC may perform a documented, scoped application deployment or restart only when the prompt authorizes deployment and the exact tested commit is known.

GHC must not, without explicit approval:

- run ad hoc server cleanup commands;
- delete caches, files, containers, images, volumes, or logs merely to make a symptom disappear;
- change ownership, permissions, firewall rules, ports, secrets, environment variables, mounts, or service definitions;
- use `sudo`, destructive shell commands, recursive deletion, force flags, or broad wildcard cleanup;
- restart unrelated services;
- deploy ETL, API, database, or other services outside the approved slice;
- execute SQL, migrations, backfills, or data repair;
- perform manual production edits that bypass the application's service boundary;
- replace a documented deployment process with an improvised one.

A scoped restart is allowed only when:

- the documented application deployment requires it;
- startup-derived asset or revision metadata is proven stale;
- only the approved service is restarted;
- health is verified afterward;
- the restart and reason are documented in the completion report.

### Production-write budget

Production writes are prohibited unless the prompt explicitly authorizes them.

When writes are authorized:

- state the exact maximum number and type of writes before execution;
- perform a read-before-write check;
- use stable IDs, not weak title/date/content matching;
- never exceed the authorized count;
- verify the authoritative response;
- perform a read-after-write check;
- never use SQL cleanup to hide validation data unless explicitly approved;
- keep application rollback separate from data rollback.

### Test and browser retry budget

- Prefer deterministic unit, contract, integration, and parity tests over repeated browser automation.
- Use fresh, small browser scenarios.
- Maximum two harness retries for the same browser interaction.
- Do not change product code solely to satisfy a flaky synthetic browser gesture when manual behavior and deterministic contracts prove the product path.
- Manual product behavior remains the acceptance gate for native drag, touch, browser, or device interactions that automation cannot reproduce reliably.
- Do not rerun a complete suite when no source changed.

### Unrelated improvement handling

If GHC discovers a nonblocking improvement:

1. Do not implement it during the current slice.
2. Record it concisely in Risks, Deviations, or Follow-ups.
3. Include the evidence, likely ownership, and recommended future slice or backlog location.
4. Continue the approved task unless the finding creates a safety or correctness stop condition.

### Completion-report requirement

Keep completion reports concise and evidence-focused. Do not narrate every search, read, or routine Git command.

Every completion report involving an autonomous discovered fix must include:

- the discovered issue;
- why autonomous action was permitted;
- the exact files changed;
- the regression proof;
- whether server, deployment, restart, or production actions occurred;
- the tested commit and deployed commit;
- any remaining risk or deferred cleanup.

## Project

This repo contains the FastAPI web app and browser dashboard for the Training Dashboard.

The separate `training-etl` repo owns Strava ingestion, ETL builders, database writes, schema SQL, weekly audit computation, and future service-log import work.

## Repo boundary

This repo owns:
- The browser-facing FastAPI application and browser-facing routes
- Static frontend assets and product presentation
- Bounded, parameterized, server-side read-only PostgreSQL queries over processed data
- Search, reporting, lookup, narrative, and approved export workflows
- Web-owned records and bounded CRUD
- Coach sessions, messages, turns, settings, memories, receipts, orchestration, and provider integration
- Sync request orchestration and status presentation

The separate `training-etl` repo owns:
- External-source ingestion and provider credentials
- Normalization and authoritative field semantics
- Schema SQL, migrations, and schema evolution
- ETL-managed writes
- Authoritative calculations and builders
- Backfills, rebuilds, reconciliation, and repair logic
- `training-runner` and `training-api`

Do not modify `training-etl` files from this repo unless explicitly requested.

For repository, service, database, Search, ETL orchestration, or internal API decisions, read `training-etl/docs/ARD/TRAINING_SYSTEM_SERVICE_BOUNDARIES.md`.

`training-web` is the browser-facing application and server-side read/query layer. Its server-side routes may perform bounded, parameterized, read-only PostgreSQL queries over processed data for ordinary dashboard, Search, reporting, lookup, narrative, and export workflows. This does not grant schema ownership or permission to duplicate ETL calculations.

The separate `training-api` container is an internal authenticated ETL facade for explicitly approved synchronous ETL operations and coordinated ETL-owned contracts. It is not the mandatory path for every database read, and browser JavaScript must never call it directly. `training-runner` executes scheduled, queued, and background ETL work.
Do not change database schema from this repo unless explicitly requested.

## Runtime

- The app runs in Docker on HarrisServer.
- Live app: `http://192.168.1.100:8088`
- Local `.venv` may not have runtime dependencies.
- Local `py_compile` is syntax-only.
- Real validation must happen against the HarrisServer runtime.

## Deployment

Deploy from macOS or Linux with:

```bash
./deploy_to_server_from_mac.sh
```

On Windows, use `.\deploy_training_web.ps1`. Both supported scripts require
a clean worktree whose `HEAD` equals its configured upstream revision, package
the same exact commit, and support `-DryRun` on Windows or `--dry-run` on
macOS/Linux to inspect the archive without uploading it.

After deployment, verify the rendered root advertises the expected full commit.
If startup-derived commit or asset metadata remains stale, restart only
`training-web`, then repeat health, version, cache, and changed-asset hash
verification. Documentation-only changes are not deployed or restarted.

After deploy, validate live endpoints with `curl`.

Example:

```bash
curl -sS -D - http://192.168.1.100:8088/api/gear/dashboard?limit=5
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

1. Run `.\.venv\Scripts\python.exe -m py_compile` on touched Python files on Windows, or `./.venv/bin/python -m py_compile` on macOS/Linux.
2. Deploy with the platform-native supported deployment script.
3. Test affected live endpoint with `curl`.
4. Confirm HTTP 200.
5. Confirm JSON shape.
6. Confirm no secrets or raw JSON appear.

For frontend changes:

1. Deploy to `http://192.168.1.100:8088` HarrisServer.
2. Hard refresh browser with `Cmd+Shift+R`.
3. Confirm changed tab loads.
4. Confirm Daily, Weekly, Zones, Sync still work.
5. Confirm no console errors.
6. Confirm no blank page.
7. Confirm no `null`, `undefined`, or `NaN`.

## Automated testing

- Read [docs/TESTING_GUIDE.md](../docs/TESTING_GUIDE.md) before changing Python behavior.
- Every new or changed Python behavior and every bug fix should add or update focused deterministic tests unless the completion report documents a concrete exception.
- When Mike says he is done with manual edits and asks GHC to update tests, inspect and preserve his uncommitted diff, add the smallest tests that prove the intended behavior, and do not merely update expectations to force green.
- Run focused tests first, then the full suite using the platform-native repository-local interpreter documented in `docs/TESTING_GUIDE.md`.
- Default tests must not access paid providers, external services, production data, Docker, SSH, or deployment.
- `rg` is available on Mike's Mac for focused repository searches. Use it when helpful, but fall back to `grep` or `find` rather than treating it as a required dependency.
- Report exact commands and results.

## Failure rule

If something fails:

- Stop feature work.
- Reproduce the failure.
- Read the exact error.
- Fix the smallest exact cause.
- Remove temporary debug output before final.
- Report files changed and validation commands run.

## Permanent architecture and execution budget

For frontend ownership, lifecycle, registry keys, transient surfaces, asset
versioning, deployment modes, and release verification, read
`docs/FRONTEND_ARCHITECTURE.md`. It is the permanent architecture source for
the vanilla-JavaScript frontend. Temporary prompts and chat transcripts are
not sources of truth.

The execution policy is single-pass rigor: discover once, patch narrowly,
validate in order, deploy deterministically when required, and stop when the
evidence is green.

Discovery:

- Maximum one ownership inventory per slice.
- Maximum one focused follow-up search per unclear boundary.
- Do not repeat discovery after context compaction; reuse recorded findings.
- Do not broaden search after editing begins unless a failing check exposes a
  specific unknown.

Implementation:

- Use at most two narrow patch attempts per boundary.
- If formatter, indentation, or line-ending churn appears, restore the
  affected file immediately and reapply narrowly.
- Do not repeatedly reread entire modules or rebuild source through broad
  PowerShell/string replacement.
- Stop and report when a bounded change requires a broad rewrite.

Validation order:

1. Focused new or changed contract.
2. Changed-file syntax.
3. Adjacent regression contracts for directly coupled owners.
4. `git diff --check` and bounded diff review.
5. Complete Node inventory and complete Python suite once after final source/test changes only for substantial runtime behavior, cross-cutting shared owners, or when `docs/TESTING_GUIDE.md` explicitly requires them.

For a tiny isolated CSS, copy, constant, selector, test-only, or deployment-packaging change, focused deterministic validation is sufficient unless the testing guide explicitly mandates more.

Once full suites are green, do not rerun them unless source or test code
changes again. Before editing, always check Git cleanliness, local/remote
equality, ancestry, and the live version. Trust an unchanged green baseline.

Live validation uses small independent fresh-page scenarios with monitoring
attached before navigation, at most two harness retries per scenario, and no
mutating production actions. Fix a harness-only failure locally; if it remains
blocked after two retries, report it. Do not change production source because
of an unproven browser observation.

After commit, the boundary is: push, deploy only when runtime files changed,
restart only when startup metadata must refresh, verify the full live revision,
run only explicitly authorized live scenarios, verify final Git status, and report. No post-commit
architecture discovery or speculative cleanup. Corrections require a new
normal commit.
