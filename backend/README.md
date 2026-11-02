# FastAPI service

The API uses Python 3.12, FastAPI and asyncpg. Email/password identities and hashed opaque sessions are stored in the local Postgres database. Private routes require the current database schema through migration `013_home_scoring_evidence.sql`, including the account, search, planning and cached scoring evidence tables.

## Local setup

Install `backend/requirements.txt` in the project's Python environment and apply SQL migrations `001` through `013` in order. `/ready` (also available as `/api/v1/ready` behind the frontend API proxy) reports migration readiness only after the full schema is present, including the cached scoring evidence tables. For a native local run, the backend loads the repository-root `.env` when `DATABASE_URL` has not already been exported, and maps the Compose-only `db`/`database` hostname to `127.0.0.1`. Explicit environment variables are left untouched. Start the local PostgreSQL service first, then run:

```bash
cd backend
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

The service starts without a database to support a health check, but persistence/search routes return `503` until the schema is configured. This is intentional; the API never reports fixture writes as durable.

## Search and historical market series

`POST /api/v1/search` accepts optional `min_floor_area_sqm`, `max_floor_area_sqm`, `min_storey`, `max_storey`, `min_remaining_lease_years`, `observed_after` (ISO date), and `max_price_per_sqm` filters. Area and price-per-square-metre values are in square metres and SGD respectively. A storey filter matches a transaction's reported storey range when that range intersects the requested bounds. `leaseCommenceDate` in a home result is the source's commencement year, not a full date. `remainingLeaseYears` is estimated as `max(0, min(99, 99 - max(0, current UTC year - commencement year)))`; the source's historical `remaining_lease` value is not reused. The result marks this estimate and its as-of year.

`GET /api/v1/homes` also accepts `min_storey` and `max_storey`. Both endpoints use inclusive overlap: a reported band `04 TO 06` matches a requested range `05 TO 08`, and a band ending at 05 matches a minimum of 05. The band describes historical transaction evidence and does not establish the exact floor. When a storey filter is active, missing, malformed, out-of-range or reversed source bands are excluded; without a storey filter they do not exclude a record. See `docs/STOREY_RANGE_FILTERING.md` for accepted source formats and verification status. Filtering applies before the total and page are calculated.

`GET /api/v1/market/history?town=...&flat_type=...&months=24` returns database-backed monthly points shaped as `{month, median, count, p25, p75}` in SGD. The period ends at the latest `observed_on` month in the imported HDB historical dataset, not the current date. `months` defaults to 24 and is bounded from 6 to 120. The response includes the selected `town` and `flatType`, the source snapshot timestamp as `sourceUpdated`, the latest transaction date as `latestObservedOn`, `semantics: "historical_transaction"`, `periodStart`, `periodEnd`, `sourceRecordCount` for the filtered period, and `datasetRecordCount` for the imported HDB dataset. Historical transactions are not current listings, valuations, or forecasts; the endpoint has no fixture fallback.

## Planning workspace

`GET /api/v1/planning/workspace` and `PUT /api/v1/planning/workspace` require an active account. An empty workspace returns `{ "scenarios": [], "decisions": {}, "revision": 0 }`. PUT accepts that same shape and persists the data only for the authenticated user; a successful write increments `revision`. Updates compare the submitted revision atomically and return `409` with the current revision if another write has already changed the workspace. The API limits a workspace to 50 scenarios, 200 decisions, and 112 KiB of JSON, validates the documented scenario and decision fields, and rejects extra fields and photo/image data. Photos must stay in browser-local storage and are never sent to this API.

## HDB snapshot import

After migrations and database credentials are configured, fetch the public government catalogue datasets:

```bash
cd backend
python -m app.sources.data_gov_sg
python -m app.sources.data_gov_resources
```

The resource command imports the registered HDB footprint/property layers, LTA Silver Zones and school zones, Dementia Friendly Go-To-Points, CHAS clinics, the current MOE school directory, ECDA childcare/kindergarten/centre/fee/charge sources, MSF Student Care Services and NEA active dengue clusters. After imports, it refreshes the cached nearest school, childcare and care evidence used for global fit ranking. Check import counts and source timestamps at `/api/v1/sources`; spatial layers are returned by `/api/v1/resources` and shown on the map. Address/fee CSV rows without a source geometry are preserved as unlocated records rather than given invented map pins.

Home search defaults to `distinct_blocks=true`: filters apply first, then the highest-scoring matching transaction per town/address is selected before pagination. Equal scores prefer the most recent transaction and then the record ID. Totals count blocks in this mode. Set `distinct_blocks=false` on `/api/v1/homes` or `/api/v1/search` to page all matching transactions instead.

Global fit ranking uses precomputed amenity distances so the search endpoint does not recalculate spatial nearest-neighbour evidence for every home on each request. After the first deployment of migration `013`, run `python -m app.scoring_evidence` once with the API database environment configured. The HDB, resource and OneMap geocoding import commands refresh this cache after successful imports. Until a complete cache matches the current home and resource snapshots, search remains available with ranking marked unavailable.

The importer calls data.gov.sg's initiate-download and poll-download endpoints, checks the returned HTTPS host against `DATA_GOV_SG_DOWNLOAD_HOSTS`, caps response and record sizes, validates expected columns/values, hashes the response, counts rejected rows and transactionally promotes the normalized snapshot. For this local import only, `.env` currently sets `DATA_GOV_SG_DOWNLOAD_HOSTS="*"` because the export endpoint returned a regional Amazon S3 URL. This wildcard still requires HTTPS and does not follow redirects. Before deploying the importer, replace it with the exact verified download host(s). Imported records are historical resale transactions. The dataset has no coordinates; geometry stays `NULL` and geocoding status stays pending until the team chooses and configures a provider. The importer does not represent rows as available homes.

To refresh only NEA active dengue clusters, run from the repository root using the configured local environment:

```bash
cd backend
../.venv/bin/python -m app.sources.data_gov_resources d_dbfabf16158d1b0e1c420627c0819168
```

The importer brackets the GeoJSON export with data.gov.sg metadata and records a publication time only when both metadata reads agree. The map's 48-hour display window is an application freshness rule, not an NEA update guarantee; downloading an old export does not make it fresh. `FMEL_UPD_D` is the feature-record update date, not a case-report date. Check `/api/v1/sources` or the map legend for the current source state and as-of time.

`DATA_GOV_SG_API_KEY` is optional for limited exploration and recommended for regular workflows. Never put it in the browser bundle.

## OneMap geocoding

The raw HDB resale and MOE school files do not supply point geometry. Register for SLA OneMap, set `ONEMAP_ACCESS_TOKEN` in the repository-root `.env` (server-side only), then geocode small sequential batches:

```bash
cd backend
python -m app.sources.onemap_geocode --home-limit 100 --school-limit 400
```

The token expires after three days. HDB street abbreviations are expanded before matching; a home needs an exact block/street match with one unique six-digit postal-code location. This ignores nearby points of interest whose OneMap postal code is `NIL` and car-park results. When multiple valid postal points remain, the latest imported official HDB building postcodes and building-footprint containment are used as tie-breakers; unresolved ambiguity stays unlocated. School postcodes are normalized to six digits, and a shared postcode is accepted only when exactly one OneMap building name matches the school. Search results are paged through so large campuses can be matched. Each run records a OneMap provenance snapshot. Use `--retry-failed` after a matcher change to revisit previously unmatched addresses. The default delay is 1.1 seconds; `--pause-seconds 0.5` stays well below [OneMap's published 300 calls/minute token limit](https://www.onemap.gov.sg/apidocs/static/media/OneMap_API_Workshop_Presentation_260825.04f72136081dd249c5ee.pdf). Never set this token with a `NEXT_PUBLIC_` prefix.

## Authentication and account deletion

The API creates local email/password accounts and issues a 30-day HttpOnly, SameSite=Lax session cookie. Passwords use Argon2id hashes; session tokens are stored only as SHA-256 hashes. `AUTH_COOKIE_SECURE` defaults to `false` for local HTTP and must be `true` behind HTTPS. Keep the frontend and API on a consistent hostname (for example, use `localhost` for both), and set the exact browser origins in `CORS_ORIGINS`. New signups receive new account IDs; existing identity-provider accounts and rows are not imported or linked.

There is no email-based password reset. An operator with backend access can reset a password and revoke all existing sessions with `python -m app.auth_admin set-password <email>` from `backend/`; the command prompts without echoing the password. Account deletion removes the local account and its dependent records and sessions transactionally.

## Gemini interpretation and evidence summaries

`/api/v1/ai/interpret` uses the Gemini Interactions API, defaults to `gemini-3.5-flash-lite` for free-tier mode and `gemini-3.8-flash` otherwise, uses a strict JSON schema and sends `store=false`. `GEMINI_MODEL` overrides the default. It sends only the search phrase, not account or profile data. `/api/v1/ai/summaries/{home_id}` summarizes a historical transaction alongside sourced nearest-service distances and the current policy-evaluated dengue state. Observations cite the supplied evidence keys; the response includes source dates and limitations. Straight-line distance is not a route, and a route is reported as unavailable until a user-selected origin is supplied. Both endpoints require an authenticated session and share the AI request limiter.

Calls require `GEMINI_API_KEY`, a monthly budget and input/output rates. For a Google Free Tier project, explicitly set `GEMINI_FREE_TIER=true`, `GEMINI_MONTHLY_BUDGET_USD=0`, and both `GEMINI_INPUT_USD_PER_MILLION` and `GEMINI_OUTPUT_USD_PER_MILLION` to `0`. The app cannot verify the project's billing tier or prevent charges if it is upgraded. For paid usage, configure a positive budget and current rates; the database reserves a bounded cost before each call and records actual usage when token counts are available.

## Health and privacy

`GET /health` exposes configuration state (not secrets). Search history and personal places are account-owned. Successful signed-in searches are recorded with the criteria, scoring policy version, and source snapshot IDs returned by that run. Replaying history keeps the saved criteria and uses current source data and scoring; it does not restore an old data snapshot.
