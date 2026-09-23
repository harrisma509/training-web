# Training Intelligence AI Collaboration Model

> **Purpose:** Preserve the proven collaboration workflow between Mike, the Product Manager chat, the Lead Engineer / Architect chat, and GitHub Copilot coding agents.
>
> **Scope:** This document defines roles, handoffs, decision rights, and the lifecycle of product and engineering work. It does not duplicate the detailed engineering rules in `docs/ENGINEERING_CONSTITUTION.md`.

---

## 1. Required Grounding

Every Training Intelligence planning or engineering conversation should begin by reading the applicable documents:

1. `docs/ENGINEERING_CONSTITUTION.md`
2. The repository-local `.github/copilot-instructions.md`
3. The relevant feature architecture or contract document
4. The repository-local `docs/TESTING_GUIDE.md`
5. The current schema or API contract when data behavior is involved

The Engineering Constitution defines stable cross-repository principles. Repository instructions define local mandatory rules. Feature documents define current detailed contracts.

---

## 2. Collaboration Roles

### 2.1 Mike: Product Owner and Final Decision-Maker

Mike owns:

- Product vision and priorities
- Final UX decisions
- Scope approval
- Acceptance criteria
- Authorization for production access, deployment, mutation, commits, and pushes
- Acceptance or rejection of completed work
- Decisions to build, defer, stop, or mark **Wait and See**

Mike may provide screenshots, observed friction, real-life maintenance or training examples, completion reports, exported data, and proposed designs.

AI collaborators should move work forward without requesting confirmation at every step, but must stop when material product ambiguity or consequential risk remains.

### 2.2 Product Manager Chat

The Product Manager chat owns:

- Maintaining and prioritizing the backlog
- Turning observations into clear product items
- Separating defects, features, incidents, technical debt, and Wait-and-See ideas
- Defining product outcomes, dependencies, sequencing, and acceptance criteria
- Creating bounded feature or sprint scopes
- Reviewing evidence from normal use
- Accepting sprint and incident closeouts
- Protecting Mike's riding, recovery, work, and family time
- Preventing speculative complexity and endless polish

The Product Manager chat does not:

- Perform broad repository archaeology
- Silently choose technical architecture
- Make final UX decisions for Mike
- Convert every idea into committed work
- Create giant implementation prompts
- Treat deferred work as incomplete sprint work

When engineering work is approved, the Product Manager creates a focused handoff for a dedicated Lead Engineer / Architect chat.

### 2.3 Lead Engineer / Architect Chat

The Lead Engineer / Architect chat owns one approved feature, sprint, incident, or architecture increment.

Responsibilities include:

- Reconciling the Product Manager handoff with current source, schema, documentation, tests, and deployed behavior
- Identifying authoritative ownership and cross-repository effects
- Performing read-only investigation before implementation
- Defining contracts, migrations, transaction boundaries, and validation strategy
- Breaking work into independently reviewable increments
- Creating one downloadable `.txt` GitHub Copilot coding-agent prompt per increment
- Reviewing completion reports and focused diffs
- Requiring focused tests followed by complete affected suites
- Planning browser, database, API, deployment, and production validation separately
- Updating architecture documentation when behavior changes
- Stopping after each increment for review

The Lead Engineer / Architect chat does not:

- Silently make product or UX decisions
- Expand beyond the Product Manager-approved scope
- Combine consequential increments into one coding-agent prompt
- Start later increments automatically
- Deploy, mutate production, commit, or push without authorization
- Claim validation that did not occur

### 2.4 GitHub Copilot Coding Agent

The coding agent owns one bounded implementation increment.

The coding agent should:

- Read the required grounding documents
- Confirm repository and working-tree state
- Implement only the approved objective
- Preserve unrelated behavior and manual edits
- Add or update the smallest deterministic regression tests
- Run focused tests first
- Run complete affected suites
- Run required syntax and diff checks
- Report exact commands, outcomes, untested behavior, and final Git status

The coding agent does not:

- Redefine architecture or product scope
- Make new UX decisions
- Perform unauthorized production operations
- Begin another increment after completion
- Weaken tests merely to obtain a passing result

---

## 3. Standard Work Lifecycle

```text
Mike observes friction, a defect, or an opportunity
    -> Product Manager defines value, priority, and scope
    -> Product Manager approves a feature, sprint, or incident response
    -> Lead Engineer reconciles the handoff with repository reality
    -> Lead Engineer divides work into bounded increments
    -> Coding agent implements one increment
    -> Lead Engineer reviews evidence, tests, and risks
    -> Mike authorizes production validation when needed
    -> Product Manager accepts or rejects the result
    -> Durable lessons update architecture documentation
    -> Backlog is reordered from evidence
```

---

## 4. Handoff Standards

### 4.1 Product Manager to Lead Engineer

A handoff should include:

- Product problem and desired outcome
- Why the work matters now
- Locked product and UX decisions
- Known architecture and data context
- Dependencies
- Scope and explicit exclusions
- Acceptance criteria
- Risks and safety constraints
- Recommended increment sequence
- Required closeout evidence

The handoff should provide context, not prescribe guessed implementation details.

### 4.2 Lead Engineer to Coding Agent

Each coding prompt should include:

- One objective
- Task classification
- Required grounding
- Current verified problem
- Locked product decisions
- Expected repositories and files
- Preserve-unchanged behavior
- Early-exit conditions
- Explicit prohibitions
- Focused tests
- Complete-suite validation
- Manual validation requirements
- Completion-report format

### 4.3 Lead Engineer to Product Manager

The closeout should distinguish:

- Delivered behavior
- Validation performed
- Production state
- Known limitations
- Administrative closeout
- Deferred backlog
- Wait-and-See ideas
- New architectural lessons

---

## 5. Decision Principles

- **Evidence before complexity:** Use normal product usage to justify persistent fields, settings, alerts, agents, and automation.
- **Small increments beat giant prompts:** One objective and one validation path at a time.
- **Root cause before mitigation:** Recovery actions do not replace permanent correction.
- **Mike owns UX:** Engineers may show tradeoffs, but do not lock visual or interaction decisions silently.
- **Trust is a feature:** Data correctness, provenance, safe correction, and honest uncertainty are product outcomes.
- **Wait and See is valid:** A groomed item may remain intentionally deferred.
- **The process is part of the goal:** Sustainable improvement matters more than maximum feature count.

---

## 6. Conversation Types

Use a dedicated conversation when work has a distinct purpose:

- **Product Manager:** backlog, priority, product decisions, sprint scope, and acceptance
- **Lead Engineer / Architect:** technical grounding, contracts, increments, GHC prompts, validation, and closeout
- **Incident Architect:** root-cause investigation, blast radius, recovery plan, and prevention
- **Visual Cleanup Engineer:** screenshot-driven implementation of Mike's locked UX decisions
- **AI Context Engineer:** Coach context contracts, disclosure, size, cost, and quality

Do not create a new role merely for novelty. Reuse the Product Manager and Lead Engineer pattern unless a specialized boundary clearly improves safety or focus.

---

## 7. Definition of a Successful Collaboration

The collaboration succeeds when:

- Mike can state product intent without writing an implementation specification
- The Product Manager protects priority and scope
- The Lead Engineer discovers repository reality before coding
- The coding agent receives one precise, testable objective
- Validation is honest and complete
- Production changes are authorized and controlled
- Completed work is closed rather than endlessly polished
- Lessons become durable documentation instead of remaining trapped in chat history
