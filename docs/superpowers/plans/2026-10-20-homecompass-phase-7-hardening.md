# HomeCompass Phase 7: Hardening and Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make the completed HomeCompass flow repeatably verifiable with migration checks, frontend accessibility coverage, a browser smoke path, and one documented test/build gate.

**Architecture:** Keep migration inspection in a small backend module used by readiness and tests. Use Vitest plus jest-axe for deterministic component accessibility checks and Playwright with mocked API routes for a dependency-light core browser flow. The smoke path verifies the user-visible contract without requiring production credentials or live government providers.

**Tech Stack:** FastAPI, PostgreSQL migration files, pytest, Next.js, Vitest/jsdom, jest-axe, Playwright, and React Testing Library.

**Spec:** docs/superpowers/specs/2026-10-20-homecompass-improvement-roadmap-design.md

## Global Constraints

- Historical HDB transaction records must remain visibly historical and must never be presented as current listings.
- Verification must fail clearly on missing migrations, broken frontend build, inaccessible stateful UI, or a core-flow regression.
- Browser smoke tests may mock provider/API responses but must not weaken production authentication or source semantics.
- No test may require credentials to be committed or printed.
- Lab 3, Lab 4, Lab 5, course reports, diagrams, generated artifacts, and course packaging are out of scope and must not be modified, staged, committed, or pushed.
- No push is authorized by this plan.

## Review Focus

- A migration file is renamed, duplicated, or skipped: readiness/tests fail with the missing or non-sequential version.
- A loading/error/empty state is rendered: it has correct alert/status semantics and an actionable accessible name.
- The browser flow receives a provider failure: it shows a retry/error state and does not display fixture homes as a false success.
- The production build uses an unsupported browser-only API during SSR: the build or smoke test fails before completion.
- The final staged path list includes a Lab deliverable: the final verification gate must stop before commit.

---

### Task 1: Add migration/version inspection

**Files:**
- Create: backend/app/migrations.py
- Modify: backend/app/readiness.py
- Create: backend/tests/test_migrations.py
- Modify: backend/tests/test_readiness.py

**Interfaces:**
- checked_in_migrations() returns ordered migration version/name pairs.
- validate_migration_set(names) raises a safe error for duplicate, missing, or
  non-sequential application migrations.
- migration_status(connection) returns applied/latest/ready categories without
  exposing connection details.

- [ ] **Step 1: Write failing migration tests**

Test ordered 001–007 discovery, duplicate/missing versions, an unexpected
filename, and readiness behavior when applied migration state is behind the
checked-in set. Test that error messages contain filenames/versions but no
DATABASE_URL or credentials.

- [ ] **Step 2: Run focused tests**

Run:

    cd backend && pytest tests/test_migrations.py tests/test_readiness.py -q

Expected: FAIL because migrations.py does not exist and readiness has no
database migration status.

- [ ] **Step 3: Implement migration inspection**

Read only database/migrations/*.sql, parse the leading numeric version,
require a contiguous sequence starting at 001, and expose safe status data.
Use the database’s migration marker if one exists; otherwise provide a
documented inspection hook that the deployment runner can bind to rather than
pretending all migrations are applied.

- [ ] **Step 4: Integrate readiness and run tests**

Run:

    cd backend && pytest tests/test_migrations.py tests/test_readiness.py -q

Expected: all migration/readiness tests pass.

- [ ] **Step 5: Commit migration verification**

Stage only backend/app/migrations.py, backend/app/readiness.py, and the two
tests. Verify paths, then commit:

    git commit -m "test: verify application migration readiness"

### Task 2: Add accessibility assertions for stateful UI

**Files:**
- Create: frontend/test/accessibility.test.jsx
- Modify: frontend/package.json
- Modify: package-lock.json
- Modify: frontend/components/data-status.jsx if an assertion exposes an issue
- Modify: frontend/components/score-breakdown.jsx if an assertion exposes an issue
- Modify: frontend/components/place-manager.jsx if an assertion exposes an issue

**Interfaces:**
- New stateful components have accessible labels, status/alert semantics,
  keyboard-operable controls, and no axe violations in the tested states.

- [ ] **Step 1: Add accessibility test dependency and failing tests**

Add jest-axe to frontend dev dependencies. Test loading, error with retry,
empty, score breakdown, and place-manager candidate-selection states using
React Testing Library and axe.

- [ ] **Step 2: Run focused accessibility tests**

Run:

    npm --workspace frontend run test -- --run frontend/test/accessibility.test.jsx

Expected: FAIL until the dependency/configuration and any required labels are
present.

- [ ] **Step 3: Fix only the accessibility defects found**

Add stable labels, keyboard semantics, live-region roles, and focus-safe
retry/selection behavior. Do not hide status text from assistive technology
to make tests pass.

- [ ] **Step 4: Run all frontend tests**

Run:

    npm --workspace frontend run test -- --run

Expected: all unit/integration/accessibility tests pass.

- [ ] **Step 5: Commit accessibility hardening**

Stage only frontend/package.json, package-lock.json, the accessibility test,
and explicitly listed component fixes. Verify paths, then commit:

    git commit -m "test: cover accessible workspace states"

### Task 3: Add a mocked browser smoke flow

**Files:**
- Create: frontend/playwright.config.js
- Create: frontend/e2e/core-flow.spec.js
- Modify: frontend/package.json
- Modify: package-lock.json

**Interfaces:**
- npm run test:e2e runs the Playwright core flow.
- The smoke flow covers landing/workspace, search, source-dated results,
  shortlist, compare, and a provider/API failure state.

- [ ] **Step 1: Add Playwright and write the failing smoke test**

Add @playwright/test and a test that starts the local frontend, intercepts
application API calls with explicit historical home/resource/source payloads,
searches a town, saves a home, selects two homes, opens comparison, and
simulates a failed search. Assert historical labels, score/evidence state,
and the visible retry/error state. Do not mock away the browser UI behavior.

- [ ] **Step 2: Configure the smoke runner**

Configure a local Next dev server through the existing frontend command,
reuse the repository’s base URL convention, and keep credentials out of the
test. Add test:e2e to frontend/package.json. Allow a CI environment to
provide an already-running base URL without changing the test contract.

- [ ] **Step 3: Run the focused smoke test**

Run:

    npm --workspace frontend run test:e2e

Expected: initially FAIL if the browser flow or scripts are not wired.

- [ ] **Step 4: Fix smoke-path regressions**

Fix only application behavior exposed by the smoke test: missing accessible
names, broken route transitions, incorrect source copy, or failure-state
fallback. Never make the test pass by enabling implicit fixtures.

- [ ] **Step 5: Run smoke and production build**

Run:

    npm --workspace frontend run test:e2e
    npm run build

Expected: smoke test and build pass.

- [ ] **Step 6: Commit browser verification**

Stage only frontend/playwright.config.js,
frontend/e2e/core-flow.spec.js, frontend/package.json, and package-lock.json.
Verify paths, then commit:

    git commit -m "test: add HomeCompass browser smoke flow"

### Task 4: Add one repeatable private verification command

**Files:**
- Modify: frontend/package.json
- Modify: package.json
- Create: backend/tests/test_verification_contract.py
- Modify: docs/superpowers/plans/2026-10-20-homecompass-improvement-roadmap.md only if final commands change

**Interfaces:**
- npm run verify:frontend runs frontend unit/accessibility tests and build.
- npm run verify:backend runs the backend pytest suite.
- npm run verify runs both application suites without touching Lab scripts.

- [ ] **Step 1: Write failing command/contract checks**

Add a small backend contract test confirming the expected verification
commands and migration count are application-owned. Ensure the package scripts
do not invoke any path under lab3 or any course export script.

- [ ] **Step 2: Add scripts**

Add root scripts that invoke only the frontend test/build and backend pytest
commands. Add frontend test:e2e separately so the default verification remains
usable without browsers, while the final gate runs both.

- [ ] **Step 3: Run the repeatable verification**

Run:

    npm run verify:backend
    npm run verify:frontend
    npm --workspace frontend run test:e2e

Expected: all application tests/build/smoke checks pass.

- [ ] **Step 4: Commit verification scripts**

Stage only package.json, frontend/package.json, and
backend/tests/test_verification_contract.py. Verify paths, then commit:

    git commit -m "chore: add repeatable private app verification"

### Task 5: Final Phase 7 and roadmap verification

**Files:**
- No source changes unless a preceding test exposes a hardening defect.

- [ ] **Step 1: Run the complete backend gate**

Run:

    npm run verify:backend

Expected: all backend tests pass.

- [ ] **Step 2: Run the complete frontend gate**

Run:

    npm run verify:frontend
    npm --workspace frontend run test:e2e

Expected: all frontend tests, accessibility tests, production build, and
browser smoke checks pass.

- [ ] **Step 3: Review every application commit**

Run:

    git log --oneline --decorate --all -- backend frontend database/migrations docs/superpowers
    git status --short

Inspect each new commit’s path list. No Lab or course-deliverable path may
appear.

- [ ] **Step 4: Perform final verification-before-completion review**

Confirm the implementation satisfies all seven phase acceptance gates, the
historical-data boundary, the explicit-fixture rule, provenance/scoring
disclosure, ownership/rate limiting, and no-push requirement. Only then report
the work complete.
