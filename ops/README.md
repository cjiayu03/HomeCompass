# Self-hosted deployment preparation

## Native private development

Use Python 3.12 (or a compatible installed Python), PostgreSQL with PostGIS, and the existing Node workspace dependencies. Create a root `.venv` with `python3 -m venv .venv`, then `.venv/bin/pip install -r backend/requirements.txt` and `npm install`. Configure the private root `.env`: use an unused `POSTGRES_PORT` such as `5433`, matching `POSTGRES_USER`/`POSTGRES_DB`/`POSTGRES_PASSWORD`, and `DATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:5433/DATABASE` (URL-encode the password). Keep `AUTH_COOKIE_SECURE=false` for local HTTP and allow both `http://localhost:3000` and `http://127.0.0.1:3000` in `CORS_ORIGINS`.

Run `npm run local`. This starts this checkout's own PostgreSQL cluster in ignored `.local/postgres`, applies all SQL migrations, and starts the API on port 8000 and the frontend on port 3000. It refuses to migrate a different database cluster. To use an existing Python environment, run `HOMECOMPASS_PYTHON=/absolute/path/to/venv/bin/python npm run local`. Browser API requests use the same-origin Next.js proxy; local HTTP backend origins are supported for production builds too. Existing imported public data and geocoding remain usable when preserved in the private cluster. A fresh cluster needs source imports and geocoding as described below.

The new decision tools require migration `010_planning_workspace.sql`, including geography indexes. Scenario/decision notes sync to the signed-in local account with revision conflict detection; guest plans and viewing photos remain in this browser. Photo storage accepts JPG/PNG/WebP (5 MB input limit), resizes images, and limits each browser account to six per home and forty total. Historical price charts are descriptive transaction evidence, not valuations. Family reach uses straight-line distances, and 3D maps fall back to 2D when unavailable.

Ctrl-C stops the app processes; the private database remains running. Use the installed `pg_ctl -D .local/postgres stop` to stop it. Preserve `.local/postgres` or take a database backup before clearing temporary worktrees. Never commit `.env`, `.local` data or viewing photos.

The repository root [`docker-compose.yml`](../docker-compose.yml) builds the Next.js frontend and FastAPI backend, starts PostgreSQL/PostGIS, applies migrations `001` through `010` in order, and runs local health checks. Migrations `006`–`008` provide account sync, saved searches, and local auth; `009` adds onboarding preferences and `010` adds planning storage and search indexes. `/ready` stays pending until the full schema is present. It binds published ports to `127.0.0.1` by default. This is a local/self-hosted starting point, not a public deployment. On ARM hosts, select a compatible PostGIS image via `POSTGIS_IMAGE` or use native PostGIS.

## First run

1. Install Docker Engine and the Docker Compose v2 plugin.
2. Copy `.env.example` to `.env` and replace the local database password. Keep `.env` out of Git. If the password includes URL-significant characters, percent-encode it in `DATABASE_URL`.
3. Keep `AUTH_COOKIE_SECURE=false` for local HTTP. Use `AUTH_COOKIE_SECURE=true` when serving the app over HTTPS, and set `CORS_ORIGINS` to the exact frontend origin(s). Frontend and API URLs should use the same hostname (for example, both `localhost`, not one `localhost` and one `127.0.0.1`) so the browser sends the session cookie.
4. Build/start: `docker compose up --build -d`.
5. Check `http://localhost:8000/health` and `http://localhost:3000`, then create a local email/password account. The API will report unavailable persistence until PostGIS is healthy and migrated. Existing Supabase accounts are not migrated.
6. Import official HDB resale rows: `docker compose run --rm api python -m app.sources.data_gov_sg`. Import the registered government resource layers: `docker compose run --rm api python -m app.sources.data_gov_resources`. The latter retrieves the HDB footprint/property reference, LTA safety/school zones, MOE schools, ECDA care/fee files, MSF student-care centres, MOH points and NEA dengue polygons.
7. For HDB-home and MOE-school coordinates, register with OneMap, set the backend-only `ONEMAP_ACCESS_TOKEN`, and run bounded batches: `docker compose run --rm api python -m app.sources.onemap_geocode --home-limit 100 --school-limit 400`. OneMap tokens expire after three days. The app declines ambiguous address matches and leaves those locations unplaced.
8. To stop without deleting database data: `docker compose down`. Do not pass `-v` unless intentionally removing the PostGIS volume.

## Secrets and externally reachable deployments

- `NEXT_PUBLIC_*` values are compiled into the browser JavaScript and are public configuration only. Never place a Gemini or data.gov.sg secret there.
- A remote deployment must set `NEXT_PUBLIC_API_BASE_URL` to an HTTPS URL reachable by each browser (not `localhost`), rebuild the frontend, set an exact CORS origin list, and configure HTTPS with `AUTH_COOKIE_SECURE=true`.
- Local account recovery has no email flow; an operator must use `python -m app.auth_admin set-password <email>` from the backend environment. This also revokes active sessions.
- Gemini remains disabled until the team enters an approved monthly cap and current per-token rates. The API makes stateless (`store=false`) calls only, limits response length, and tracks budget reservations in Postgres.
- The official HDB resale-price source contains transaction attributes but no latitude/longitude. HDB/map and MOE address records remain unlocated until a registered OneMap token is configured and exact-match batches are run. Amenity layers remain source evidence, not route estimates or suitability/risk predictions.

## Operations still to complete before public release

- choose and configure address geocoding/routing, and verify licensing, quotas and attribution;
- configure a real public ingress/TLS, managed backup schedule, restore and rollback drill;
- schedule the source importer and monitor last-good snapshot/freshness/rejected-row counts;
- implement/verify rate limiting and retention cleanup against the approved policy;
- run dependency/security review, end-to-end flows, accessibility review and measured latency/recovery tests;
- fill `lab5/RELEASE.md` with actual values, record a real build revision and obtain team sign-off.

## Backup and restore outline

For a local snapshot, use `docker compose exec -T database pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > backup.dump` with variables sourced from the team's private shell environment. Store backups encrypted outside this repository. To rehearse recovery, restore into a separate disposable database, verify row counts/source snapshots/ownership and record elapsed time. No recovery target is claimed until this drill is run and measured.
