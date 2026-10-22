# Implementation status

## Private implementation update — 23 October 2026

The private worktree now uses local email/password accounts with Argon2id passwords and database-backed sessions; Supabase and Google auth have been removed. Skippable onboarding is connected to profile persistence. New decision tools include advanced must-have/property filters, preference previews and named scenarios, match explanations, family distance rings, neighbourhood transaction charts, decision-board notes/ratings/viewing checklists and browser-local photos, comparison differences and printable/HTML decision summaries. See `docs/DECISION_TOOLS.md` for usage and limitations.

Native development now has a checkout-owned PostGIS cluster in ignored `.local/postgres` on port 5433, with the imported public housing/resource records preserved independently of the main database. `npm run local` starts it, applies migrations 001–010, and starts the frontend/API. Migration 010 adds planning storage and geography indexes. Search pages property matches before calculating nearest services, while distance filtering operates on distinct locations.

The September checkpoint below is retained as historical evidence, including its then-current Supabase design and verification results. It does not describe the current private authentication design.

Private verification: production build and Python compilation passed, along with focused live API/browser checks for search, charts, local accounts, revision-safe planning, notes/photos, comparison/export/print, map fallback and mobile layout. Full automated suites were not run. The final implementation and limits are recorded in `docs/superpowers/plans/2026-10-23-decision-tools.md`; these local checks are not a public deployment or production-readiness claim.

**Checkpoint:** 29 September 2026  
**Author:** xyz  
**App name:** `HomeCompass`
**Deployment direction:** Docker/self-hosted preparation  
**Repository policy:** local only; no push, PR or external deployment has been performed.

## Implemented in this workspace

- Next.js App Router routes for the landing page, standalone login/signup, Explore, Shortlist, Compare and Account; the filter modal uses a titled accessible dialog and increased backdrop blur.
- Approved visual direction carried into the UI: near-black dark mode, restrained colors, light/dark theme, transparent cards, reduced-motion-aware interactions and no contrast-toggle control.
- Movable, attributed OpenStreetMap basemap with imported public resource/zone overlays and official-source popups. All imported HDB transaction addresses now have locally verified geometry; fixture pins remain explicitly illustrative.
- Supabase Auth client/session integration for email/password and Google OAuth, protected callback route, and API-side verification against Supabase Auth. OAuth credentials/callback setup and a live end-to-end test remain external configuration work.
- FastAPI + PostgreSQL/PostGIS integration, migrations `001`–`004`, owner-scoped profile/shortlist/history/personal-place endpoints, and explicit account deletion with a retryable state when identity deletion cannot complete.
- Imported the HDB resale snapshot (241,148 rows) and all 14 registered public government resource datasets into the configured local PostGIS database. Latest snapshots report zero rejected rows. The resources include HDB footprints/property data, LTA safety/school zones, dementia points, CHAS clinics, MOE schools, ECDA care/fee datasets, MSF Student Care, and NEA dengue polygons. HDB records remain historical transactions, not current listings.
- Added generic CSV/GeoJSON ingestion with bounded retries/size limits, 2D PostGIS normalization, stable record keys, snapshot hashes/provenance, retention of nonspatial rows, `/api/v1/sources` and `/api/v1/resources`, plus a visible Sources page.
- Ran checkpointed OneMap geocoding with the configured server-side token. On 29 September, read-only PostGIS verification found 9,750/9,750 distinct HDB addresses located (all 241,148 historical transaction rows), 337/337 current MOE schools located, zero failed/unlocated addresses and zero coordinates outside the Singapore bounds. Matching requires exact normalized HDB block/street and valid building postcode; official HDB building postcodes/footprints resolve only otherwise ambiguous results. Schools require exact postcode and, when shared, a unique exact school name. New imports need another geocoding pass.
- Gemini Interactions API adapter for schema-constrained search interpretation and evidence summaries. `GEMINI_MONTHLY_BUDGET_USD` is intentionally unset, so outbound model calls are disabled until a cap and current model rates are approved/configured.
- Docker Compose preparation for the Next.js app, FastAPI, PostGIS and migrations. Supabase Auth remains an external endpoint; whether it is managed or self-hosted is not yet confirmed. The compose stack has not been used for a complete live integration/deployment rehearsal.
- Lab 3–5 editable documentation and source models, and team-only change rationale at `/home/ubuntu/sc2006/team-private/CHANGE_RATIONALE.md`. The Markdown-derived PDFs were regenerated for this checkpoint, but diagram exports remain stale and course-evidence TODOs are still open; do not treat those as completed evidence.

## Verified locally

| Check | Result | Limits |
|---|---|---|
| Backend automated suite: `PYTHONPATH=/tmp/sc2006-backend-deps python3 -m pytest -q` | 74 passed | Includes resource schema, OneMap address normalization, duplicate-result, school-name/pagination and transport-retry cases. |
| Frontend production build: `npm run build` | Passed | Build only; not a deployment. |
| Local PostGIS migrations and API smoke (24 Sep baseline) | Passed: migrations `001`–`004`; `/health`, `/api/v1/sources`, `/api/v1/resources`, `/api/v1/homes`, and `/api/v1/search` returned successfully. At that earlier checkpoint, OneMap had not yet run. | Historical smoke result; it does not describe the current geocoding coverage or verify a new browser flow. |
| OneMap/PostGIS coverage (29 Sep) | 241,148/241,148 HDB transaction rows located across 9,750/9,750 distinct addresses; 337/337 MOE schools located; zero failed/unlocated home addresses and zero out-of-bounds home points. A subsequent `--retry-failed` command returned `already_complete`, zero requests and zero unmatched counts. | Checked the configured local database and CLI. This verifies geocoding, not routing, admission eligibility, current listing availability or browser rendering. |
| Premium UI source verifier: `npm run verify:premium` | Passed | Static checks; not a substitute for accessibility/user review. |
| Browser smoke | Earlier smoke passed for `/`, `/login`, `/signup`, `/explore` using cached Chromium/Puppeteer fallback | The newly added source-map overlays were build-checked but not browser-interaction-tested. No live sign-in or model call was exercised. |
| Filter dialog accessibility/style smoke | Passed: a `DialogTitle` labels the dialog; overlay computed blur is `12px`; dialog/overlay stacking is 100/90 | Basic smoke only, not a full screen-reader or keyboard audit. |
| Diagram check: `npm run diagrams:check` | Source files were enumerated | It did not render/regenerate exports or validate semantic diagram consistency. |
| Written-deliverable PDF export: `npm run docs:export` | Passed after a scoped local-browser permission retry; 13 Lab 3–5 PDFs regenerated on 24 September 2026 | Markdown-derived PDFs were regenerated; current architecture/use-case diagram render exports are still stale and need a renderer/visual review. |
| Docker Compose configuration | Valid with `docker compose --env-file .env.example config` | Parses configuration only; placeholder credentials intentionally leave external providers disabled. |
| Docker/runtime integration | Not run | User requested native local execution; Docker was not started. Migrations were applied to the configured local PostgreSQL/PostGIS database. |

## Decisions recorded and still open

| Area | Current record | Remaining gate |
|---|---|---|
| Identity | Supabase Auth, email/password + Google OAuth | Managed or self-hosted Supabase Auth topology; credentials, callback configuration and end-to-end verification. |
| AI | Gemini API; current Interactions API integration and configurable model default | Approved monthly spend cap and confirmation of model/rates before enabling calls. |
| Local hosting | Docker/self-hosted | Compose runtime rehearsal; no external host/public URL was selected or authorized. |
| Map/location | OpenStreetMap tiles; public amenity/zone data imported; all current HDB addresses and MOE schools geocoded with OneMap in local PostGIS | The short-lived token needs renewal for future imports. Route estimates and live user-entered address lookup remain unimplemented/unverified. |
| Scoring | Tested weighted-average preview utility that excludes unavailable values and reports coverage | Team-approved ranking formula, default weights, incomplete-data rule and tie-break policy. No ranked HDB results are claimed. |
| Data | HDB resale + 14 public source datasets imported into local PostGIS; current HDB and MOE address geocoding complete | Review timestamp/freshness policies and re-geocode after source refresh; audit joins between ECDA spatial/register/fee records; do not infer clinic participation, costs after subsidies, or dengue buffers. |
| Localization | English UI baseline | Confirm locale set and human-reviewed translations. |
| Course evidence | Templates, code, and test structures exist | Lab 3 actual AI transcripts/original ZIP; Lab 4 required experiments and actual test-case evidence; Lab 5 demo video/link, peer reviews, measured recovery and final export/sign-off. |

## Interpretation

This is an implementation-in-progress and locally integrated demonstration, not a feature-complete or production-ready release. Fixture data is labeled and may not be represented as government evidence. Public datasets and verified current HDB/MOE point geometry are present locally, but route estimates, current listing availability and a final approved scoring policy are still absent. A passing build/test is not proof of OAuth, routing, production recovery, deployment, course-experiment completion, recording, or TA acceptance.
