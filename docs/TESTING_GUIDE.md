# Testing Guide

## Purpose

Pytest is the standard Python test runner for `training-web`. Existing `unittest.TestCase` tests remain valid under pytest. New tests may use native pytest style when it improves clarity, but existing tests should not be converted merely for style.

Automated tests complement runtime and browser validation. They do not replace live endpoint, deployment, or browser checks when a change requires those checks.

## Environment and commands

Run commands from the repository root with the repository-local interpreter. Activation is optional on macOS and Linux:

```bash
./.venv/bin/python -m pip install -r requirements.txt
./.venv/bin/python -m pip install -r requirements-dev.txt
./.venv/bin/python -m pytest --collect-only -q
./.venv/bin/python -m pytest -q
```

Focused examples:

```bash
./.venv/bin/python -m pytest tests/test_coach_orchestration.py -q
./.venv/bin/python -m pytest tests/test_coach_orchestration.py::CoachOrchestrationTests::test_context_failure_marks_started_turn_and_does_not_call_provider -q
./.venv/bin/python -m pytest -k budget -q
./.venv/bin/python -m pytest --lf -q
./.venv/bin/python -m pytest -x -q
```

On Windows, activate the repository virtual environment first and use `python -m pytest`; use `python -m pytest -q` when `python3` is unavailable.

## Local search tooling

- `rg` (ripgrep) is available for fast repository searches on Mike's Mac.
- It is useful for locating tests, references, imports, and affected files.
- It respects `.gitignore` by default.
- It is a convenience tool, not a Python or test dependency, and must not be added to `requirements.txt` or `requirements-dev.txt`.
- If `rg` is unavailable on another development machine or coding-agent environment, use `grep` or `find`; do not block implementation or validation solely because `rg` is missing.

```bash
rg "route_evidence" --glob '*.py'
rg --hidden "TESTING_GUIDE" --glob '*.md'
rg --files tests | rg 'test_.*\.py$'
```

## Definition of done for Python changes

1. Identify the intended behavior and owning module.
2. Add or update the smallest deterministic regression test that proves the behavior.
3. Run the focused test first.
4. Run the complete web suite before completion.
5. Run `py_compile` on every changed Python file.
6. Report the exact commands and outcomes.
7. Never claim validation that did not occur.

## Manual edit to GHC workflow

GHC is optional for editing application code. Mike may make production edits manually and then ask GHC to create and validate the tests. Add one sentence describing the intended behavior change, for example: "The route should reject invalid IDs without opening a database connection."

Reusable prompt:

```text
I am done with my manual edits. Review the current uncommitted diff, identify the intended behavior changes, and infer the contract from my stated intent, current code, existing tests, and documentation. Preserve and distinguish my manual edits. Add or update the smallest focused deterministic tests that prove the intended behavior. Do not merely update expected values or weaken assertions to force green. Ask only if material ambiguity remains. Run the focused tests first, then the complete repository suite, and run py_compile on changed Python files. Report exact commands and outcomes. Do not commit or push.
```

## Test safety invariants

The default suite must never:

- call OpenAI or another paid provider;
- call Strava or production training-api;
- connect to production PostgreSQL;
- use Docker or SSH;
- deploy, restart, rebuild, or recreate services;
- require or print production credentials;
- print complete prompts, memories, health context, provider payloads, tokens, or secrets.

Use fakes, mocks, synthetic context, fake database objects, and patched network boundaries. Provider and context tests must prove call prevention or error mapping without making real calls.

## What requires tests

Add or update tests for new or changed Python behavior, bug fixes, FastAPI route validation, sanitized errors, API response shapes, security boundaries, and AI Coach orchestration. AI Coach changes commonly require coverage for budgets, failures, memory routing, context receipts, and provider-call prevention.

Reasonable exceptions include documentation-only changes, comments, and genuinely nonbehavioral formatting. Manual runtime or browser checks may remain manual when they cannot be automated locally, but local logic should still be tested where practical.

## Test layers

- **Unit tests:** deterministic Python logic with fakes and mocks.
- **API and consumer contract tests:** route validation, response shapes, and sanitized boundaries without production services.
- **Future controlled integration tests:** non-production infrastructure only; do not introduce that infrastructure as part of ordinary unit-test work.
- **Manual smoke tests:** runtime, provider, deployment, and browser checks kept separate from pytest.

## Frontend boundary

Pytest covers Python, not vanilla JavaScript behavior. Continue `node --check` for changed JavaScript files. Browser validation remains required for UI changes. Do not add Playwright or a JavaScript test framework as part of this guide.

## Failure handling

Reproduce the exact failure, then decide whether the code, test, or documented contract is wrong. Do not weaken a test merely to obtain green output. Make the smallest correction and rerun the focused test before rerunning the full suite.

## Completion report checklist

Report:

- files changed;
- tests added or updated and behavior proven;
- focused result;
- full-suite result;
- syntax checks;
- manual validation performed;
- remaining untested behavior;
- isolation confirmation;
- final `git status --short`;
- no commit or push unless explicitly requested.
