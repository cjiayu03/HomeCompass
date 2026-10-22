# HomeCompass Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a skippable, animated onboarding flow whose account-backed preferences configure the existing HomeCompass Explore search.

**Architecture:** Store onboarding status and search preferences on `family_profile`, with new accounts created as incomplete and existing profiles defaulting to complete. Extend the profile/search APIs and keep the `WorkspaceProvider` brief as the frontend source of truth; the onboarding page and Explore controls edit that same brief. Reuse the existing AuthShell, theme tokens, and Motion dependency.

**Tech Stack:** Next.js 16, React 19, Motion 13, FastAPI, Pydantic, asyncpg, PostgreSQL/PostGIS.

**Spec:** `docs/superpowers/specs/2026-10-20-homecompass-onboarding-design.md`

## Global Constraints

- “Let a new user finish setup or skip directly to Explore, without blocking either path on optional answers.”
- “Household defaults are one adult, zero children, and zero older adults.”
- “A selected town list filters results to any selected town”; allow at most three unique towns and one supported flat type.
- Keep “No preference” and “No limit” nullable/empty, never serialize them as a zero-distance constraint.
- “Use the existing Motion package”; honor `prefers-reduced-motion`; do not add a dependency.
- “Do not request precise location, store contact/family details, or imply that selected preferences guarantee suitable homes.”
- Preserve current local-auth and 3D-map edits. Do not stage or commit this plan or implementation without a separate user request.
- Per the user's earlier instruction, do not add or run automated tests. Perform only focused syntax/build checks and manual flow checks.

## Review Focus

These edge cases are manual acceptance checks because automated tests are out of scope:

- Existing accounts and new-but-incomplete accounts must take different routes; verify migration defaults and signup profile creation preserve that distinction.
- Empty/unavailable resale data must yield no town/type suggestions without inventing options or preventing skip.
- Duplicate, whitespace-padded, or unsupported town/type values must not be persisted as valid preferences.
- Multiple selected towns must behave as OR; an explicit town/type in a one-off query must override profile defaults only for that request.
- Profile load/save failure or a rapid account switch must not trap a user or write one account's preferences into another account.

---

### Task 1: Add the onboarding profile migration and schema readiness contract

**Files:**
- Create: `database/migrations/009_onboarding_profile.sql`
- Modify: `docker-compose.yml`
- Modify: `backend/app/migrations.py`
- Modify: `backend/README.md`
- Modify: `ops/README.md`

**Interfaces:**
- Produces migration 009 with `preferred_towns text[] NOT NULL DEFAULT '{}'`, nullable `preferred_flat_type`, nullable school/childcare/care distance integers, and `onboarding_completed boolean NOT NULL DEFAULT true`.
- Existing rows remain complete; new-account code in Task 2 explicitly inserts `onboarding_completed = false`.

- [x] Add migration 009 constraints: at most three towns; nullable distances from 0 through 100,000 metres; flat type limited to 40 characters. Keep it additive and preserve all existing profile data.
- [x] Append migration 009 to the Compose `migrate` command and update migration version constants and the schema-inspection contract to require each new column/constraint.
- [x] Update backend and ops setup docs from eight migrations to nine, naming the onboarding profile migration.
- [x] Run `python3 -m compileall -q backend/app`; migration discovery reports the contiguous chain 001–009. `docker compose config --quiet` was skipped because required `POSTGRES_DB`/database environment values are absent. Do not apply migrations to a database as part of this task.

### Task 2: Persist profile completion and onboarding answers

**Files:**
- Modify: `backend/app/database.py`
- Modify: `backend/app/schemas.py`
- Modify: `backend/app/main.py`

**Interfaces:**
- Profile GET returns `preferredTowns: string[]`, `preferredFlatType: string | null`, `maxSchoolDistanceM: number | null`, `maxChildcareDistanceM: number | null`, `maxCareDistanceM: number | null`, and `onboardingCompleted: boolean`, alongside existing fields.
- Profile PUT accepts those values in snake_case. `onboarding_completed` is optional and only changes when explicitly supplied as `true` by onboarding completion/skip.
- `database.get_current_search_options(connection) -> {"towns": string[], "flat_types": string[]}` returns distinct values from the latest usable HDB resale snapshot for Task 3 and profile validation.

- [x] Extend `ensure_profile` to select the new migration-009 columns while preserving the database's complete-by-default behavior for existing accounts.
- [x] In `register_local_account`, insert the neutral household profile in the same account/identity/session transaction with one adult, zero children/older adults, and `onboarding_completed = false`.
- [x] Add Pydantic validation for at most three distinct trimmed towns, a nullable flat type of at most 40 characters, nullable 0–100,000 metre distances, and an optional completion flag. Preserve the existing priority-weight validation.
- [x] Implement `get_current_search_options` using distinct town and flat-type values from the latest valid/degraded HDB source snapshot; return empty lists if no usable snapshot exists.
- [x] Extend profile GET/PUT to read/write all new fields, replace priority weights as today, validate non-empty town/type choices against current search options, and never let an ordinary autosave change completion state.
- [x] Manually inspect invalid/duplicate town input, unsupported flat type, and out-of-range distances; inspect the new-account transaction and existing-account `ensure_profile` path to confirm signup yields incomplete, existing/missing profile yields complete, and unrelated profile fields are unchanged.

### Task 3: Expose supported options and apply multi-town search filters

**Files:**
- Modify: `backend/app/schemas.py`
- Modify: `backend/app/main.py`

**Interfaces:**
- `GET /api/v1/search/options` returns `{ "towns": string[], "flatTypes": string[] }` from `database.get_current_search_options`.
- `SearchRequest.towns` is a list of at most three unique town strings. If it is non-empty it takes precedence over legacy scalar `town`; otherwise existing `town` behavior remains unchanged.

- [x] Add the public search-options endpoint and use the exact camelCase response key `flatTypes`.
- [x] Add `towns` validation to `SearchRequest`, trimming whitespace and rejecting duplicates after case folding.
- [x] Update `_query_homes` to apply a parameterized `h.town = ANY(...::text[])` predicate for multiple towns, preserving the scalar `town` path for old callers.
- [x] Manually inspect generated SQL parameters for zero, one, and three towns and confirm the legacy scalar request still uses its existing `ILIKE` behavior.

### Task 4: Make the shared brief own and apply the new preferences

**Files:**
- Modify: `frontend/lib/data.js`
- Modify: `frontend/components/workspace-provider.jsx`
- Modify: `frontend/app/(workspace)/explore/page.jsx`
- Modify: `frontend/components/brief-ribbon.jsx`

**Interfaces:**
- Extend the brief with `preferredTowns: string[]`, `preferredFlatType: string | null`, and nullable `schoolDistance`, `childcareDistance`, and `careDistance` fields.
- Expose `saveProfile({ onboardingCompleted?: true }) -> Promise<ProfilePayload>` through `WorkspaceProvider`; it persists the current brief immediately and rejects on sync failure so onboarding can show a retry/continue state. Regular debounced autosave omits `onboarding_completed`.
- Profile load/save translates the established camelCase response and snake_case request contract; profile values remain scoped to the active account owner.

- [x] Hydrate and persist all new fields through the existing profile effect; use null/empty values for no preference and include childcare distance, town list, and flat type in autosaves.
- [x] Expose the immediate `saveProfile` operation and ensure it checks the current workspace owner before and after its request.
- [x] Include saved preferences in default Explore requests; when interpreted query criteria explicitly supply a scalar town or flat type, use that criterion for the current request without mutating the saved brief.
- [x] Add town multi-select (maximum three), flat-type selection, and “No limit” choices for school/childcare/care to the existing Explore Filters dialog. Include town/type in the current-filter summary and apply those supported filters to fixture data; disclose that illustrative fixtures have no verified service distances.
- [x] Manually inspect the serialized request for no preference, three towns, and an explicit one-off town query; confirm empty limits are omitted rather than sent as zero.

### Task 5: Build the branded onboarding flow and route signup through it

**Files:**
- Create: `frontend/app/onboarding/page.jsx`
- Create: `frontend/components/onboarding-flow.jsx`
- Modify: `frontend/components/auth-shell.jsx`
- Modify: `frontend/components/auth-form.jsx`
- Modify: `frontend/app/globals.css`

**Interfaces:**
- `/onboarding` is authenticated and checks `/api/v1/profile`; incomplete accounts see the flow, completed accounts and signed-out visitors redirect to `/explore`.
- Signup redirects to `/onboarding`. Sign-in checks `onboardingCompleted`: incomplete accounts resume onboarding; completed accounts go to Explore.
- The flow has four steps (household, budget, towns/type, priorities/distances), calls the Task 4 `saveProfile({ onboardingCompleted: true })` on finish or skip, and loads available town/type options from `/api/v1/search/options`.

- [x] Add a `wide` AuthShell variant that keeps the existing header/theme controls and uses the current app tokens for a responsive question card plus “Your search so far” summary.
- [x] Implement the four steps, counters, budget slider plus numeric input, three-town selector, supported flat-type selector, four 1–3 priority controls and presets, and nullable distance controls. Keep labels and helper copy direct and non-promotional.
- [x] Make every control keyboard-operable and labeled, announce step changes/errors, preserve visible focus, and use the existing light/dark theme tokens.
- [x] Add loading, completed-account redirect, signed-out redirect, option-fetch failure, profile-save retry, and continue-to-Explore states. A failed save must be visible but must not trap the user; only a successful explicit save marks the server profile complete.
- [x] Add low-contrast decorative topographic lines and a dashed route that advances with the steps; tie town pins to selection, keep the drawing explicitly illustrative, use the installed Motion package, and disable motion under `prefers-reduced-motion`.
- [x] Update `AuthForm`: signup goes to onboarding; login fetches the profile completion state and routes accordingly, falling back to Explore if the profile endpoint is temporarily unavailable.
- [ ] Manually walk through signup, returning login, refresh-mid-onboarding, skip, completion, narrow screen, dark theme, reduced motion, unavailable options, and failed profile save. Not run per the user's instruction to skip tests; production build and code-path review were used instead.

### Task 6: Final focused verification and handoff

**Files:**
- Review all files listed in Tasks 1–5; no additional scope.

**Interfaces:**
- No new interfaces. Verify the migration/API/profile/search/UI path as a single flow.

- [x] Run `python3 -m compileall -q backend/app` and `BACKEND_URL=https://api.example.invalid npm run build --prefix frontend`; both pass. The HTTPS placeholder was process-local and not written to project configuration.
- [x] Confirm the Compose database is not configured (`POSTGRES_DB` is unset); migration 009 was not applied to any database.
- [x] Review final `git status` and staged diff to ensure the onboarding edits remain in the private worktree and unstaged; leave everything uncommitted.
