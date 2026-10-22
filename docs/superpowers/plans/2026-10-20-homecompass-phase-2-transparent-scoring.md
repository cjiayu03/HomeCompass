# HomeCompass Phase 2: Transparent Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Apply one versioned, evidence-aware scoring policy to real source records and expose the score components, coverage, missing evidence, and policy version in the UI.

**Architecture:** Put normalization and aggregation in a dedicated backend scoring module. Keep the existing generic weighted_score preview compatible, but make real home queries call the dedicated policy with persisted criterion weights and nullable low-coverage scores. Frontend cards and comparison tables consume the same score contract and never infer a score from missing fields.

**Tech Stack:** Python dataclasses/functions, Pydantic validators, FastAPI/asyncpg/PostGIS, React, Vitest, and pytest.

**Spec:** docs/superpowers/specs/2026-10-20-homecompass-improvement-roadmap-design.md

## Global Constraints

- Historical HDB transaction records must remain visibly historical and must never be presented as current listings.
- Scores use only available evidence; missing data is excluded from the numerator and remains visible.
- Real scores use policy version home-fit-v1, default weights school 2, childcare 2, care 2, affordability 1, and a minimum coverage threshold of 0.50 for displaying a numeric score.
- Distance components use an explicit target: request threshold when supplied, otherwise school 1500 m, childcare 2000 m, and care 2000 m.
- Affordability is unavailable without a budget and uses a bounded price-fit normalization; it is not a claim that a transaction is affordable for every family.
- Lab 3, Lab 4, Lab 5, course reports, diagrams, generated artifacts, and course packaging are out of scope and must not be modified, staged, committed, or pushed.
- No push is authorized by this plan.

## Review Focus

- A home has no evidence: numeric score is null, coverage is zero, and missingEvidence explains why.
- A high-weight criterion is missing: available evidence may contribute, but coverage drops and the missing criterion is not treated as zero.
- A profile sends an unknown, negative, NaN, or infinite weight: validation rejects it before database writes or scoring.
- A budget is missing: affordability is omitted rather than assigned a neutral or failing value.
- The API policy changes later: saved/history responses retain the policy version used for the calculation.

---

### Task 1: Implement the versioned scoring policy

**Files:**
- Create: backend/app/scoring.py
- Create: backend/tests/test_scoring.py
- Modify: backend/app/domain.py only if the generic preview needs a compatibility adapter

**Interfaces:**
- Exports POLICY_VERSION = home-fit-v1.
- Exports DEFAULT_WEIGHTS with school 2, childcare 2, care 2, affordability 1.
- Exports score_distance(distance_m, target_m) -> float | None.
- Exports score_affordability(price_cents, budget_cents) -> float | None.
- Exports score_home_evidence(evidence, weights, targets) -> dict with score,
  coverage, components, missingEvidence, policyVersion, and scoredAt.

- [ ] **Step 1: Write failing policy tests**

Test score_distance at zero, target, beyond target, and missing distance.
Test score_affordability with no budget, zero price, at-budget price, and
twice-budget price. Test score_home_evidence for:

- all four available criteria;
- missing high-weight school evidence;
- all criteria missing;
- zero total positive weight;
- coverage below 0.50 returning score null;
- component records containing raw value, normalized value, weight,
  contribution, and evidence status;
- deterministic policy version and a UTC score timestamp.

- [ ] **Step 2: Run the focused scoring tests**

Run:

    cd backend && pytest tests/test_scoring.py -q

Expected: FAIL because backend/app/scoring.py does not exist.

- [ ] **Step 3: Implement backend/app/scoring.py**

Use distance normalization max(0, 100 * (1 - distance / target)) rounded to
one decimal. Use price fit 50 + 50 * ((budget - price) / budget), clamped to
0..100, when both price and budget are present. Normalize weights to finite
non-negative values, exclude unavailable evidence from the numerator, compute
coverage as available weight divided by total positive weight, and return a
nullable score when coverage is below 0.50.

- [ ] **Step 4: Run the focused scoring tests**

Run:

    cd backend && pytest tests/test_scoring.py -q

Expected: all policy tests pass.

- [ ] **Step 5: Commit the policy module**

Stage only backend/app/scoring.py and backend/tests/test_scoring.py, verify the
staged paths, then commit:

    git commit -m "feat: add versioned evidence scoring policy"

### Task 2: Validate and persist family priority weights

**Files:**
- Modify: backend/app/schemas.py
- Modify: backend/app/main.py
- Modify: backend/app/database.py if profile reads need a helper
- Modify: backend/tests/test_schemas.py
- Modify: backend/tests/test_api_contract.py

**Interfaces:**
- FamilyProfileUpdate.priority_weights accepts only school, childcare, care,
  and affordability with finite values from 0 through 3.
- Profile GET returns priorityWeights with defaults for missing criterion rows.
- Profile PUT replaces the four criterion_weight rows atomically.
- SearchRequest accepts an optional validated priority_weights snapshot.

- [ ] **Step 1: Write failing schema and persistence tests**

Add schema tests for default weights, valid boundary values, unknown keys,
negative values, values above 3, non-numeric values, and JSON non-finite
values. Add route/helper tests proving profile output includes defaults and
profile writes cannot persist unknown criteria.

- [ ] **Step 2: Run the focused backend tests**

Run:

    cd backend && pytest tests/test_schemas.py tests/test_api_contract.py -q

Expected: the new fields and validation assertions fail.

- [ ] **Step 3: Implement the weight schema**

Add a Pydantic validator that rejects unknown keys and normalizes integer and
float values without accepting NaN or infinity. Use the policy defaults for
omitted keys. Keep the existing snake_case request convention and return
camelCase only at the response boundary.

- [ ] **Step 4: Wire criterion_weight into profile reads and writes**

Update profile GET to left-join or separately load criterion_weight rows and
fill missing criteria from DEFAULT_WEIGHTS. Update profile PUT inside the
existing transaction to upsert the four allowed rows and remove stale rows.
Do not add a new table because criterion_weight already exists in
database/migrations/001_initial.sql.

- [ ] **Step 5: Run the focused backend tests**

Run:

    cd backend && pytest tests/test_schemas.py tests/test_api_contract.py -q

Expected: all weight validation and profile contract tests pass.

- [ ] **Step 6: Commit profile weight support**

Stage only backend/app/schemas.py, backend/app/main.py,
backend/app/database.py if changed, and the two backend test files. Verify
the path list, then commit:

    git commit -m "feat: persist family scoring priorities"

### Task 3: Apply scoring to live home searches

**Files:**
- Modify: backend/app/main.py
- Modify: backend/app/schemas.py
- Modify: backend/tests/test_api_contract.py
- Create: backend/tests/test_search_scoring.py

**Interfaces:**
- _home(record, score=None) includes score and scoreDetails. scoreDetails has
  coverage, components, missingEvidence, policyVersion, and scoredAt.
- _query_homes(request, priority_weights=None) returns deterministic records
  with the score contract.
- POST /api/v1/search accepts the validated priority weight snapshot and
  returns scorePolicyVersion in result metadata.

- [ ] **Step 1: Write failing live-query scoring tests**

Use a fake asyncpg pool/connection or extracted query-row transformer to test
that a row with price and amenity distances receives component evidence, that
missing geometry does not become zero distance, and that a low-coverage row
has score null. Test that source semantics remain historical and that
policyVersion is present.

- [ ] **Step 2: Run the focused tests**

Run:

    cd backend && pytest tests/test_search_scoring.py -q

Expected: FAIL because live home serialization currently hardcodes score null.

- [ ] **Step 3: Add score evidence to the query transformation**

Pass the budget and distance targets into score_home_evidence while converting
each database row. Preserve the existing price, source, geocode, and
historical-risk fields. Keep the score calculation out of SQL so the policy
has one tested implementation.

- [ ] **Step 4: Add weights to search and compatibility metadata**

Accept priority_weights on SearchRequest, pass them to _query_homes, and
return policy version plus score coverage in each item. Keep existing
unappliedCriteria and limitations keys. The generic /api/v1/scoring/preview
route should call the same normalization rules where its input represents
already-normalized criterion scores.

- [ ] **Step 5: Run backend scoring and regression tests**

Run:

    cd backend && pytest tests/test_domain.py tests/test_scoring.py tests/test_search_scoring.py tests/test_api_contract.py -q

Expected: all tests pass, including existing missing-data behavior.

- [ ] **Step 6: Commit live score application**

Stage only backend/app/main.py, backend/app/schemas.py, and the two new/updated
backend test files. Verify the staged path list, then commit:

    git commit -m "feat: score live home evidence transparently"

### Task 4: Display score evidence in cards and comparison

**Files:**
- Create: frontend/components/score-breakdown.jsx
- Create: frontend/test/score-breakdown.test.jsx
- Modify: frontend/components/workspace-provider.jsx
- Modify: frontend/components/home-card.jsx
- Modify: frontend/app/(workspace)/explore/page.jsx
- Modify: frontend/app/(workspace)/compare/page.jsx

**Interfaces:**
- ScoreBreakdown accepts scoreDetails plus the numeric score and renders a
  numeric score only when score is finite. scoreDetails has coverage,
  components, missingEvidence, policyVersion, and scoredAt.
- Search payload includes brief.priorityWeights.
- Profile sync includes brief.priorityWeights.

- [ ] **Step 1: Write failing score UI tests**

Test that ScoreBreakdown:

- renders “Insufficient evidence” for a null score;
- renders coverage and policy version;
- renders each component contribution and missing evidence;
- never displays missing data as zero;
- remains accessible when expanded in a card/detail surface.

- [ ] **Step 2: Run the focused frontend test**

Run:

    npm --workspace frontend run test -- --run frontend/test/score-breakdown.test.jsx

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement ScoreBreakdown and wire workspace requests**

Create the presentational component. Update provider search/profile payloads to
send the validated priority weights. Do not calculate real scores in the
browser; the API response is authoritative.

- [ ] **Step 4: Integrate cards, detail, and compare**

Update HomeCard and compare/page.jsx to show the score only with its coverage
and policy context. Add an expandable breakdown to the detail/comparison
surface. Replace the Explore filter copy that says weights affect fixture
ordering only with copy explaining evidence-based scoring and missing data.

- [ ] **Step 5: Run frontend tests and build**

Run:

    npm --workspace frontend run test -- --run
    npm run build

Expected: all frontend tests pass and the production build succeeds.

- [ ] **Step 6: Commit score presentation**

Stage only the listed frontend components and tests. Verify the staged paths,
then commit:

    git commit -m "feat: explain home fit scores with evidence"

### Task 5: Phase 2 acceptance verification

**Files:**
- No source changes unless a preceding test exposes a Phase 2 defect.

- [ ] **Step 1: Run the full backend suite**

Run:

    cd backend && pytest -q

Expected: all backend tests pass.

- [ ] **Step 2: Run frontend tests and build**

Run:

    npm --workspace frontend run test -- --run
    npm run build

Expected: all frontend tests pass and the build succeeds.

- [ ] **Step 3: Verify path safety and score semantics**

Inspect git status and the staged path lists for the Phase 2 commits. Confirm
that no Lab path changed and that every numeric score has coverage, components,
missing evidence, and home-fit-v1 metadata.

- [ ] **Step 4: Record the phase gate**

Do not begin Phase 3 until real API results use the policy, persisted weights
round-trip, sparse evidence remains visible, and the frontend no longer claims
that weights affect fixture ordering only.
