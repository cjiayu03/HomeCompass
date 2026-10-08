# HomeCompass

SC2006 software engineering project: a housing and neighbourhood exploration prototype.
The lab repository is `softwarelab3/2006-SCSL-S1`.

## Project status

This is an imported, incomplete implementation baseline from
[aryashmullick/sc2006-private](https://github.com/aryashmullick/sc2006-private), source
commit `ce64d471e2f351d2648e1704a697553e04be37c8` (Git author `AR9157`). Keep the existing
Lab1 and Lab2 work. The import does not represent a completed or team-approved release;
confirm contributor credits with the team. HomeCompass branding, setup and CI preparation
were completed with Codex assistance.

Present code includes a Next.js/React app, FastAPI API, PostGIS migrations/importers,
Supabase integration, a gated Gemini adapter and backend tests. Outstanding work includes
actual ranking, durable and account-isolated saved/compared homes, personal pins and address
lookup, travel times, validated source coverage and policy calculations, dengue freshness,
AI verification, and course deliverables. Live database, account-provider and AI journeys
have not been verified for this package. See [team handover](docs/TEAM_HANDOVER.md) for the
code map, evidence and next tasks.

There is a requirements conflict to resolve with the team before treating behavior as
correct: the shared requirements describe currently available flats, at least five matches
and a minimum personal-pin distance; later implementation notes use historical resale
transactions, up-to-N results and maximum distance. Update the requirements, design, UI and
tests together after the team decides.

## Run locally

Requires Node.js 22+ and npm. The frontend can run by itself with clearly labelled illustrative sample results. It does
not prove that government data or a database is connected.

```bash
npm ci
npm run dev
```

Open http://localhost:3000. For the API, use Python 3.12 from the repository root:

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
cd backend
../.venv/bin/python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

The API health check and docs are at http://127.0.0.1:8000/health and `/docs`. Without a
database, persistent search/source routes return 503. Development Next.js proxies `/api`
to the API. On Windows, use `.venv\Scripts\python.exe` in place of `.venv/bin/python`.

## Run with PostGIS

Install Docker, copy root `.env.example` to `.env`, replace the local database password,
and set `DATABASE_URL` to use that password and Compose hostname `database`. Then run:

```bash
docker compose config --quiet
docker compose up --build -d
```

Compose starts PostGIS, applies migrations 001–004, and starts the API and frontend. Visit
http://localhost:3000 and http://localhost:8000/health. To import source data after startup:

```bash
docker compose run --rm api python -m app.sources.data_gov_sg
docker compose run --rm api python -m app.sources.data_gov_resources
docker compose run --rm api python -m app.sources.onemap_geocode --home-limit 100 --school-limit 400
```

The geocoder needs a valid server-side `ONEMAP_ACCESS_TOKEN`; imports need verified download
hosts and a configured database. Source data is historical resale evidence, not live listings.
The repository contains schema and import code, not the friend's database or its contents.

## Environment and secrets

Keep `.env` and `frontend/.env.local` on your machine; Git ignores them. Commit the root and
frontend `.env.example` templates, which use placeholders and non-secret defaults. Never
put real credentials in GitHub Actions for the existing tests/build: CI runs without them.
Only add narrowly scoped GitHub Environment secrets if a later approved deployment needs
them. `NEXT_PUBLIC_*` settings are visible to browser users. Read [security rules](SECURITY.md)
before adding configuration.

## Checks

```bash
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000 npm run build
cd backend
../.venv/bin/python -m pytest -q
```

On 8 October 2026 the prepared baseline passed 74 backend tests, a clean frontend build on
Node 22.23.3, Compose configuration parsing and Gitleaks scans of the candidate and Git history. The current HomeCompass frontend and API health endpoint
were also checked locally. The prepared GitHub Actions workflow checks secrets, backend tests, the frontend build and
Compose configuration on branch pushes and PRs. CI has not yet run on GitHub. These checks do not verify live
database imports, authentication, AI, accessibility, recovery or performance targets.

## Course deliverables

This first code import is not the final Lab3–5 submission. Review the Lab3 models, use cases
and architecture and provide the required original AI ZIP/report. Complete and record the
actual Lab4 tests/experiments, then Lab5 SRS, updated models, demo recording and peer reviews.
Follow the lab's storage instruction to submit deliverables in PDF/JPEG format; retain
required source files and tests in the repository. See [contribution workflow](CONTRIBUTING.md)
for branch/review practice and [team handover](docs/TEAM_HANDOVER.md) for the next-agent brief.
