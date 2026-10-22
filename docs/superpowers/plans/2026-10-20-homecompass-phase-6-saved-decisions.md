# HomeCompass Phase 6: Saved Decision Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Surface search history, saved searches, personal places, reruns, and evidence snapshots so families can revisit decisions without confusing old transaction data with live listings.

**Architecture:** Add a user-owned saved_search table that stores the normalized query/profile/place inputs and scoring policy version. Reuse the live search service for reruns, record fresh source metadata, and expose structured differences. The frontend provider loads these records and supplies account, Explore, shortlist, and compare surfaces.

**Tech Stack:** FastAPI/Pydantic, asyncpg/PostgreSQL, React/Next.js, Fetch, Vitest/RTL, and pytest.

**Spec:** docs/superpowers/specs/2026-10-20-homecompass-improvement-roadmap-design.md

## Global Constraints

- Historical HDB transaction records must remain visibly historical and must never be presented as current listings.
- A saved search stores criteria and evidence context, not a promise that an old transaction remains available.
- Reruns use current source metadata and disclose differences from the saved run.
- All saved-search/history/place data is scoped to the authenticated owner.
- Score policy version and source snapshot IDs remain attached to decisions.
- Lab 3, Lab 4, Lab 5, course reports, diagrams, generated artifacts, and course packaging are out of scope and must not be modified, staged, committed, or pushed.
- No push is authorized by this plan.

## Review Focus

- A saved search is rerun after source data changes: the UI shows new retrieval metadata and a result difference, not “updated listing” language.
- A deleted or foreign saved-search ID is requested: the API returns a safe ownership-scoped error.
- A saved search references a place that no longer exists: rerun reports the missing constraint and does not silently broaden the query.
- A comparison includes a low-coverage score or historical record: evidence and policy metadata remain visible.
- A user has no saved searches/history: the UI shows an explicit empty state rather than fixture content.

---

### Task 1: Add saved-search persistence and contracts

**Files:**
- Create: database/migrations/007_saved_searches.sql
- Modify: backend/app/schemas.py
- Create: backend/tests/test_saved_searches.py
- Modify: backend/tests/test_schemas.py

**Interfaces:**
- SavedSearchCreate accepts name, mode, normalized SearchRequest,
  priority_weights, place_constraints, and scoring_version.
- SavedSearchRecord includes id, name, criteria, places, score policy,
  createdAt, updatedAt, lastRunAt, lastSourceSnapshotIds, and lastResultMeta.
- All name/query/history collection sizes are bounded.

- [ ] **Step 1: Write failing schema/persistence tests**

Test valid saved-search creation, name length, criteria bounds, maximum
place/history sizes, policy-version length, and rejection of unknown fields.
Test migration SQL contains owner foreign key, timestamps, JSONB criteria,
and indexes for user/updated time.

- [ ] **Step 2: Run focused tests**

Run:

    cd backend && pytest tests/test_saved_searches.py tests/test_schemas.py -q

Expected: FAIL because migration 007 and the new schemas do not exist.

- [ ] **Step 3: Add migration 007**

Create saved_search with user_id cascading ownership, name, mode, criteria,
place_constraints, priority_weights, scoring_version, created/updated times,
last_run_at, last_source_snapshot_ids, and last_result_meta. Add a
user_id/updated_at index. Keep the migration additive.

- [ ] **Step 4: Implement Pydantic contracts**

Add SavedSearchCreate and response serialization helpers. Reuse the existing
SearchRequest and place-constraint validation rather than accepting arbitrary
JSON.

- [ ] **Step 5: Run focused tests**

Run:

    cd backend && pytest tests/test_saved_searches.py tests/test_schemas.py -q

Expected: all schema and migration contract tests pass.

- [ ] **Step 6: Commit saved-search persistence**

Stage only database/migrations/007_saved_searches.sql,
backend/app/schemas.py, backend/tests/test_saved_searches.py, and the schema
test. Verify paths, then commit:

    git commit -m "feat: persist user-owned saved searches"

### Task 2: Implement owner-scoped saved-search/history endpoints

**Files:**
- Create: backend/app/saved_searches.py
- Modify: backend/app/main.py
- Modify: backend/tests/test_saved_searches.py

**Interfaces:**
- GET /api/v1/saved-searches lists only the active user’s records.
- POST /api/v1/saved-searches creates a normalized record and captures
  current source/policy metadata.
- PATCH /api/v1/saved-searches/{id} renames a record.
- DELETE /api/v1/saved-searches/{id} removes only the owner’s record.
- POST /api/v1/saved-searches/{id}/run reruns current criteria and returns
  items, fresh metadata, prior metadata, and a structured difference.
- Existing GET /api/v1/history remains available and is linked to the UI.

- [ ] **Step 1: Write failing endpoint/service tests**

Test owner listing, create, rename, delete, foreign-ID isolation, malformed
criteria rejection, rerun with current metadata, and missing referenced-place
behavior. Test result difference fields for count, source snapshots, and
policy version.

- [ ] **Step 2: Run focused tests**

Run:

    cd backend && pytest tests/test_saved_searches.py -q

Expected: FAIL because the service/endpoints do not exist.

- [ ] **Step 3: Implement the saved-search service**

Normalize criteria through SearchRequest, store the policy/weight/place
snapshot, and use parameterized queries. For rerun, load the row under the
current user, validate every referenced place still exists for that user,
execute the same search function as POST /api/v1/search, and compute only
safe metadata differences.

- [ ] **Step 4: Add routes and update last-run metadata**

Add the five routes with require_active_user. Store last_run_at,
last_source_snapshot_ids, and last_result_meta after a successful rerun.
Do not store or return provider secrets or arbitrary upstream payloads.

- [ ] **Step 5: Run focused and regression tests**

Run:

    cd backend && pytest tests/test_saved_searches.py tests/test_api_contract.py -q

Expected: all saved-search and API tests pass.

- [ ] **Step 6: Commit saved-search APIs**

Stage only backend/app/saved_searches.py, backend/app/main.py, and the listed
tests. Verify paths, then commit:

    git commit -m "feat: add saved search and rerun APIs"

### Task 3: Load history, places, and saved searches in the workspace

**Files:**
- Create: frontend/components/saved-searches.jsx
- Create: frontend/test/saved-searches.test.jsx
- Modify: frontend/components/workspace-provider.jsx
- Modify: frontend/app/(workspace)/account/page.jsx
- Modify: frontend/app/(workspace)/explore/page.jsx

**Interfaces:**
- Workspace context exposes history, savedSearches, savedSearchState,
  saveSearch(name), renameSavedSearch(id, name), deleteSavedSearch(id), and
  rerunSavedSearch(id).
- Provider retains the result metadata needed to show prior/current
  differences.

- [ ] **Step 1: Write failing frontend tests**

Test loading empty/non-empty history, saving a normalized current search,
renaming/deleting, rerun success with changed source metadata, missing-place
error, and signed-out behavior.

- [ ] **Step 2: Run focused frontend tests**

Run:

    npm --workspace frontend run test -- --run frontend/test/saved-searches.test.jsx

Expected: FAIL because the provider methods and component do not exist.

- [ ] **Step 3: Implement provider methods**

Use authenticated requestJson calls and stable error states. After each live
search, preserve the criteria and score policy snapshot needed for save. A
rerun must replace current results only after a successful response.

- [ ] **Step 4: Implement the saved-search UI**

Add a Save search action to Explore and a history/saved-search section to
Account. Show created/last-run dates, source snapshot freshness, policy
version, result-count differences, and missing-place errors. Provide explicit
empty states with no fixture substitution.

- [ ] **Step 5: Run frontend tests and build**

Run:

    npm --workspace frontend run test -- --run
    npm run build

Expected: all frontend tests pass and the build succeeds.

- [ ] **Step 6: Commit saved decision UI**

Stage only the listed frontend files and test. Verify paths, then commit:

    git commit -m "feat: expose saved searches and search history"

### Task 4: Attach evidence context to compare and shortlist

**Files:**
- Create: frontend/components/evidence-context.jsx
- Create: frontend/test/evidence-context.test.jsx
- Modify: frontend/app/(workspace)/compare/page.jsx
- Modify: frontend/app/(workspace)/shortlist/page.jsx
- Modify: frontend/components/home-card.jsx

**Interfaces:**
- EvidenceContext renders source semantics, source date, geocode status,
  score policy, coverage, and missing evidence without inventing values.
- Shortlist/compare surfaces consume the same home metadata as Explore.

- [ ] **Step 1: Write failing evidence UI tests**

Test historical transaction labels, fixture labels, source dates, null-score
coverage, missing evidence, and geocode-pending copy. Assert that no component
calls a historical record a listing.

- [ ] **Step 2: Run the focused frontend test**

Run:

    npm --workspace frontend run test -- --run frontend/test/evidence-context.test.jsx

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement and integrate evidence context**

Create the compact component and place it in card/detail/compare surfaces.
Keep score breakdown and provenance adjacent enough that a user cannot
mistake a score for a current listing claim.

- [ ] **Step 4: Run frontend tests and build**

Run:

    npm --workspace frontend run test -- --run
    npm run build

Expected: all tests pass and the build succeeds.

- [ ] **Step 5: Commit evidence context**

Stage only the listed frontend components/tests. Verify paths, then commit:

    git commit -m "feat: keep evidence context in decisions"

### Task 5: Phase 6 acceptance verification

**Files:**
- No source changes unless a preceding test exposes a Phase 6 defect.

- [ ] **Step 1: Run all backend tests**

Run:

    cd backend && pytest -q

Expected: all backend tests pass.

- [ ] **Step 2: Run all frontend tests and build**

Run:

    npm --workspace frontend run test -- --run
    npm run build

Expected: all frontend tests pass and the build succeeds.

- [ ] **Step 3: Inspect owner and historical-data boundaries**

Verify migrations 005–007 are additive, all saved-search routes require
ownership, reruns do not broaden missing place constraints, and no Lab path
appears in staged commits.

- [ ] **Step 4: Record the phase gate**

Do not begin Phase 7 until history/saved searches, reruns, provenance,
policy-version context, and empty/error states are verified.
