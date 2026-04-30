# ULTRAREVIEW - Snapflow Codebase Verification

> Drop this file at the root of the Snapflow repo as `ULTRAREVIEW.md`.
> Run it from Claude Code with: `claude "Run ULTRAREVIEW"` or reference it in your task.

---

## Purpose

This document instructs Codex to perform a **deep, structured code review** of the Snapflow codebase - with a focus on catching real bugs, regressions, and silent failures before they reach production. It is not a style guide. Every finding must be actionable.

---

## Scope

| Layer | Included |
|---|---|
| Services V3 | ✅ Full review |
| API routes & controllers | ✅ Full review |
| Data models & migrations | ✅ Full review |
| Background jobs / queues | ✅ Full review |
| Auth & permissions | ✅ Full review |
| Frontend (if colocated) | ✅ Surface-level review |
| Tests | ✅ Coverage gaps flagged |
| Config / env handling | ✅ Full review |
| Third-party integrations | ✅ Error handling only |

---

## How to Run

```bash
# From the repo root - runs full Ultrareview
claude "Follow ULTRAREVIEW.md and audit the full codebase. Output a findings report."

# Scope to a single module
claude "Follow ULTRAREVIEW.md, scope to src/services/v3 only."

# Re-run after a fix
claude "Re-run the ULTRAREVIEW check for the bug at [file:line] and confirm it is resolved."
```

---

## Review Methodology

Codex must complete **all six passes** in order. Do not skip a pass even if earlier passes find many issues.

### Pass 1 - Static Triage

Scan the full file tree. Build a mental map of:

- Entry points (API gateway, CLI, workers)
- Service boundaries in `services/v3`
- Shared utilities and their consumers
- Environment config loading path

Flag immediately:

- Dead files (no imports, no references in the last 90 days of git log)
- Circular dependencies
- Files that shadow each other across directories

### Pass 2 - Logic & Control Flow

Read each service and controller for logic bugs. Check:

- **Off-by-one errors** in pagination, slicing, loop bounds
- **Incorrect operator precedence** (`&&` vs `||`, bitwise vs logical)
- **Unreachable branches** - conditions that can never be true given upstream guards
- **Early returns that swallow state** - function exits before flushing a queue, closing a cursor, or emitting an event
- **Mutation of shared objects** inside loops or callbacks
- **Async/await mistakes**: missing `await`, fire-and-forget promises that should be awaited, unhandled rejections
- **Race conditions**: two async paths writing to the same resource without locking

### Pass 3 - Data & Persistence

For every database query, ORM call, and migration:

- **N+1 queries** - loops that issue one query per item instead of a batch
- **Missing transactions** - multi-step writes that can leave the DB in a partial state
- **Unsafe raw queries** - string interpolation into SQL/NoSQL queries (injection risk)
- **Migration safety** - column renames or drops without a backfill, nullable columns added without defaults
- **Soft-delete gaps** - queries that forget to filter `deleted_at IS NULL`
- **Timestamp drift** - mixing `Date.now()`, `new Date()`, and DB-side `NOW()` in the same flow

### Pass 4 - Auth, Permissions & Trust Boundaries

- **Missing auth middleware** on any route that touches user or tenant data
- **IDOR (Insecure Direct Object Reference)** - fetching a resource by ID without verifying it belongs to the requesting user/tenant
- **Over-permissive service tokens** - internal services that accept any caller without validation
- **Secrets in code** - hardcoded API keys, tokens, or passwords anywhere outside `.env.example`
- **JWT/session issues** - missing expiry checks, algorithm confusion (`none` alg), or tokens not invalidated on logout
- **Input not validated at the boundary** - payloads accepted and passed downstream without schema validation

### Pass 5 - Error Handling & Observability

- **Swallowed errors** - `catch` blocks that log nothing and return silently
- **Overly broad catches** - catching `Error` where only a specific subtype was intended
- **Missing error propagation** - a service method fails but the caller sees a success response
- **No retry / fallback** on external calls (HTTP, queues, caches) that can transiently fail
- **Unstructured log output** - `console.log(err)` instead of structured logger with context
- **Missing correlation IDs** - requests that can't be traced end-to-end across services

### Pass 6 - Tests & Coverage Gaps

- List every file in `services/v3` that has **no corresponding test file**
- Flag tests that only assert the happy path with no edge cases
- Flag mocks that are too broad (mocking an entire module instead of just the external call)
- Flag tests that don't clean up state (polluting other tests)
- Flag any test that has `TODO`, `skip`, or `xit` that is not tracked in an issue

---

## Findings Format

Every finding must follow this format exactly:

```text
### [SEVERITY] Short title

**File:** `path/to/file.ts` (line N)
**Pass:** Pass 2 - Logic & Control Flow
**Category:** Race condition

**What is wrong:**
Plain-English description of the bug. No jargon without explanation.

**Why it matters:**
What breaks in production. Data loss? Wrong response? Security hole?

**Reproduction path (if known):**
1. Call endpoint X with payload Y
2. Trigger condition Z simultaneously
3. Observe result

**Suggested fix:**
Concrete code change or approach. Do not be vague.
```

**Severity levels:**

| Level | Meaning |
|---|---|
| `CRITICAL` | Data loss, security breach, or service outage possible |
| `HIGH` | Silent data corruption, auth bypass, or frequent crash |
| `MEDIUM` | Wrong behavior in specific conditions, performance cliff |
| `LOW` | Code smell with low-probability impact |
| `INFO` | Observation with no immediate impact (coverage gap, dead code) |

---

## Report Structure

Output the final report in this order:

```text
# Ultrareview Report - Snapflow
Date: <today>
Passes completed: 1-6
Files reviewed: N
Findings: X critical, Y high, Z medium, W low, V info

---

## Summary
Two-paragraph plain-English summary of the overall codebase health.
Call out the riskiest area first.

---

## Critical Findings
[findings]

## High Findings
[findings]

## Medium Findings
[findings]

## Low Findings
[findings]

## Info / Coverage Gaps
[findings]

---

## Recommended Fix Order
Numbered list - highest risk first.
1. Fix [CRITICAL] X in file Y - blocks safe operation
2. Fix [HIGH] A in file B - risk of data corruption
...
```

---

## Snapflow-Specific Context

- Services V3 lives in `src/services/v3/` - this is the primary review target
- Services communicate over internal HTTP or a message queue (confirm actual transport before Pass 2)
- Each service is expected to be independently deployable - flag anything that creates tight coupling
- Tenant isolation is a hard requirement - any cross-tenant data leak is `CRITICAL`
- Background jobs must be idempotent - flag any job that would produce duplicate effects if retried

---

## What Codex Must NOT Do

- Do not auto-fix bugs. Report only. Fixes are applied after human review.
- Do not skip a pass because the codebase is large. Narrow the scope if needed, but complete all six passes within scope.
- Do not rate a finding as `LOW` to avoid discomfort. Rate it by actual impact.
- Do not report style issues (formatting, naming) unless they directly cause a bug.
- Do not hallucinate file paths. Only reference files you have actually read.

---

## Quick-Reference Checklist

```text
Pass 1 - Static Triage          [ ] Dead files  [ ] Circular deps  [ ] Shadowed files
Pass 2 - Logic & Control Flow   [ ] Off-by-one  [ ] Async bugs     [ ] Race conditions
Pass 3 - Data & Persistence     [ ] N+1         [ ] Transactions   [ ] Injection
Pass 4 - Auth & Trust           [ ] Missing auth  [ ] IDOR  [ ] Secrets in code
Pass 5 - Error Handling         [ ] Swallowed errors  [ ] Missing retry  [ ] No trace IDs
Pass 6 - Tests                  [ ] Untested files  [ ] Happy-path only  [ ] Skipped tests
```

---

*ULTRAREVIEW v1.0 - Snapflow / Ahmed*