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

### Windows

Run Python tooling through the repository-local interpreter explicitly. Virtual-environment activation is optional and must not be assumed.

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest --collect-only -q
.\.venv\Scripts\python.exe -m pytest -q
```

Focused examples:

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_coach_orchestration.py -q
.\.venv\Scripts\python.exe -m pytest -k budget -q
.\.venv\Scripts\python.exe -m pytest --lf -q
.\.venv\Scripts\python.exe -m pytest -x -q
```

Do not use bare `python`, `python3`, `py`, `pytest`, `pip`, or `pip3` when the repository-local `.venv` exists. This prevents commands from silently using a system interpreter with missing or incompatible dependencies.

## Test-environment preflight

Complete this preflight before editing code or running the first Python validation command:

1. Confirm the command is running from the repository root.
2. Confirm the repository-local interpreter exists.
3. Print the interpreter path.
4. Verify the required test and application imports.
5. Use the same interpreter for every Python command during the task.
6. Do not silently switch to a system interpreter.
7. If the documented environment is missing or incomplete, classify validation as `BLOCKED` and report the precise problem.
8. Do not install dependencies unless the task explicitly authorizes installation.

macOS/Linux:

```bash
test -x ./.venv/bin/python
./.venv/bin/python -c "import sys; print(sys.executable)"
./.venv/bin/python -c "import pytest; print('pytest ready')"
```

Windows PowerShell:

```powershell
if (-not (Test-Path .\.venv\Scripts\python.exe)) {
	throw "Repository Python environment not found"
}

$python = (Resolve-Path .\.venv\Scripts\python.exe).Path

& $python -c "import sys; print(sys.executable)"
& $python -c "import pytest, fastapi; print('training-web test environment ready')"
```

Use the captured interpreter for follow-on commands:

```powershell
& $python -m pytest tests\test_feature.py -q
& $python -m pytest -q
& $python -m py_compile routes\feature.py tests\test_feature.py
```

Do not switch interpreters during the task.

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

1. Read this Testing Guide before running Python commands.
2. Complete the test-environment preflight with the repository-local interpreter.
3. Identify the intended behavior and owning module.
4. Add or update the smallest deterministic regression test that proves the behavior.
5. Run the focused test first.
6. Run the complete web suite before completion.
7. Run `py_compile` on every changed Python file.
8. Report the exact commands and outcomes.
9. Never claim validation that did not occur.

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

Classify each validation result as follows:

- `PASS`: Tests executed and every assertion passed.
- `FAIL`: Tests executed and at least one assertion failed.
- `BLOCKED`: Tests did not execute because of an interpreter, dependency, import, collection, command, or environment problem.
- `NOT RUN`: Validation was intentionally omitted.

Reproduce the exact failure, then decide whether the code, test, or documented contract is wrong. A missing package in the system interpreter is not a product-code failure. If a command accidentally uses the wrong interpreter, record the attempt as `BLOCKED`, switch to the documented repository-local interpreter, and rerun the exact focused validation. Report the authoritative rerun prominently. Do not describe a blocked attempt as a failed test.

Do not claim test coverage from compilation, collection, source inspection, or static contract matching alone. Do not weaken a test merely to obtain green output. Make the smallest correction and rerun the focused test before rerunning the full suite.

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
