# HomeCompass Phase 1: Trustworthy Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make live, fixture, empty, loading, stale, and failed search states explicit and prevent failed requests from replacing real data with fixture homes.

**Architecture:** Add one normalized frontend request helper and a small backend metadata helper. The workspace provider becomes the owner of abortable home/resource/source request state. Fixture data is selected only when an explicit environment mode is enabled; live failures retain the last successful data and expose a retryable error.

**Tech Stack:** Next.js/React, browser Fetch and AbortController, FastAPI/Pydantic, pytest, Vitest, jsdom, and React Testing Library.

**Spec:** docs/superpowers/specs/2026-10-20-homecompass-improvement-roadmap-design.md

## Global Constraints

- Historical HDB transaction records must remain visibly historical and must never be presented as current listings.
- Fixture homes are available only through an explicit fixture/demo mode and are never an implicit fallback for failed live requests.
- Result metadata uses dataMode values live, fixture, mixed, or error and includes source/freshness information when available.
- A failed request retains the previous successful result when safe and never silently converts an error into an empty success.
- Lab 3, Lab 4, Lab 5, course reports, diagrams, generated artifacts, and course packaging are out of scope and must not be modified, staged, committed, or pushed.
- No push is authorized by this plan.

## Review Focus

- Initial live API failure: homes remain empty, the UI shows an error and retry action, and fixture data is not installed.
- Search failure after a successful search: the previous homes remain visible with a stale/error state.
- Two overlapping requests: the later request wins even if the earlier response resolves last.
- Malformed JSON or non-2xx response: the client exposes a stable ApiError rather than returning an empty object.
- Explicit fixture mode: the UI labels fixture data and reset/search remain fixture-local.

---

### Task 1: Add the normalized request client and frontend test harness

**Files:**
- Create: frontend/lib/api-client.js
- Create: frontend/vitest.config.js
- Create: frontend/test/setup.js
- Create: frontend/test/api-client.test.js
- Modify: frontend/package.json
- Modify: package-lock.json

**Interfaces:**
- Produces requestJson(path, options) returning the parsed JSON payload.
- Produces ApiError with status, code, payload, and a user-safe message.
- Produces getApiBase() with the trailing slash removed.
- Uses an optional AbortSignal and passes all other FetchInit fields through.

- [ ] **Step 1: Add the frontend test command and test dependencies**

Add Vitest, jsdom, React Testing Library, jest-dom, and the Vite React plugin
as frontend development dependencies. Add the script
test: vitest run to frontend/package.json and update the root lockfile with
the package manager already used by the repository. Do not touch
lab3/application/package-lock.json.

- [ ] **Step 2: Write failing client tests**

In frontend/test/api-client.test.js, test that requestJson:

- returns JSON for a successful response;
- throws ApiError with the HTTP status and detail code for a structured
  non-2xx response;
- throws ApiError with a stable network code when Fetch rejects;
- throws ApiError with a malformed-payload code when the response is not JSON;
- forwards an AbortSignal.

- [ ] **Step 3: Run the focused frontend test**

Run:

    npm --workspace frontend run test -- --run frontend/test/api-client.test.js

Expected: the command initially fails because the helper and test harness do
not exist yet.

- [ ] **Step 4: Implement frontend/lib/api-client.js**

Implement getApiBase(), ApiError, and requestJson(path, options). Treat any
non-2xx status as an error; use detail.code when the API supplies it; never
return a synthetic empty result. Preserve AbortError identity so callers can
ignore intentional cancellation.

- [ ] **Step 5: Add Vitest configuration and setup**

Configure jsdom, the frontend path alias used by jsconfig.json, and the
frontend/test/setup.js jest-dom import. Keep the configuration scoped to
frontend tests and do not add a second package manager.

- [ ] **Step 6: Run the focused test again**

Run:

    npm --workspace frontend run test -- --run frontend/test/api-client.test.js

Expected: all client tests pass.

- [ ] **Step 7: Commit the isolated harness change**

Stage only frontend/package.json, package-lock.json,
frontend/vitest.config.js, frontend/test/setup.js, and
frontend/test/api-client.test.js. Verify the staged path list contains no
Lab path, then commit with:

    git commit -m "test: add frontend request client harness"

### Task 2: Add an explicit backend result metadata contract

**Files:**
- Create: backend/app/contracts.py
- Modify: backend/app/main.py
- Modify: backend/tests/test_api_contract.py

**Interfaces:**
- Produces live_result_metadata(source_summary, warnings, retrieved_at) with
  dataMode, retrievedAt, sourceSummary, and warnings keys.
- Keeps existing response keys such as items, count, sourceStatus,
  limitations, and unappliedCriteria for compatibility.

- [ ] **Step 1: Write failing metadata tests**

Add tests for live_result_metadata that assert:

- dataMode is live by default;
- retrievedAt is an ISO timestamp;
- sourceSummary is copied without mutation;
- warnings are always a list;
- a supplied retrieved timestamp is preserved.

Add an API contract assertion that /health remains unchanged while result
metadata uses the new field names.

- [ ] **Step 2: Run the focused backend tests**

Run:

    cd backend && pytest tests/test_api_contract.py -q

Expected: the new import/assertion fails because contracts.py and endpoint
metadata do not exist.

- [ ] **Step 3: Implement backend/app/contracts.py**

Define the data-mode literal and live_result_metadata. Normalize datetime
values to UTC ISO-8601 strings and copy list inputs so endpoint code cannot
mutate a caller-owned source summary.

- [ ] **Step 4: Attach metadata to result endpoints**

In backend/app/main.py, attach the helper output to /api/v1/homes,
/api/v1/search, and /api/v1/resources. Use the current retrieval time and
the latest source snapshot identifiers already available to each query.
Keep historical limitations in both the existing limitations key and the new
warnings key until all clients migrate.

- [ ] **Step 5: Run the focused backend tests**

Run:

    cd backend && pytest tests/test_api_contract.py -q

Expected: all API contract tests pass.

- [ ] **Step 6: Commit the backend contract change**

Stage only backend/app/contracts.py, backend/app/main.py, and
backend/tests/test_api_contract.py. Verify the staged path list, then commit:

    git commit -m "feat: expose live result metadata"

### Task 3: Make workspace data state explicit and abortable

**Files:**
- Modify: frontend/components/workspace-provider.jsx
- Modify: frontend/.env.example
- Create: frontend/test/workspace-provider.test.jsx
- Modify: frontend/test/setup.js if provider test cleanup needs it

**Interfaces:**
- Workspace context adds homeState, resourceState, sourceState, fixtureMode,
  retryHomes, and retryResources.
- Each state has status idle, loading, success, empty, or error; dataMode;
  retrievedAt; warnings; and error when applicable.
- Live provider initialization starts homes as an empty list, not fixtureHomes.

- [ ] **Step 1: Write failing provider tests**

Render WorkspaceProvider with a minimal probe component and a mocked
useAuth value. Test:

- live initialization success exposes API homes and live state;
- initial live failure leaves homes empty and exposes error state;
- a failed search after a previous success retains the previous homes;
- an older request resolving after a newer request cannot overwrite homes;
- fixture mode is enabled only when NEXT_PUBLIC_HOME_DATA_MODE=fixture and
  labels the state fixture.

- [ ] **Step 2: Run the focused provider tests**

Run:

    npm --workspace frontend run test -- --run frontend/test/workspace-provider.test.jsx

Expected: tests fail against the current implicit fixture fallback and
missing state fields.

- [ ] **Step 3: Implement explicit state and load functions**

Refactor workspace-provider.jsx so it:

- imports requestJson and ApiError;
- uses empty live initial data;
- reads NEXT_PUBLIC_HOME_DATA_MODE once as an explicit fixture switch;
- gives each request its own AbortController and cleanup;
- preserves previous data on refresh errors;
- stores structured state instead of silently ignoring Promise failures;
- exposes retryHomes and retryResources.

The source request may fail independently; its failure must not discard homes
or resources that loaded successfully.

- [ ] **Step 4: Remove implicit fixture fallback paths**

Change applySearch so API failure sets the error state and retains existing
homes. It may call filterHomes only when fixtureMode is true. Change
resetSearch so live mode reloads the default live query and fixture mode
restores the labelled fixture set. Do not flash copy that calls live data
fixtures or says a failed request was a successful reset.

- [ ] **Step 5: Add the explicit mode to frontend/.env.example**

Document NEXT_PUBLIC_HOME_DATA_MODE=live as the default and explain that
fixture is an explicit local UI-demo mode. Do not put credentials or tokens
in the example file.

- [ ] **Step 6: Run the focused provider tests**

Run:

    npm --workspace frontend run test -- --run frontend/test/workspace-provider.test.jsx

Expected: all state, fallback, and race tests pass.

- [ ] **Step 7: Commit the provider change**

Stage only frontend/components/workspace-provider.jsx,
frontend/.env.example, frontend/test/workspace-provider.test.jsx, and any
provider-test setup edit. Verify the staged path list, then commit:

    git commit -m "fix: keep live search failures out of fixture state"

### Task 4: Render state and provenance in the workspace

**Files:**
- Create: frontend/components/data-status.jsx
- Modify: frontend/app/(workspace)/explore/page.jsx
- Modify: frontend/components/map-panel.jsx
- Modify: frontend/app/(workspace)/sources/page.jsx
- Create: frontend/test/data-status.test.jsx

**Interfaces:**
- DataStatus renders loading, fixture/demo, stale/error, empty, and live
  source states with accessible status or alert roles.
- It accepts state and retry callbacks without owning Fetch or workspace data.

- [ ] **Step 1: Write failing component tests**

Test that DataStatus:

- labels fixture data as preview/demo;
- renders a retry button for error state;
- renders a distinct successful-empty message;
- includes source retrieval/freshness text when supplied;
- uses alert semantics for errors and status semantics for progress.

- [ ] **Step 2: Run the focused component test**

Run:

    npm --workspace frontend run test -- --run frontend/test/data-status.test.jsx

Expected: the component does not exist yet.

- [ ] **Step 3: Implement the presentational status component**

Keep copy explicit: historical source records are not current listings, and
fixture data is illustrative only. Keep the component independent of API
calls; retry comes from a callback.

- [ ] **Step 4: Integrate status into Explore, MapPanel, and Sources**

Show loading/error/source state without hiding existing good results during a
refresh. Preserve the existing source counts and historical warnings. Ensure
the empty live state is not described as a fixture set and the Reset button
does not imply data was restored when it was only retried.

- [ ] **Step 5: Run frontend tests and build**

Run:

    npm --workspace frontend run test -- --run
    npm run build

Expected: all frontend tests pass and the Next.js production build succeeds.

- [ ] **Step 6: Commit the workspace state UI**

Stage only the four application components and the new component test. Verify
the staged path list, then commit:

    git commit -m "feat: show source and search data states"

### Task 5: Phase 1 acceptance verification

**Files:**
- No source changes unless a preceding test exposes a Phase 1 defect.

- [ ] **Step 1: Run the complete current backend suite**

Run:

    cd backend && pytest -q

Expected: all existing and new backend tests pass.

- [ ] **Step 2: Run the complete frontend suite and production build**

Run:

    npm --workspace frontend run test -- --run
    npm run build

Expected: all frontend tests pass and the build succeeds.

- [ ] **Step 3: Inspect the allowed path boundary**

Run:

    git status --short
    git diff --name-only HEAD~4..HEAD

Expected: only application paths and Phase 1 documentation/tests appear in
the Phase 1 commits; existing Lab 3 changes remain unstaged and untouched.

- [ ] **Step 4: Record the phase gate**

Confirm the Phase 1 acceptance criteria from the master plan. Do not begin
Phase 2 until live failure, reset, fixture mode, request races, and source
status are all verified.
