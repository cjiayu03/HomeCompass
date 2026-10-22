# HomeCompass Phase 4: Map and Data Scale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Bound home/resource queries, make map loading viewport-aware, and keep dense layers usable through deterministic pagination and lightweight client-side clustering.

**Architecture:** Add one validated opaque cursor format and reuse the existing bounds validation for homes and resources. The workspace provider owns cancellable viewport requests. The map renders clustered point features from bounded results while the list uses the same deterministic API ordering and a load-more cursor.

**Tech Stack:** FastAPI/Pydantic, asyncpg/PostGIS, Python base64/json pagination helpers, React Leaflet map events, plain JavaScript geospatial grouping, Vitest/RTL, and pytest.

**Spec:** docs/superpowers/specs/2026-10-20-homecompass-improvement-roadmap-design.md

## Global Constraints

- Historical HDB transaction records must remain visibly historical and must never be presented as current listings.
- Every bounds and limit value is validated server-side and capped before SQL is built.
- Obsolete viewport requests are cancellable and must not overwrite newer map data.
- Map data is a bounded sample of current source snapshots and is labelled accordingly.
- Clustering may generalize display only; it must not alter the underlying list/search records.
- Lab 3, Lab 4, Lab 5, course reports, diagrams, generated artifacts, and course packaging are out of scope and must not be modified, staged, committed, or pushed.
- No push is authorized by this plan.

## Review Focus

- Bounds cross the antimeridian or have invalid ordering: the API returns a safe validation error rather than a broad query.
- limit is negative, zero, or above the cap: the API rejects or clamps according to the documented contract and never interpolates user input into SQL.
- An older viewport response resolves last: the newer viewport remains visible.
- Dense resources share a grid cell: the cluster shows count and representative location while source features remain available to the list/count metadata.
- An empty page with a non-null cursor: the UI stops loading and does not loop.

---

### Task 1: Add validated cursor and viewport primitives

**Files:**
- Create: backend/app/pagination.py
- Modify: backend/app/schemas.py
- Create: backend/tests/test_pagination.py
- Modify: backend/tests/test_schemas.py

**Interfaces:**
- encode_cursor(values) -> str returns a bounded base64url JSON cursor.
- decode_cursor(cursor) -> dict raises a safe validation exception for malformed
  or oversized cursors.
- BoundsRequest validates west, south, east, north in Singapore/world ranges.
- SearchRequest accepts bounds, limit default 50 max 200, and cursor.
- Resource query accepts limit default 500 max 2000 and cursor.

- [ ] **Step 1: Write failing pagination/schema tests**

Test round-trip cursor encoding, malformed base64/JSON, oversized payload,
missing keys, invalid bounds, zero/negative limits, and upper-bound limits.
Test that valid Singapore bounds and ordinary world bounds remain accepted.

- [ ] **Step 2: Run focused tests**

Run:

    cd backend && pytest tests/test_pagination.py tests/test_schemas.py -q

Expected: FAIL because pagination.py and the new fields do not exist.

- [ ] **Step 3: Implement bounded cursor helpers and schemas**

Use URL-safe base64 over compact JSON. The home cursor payload is
observed_on plus id; the resource cursor payload is resource_type, name, and
id. Enforce a short maximum encoded length and reject extra/unexpected
fields. Keep cursor values opaque to the frontend.

- [ ] **Step 4: Run focused tests**

Run:

    cd backend && pytest tests/test_pagination.py tests/test_schemas.py -q

Expected: all tests pass.

- [ ] **Step 5: Commit pagination primitives**

Stage only backend/app/pagination.py, backend/app/schemas.py, and the two test
files. Verify paths, then commit:

    git commit -m "feat: add bounded pagination and viewport validation"

### Task 2: Add bounded paginated home/resource API responses

**Files:**
- Modify: backend/app/main.py
- Create: backend/tests/test_pagination_api.py
- Modify: backend/tests/test_api_contract.py

**Interfaces:**
- GET /api/v1/homes and POST /api/v1/search accept bounds, limit, and cursor.
- Home responses include items, count, total, nextCursor, hasMore, and
  metadata.
- GET /api/v1/resources accepts the same bounded viewport/cursor contract.
- Resource responses include nextCursor and hasMore while retaining counts and
  GeoJSON FeatureCollection compatibility.

- [ ] **Step 1: Write failing endpoint/query tests**

Test invalid bounds and over-limit inputs, deterministic ordering, cursor
continuation without duplicates, total/count metadata, and bounds restricting
homes/resources. Test that an empty final page returns hasMore false and a
null nextCursor.

- [ ] **Step 2: Run focused backend tests**

Run:

    cd backend && pytest tests/test_pagination_api.py tests/test_api_contract.py -q

Expected: FAIL because endpoints currently hardcode 200 homes and allow
resource limits up to 10000 without continuation metadata.

- [ ] **Step 3: Implement cursor-aware home query**

Replace the hardcoded home limit with validated parameters. Apply bounds using
ST_Intersects against a parameterized envelope, use observed_on DESC NULLS
LAST and id as the stable tie-breaker, and add one extra row to determine
hasMore. Encode the final returned row as nextCursor.

- [ ] **Step 4: Implement cursor-aware resource query**

Apply the existing bounds validation to the new cursor/limit contract. Order
by resource_type, name, id, apply the cursor tuple, fetch one extra row, and
retain source/location provenance fields and per-type counts.

- [ ] **Step 5: Preserve compatibility fields**

Keep existing items/count/sourceStatus/limitations/unappliedCriteria keys.
Add total, nextCursor, and hasMore without changing the historical semantics
or resource GeoJSON shape.

- [ ] **Step 6: Run focused and regression backend tests**

Run:

    cd backend && pytest tests/test_pagination_api.py tests/test_api_contract.py tests/test_sources.py -q

Expected: all tests pass.

- [ ] **Step 7: Commit the bounded API**

Stage only backend/app/main.py and the listed backend tests. Verify paths, then
commit:

    git commit -m "feat: paginate homes and map resources"

### Task 3: Add pure client-side point clustering

**Files:**
- Create: frontend/lib/geo-cluster.js
- Create: frontend/test/geo-cluster.test.js
- Modify: frontend/components/map-view.jsx

**Interfaces:**
- clusterPointFeatures(features, {cellSize}) returns original non-point
  features plus cluster features with point geometry, count, memberIds, and
  representative source metadata.

- [ ] **Step 1: Write failing clustering tests**

Test that nearby points create one cluster with the correct count and member
IDs, distant points remain individual, polygons pass through unchanged,
malformed geometry is ignored safely, and a single point is not wrapped in a
cluster.

- [ ] **Step 2: Run focused frontend tests**

Run:

    npm --workspace frontend run test -- --run frontend/test/geo-cluster.test.js

Expected: FAIL because geo-cluster.js does not exist.

- [ ] **Step 3: Implement deterministic grid clustering**

Use longitude/latitude grid keys based on the supplied cellSize. Preserve
source IDs and a representative source label; calculate the cluster centroid
from valid points. Do not mutate the API feature objects.

- [ ] **Step 4: Render clusters in MapView**

Cluster only dense point resources at the current zoom/viewport. Render a
count marker for clusters and preserve existing GeoJSON rendering for
polygons and individual points. Keep homes as selectable individual markers
unless they are explicitly returned as a paginated cluster layer.

- [ ] **Step 5: Run focused tests and build**

Run:

    npm --workspace frontend run test -- --run frontend/test/geo-cluster.test.js
    npm run build

Expected: tests pass and the build succeeds.

- [ ] **Step 6: Commit clustering**

Stage only frontend/lib/geo-cluster.js, frontend/test/geo-cluster.test.js, and
frontend/components/map-view.jsx. Verify paths, then commit:

    git commit -m "feat: cluster dense map resource points"

### Task 4: Make map viewport loading and list pagination cancellable

**Files:**
- Create: frontend/components/map-viewport-listener.jsx
- Create: frontend/test/map-viewport.test.jsx
- Modify: frontend/components/workspace-provider.jsx
- Modify: frontend/components/map-panel.jsx
- Modify: frontend/app/(workspace)/explore/page.jsx

**Interfaces:**
- MapViewportListener calls onBoundsChange(bounds) on Leaflet moveend,
  normalized as west,south,east,north.
- Workspace context exposes pagination, loadMoreHomes, refreshViewport, and
  resourceState.
- refreshViewport(bounds) cancels the previous viewport request and applies
  only the newest response.

- [ ] **Step 1: Write failing provider/listener tests**

Test bounds normalization, request cancellation, newer-response-wins
behavior, append-without-duplicates for loadMoreHomes, and stopping at
hasMore false. Mock Leaflet/map event hooks rather than requiring a browser map.

- [ ] **Step 2: Run focused frontend tests**

Run:

    npm --workspace frontend run test -- --run frontend/test/map-viewport.test.jsx

Expected: FAIL because the listener and provider pagination interfaces do not
exist.

- [ ] **Step 3: Implement the viewport listener**

Use react-leaflet map events and emit only on moveend. Clamp/normalize
coordinates before invoking the callback. Keep the listener renderless.

- [ ] **Step 4: Implement provider viewport/pagination methods**

Send encoded bounds, limit, and cursor through requestJson. Keep the current
search result while a viewport refresh is loading, ignore AbortError, and
retain the previous result on other failures. Append pages by stable home ID
without duplicating records.

- [ ] **Step 5: Wire map and list UI**

Mount the listener inside MapView/MapPanel. Add a bounded resource loading
indicator and a list Load more action when hasMore is true. Preserve source
counts and show the current viewport as a data-scope note.

- [ ] **Step 6: Run frontend tests and build**

Run:

    npm --workspace frontend run test -- --run
    npm run build

Expected: all tests pass and the build succeeds.

- [ ] **Step 7: Commit viewport loading**

Stage only the listed frontend components/tests. Verify paths, then commit:

    git commit -m "feat: load map data by cancellable viewport"

### Task 5: Phase 4 acceptance verification

**Files:**
- No source changes unless a preceding test exposes a Phase 4 defect.

- [ ] **Step 1: Run all backend tests**

Run:

    cd backend && pytest -q

Expected: all backend tests pass.

- [ ] **Step 2: Run all frontend tests and build**

Run:

    npm --workspace frontend run test -- --run
    npm run build

Expected: all frontend tests pass and the build succeeds.

- [ ] **Step 3: Inspect scale safeguards**

Verify API defaults/caps, cursor continuation, SQL parameterization, map
AbortController behavior, and no Lab path in any staged Phase 4 commit.

- [ ] **Step 4: Record the phase gate**

Do not begin Phase 5 until invalid bounds/limits fail safely, viewport races
are covered, and dense resource layers do not render every feature directly.
