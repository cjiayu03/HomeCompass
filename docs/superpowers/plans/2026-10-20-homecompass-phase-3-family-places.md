# HomeCompass Phase 3: Family Places and Commute Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Let families save typed personal places, select verified OneMap address candidates, and use explicit place-distance constraints in search without overstating straight-line distance as commute time.

**Architecture:** Extend the existing personal_place table and API rather than creating a parallel location system. Put OneMap address lookup behind a small backend adapter with strict Singapore-coordinate validation. Search receives user-owned place constraints and calculates PostGIS distances; the frontend exposes place management and selection from the account and filter flows.

**Tech Stack:** FastAPI/Pydantic, asyncpg/PostGIS, OneMap HTTP API, React/Next.js, Fetch, Vitest/RTL, and pytest.

**Spec:** docs/superpowers/specs/2026-10-20-homecompass-improvement-roadmap-design.md

## Global Constraints

- Historical HDB transaction records must remain visibly historical and must never be presented as current listings.
- Place coordinates must carry provider/provenance metadata; an address lookup must not trust arbitrary browser-supplied upstream URLs.
- Straight-line distance must be labelled as an estimate; it must not be called commute time or transit time.
- A place constraint may use only a place owned by the authenticated user.
- Lab 3, Lab 4, Lab 5, course reports, diagrams, generated artifacts, and course packaging are out of scope and must not be modified, staged, committed, or pushed.
- No push is authorized by this plan.

## Review Focus

- OneMap returns ambiguous or duplicate candidates: the user must choose explicitly and no coordinate is stored before selection.
- OneMap returns coordinates outside Singapore or malformed fields: the adapter rejects them.
- A user submits another account’s place ID: the search must reject or ignore it without leaking the place.
- A home or place lacks geometry: the result remains visible where appropriate and the distance is unavailable, never zero.
- A straight-line measurement is shown: the UI labels its method and does not call it commute time.

---

### Task 1: Extend place and search schemas with provenance and constraints

**Files:**
- Create: database/migrations/005_family_places.sql
- Modify: backend/app/schemas.py
- Modify: backend/tests/test_schemas.py
- Create: backend/tests/test_family_places.py

**Interfaces:**
- PlaceKind is one of workplace, school, childcare, elder-care, or other.
- PersonalPlaceRequest accepts kind, label, address, latitude, longitude,
  maximum_distance_m, geocode_source, and geocoded_at.
- PlaceConstraint accepts place_id and max_distance_m.
- SearchRequest accepts place_constraints with a maximum of 10 entries.

- [ ] **Step 1: Write failing schema tests**

Test valid and invalid place kinds, coordinate bounds, distance bounds,
geocode source values, duplicate place constraints, maximum constraint count,
and missing labels. Test that a search request with no place constraints
retains current defaults.

- [ ] **Step 2: Run focused schema tests**

Run:

    cd backend && pytest tests/test_schemas.py tests/test_family_places.py -q

Expected: FAIL because the new models and migration do not exist.

- [ ] **Step 3: Add migration 005**

Add kind with default other and a check constraint, geocode_source,
geocoded_at, and an index supporting user/kind lookup. Preserve existing
rows and make the migration additive. Do not modify migrations 001–004.

- [ ] **Step 4: Implement Pydantic place models**

Add PlaceKind, PlaceConstraint, PlaceSuggestionRequest, and the new
PersonalPlaceRequest fields. Validate finite coordinates, enforce the
Singapore-provider values used by the adapter, and reject duplicate place IDs
in one search request.

- [ ] **Step 5: Run focused schema tests**

Run:

    cd backend && pytest tests/test_schemas.py tests/test_family_places.py -q

Expected: all schema tests pass.

- [ ] **Step 6: Commit the schema/migration change**

Stage only database/migrations/005_family_places.sql,
backend/app/schemas.py, backend/tests/test_schemas.py, and
backend/tests/test_family_places.py. Verify the staged paths, then commit:

    git commit -m "feat: add typed family places and constraints"

### Task 2: Add the server-side OneMap candidate adapter

**Files:**
- Create: backend/app/onemap.py
- Create: backend/tests/test_onemap_api.py
- Modify: backend/app/sources/onemap_geocode.py only if shared validation is extracted

**Interfaces:**
- search_address_candidates(query, token, client) returns validated candidate
  dictionaries with address, latitude, longitude, and provider identifier.
- The adapter uses the fixed OneMap search endpoint, caps pages at 3, and
  rejects non-Singapore or malformed coordinates.

- [ ] **Step 1: Write failing adapter tests**

Mock the HTTP client and test:

- a valid candidate is normalized;
- malformed JSON is rejected;
- a 401/403 response becomes a safe provider error;
- a 429/5xx response uses bounded retry behavior;
- candidates outside Singapore are discarded;
- the token never appears in an exception or returned payload;
- only the fixed OneMap host/path is used.

- [ ] **Step 2: Run focused adapter tests**

Run:

    cd backend && pytest tests/test_onemap_api.py -q

Expected: FAIL because backend/app/onemap.py does not exist.

- [ ] **Step 3: Implement the adapter**

Keep provider URL and retry limits in the backend module. Return only fields
needed for selection. If common Singapore-coordinate or query-normalization
logic is extracted from backend/app/sources/onemap_geocode.py, preserve the
batch geocoder’s current behavior and run its existing tests.

- [ ] **Step 4: Run adapter and source tests**

Run:

    cd backend && pytest tests/test_onemap_api.py tests/test_sources.py -q

Expected: all adapter and existing batch-source tests pass.

- [ ] **Step 5: Commit the adapter**

Stage only backend/app/onemap.py, backend/tests/test_onemap_api.py, and any
explicitly extracted shared source code. Verify paths, then commit:

    git commit -m "feat: add bounded OneMap address lookup"

### Task 3: Expose owned places and apply PostGIS place constraints

**Files:**
- Modify: backend/app/main.py
- Modify: backend/app/schemas.py if route response models need aliases
- Modify: backend/tests/test_family_places.py
- Create: backend/tests/test_place_search.py

**Interfaces:**
- GET /api/v1/places returns kind, geocodeSource, geocodedAt, and
  maximumDistanceM.
- GET /api/v1/places/suggest?q=... requires an active user and returns
  provider-labelled candidates.
- POST /api/v1/places stores only the selected candidate metadata.
- POST /api/v1/search applies all submitted owned place constraints and
  returns per-home placeDistances with method straight-line.

- [ ] **Step 1: Write failing route/query tests**

Test unauthenticated suggestion access, valid candidate response, place
ownership filtering, creation/serialization of new fields, and search with:

- one owned place within range;
- one owned place outside range;
- two constraints where both must pass;
- a foreign place ID;
- a home with null geometry.

- [ ] **Step 2: Run focused backend tests**

Run:

    cd backend && pytest tests/test_family_places.py tests/test_place_search.py -q

Expected: FAIL because the endpoints and SQL constraints do not exist.

- [ ] **Step 3: Implement place suggestion and persistence routes**

Add the suggestion route using require_active_user and the OneMap adapter.
Add kind and provenance to the existing GET/POST place routes. Validate that
the create request corresponds to a selected provider candidate or an
explicitly labelled manual source; never log the access token.

- [ ] **Step 4: Add ownership-safe PostGIS filtering**

Extend the search query with a parameterized subquery for place_constraints.
Resolve submitted IDs through the current user’s personal_place rows, reject
unknown/foreign IDs with a safe 422 or 404 response, and require every
selected constraint to pass. Add a JSON aggregation for per-home distances.
Use ST_Distance on geography and label the result straight-line.

- [ ] **Step 5: Run focused and regression backend tests**

Run:

    cd backend && pytest tests/test_family_places.py tests/test_place_search.py tests/test_api_contract.py tests/test_sources.py -q

Expected: all tests pass and historical home output remains unchanged except
for additive place-distance metadata.

- [ ] **Step 6: Commit the places API**

Stage only backend/app/main.py, backend/app/schemas.py if changed, and the
listed tests. Verify the staged path list, then commit:

    git commit -m "feat: search by owned family places"

### Task 4: Add place management and filter selection UI

**Files:**
- Create: frontend/components/place-manager.jsx
- Create: frontend/components/place-picker.jsx
- Create: frontend/test/place-manager.test.jsx
- Modify: frontend/components/workspace-provider.jsx
- Modify: frontend/app/(workspace)/account/page.jsx
- Modify: frontend/app/(workspace)/explore/page.jsx

**Interfaces:**
- Workspace context exposes places, placeState, refreshPlaces,
  suggestPlaces(query), createPlace(candidate), and deletePlace(id).
- Brief stores selected place constraints as serializable IDs and distances.
- PlacePicker displays provider/method labels and does not submit arbitrary
  coordinates without an explicit selection.

- [ ] **Step 1: Write failing UI tests**

Test candidate loading, ambiguous candidate selection, creation success,
delete success, provider error, signed-out state, and selected constraint
serialization. Assert that straight-line labels are visible wherever a
place distance is shown.

- [ ] **Step 2: Run the focused frontend test**

Run:

    npm --workspace frontend run test -- --run frontend/test/place-manager.test.jsx

Expected: FAIL because the manager/picker components and provider methods do
not exist.

- [ ] **Step 3: Implement provider place methods**

Use requestJson and the authenticated session for all place routes. Keep
places account-owned; local brief state may retain selected IDs, but a failed
server load must not invent a local place record.

- [ ] **Step 4: Implement manager and picker**

Add typed place creation to Account and candidate selection to the Explore
filter dialog. Keep the existing primary-place fields compatible while
making the saved place the source of truth when selected. Show address,
kind, source, timestamp, maximum distance, and straight-line wording.

- [ ] **Step 5: Send place constraints with searches**

Update applySearch to include selected place constraints. Display returned
placeDistances in HomeCard/detail/compare without calling them commute times.

- [ ] **Step 6: Run frontend tests and build**

Run:

    npm --workspace frontend run test -- --run
    npm run build

Expected: all frontend tests pass and the build succeeds.

- [ ] **Step 7: Commit the places UI**

Stage only the listed frontend files and tests. Verify paths, then commit:

    git commit -m "feat: add family place management and constraints"

### Task 5: Phase 3 acceptance verification

**Files:**
- No source changes unless a preceding test exposes a Phase 3 defect.

- [ ] **Step 1: Run backend tests**

Run:

    cd backend && pytest -q

Expected: all tests pass.

- [ ] **Step 2: Run frontend tests and build**

Run:

    npm --workspace frontend run test -- --run
    npm run build

Expected: all frontend tests pass and the build succeeds.

- [ ] **Step 3: Inspect migration and path safety**

Confirm migration 005 is additive, no Lab path is staged, and all new place
queries include user ownership checks.

- [ ] **Step 4: Record the phase gate**

Do not begin Phase 4 until place suggestions, ownership, PostGIS filtering,
provenance labels, and missing-geometry behavior are verified.
