# HomeCompass Phase 5: Security and Account Synchronization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Protect paid AI interpretation, add safe readiness/rate-limit behavior, merge guest browser state into accounts idempotently, and roll back failed optimistic account mutations.

**Architecture:** Keep authentication in the existing Supabase dependency chain and add a narrow AI-specific rate limiter. Implement guest merge as a validated, ownership-scoped service with a unique sync event. The workspace provider submits a single explicit snapshot after sign-in and treats account operations as state machines with rollback.

**Tech Stack:** FastAPI dependencies, Supabase bearer validation, asyncpg/PostgreSQL, in-process rate limiting for the current deployment boundary, React/Fetch, pytest, and Vitest/RTL.

**Spec:** docs/superpowers/specs/2026-10-20-homecompass-improvement-roadmap-design.md

## Global Constraints

- Paid AI interpretation must require a valid authenticated active user in production and remain bounded by monthly budget reservation.
- Rate-limit failures must be safe and must not reveal provider secrets or account data.
- Guest synchronization is idempotent, ownership-safe, conflict-reporting, and must not silently overwrite account values.
- Failed optimistic shortlist/reorder mutations roll back to the last confirmed state.
- Readiness responses expose component states only, never credentials or provider tokens.
- Lab 3, Lab 4, Lab 5, course reports, diagrams, generated artifacts, and course packaging are out of scope and must not be modified, staged, committed, or pushed.
- No push is authorized by this plan.

## Review Focus

- An unauthenticated AI request: the API returns 401 before spending budget or contacting Gemini.
- Repeated AI requests from one client: the rate limiter returns a safe 429 while valid requests still work after the window.
- The same guest sync key is retried: the second call returns the recorded result without duplicating history, shortlist entries, or places.
- Guest and account profiles conflict: the response reports the conflict and retains the account value unless replacement is confirmed.
- Shortlist save/reorder fails after an optimistic update: the UI restores the prior order/selection and offers a retryable notice.

---

### Task 1: Protect AI interpretation and add bounded rate limiting

**Files:**
- Create: backend/app/rate_limit.py
- Modify: backend/app/security.py
- Modify: backend/app/main.py
- Modify: backend/tests/test_api_contract.py
- Create: backend/tests/test_rate_limit.py

**Interfaces:**
- RateLimiter.check(key, now=None) raises a safe 429 response after the
  configured per-window request count.
- require_active_user remains the ownership dependency for protected routes.
- POST /api/v1/ai/interpret requires require_active_user and applies the
  limiter before interpret_query.

- [ ] **Step 1: Write failing security tests**

Test that AI interpretation without a bearer token returns 401, with
unconfigured auth returns 503 after authentication is attempted, and does not
call interpret_query. Test valid authenticated calls pass the dependency.
Test RateLimiter accepts the configured number of calls, rejects the next
call with a Retry-After value, and expires entries after the window.

- [ ] **Step 2: Run focused tests**

Run:

    cd backend && pytest tests/test_api_contract.py tests/test_rate_limit.py -q

Expected: the current unauthenticated AI route fails the new 401 assertion and
rate_limit.py does not exist.

- [ ] **Step 3: Implement the bounded limiter**

Use monotonic time and a bounded per-key dictionary. Key by authenticated user
ID when available and by sanitized client address for pre-auth checks only.
Keep the limit and window configurable through non-secret environment values,
with conservative defaults. Do not include tokens in logs.

- [ ] **Step 4: Protect the AI route**

Add require_active_user to /api/v1/ai/interpret and invoke the limiter before
interpret_query. Preserve the existing AI monthly reservation and provider
error semantics. Update tests that previously expected a database 503 for an
unauthenticated request to expect the auth boundary.

- [ ] **Step 5: Run focused AI/security tests**

Run:

    cd backend && pytest tests/test_api_contract.py tests/test_rate_limit.py tests/test_ai.py -q

Expected: all focused tests pass.

- [ ] **Step 6: Commit the AI boundary**

Stage only backend/app/rate_limit.py, backend/app/security.py,
backend/app/main.py, and the listed tests. Verify paths, then commit:

    git commit -m "fix: protect paid AI interpretation"

### Task 2: Add readiness checks without secret leakage

**Files:**
- Create: backend/app/readiness.py
- Modify: backend/app/main.py
- Create: backend/tests/test_readiness.py

**Interfaces:**
- readiness_snapshot() returns application, database, migrations, sourceData,
  auth, and ai states plus a boolean ready.
- GET /ready returns 200 when required components are ready and 503 otherwise.
- GET /health remains a lightweight non-secret diagnostic.

- [ ] **Step 1: Write failing readiness tests**

Test configured/unconfigured database, auth, AI, and migration states. Assert
that no response key/value contains DATABASE_URL, access tokens, API keys, or
full connection strings. Test the 200/503 route status behavior.

- [ ] **Step 2: Run focused readiness tests**

Run:

    cd backend && pytest tests/test_readiness.py -q

Expected: FAIL because readiness.py and /ready do not exist.

- [ ] **Step 3: Implement readiness_snapshot**

Report only categorical states and safe counts. Determine migration readiness
from the checked-in application migration set and the database’s applied
migration marker/inspection hook; do not echo SQL connection details.

- [ ] **Step 4: Add /ready and run tests**

Run:

    cd backend && pytest tests/test_readiness.py tests/test_api_contract.py -q

Expected: all readiness tests pass.

- [ ] **Step 5: Commit readiness**

Stage only backend/app/readiness.py, backend/app/main.py, and the two tests.
Verify paths, then commit:

    git commit -m "feat: add safe application readiness checks"

### Task 3: Add an idempotent guest-to-account merge

**Files:**
- Create: database/migrations/006_account_sync.sql
- Create: backend/app/sync.py
- Modify: backend/app/schemas.py
- Modify: backend/app/main.py
- Create: backend/tests/test_sync.py

**Interfaces:**
- GuestSyncRequest contains sync_key, optional brief, shortlistHomeIds,
  compareHomeIds, bounded history entries, optional places, and
  confirmPlaces.
- merge_guest_data(connection, user, request) returns accepted, skipped,
  conflicts, and syncKey.
- POST /api/v1/sync/guest requires require_active_user and is idempotent by
  user plus sync_key.

- [ ] **Step 1: Write failing merge/schema tests**

Test validation bounds and unknown fields. Test a first merge unions valid
candidate-home shortlist IDs, limits compare IDs to three, imports bounded
history, and rejects nonexistent homes. Test profile conflict behavior,
place confirmation behavior, and repeated sync key behavior.

- [ ] **Step 2: Run focused sync tests**

Run:

    cd backend && pytest tests/test_sync.py -q

Expected: FAIL because the table, schema, service, and endpoint do not exist.

- [ ] **Step 3: Add migration 006**

Create account_sync_event with user_id, sync_key, result JSONB, created_at, and
a unique constraint on (user_id, sync_key). Keep the migration additive and
do not modify earlier migrations.

- [ ] **Step 4: Implement validated merge service**

Validate home IDs against candidate_home, preserve account profile values
unless the request includes explicit replacement confirmation, union shortlist
entries by stable home ID, deduplicate imported history by normalized
criteria/mode/source snapshot set, and accept personal places only when
confirmPlaces is true. Record the full safe result under the unique sync key
inside one transaction.

- [ ] **Step 5: Add the protected endpoint**

Call the merge service under require_active_user. On a repeated key, return
the stored result without repeating writes. Never return another user’s
shortlist, history, or place data.

- [ ] **Step 6: Run focused backend tests**

Run:

    cd backend && pytest tests/test_sync.py tests/test_schemas.py -q

Expected: all merge and validation tests pass.

- [ ] **Step 7: Commit guest sync**

Stage only database/migrations/006_account_sync.sql,
backend/app/sync.py, backend/app/schemas.py, backend/app/main.py, and
backend/tests/test_sync.py. Verify paths, then commit:

    git commit -m "feat: merge guest workspace data safely"

### Task 4: Add frontend sign-in merge and rollback semantics

**Files:**
- Create: frontend/test/account-sync.test.jsx
- Modify: frontend/components/workspace-provider.jsx
- Modify: frontend/app/(workspace)/shortlist/page.jsx
- Modify: frontend/app/(workspace)/account/page.jsx

**Interfaces:**
- Workspace context exposes syncState with local, syncing, synced, and error
  statuses plus syncGuestData().
- toggleShortlist and move retain a confirmed snapshot and restore it when
  the account mutation fails.
- Account/profile load triggers one idempotent sync using a generated stable
  browser sync key; personal-place upload requires explicit user confirmation.

- [ ] **Step 1: Write failing frontend state tests**

Test sign-in merge payload construction, conflict/result notice handling,
shortlist save rollback, shortlist remove rollback, reorder rollback, and
retry behavior. Assert that a failed authenticated request does not leave the
browser state claiming it is synced.

- [ ] **Step 2: Run focused frontend tests**

Run:

    npm --workspace frontend run test -- --run frontend/test/account-sync.test.jsx

Expected: FAIL because the provider has no sync state and optimistic
operations currently do not roll back.

- [ ] **Step 3: Implement provider sync state**

Capture the local brief, shortlist, compare selection, and local history
snapshot before account hydration. Submit it once after a valid session is
available. Keep the sync key in localStorage, show accepted/skipped/conflict
counts, and clear only successfully merged local entries.

- [ ] **Step 4: Implement rollbackable shortlist operations**

For toggleShortlist and shortlist reorder, snapshot the previous IDs, apply
the optimistic state, and restore the snapshot on non-2xx, expired-session,
or network failure. Use the existing notice mechanism with a retryable
message; do not imply account persistence when only local state changed.

- [ ] **Step 5: Add explicit place-upload confirmation**

In Account, show the local/account merge status and ask before sending local
personal places. Do not automatically upload an address or coordinate merely
because the user signed in.

- [ ] **Step 6: Run frontend tests and build**

Run:

    npm --workspace frontend run test -- --run
    npm run build

Expected: all frontend tests pass and the build succeeds.

- [ ] **Step 7: Commit frontend sync behavior**

Stage only the listed frontend files and test. Verify paths, then commit:

    git commit -m "fix: make account sync and shortlist mutations recoverable"

### Task 5: Phase 5 acceptance verification

**Files:**
- No source changes unless a preceding test exposes a Phase 5 defect.

- [ ] **Step 1: Run all backend tests**

Run:

    cd backend && pytest -q

Expected: all backend tests pass.

- [ ] **Step 2: Run all frontend tests and build**

Run:

    npm --workspace frontend run test -- --run
    npm run build

Expected: all frontend tests pass and the build succeeds.

- [ ] **Step 3: Inspect security and migration boundaries**

Verify AI calls require authentication, rate limiting is tested, readiness
does not leak secrets, migration 006 is additive, sync writes are owned and
idempotent, and no Lab path appears in staged commits.

- [ ] **Step 4: Record the phase gate**

Do not begin Phase 6 until AI protection, readiness, merge conflicts,
idempotency, and optimistic rollback are all verified.
