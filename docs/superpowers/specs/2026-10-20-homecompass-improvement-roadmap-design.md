# HomeCompass Improvement Roadmap

## Status

Approved architecture for private implementation planning. Implementation has not started.

This design applies only to the private HomeCompass application code. It does not
modify, stage, or publish Lab 3, Lab 4, Lab 5, or any other course deliverable.

## Problem statement

HomeCompass already has the core pieces of a family-oriented Singapore home
research product: source ingestion, source snapshots, geocoded homes and
resources, PostGIS queries, authentication, shortlist persistence, search
history, personal places, and an AI interpretation adapter.

The current user experience still behaves partly like a fixture-backed prototype:

- The workspace provider silently ignores failed initial requests.
- Search and reset can replace real API results with fixture homes.
- The UI does not distinguish live database results, fixtures, stale data, and
  failed requests.
- Priority weights affect fixture ordering but are not used to rank real homes.
- The backend has search-history and personal-place capabilities that are not
  exposed in the workspace.
- The map requests a very large unbounded resource set and renders every feature
  directly.
- Some account mutations are optimistic without rollback.
- The unauthenticated AI interpretation endpoint can trigger paid model calls.
- There is no frontend integration-test layer guarding these flows.

The roadmap turns these capabilities into a trustworthy decision-support flow
without claiming that historical transaction records are current property
listings.

## Product principles

1. **Truth before convenience.** A failed or incomplete request must never look
   like a successful empty search.
2. **Evidence before score.** A score is useful only when its inputs, weights,
   freshness, and missing evidence are visible.
3. **Historical data stays historical.** HDB transaction records may support
   price context and area research, but the product must not label them as
   available listings.
4. **Family constraints are first-class.** Budget, household composition,
   personal places, school, childcare, elder-care, and commute context should
   flow through the same search and comparison model.
5. **Every external source is attributable.** Source identity, retrieval time,
   geocoding provenance, and freshness limitations belong in the API model and
   in the UI where they affect a decision.
6. **Private application work only.** Changes stay in application paths and
   private engineering documentation; course deliverables remain outside the
   implementation scope.

## Scope and implementation order

The work is intentionally ordered so that later features cannot conceal data
or correctness problems in earlier layers.

1. Trustworthy search and data-state handling.
2. Transparent scoring.
3. Family places and commute context.
4. Map and data-scale improvements.
5. Security and account synchronization.
6. Saved decision workflow.
7. Hardening, tests, and operational checks.

Each phase must meet its acceptance criteria before the next phase begins.
Small prerequisite migrations or shared types may be introduced as part of the
phase that needs them; they are not a separate product phase.

## Current boundaries

### In scope

- Backend API contracts, schemas, queries, migrations, and tests.
- Frontend workspace state, search, map, compare, shortlist, account, and
  supporting components.
- Source/provenance presentation and explicit freshness states.
- Private engineering documentation under docs/superpowers.

### Out of scope

- Lab 3, Lab 4, Lab 5, submissions, reports, diagrams, generated artifacts,
  or course packaging.
- Publishing or pushing the private branch.
- Presenting historical HDB transactions as live inventory.
- Guaranteeing driving or public-transit travel times before a verified route
  provider is available.
- An unrestricted public AI proxy.
- Replacing the existing ingestion/source architecture wholesale.

## Target architecture

### 1. A shared truth model for every result

The backend will expose a consistent status envelope for result-producing
endpoints. The exact wire format should be shared through typed frontend
helpers rather than duplicated ad hoc.

The envelope will include:

- data: homes, resources, or other result payload.
- dataMode: live, fixture, mixed, or error.
- retrievedAt: server retrieval timestamp when applicable.
- sourceSummary: source names, record counts, and source snapshot dates.
- warnings: user-visible limitations that do not invalidate the request.
- error: a stable machine-readable code and safe message when the request
  fails.

Home records will also carry their own provenance fields where the result can
contain different source dates:

- source type and source snapshot identifier;
- record date or transaction date;
- isHistorical;
- geocode status and geocode provenance;
- last-known verification/freshness metadata.

The UI will render these states explicitly. A fixture result will have a
visible demo label; a stale result will have a freshness warning; an error
will have retry affordance; and an empty live result will remain empty rather
than being silently filled from fixtures.

Fixture homes remain available for local demo and offline development, but
they are entered through an explicit fixture/demo mode. They are never an
implicit fallback for a failed live request.

### 2. Workspace request lifecycle

The workspace provider will own a small request state machine:

- idle;
- loading with the previous successful data retained when available;
- success with dataMode and provenance;
- empty with successful source metadata;
- error with the previous successful data retained when safe to do so.

Every request will have an abort/cancellation path. A response from an older
query must not overwrite a newer query. Reset will restore the current
live/default query and refetch it; it will not install fixture data.

The client API layer will normalize non-2xx responses, network failures,
timeouts, and malformed payloads into the same error shape. Components will
not need to infer failure from an empty array.

### 3. Transparent scoring

Scoring will be a versioned backend policy rather than fixture-only ordering.
The policy will:

- accept validated family priority weights;
- use only evidence present for the home;
- normalize each available component to a documented scale;
- exclude unavailable components from the numerator and denominator;
- report coverage so a high score with sparse evidence is visible;
- return component contributions and missing evidence;
- identify the policy version and score timestamp.

The score response for a home will include:

- score: nullable until the policy minimum evidence threshold is met;
- coverage: the weighted proportion of applicable evidence;
- components: component name, raw value, normalized value, weight,
  contribution, and evidence status;
- missingEvidence: fields not available for this home;
- policyVersion;
- scoredAt.

The default policy will be conservative. Price fit and spatial/family
constraints can be scored where data exists; unsupported claims such as an
unverified commute time cannot contribute. The UI will show “insufficient
evidence” instead of manufacturing a score.

Priority weights will be persisted as part of the family profile with schema
validation and safe defaults. The existing weighted-score preview remains a
useful policy preview, but real search results will use the same policy
implementation. Policy changes will be versioned so saved decisions can state
which rules produced their score.

### 4. Family places and commute context

The existing personal-place capability will become a user-facing feature.
Places will support explicit kinds such as:

- workplace;
- school;
- childcare;
- elder-care;
- other.

The place record will retain label, address, coordinates, maximum preferred
distance, and geocoding provenance. A schema extension may add a normalized
place kind and source metadata while preserving existing rows.

Address entry will use a backend-controlled OneMap adapter. The browser will
not be trusted with provider secrets or arbitrary upstream URLs. The flow will
show candidates, require a user choice when ambiguous, and store the selected
coordinates plus provider timestamp.

Search will support distance constraints against selected personal places
using PostGIS. The response will identify whether a distance is straight-line,
road, or transit-derived. Until a verified route provider is integrated,
straight-line distance will be labeled as an estimate and will not be called
“commute time.”

The UI will let users manage places, choose which constraints apply to a
search, and inspect the distance evidence for each result.

### 5. Map and data-scale behavior

Resource and home queries will be scoped to the visible map viewport when a
viewport is available. The backend will accept validated bounds, a bounded
page size, and a continuation mechanism. It will reject or clamp excessive
limits.

The map layer will:

- load only relevant resources for the current viewport and active filters;
- cancel obsolete bounds requests;
- show loading and partial-result states;
- cluster or generalize dense point layers;
- preserve source-layer counts without rendering every feature at once.

List and map results will share stable ordering and pagination metadata.
Ranking will be explicit: user filters first, then score or recency only when
the relevant evidence exists, with deterministic tie-breaking.

### 6. Security and account synchronization

AI interpretation is a paid-resource boundary. The endpoint will require a
valid authenticated session for the production flow and retain the existing
monthly budget reservation/validation. The service will also add request
throttling and safe error responses so authentication is not the only control.
If a future guest preview is desired, it must use a separately capped,
non-paid path.

Guest-to-account synchronization will be an explicit, idempotent merge:

- local family brief fields are submitted only when the account has no value
  or the user confirms replacement;
- shortlist items are unioned by stable home identity;
- compare selections are validated against available home identities;
- local search history is imported with provenance and deduplication;
- personal places require explicit confirmation before upload;
- the merge result reports accepted, skipped, and conflicting items.

Optimistic shortlist/reorder changes will roll back on failure and retain a
retryable pending state. Account and workspace UI will distinguish local-only,
syncing, synced, and failed-to-sync data.

Readiness checks will separately report application, database, migration,
source-data, and AI configuration status. Secrets and provider details will
not be included in readiness responses.

### 7. Saved decision workflow

Existing search-history and personal-place endpoints will be surfaced in the
workspace. The user will be able to:

- inspect prior searches;
- save a search definition with a human-readable name;
- rerun a saved search against current source data;
- see when the original result and current result differ;
- use saved personal places as repeatable constraints;
- inspect provenance and score-policy versions in comparisons.

Saved searches will store the query/profile inputs, selected places, policy
version, and creation time, not a misleading promise that old transaction
records remain live inventory. A rerun creates a new result timestamp and
fresh source summary.

Comparison and shortlist views will keep evidence attached to each home so
the user can tell whether a difference is a current calculation, a source
snapshot difference, or missing data.

### 8. Hardening and verification

The project will add a frontend test layer for request state and critical
workspace flows, alongside the existing backend tests. The target coverage
will include:

- live success, empty, timeout, malformed response, and retry states;
- fixture mode being explicit;
- stale-request cancellation and race prevention;
- score components and insufficient-evidence behavior;
- place creation, ambiguous geocode selection, and distance labels;
- map bounds request cancellation and pagination;
- shortlist rollback and guest-to-account merge;
- saved-search rerun and provenance display;
- accessibility checks for loading, error, and map alternatives.

Backend tests will cover query boundaries, score policy versions, provenance,
ownership, rate limits, and migration compatibility. API contract tests will
ensure the frontend envelope is stable.

The final phase will also add a documented migration/version check and a
repeatable application health check. A full browser smoke test will cover the
core path from family brief to search, map/list inspection, shortlist, and
comparison.

## Proposed API and persistence changes

The implementation plan must preserve backward compatibility for existing
clients while introducing the following contracts:

### Result metadata

Home, search, and resource responses will expose consistent metadata for:

- result count and pagination;
- data mode;
- source snapshots and retrieval time;
- warnings and unapplied criteria;
- score policy version when scoring was requested.

The existing search limitations will remain available but will be represented
as structured warnings where possible.

### Family profile

Extend the profile update contract to validate and persist priority weights,
with server defaults and a normalization rule. The implementation must not
accept arbitrary keys or negative, NaN, or infinite values.

### Personal places

Add validated place kind and geocode provenance while accepting legacy records
that do not yet have the new fields. Existing ownership checks remain
mandatory for read, create, update, and delete.

### Saved searches

Add a user-owned saved-search record containing:

- name;
- normalized search request;
- selected place identifiers and distance constraints;
- profile/weight snapshot or reference;
- scoring policy version;
- created and last-run timestamps.

The query must never cross account boundaries.

### Migrations

Database migrations will be incremental and reversible in development:

1. profile priority weights and score-policy metadata;
2. personal-place kind/geocode provenance;
3. saved searches and any required indexes;
4. optional decision/evidence snapshot fields only if comparison behavior
   requires them.

Before each migration is applied, the implementation will inspect the actual
private schema and existing migration conventions. No Lab database copy will
be modified.

## Phase acceptance criteria

### Phase 1: Trustworthy search

- Failed API calls are visible and retryable.
- Reset and failed search do not install fixture homes.
- Fixture mode is explicit and labeled.
- Older requests cannot overwrite newer results.
- Source/freshness metadata is visible for live results.
- Backend and frontend tests cover success, empty, failure, and race cases.

### Phase 2: Transparent scoring

- Real search results can be ranked by the same policy previewed by the API.
- Scores expose components, coverage, missing evidence, timestamp, and policy
  version.
- The UI does not show a numeric score below the evidence threshold.
- Priority weights persist safely and have deterministic defaults.

### Phase 3: Family places and commute

- Users can create and manage typed places.
- OneMap results are selected explicitly and provenance is stored.
- Search can apply selected-place distance constraints.
- Every distance/route value is labeled by measurement method and freshness.

### Phase 4: Map and data scale

- Map requests are viewport-scoped and bounded.
- Stale bounds requests are cancelled.
- Dense resources use clustering/generalization.
- Pagination and ordering are deterministic and visible.

### Phase 5: Security and account sync

- Paid AI interpretation cannot be called through the unauthenticated
  production path.
- Rate limiting and budget checks produce safe, testable failures.
- Guest merge is idempotent, ownership-safe, and reports conflicts.
- Failed optimistic mutations roll back.
- Readiness checks do not leak secrets.

### Phase 6: Saved decision workflow

- Search history, personal places, saved searches, and reruns are available
  from the workspace.
- Reruns show current source metadata and differences from prior runs.
- Shortlist and compare views retain provenance and score-policy context.

### Phase 7: Hardening

- Backend and frontend tests run through documented commands.
- Critical browser flow has a smoke test.
- Accessibility checks cover all new stateful UI.
- Migration and health checks are repeatable.
- No course deliverable is modified or staged.

## Risks and mitigations

### Historical records could be mistaken for listings

Mitigation: use explicit historical labels, source dates, and copy in all
search/list/detail surfaces; never add availability language to transaction
records.

### Sparse evidence could produce misleading scores

Mitigation: nullable scores below a minimum evidence threshold, coverage,
component disclosure, missing-evidence text, and policy versioning.

### Provider limits could make map/search requests expensive

Mitigation: bounded queries, viewport loading, cancellation, caching where
safe, source snapshots, and explicit rate limits.

### Account merge could overwrite user intent

Mitigation: deterministic idempotent merge, field-level conflict reporting,
explicit confirmation for personal places, and rollbackable sync.

### Dirty course files could be accidentally included

Mitigation: restrict edits to application paths and docs/superpowers, inspect
the path list before every commit, and refuse to stage Lab paths. Any future
commit must be created from an explicit allowlist.

## Decisions deferred until implementation planning

The writing plan must resolve these implementation-level choices from the
current code and dependency constraints:

- exact response-envelope names and shared frontend types;
- score normalization constants and minimum evidence threshold;
- OneMap endpoint/provider configuration and cache policy;
- route-provider availability and the straight-line fallback boundary;
- pagination cursor format;
- clustering library or server-side generalization strategy;
- frontend test runner and browser test runner;
- migration numbering based on the actual private database state.

These are implementation details, not unresolved product requirements. They
must be decided in the plan with tests and rollback considerations before code
changes begin.
