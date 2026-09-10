# AI Coach Architecture and V2 Roadmap

## Overview

AI Coach is an embedded, data-grounded coaching experience inside the Training Intelligence web application. It combines authoritative training data, athlete-entered commentary, recent Coach conversation history, and a server-side coaching policy to produce concise, actionable recommendations.

AI Coach V1 is complete as a working vertical slice:

- Persistent Coach sessions and messages
- Provider-neutral AI integration
- OpenAI Responses API support
- Fresh Training Intelligence context on every coaching turn
- Injury and risk-note awareness
- Bounded conversation history
- Usage, latency, and cost tracking
- Server-side budget and concurrency safeguards
- A responsive, modern Coach web interface
- Deterministic and editable conversation titles

AI Coach V2 should build on this foundation without weakening the central architectural rule:

> Training Intelligence owns the data, conversation history, policy, and product experience. The AI provider performs bounded inference and does not become the system of record.

---

## Product Goals

AI Coach is designed to answer questions such as:

- How did I do last week?
- How am I doing this week?
- What should I do next?
- Should I ride hard tomorrow?
- How should an injury, poor sleep, travel, or unusual fatigue change the plan?
- How does this week compare with previous weeks?

The Coach should provide recommendations that are:

- Grounded in authoritative application data
- Sensitive to injuries and athlete-entered risk notes
- Conservative when readiness information is incomplete
- Specific enough to guide the next action
- Concise enough to scan in the web UI
- Persistent and reviewable later
- Provider-neutral
- Cost-bounded
- Privacy-conscious

The Coach is not intended to replace medical care, diagnose an injury, or override instructions from a treating clinician.

---

## High-Level Architecture

```text
Browser Coach UI
    |
    | HTTPS/HTTP on trusted application network
    v
training-web
    |
    |-- Coach session and message persistence
    |-- Coach orchestration
    |-- Coaching policy
    |-- Context size limits
    |-- Conversation-history limits
    |-- Cost and concurrency guards
    |-- Provider-neutral AI interface
    |
    +----> PostgreSQL
    |        - coach_session
    |        - coach_message
    |        - coach_turn
    |
    +----> training-api
    |        GET /internal/coach/context/current
    |        X-Internal-Token authentication
    |
    +----> Configured AI provider
             Current: OpenAI Responses API
             Future: Gemini or another provider adapter
```

### Architectural ownership

| Concern | Owner |
|---|---|
| Training calculations | training-etl / training-api |
| Weekly Audit results | training-etl / training-api |
| Fresh model-facing context | training-api |
| Sessions and messages | training-web / PostgreSQL |
| Turn lifecycle | training-web / PostgreSQL |
| Coaching policy | training-web |
| Provider selection | training-web provider factory |
| Model inference | Configured AI provider |
| UI presentation | training-web static frontend |
| Cost and usage records | training-web / PostgreSQL |

---

## Core Design Principles

### 1. Training Intelligence remains authoritative

The AI model does not recalculate or replace persisted values such as:

- Weekly Audit
- Load
- TID
- Fitness
- Fatigue
- Form
- Recovery scoring

The Coach interprets these values. It does not become a second analytics engine.

### 2. Current-week findings are provisional

A partial week must not be treated as a completed-week failure. For example, missing strength or prehab on Monday is not evidence of a failed training week.

The Coach uses:

- `current_weekly_audit` as the provisional current state
- `latest_completed_weekly_audit` as the stable completed-week anchor

### 3. Form is not complete readiness

Modeled Form is a training-load signal. It does not independently establish readiness to ride hard, especially when pain, poor sleep, illness, coordination problems, travel, or injury are present.

### 4. Missing data is unknown

Missing pain, soreness, sleep, or recovery information is not interpreted as normal or zero. When missing subjective information could materially change the recommendation, the Coach should ask one concise follow-up question.

### 5. Risk overrides routine training progression

Injury notes and risk flags can change the recommendation even when training metrics appear acceptable.

A validated V1 example demonstrated this behavior:

```text
Weekly risk note:
3 cm calf laceration requiring four sutures

Coach result:
The week was reframed as injury management rather than normal training.
```

### 6. The provider is replaceable

Application code depends on a generic `AIProvider` contract. OpenAI-specific types, request syntax, and exception handling stay inside the OpenAI adapter.

A future Gemini integration should require:

- A Gemini adapter
- One provider-factory branch
- A pricing entry if paid-call cost controls apply

It should not require rewriting:

- Coach sessions
- Turn persistence
- Context retrieval
- Coach UI
- Orchestration flow

---

## Request Lifecycle

A real Coach request follows this sequence:

```text
User presses Send
    |
    v
POST /api/coach/sessions/{session_id}/respond
    |
    |-- Validate session and message
    |-- Insert user message
    |-- Insert started coach_turn
    |-- Commit transaction
    |
    |-- Fetch fresh authoritative context from training-api
    |-- Load bounded recent conversation
    |-- Load and select eligible Durable Memories
    |-- Build provider-neutral AIRequest
    |-- Enforce pricing and monthly budget rules
    |-- Acquire provider concurrency capacity
    |-- Persist immutable context receipt
    |-- Call configured provider
    |-- Validate provider response
    |-- Calculate estimated cost
    |
    |-- Insert assistant message
    |-- Complete coach_turn
    |-- Update session provider/model/activity metadata
    |-- Commit transaction
    |
    v
Return persisted messages, completed turn, and usage summary
```

Network calls are deliberately made outside an open database transaction.

Durable Memory management is separate from this paid-turn lifecycle. Its
parameterized management routes use short transactions and never call a
provider. During a paid turn, Durable Memories are selected deterministically
from the current question, the exact bounded history, authoritative signals,
and a bounded recent-day entity window. The compiled block is placed after
Custom Instructions and before temporal and authoritative context. If optional
memory persistence is unavailable, the turn continues without a memory block;
critical selection overflow fails safely before provider inference. The receipt
still retains real topic scopes derived from the question, bounded history, and
authoritative context even when no Durable Memories can be loaded.

Each new turn also persists one validated V1 Context Receipt immediately before
provider execution, after provider-capacity admission. The receipt INSERT and
commit complete before `provider.complete()` begins. It records selected memory
metadata and controlled selection reasons, active scopes, compact context
coverage, bounded history count, and whether Custom Instructions were included.
Receipt failures are recorded internally as invalid, conflict, or unavailable;
client details remain generic. Historical receipts are retrieved through
`GET /api/coach/turns/{coach_turn_id}/context-receipt` without rerunning memory
routing or current-context retrieval.

---

## What Is Stored Locally

PostgreSQL is the durable system of record.

### `coach_session`

Stores the conversation container, including:

- Session title
- Active or archived status
- Provider and default model metadata
- Coaching policy version
- Last activity time
- Optional compaction metadata for future use

### `coach_message`

Stores both sides of the conversation:

- User questions
- Assistant answers
- Role
- Message kind
- Message text
- Optional structured payload
- Creation timestamp

### `coach_turn`

Stores the lifecycle and accounting for one user-question/assistant-answer pair:

- User message relationship
- Assistant message relationship
- Status: started, completed, failed, timed out, or cancelled
- Provider and model
- Provider response ID
- Input tokens
- Cached input tokens
- Output tokens
- Reasoning tokens
- Total tokens
- Elapsed milliseconds
- Estimated cost
- Error category
- Tool-call count

### Local persistence behavior

- Opening the Coach tab does not call the AI provider.
- Loading an old session does not call the AI provider.
- Refreshing the browser does not call the AI provider.
- Renaming a session does not call the AI provider.
- Copying an answer does not call the AI provider.
- Only submitting a real Coach message invokes provider inference.

---

## What Is Sent to the AI Provider

Each real Coach turn sends a newly assembled request containing four major parts.

Before the full authoritative context, `training-web` adds a deterministic temporal-reference block derived from the context's `as_of.current_date`, `as_of.timezone`, and `as_of.response_generated_at` fields. Relative dates are derived from the Training API context, not from the web server clock.

### 1. Stable Coach policy

The server-side policy defines:

- Authority of Training Intelligence data
- Provisional-week handling
- Completed-week anchoring
- Safety priorities
- Missing-data behavior
- Response structure
- Markdown formatting expectations

### 2. Fresh authoritative training context

The application fetches the current context from:

```text
GET /internal/coach/context/current
```

The request is server-to-server and includes:

```text
X-Internal-Token: <server-side token>
```

The model-facing context may include:

- Current date and as-of metadata
- Week progress
- Current provisional Weekly Audit
- Latest completed Weekly Audit
- Weekly Load history
- Weekly TID history
- Recent training days and rides
- Zone exposure
- Fitness, Fatigue, and Form
- Sleep and recovery history
- Weight-related trends or flags
- Strength and prehab information
- Weekly commentary
- Injury flags
- Risk notes
- Athlete narrative
- Coverage indicators
- Missing subjective context

The complete context is fetched again for each real Coach turn so that newly entered information can affect the next answer immediately.

### 3. Bounded recent conversation

The application includes both sides of recent conversation history:

- Previous user questions
- Previous Coach answers

Current V1 bounds:

- Maximum 24 prior messages
- Maximum 24,000 characters across those messages
- Most recent messages are preferred
- Messages are kept in chronological order
- The new current question is always included separately

Activities and health measurements must be matched by their explicit dates rather than inferred from array position. The current repository evidence does not formally guarantee ordering for `recent_days` or `recovery_history`, so the temporal reference does not claim newest-first or oldest-first ordering; explicit dates remain authoritative.

Twelve prior messages usually represent about six question/answer exchanges, but long Coach answers may reach the character limit sooner.

Example model-facing conversation:

```text
Recent conversation:
User: How did I do last week?
Assistant: Last week was a high-load week...

User: The nurse said I can remove the stitches in 10 days.
Assistant: Follow the nurse's instructions...

Current question:
User: When can I start riding again?
```

Older messages remain stored and visible locally even after they fall outside the active model-history window.

### 4. Current question

The current message is added after the authoritative context and recent conversation.

---

## What Goes Back and Forth on Each Turn

### Request to provider

```text
Configured model
+ Coach policy
+ Fresh Training Intelligence context
+ Recent user questions
+ Recent Coach answers
+ Current user question
+ Server-controlled reasoning and output limits
```

### Response from provider

The adapter normalizes provider output into an application-level response containing:

- Assistant text
- Provider
- Model
- Provider response ID
- Input tokens
- Cached input tokens
- Output tokens
- Reasoning tokens
- Total tokens
- Elapsed time
- Completion status

The raw provider object is not exposed to the browser or stored as an opaque payload.

---

## Conversation State and Provider Memory

### Current V1 model

AI Coach manages conversation state locally.

```text
PostgreSQL owns durable history
training-web selects recent history
training-web sends bounded history with each request
OpenAI generates one response
training-web stores the result locally
```

The current implementation does not depend on provider-managed conversation state such as:

- OpenAI Conversations
- `previous_response_id`
- Provider-managed personal memory
- Provider-hosted long-term chat history

This design improves:

- Provider portability
- Deletion control
- Data ownership
- Debuggability
- Reproducibility
- Local usage accounting

### Important distinction

The model does not carry personal memory from one independent request to another. Continuity exists because Training Intelligence stores the conversation and resends a bounded recent portion.

Provider operational retention is a separate privacy topic from conversation state. Data sharing for model improvement should remain disabled for this application.

### Implemented privacy setting

The OpenAI adapter explicitly uses stateless response storage for normal Responses API calls:

```python
store=False
```

This disables provider-managed application response storage. It does not promise zero provider retention; operational, abuse-monitoring, security, or legally required retention may still apply under the provider's policies and terms.

The application does not use `previous_response_id`, the Conversations API, or equivalent provider-owned conversation state. PostgreSQL remains the durable owner of Coach sessions and messages, and `training-web` resends bounded local history on each turn.

## Follow-up response behavior

The stable policy in `coach_policy.py` distinguishes an initial question from a follow-up using the presence or absence of recent local conversation history.

- An initial question should receive the full requested assessment and response structure.
- A follow-up should acknowledge new information and focus on what changed in the recommendation.
- Follow-ups should avoid repeating unchanged assessments, metrics, restrictions, and warning signs.
- Active injury restrictions, clinician guidance, urgent safety information, and facts essential to the immediate recommendation must remain in the answer.
- The Coach may ask one concise follow-up question when missing subjective information could materially change the recommendation.

Temporal grounding is also required for follow-ups: the Coach resolves today, yesterday, and tomorrow from the supplied temporal reference, states relevant calendar dates when sequence matters, and acknowledges uncertainty when temporal metadata conflicts or is insufficient.

---

## Provider-Neutral AI Contract

The application-level request includes concepts such as:

```python
AIRequest(
    model=model,
    instructions=coach_policy,
    input_text=model_input,
    max_output_tokens=1200,
    timeout_seconds=60,
    reasoning_effort="low",
)
```

The application-level response includes:

```python
AIResponse(
    text=assistant_text,
    provider=provider_name,
    model=model_name,
    provider_response_id=response_id,
    input_tokens=input_tokens,
    cached_input_tokens=cached_tokens,
    output_tokens=output_tokens,
    reasoning_tokens=reasoning_tokens,
    total_tokens=total_tokens,
    elapsed_ms=elapsed_ms,
    finish_status=finish_status,
)
```

Provider SDK types must not escape the provider adapter.

---

## OpenAI Integration

### Current implementation

- Provider: OpenAI
- API: Responses API
- Model: `gpt-5.6-luna`
- Reasoning effort for real coaching: `low`
- Reasoning effort for diagnostic connectivity: `none`
- Maximum output tokens: 1,200
- Provider timeout: 60 seconds
- SDK retries: zero initially
- Service tier: Standard/default processing

### Environment configuration

The runtime configuration is provided to `training-web` through the server environment file referenced by Docker Compose.

```env
TRAINING_AI_PROVIDER=openai
TRAINING_AI_MODEL=gpt-5.6-luna
OPENAI_API_KEY=<secret>
TRAINING_API_BASE_URL=http://training-api:8090
TRAINING_API_TOKEN=<secret>
```

Secrets must not be committed to source control or printed in logs.

### Dependency

The official OpenAI Python SDK is pinned in `requirements.txt`.

---

## Context Client

The context client:

- Reads `TRAINING_API_BASE_URL`
- Reads `TRAINING_API_TOKEN`
- Sends `X-Internal-Token`
- Uses a 15-second timeout
- Requires HTTP 200
- Requires a JSON object
- Validates required top-level context sections
- Differentiates authentication, timeout, invalid-response, and unavailable-service failures
- Does not log the context payload
- Does not persist the full context in Coach tables

The context JSON is serialized deterministically before provider inference.

Current maximum serialized authoritative context size:

```text
120,000 characters
```

If the authoritative context exceeds this limit, the request fails before the paid provider call rather than silently dropping arbitrary sections.

---

## Coaching Policy

The V1 Coach policy requires responses with this general shape:

```markdown
## Summary

- Three to five concise actionable bullets

## This week

Interpretation of current and completed-week facts.

## What to do next

Ordered actions when sequence matters.

## Risk

Only when a material safety, injury, recovery, or overreaching concern exists.
```

Formatting rules:

- Use bold sparingly for decisions, durations, intensity targets, restrictions, and thresholds.
- Use bullets for independent actions.
- Use numbered lists only when order matters.
- Keep paragraphs short.
- Do not use raw HTML.
- Avoid tables unless genuinely necessary.

Behavioral rules:

- Never replace authoritative metrics.
- Treat partial-week audits as provisional.
- Treat missing values as unknown.
- Ask one concise follow-up only when needed.
- Prioritize safety and consistency.
- Avoid diagnosis.
- Avoid presenting Load ratios as deterministic injury predictions.
- Never mention raw JSON, database tables, provider details, or internal APIs.

---

## Turn Lifecycle and Failure Handling

### Successful turn

```text
started
  -> provider call succeeds
  -> assistant message inserted
  -> usage and cost recorded
  -> completed
```

### Context failure

Possible sanitized categories include:

- `context_timeout`
- `context_auth_error`
- `context_invalid_response`
- `context_unavailable`
- `context_too_large`

### Provider failure

Possible sanitized categories include:

- `provider_timeout`
- `provider_rate_limited`
- `provider_authentication_failed`
- `provider_configuration`
- `provider_failed`

### Guardrail failure

Possible categories include:

- `provider_concurrency_limit`
- `budget_limit`
- `budget_unavailable`

Handled failures transition the turn out of `started` so the session is not permanently blocked.

No raw provider exception body is returned to the browser.

---

## Cost, Token, and Concurrency Controls

### Current limits

```text
Maximum active turn per session: 1
Maximum simultaneous provider calls per web process: 2
Maximum provider timeout: 60 seconds
Maximum Coach output tokens: 250-8,000, configured value defaults to 1,200
Maximum theoretical cost per turn: $0.01-$1.00, configured value defaults to $0.25
Monthly application recorded-cost ceiling: $0.00-$25.00, configured value defaults to $5.00
```

The persisted settings singleton is read before every paid turn. The server also
validates `reasoning_effort` as `none`, `low`, `medium`, or `high`. A monthly
limit of `$0.00` deliberately blocks all paid turns. Missing, malformed, or
unavailable settings fail closed before provider creation and reconcile the
started turn as `settings_unavailable`; there is no silent runtime fallback.

The trusted-network API is:

```text
GET /api/settings/ai-coach
PUT /api/settings/ai-coach
```

The Settings browser tab is implemented as a dedicated `AI Coach` tab. It
loads the PostgreSQL-backed singleton through the API, keeps a local draft only
while editing, and never writes authoritative Coach settings to localStorage.
Save and Cancel are local UI actions around the server-backed baseline; saving
does not require a service restart and settings management makes no provider
call.

### Custom Instructions

The backend provides protected routes for the complete seven-section profile:

```text
GET /api/settings/ai-coach/custom-instructions
PUT /api/settings/ai-coach/custom-instructions
```

Each field is normalized by converting CRLF/CR to LF and trimming surrounding
whitespace before validation. Every field is limited to 1,500 normalized
characters, with an 8,000-character combined limit. Blank fields are valid; a
PUT must provide all seven fields and unknown fields are rejected.

Nonblank sections compile deterministically in this order: Coaching priorities,
Safety and progression rules, Training approach, Recovery and adjustment rules,
Communication style, Planning preferences, and Other instructions. The
compiled profile is preceded by a server-controlled wrapper stating that it
cannot override safety policy, clinician guidance, authoritative Training
Intelligence, privacy controls, or missing-data semantics. An entirely blank
profile compiles to no additional instructions, preserving existing Coach
behavior.

The compiled profile is included in provider instructions on every paid turn
and in preflight cost accounting exactly once. Loading and saving make no
provider call. Missing, malformed, oversized, or unavailable persistence fails
closed before provider inference and reconciles the started turn as
`custom_instructions_unavailable`.

The Settings editor keeps a module-local clean baseline and draft, supports
Save, Cancel, and Retry, prevents duplicate loads and saves, retains drafts
after save failures, and never writes Custom Instructions to localStorage. The
blank seeded profile loads as seven empty textareas. The returned `updated_at`
is shown as local readable metadata. Persisted `updated_at` must be a real
database date/datetime object; arbitrary stored strings fail closed. Durable
Memories remain pending.

### Pricing behavior

The application maintains a server-side pricing map for approved models.

For the configured Luna model, cost calculation separates:

- Uncached input tokens
- Cached input tokens
- Output tokens

Decimal arithmetic is used.

Unknown model pricing fails closed before a paid request. The application does not silently assume that an unknown model costs the same as Luna.

### Monthly budget behavior

Before provider inference:

```text
Recorded completed-turn cost
+ conservative proposed-turn cost
<= monthly application limit
```

Completed turns with unknown cost make budget status unavailable and prevent additional paid requests until reviewed.

The application budget is a product guard, not an atomic provider billing reservation. The prepaid provider balance with auto-reload disabled remains the external financial backstop.

Budget rejections are presented distinctly. A `$0.00` monthly limit reports
that AI Coach is paused and points to Settings > AI Coach. A reached or
exceeded monthly limit reports that the monthly budget has been reached. A
per-turn estimate above its configured cap asks for a higher limit or shorter
response. Accounting, unknown-pricing, malformed-cost, and database failures
remain a generic unavailable error. All rejected cases make no provider call
and expose no spend totals, secrets, SQL, or internal exception details.

### Observed V1 performance

Representative grounded Coach turns used approximately:

```text
Input tokens: about 32,000
Output tokens: about 600-700
Latency: about 8-10 seconds
Estimated cost: about $0.007 per turn
```

These values are observations, not guaranteed service levels.

---

## Coach Web UI

### Current V1 features

- Coach is the first navigation tab
- Desktop two-panel workspace
- Mobile session drawer
- New chat creation
- Existing session history
- Newest-first session sorting
- Today / Previous 7 Days / Older grouping
- Persistent selected session
- Rich Coach response formatting
- Distinct Risk presentation
- Message composer
- Enter to send
- Shift+Enter for newline
- Staged loading presentation
- Duplicate-submission prevention
- Failure reconciliation
- Copy response
- Session-level usage panel
- Per-response model, latency, token, and cost metadata
- Automatic first-question titles
- Inline editable titles

### Session titles

New sessions start as:

```text
New coaching session
```

The first persisted user question creates a deterministic bounded title without another AI call.

Users may rename sessions manually. A manual title is not overwritten by later automatic behavior.

### Safe response rendering

The current renderer builds DOM nodes rather than inserting model output as raw HTML. HTTP and HTTPS links are allowlisted.

A future V2 hardening item is to replace the custom bounded Markdown renderer with a maintained, locally bundled Markdown parser and sanitizer if the project adopts a suitable frontend dependency strategy.

---

## Security and Privacy

### Current posture

- OpenAI key is server-side only
- Training API token is server-side only
- Browser cannot choose provider, model, reasoning effort, timeout, or output limit
- Prompt and full context are not logged by the application
- Raw provider objects are not persisted
- Provider data sharing for model improvement remains disabled
- Application is currently restricted to the trusted local network
- Auto-reload for provider billing is disabled

### Important retention distinction

No-training treatment does not necessarily mean zero operational retention. Provider abuse-monitoring or legally required retention may still apply.

### Before broader exposure

Add:

- User authentication
- Session ownership and authorization
- Shared rate limiting across workers
- Diagnostic endpoint disabled by default
- Stronger secret-management approach if deployment expands
- Cross-site request protections appropriate to the final authentication model
- Audit logging that excludes sensitive prompt and response bodies

---

## AI Coach V2 Roadmap

V2 should be driven by observed use rather than feature volume.

### V2.1 Conversation compaction and durable memory

Problem:

Older messages eventually fall outside the 12-message / 12,000-character active-history window.

Goal:

Preserve important decisions and durable facts without resending the entire conversation.

Possible design:

```text
Recent conversation messages
+ session summary through message N
+ selected durable athlete facts
+ fresh authoritative training context
```

Requirements:

- Summary stored locally
- Summary versioned
- Source-message boundary recorded
- Original messages retained
- No silent loss of injury or clinician guidance
- Summary generation cost tracked
- Manual correction possible

### V2.2 Context optimization and observability

Add measurement by context section:

- Characters or tokens contributed by each section
- Repeated versus changed context
- Conversation-history size
- Policy size
- Output size

Goals:

- Reduce redundant context safely
- Improve prompt-cache eligibility
- Preserve risk-sensitive details
- Avoid optimizing solely for token count

### V2.3 Additional controls

The Settings > AI Coach tab now edits the bounded persisted settings. Future
work may add additional read-only operational status where a verified safe
backend route exists. Browser users must remain subject to the same server
ceilings and must not receive provider credentials or deployment configuration.

### V2.4 Provider comparison

Add a Gemini adapter only after the provider-neutral contract remains stable through real use.

Evaluation should compare providers on:

- Factual grounding
- Safety
- Recommendation stability
- Specificity
- Conciseness
- Latency
- Cost
- Handling of partial weeks
- Handling of injury and missing data

Provider names should be hidden during human quality scoring where practical.

### V2.5 Deep-review mode

Keep Luna as the routine Coach model. Consider a stronger model only for explicit high-complexity tasks such as:

- Multi-week periodization
- Season review
- Conflicting recovery and performance signals
- Major travel or injury planning
- Detailed plan tradeoff analysis

Deep review must have:

- Clear user intent
- Separate cost ceiling
- Visible model/cost disclosure
- No accidental default activation

### V2.6 Plan recommendations and writes

Future Coach changes to a training plan should use a reviewable proposal flow:

```text
Coach recommendation
-> structured proposed changes
-> human review
-> explicit Apply action
-> audited plan update
```

The Coach must not silently rewrite Plan data.

### V2.7 Feedback and evaluation framework

Capture explicit local feedback without opting provider traffic into model training.

Potential signals:

- Useful / not useful
- Too conservative / appropriate / too aggressive
- Factually correct / incorrect
- Followed recommendation / did not follow
- Outcome note

Use this to build a repeatable local evaluation set.

### V2.8 Authentication and multi-user readiness

Before access expands beyond the trusted LAN:

- Authenticate users
- Associate sessions with an owner
- Enforce ownership on every session route
- Separate budgets by user or household if needed
- Replace process-local concurrency control with a shared mechanism when running multiple workers

### V2.9 Maintained Markdown pipeline

Adopt a maintained local Markdown parser and sanitizer when the frontend has an approved dependency strategy.

Requirements:

- Raw HTML disabled
- Sanitizer allowlist
- No CDN dependency
- Safe links
- No remote images by default
- Risk-section transformation preserved
- Plain-text fallback

### V2.10 Streaming and background turns

Streaming is not required while responses complete in approximately 8-10 seconds.

Consider streaming or background execution only if:

- Typical latency increases materially
- Stronger models are introduced
- Tool-driven workflows make requests long-running

Any background-turn design must preserve durable turn state and prevent duplicate paid calls.

---

## Testing Strategy

### Current unit and focused tests

Tests should continue to use:

- Fake provider
- Fake context client
- Synthetic context
- Mocked persistence where appropriate
- No paid provider calls
- No production database calls

Critical coverage areas:

- Turn start and completion
- Stuck-turn prevention
- Context failures
- Provider timeout and failure
- Reasoning translation
- Cost calculation
- Unknown-price rejection
- Monthly budget rejection
- Concurrency behavior
- Session-detail metadata
- Message reconciliation
- Repeated identical messages
- Title generation and rename protection

### Manual integration tests

A manual real-provider smoke test should verify:

1. Create a fresh session.
2. Submit a grounded training question.
3. Confirm HTTP 200.
4. Confirm persisted user and assistant messages.
5. Confirm completed turn.
6. Confirm provider/model.
7. Confirm token and cost values.
8. Confirm title generation.
9. Add an injury/risk note.
10. Ask the question again in a new session.
11. Confirm risk information changes the recommendation.
12. Continue the same session and confirm bounded conversational continuity.

Do not make real-provider calls part of the normal unit-test suite.

---

## Operational Runbook

### Recreate after environment changes

```bash
cd /opt/training/web
docker compose up -d --force-recreate training-web
```

### Rebuild after dependency changes

```bash
cd /opt/training/web
docker compose up -d --build --force-recreate training-web
```

### Verify AI configuration without printing secrets

```bash
docker exec training-web python -c 'import os; print("Provider:", os.getenv("TRAINING_AI_PROVIDER") or "missing"); print("Model:", os.getenv("TRAINING_AI_MODEL") or "missing"); print("OpenAI key:", "configured" if os.getenv("OPENAI_API_KEY") else "missing")'
```

### Verify Training API configuration safely

```bash
docker exec training-web python -c 'import os; print("Training API:", os.getenv("TRAINING_API_BASE_URL") or "missing"); print("Training API token:", "configured" if os.getenv("TRAINING_API_TOKEN") else "missing")'
```

### Verify context retrieval without an AI call

```bash
docker exec -i training-web python - <<'PY'
from context_client import fetch_current_context

context = fetch_current_context()
print("Context fetch: success")
print("Current date:", context["as_of"]["current_date"])
print("Recent days:", len(context["recent_days"]))
print("Weekly load rows:", len(context["weekly_load_history"]))
PY
```

### Check application logs

```bash
docker logs --tail 100 training-web
```

Do not print the complete process environment or secret-bearing `.env` files.

---

## API Summary

### Sessions

```text
POST  /api/coach/sessions
GET   /api/coach/sessions
GET   /api/coach/sessions/{session_id}
PATCH /api/coach/sessions/{session_id}
```

### Coaching

```text
POST /api/coach/sessions/{session_id}/respond
```

### Usage

```text
GET /api/coach/sessions/{session_id}/usage
```

Provider connectivity is exercised only through the normal budget-controlled
Coach response path.

---

## Known Limitations

- Full authoritative context is resent on every real Coach request.
- Recent conversation is bounded and older details can fall out of active context.
- No automated session compaction is active yet.
- Cost limits are application-level accounting controls, not provider billing reservations.
- Concurrency control is process-local.
- The custom Markdown renderer is intentionally limited.
- Authentication is not ready for untrusted external exposure.
- Session titles are deterministic excerpts, not AI-generated summaries.
- The Coach does not write directly into the training Plan.
- The Coach provides training guidance, not medical diagnosis.

---

## V1 Completion Criteria

AI Coach V1 is considered complete because it can:

- Receive a Coach question in the web UI
- Persist the user question
- Fetch current Training Intelligence context
- Include bounded recent user and assistant messages
- Call the configured model through a provider-neutral adapter
- Persist the answer
- Track tokens, latency, model, provider, and estimated cost
- Handle failures without leaving a stuck active turn
- Respond differently when injury/risk context changes
- Continue a conversation
- Restore sessions after refresh
- Display readable Markdown and Risk treatment
- Generate and edit session titles
- Enforce initial cost and concurrency limits

---

## Recommended Next Step

Use V1 for real coaching conversations before adding major features.

Capture observations in four categories:

1. **Accuracy**: Did the Coach use the data correctly?
2. **Safety**: Did the Coach prioritize injury, sleep, and recovery appropriately?
3. **Actionability**: Did the Coach provide a clear next step?
4. **Efficiency**: Was the answer worth the latency and token cost?

V2 work should begin with conversation compaction, context observability, and an evaluation set derived from real usage.
