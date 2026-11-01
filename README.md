# HomeCompass

HomeCompass is a Singapore home-research workspace built around historical HDB resale transactions and public neighbourhood data. It helps households compare homes against their preferences, inspect the evidence behind results, save decisions, and revisit searches.

**Live site:** [homecompass.aryash.is-a.dev](https://homecompass.aryash.is-a.dev)

> HDB records are past transactions. They are not current listings, asking prices, valuations, or guarantees that a home is available.

## What you can do

- Search historical HDB resale transactions by budget, town, flat type, size, storey range, lease estimate, and proximity criteria.
- Explore public map layers and review the source and date information behind results.
- Compare and shortlist homes, save search criteria, and replay a past search against current data.
- View an AI evidence summary for a home when the server-side Gemini integration is configured and enabled.
- Keep account searches and decisions associated with the signed-in account.
  
**AI Summary is currently unavailable

## Technology

- Frontend: Next.js, React, Tailwind CSS, MapLibre GL, and Leaflet.
- API: FastAPI and Python 3.12.
- Persistence: PostgreSQL with PostGIS and ordered SQL migrations.
- Public data: data.gov.sg datasets and other documented government sources; OneMap is optional for geocoding.

## Run locally

### Docker Compose

1. Install Docker Engine and Docker Compose v2.
2. Copy `.env.example` to `.env` and set a local database password. Keep `.env` private and out of Git.
3. Start the stack:

   ```bash
   docker compose up --build -d
   ```

4. Open the frontend at [http://localhost:3000](http://localhost:3000). The API health endpoint is [http://localhost:8000/health](http://localhost:8000/health), and readiness is [http://localhost:8000/ready](http://localhost:8000/ready).
5. Create a local account to use account-backed features. A new local account is separate from any external identity-provider account.

Stop the services without deleting the database volume with:

```bash
docker compose down
```

For the full Docker setup, import and geocoding procedures, and backup guidance, see [`ops/README.md`](ops/README.md). Do not add `-v` to `docker compose down` unless you intend to delete the database volume.

### Native local development

The repository’s native runner starts a private local Postgres cluster, applies migrations, then starts the API and frontend:

```bash
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
npm install
cp .env.example .env
# Edit .env for local database credentials and ports.
npm run local
```

The frontend is available at `http://localhost:3000` and the API at `http://localhost:8000`. See [`ops/README.md`](ops/README.md) for prerequisites and details. You can also run only the frontend with `npm run dev` when a compatible API is already running.

## Data setup

A fresh database has no imported HDB or resource snapshots. Import the public datasets from the `backend/` directory after migrations and database configuration:

```bash
cd backend
python -m app.sources.data_gov_sg
python -m app.sources.data_gov_resources
```

Some HDB and school location evidence requires optional OneMap geocoding. Configure `ONEMAP_ACCESS_TOKEN` only in the server environment, then run a bounded import such as:

```bash
cd backend
python -m app.sources.onemap_geocode --home-limit 100 --school-limit 400
```

The data importers and API behavior are described in [`backend/README.md`](backend/README.md). Source freshness and coverage can be inspected in the app’s Sources view and through `/api/v1/sources`.

## Configuration and secrets

- Copy `.env.example` to `.env` for local setup; the checked-in file contains placeholders only.
- Keep API keys, database credentials, and SMTP credentials server-side. Never use a `NEXT_PUBLIC_` variable for a secret.
- AI interpretation and evidence summaries require a server-side `GEMINI_API_KEY`, a positive monthly budget, and configured token rates. Without these values, AI requests remain disabled.
- For HTTPS deployments, set `AUTH_COOKIE_SECURE=true` and configure exact allowed origins in `CORS_ORIGINS`.
- `frontend/.env.example` documents browser-visible frontend settings. Browser-visible variables are public configuration.

## Checks

Run the frontend test suite:

```bash
npm --workspace frontend run test
```

Run backend tests:

```bash
cd backend
python -m pytest -q
```

Build the frontend:

```bash
npm run build
```

The combined `npm run verify` script runs backend tests, frontend tests, and a production frontend build.

## Repository guide

- [`frontend/`](frontend/) — web application and frontend tests.
- [`backend/`](backend/) — FastAPI service, data importers, and backend tests.
- [`database/migrations/`](database/migrations/) — ordered PostgreSQL/PostGIS schema migrations.
- [`ops/README.md`](ops/README.md) — local and self-hosted operations guidance.
- [`docs/`](docs/) — product design, implementation plans, and behavior notes.
- [`lab3/`](lab3/), [`lab4/`](lab4/), [`lab5/`](lab5/) — course deliverables and related source materials.

## Security

Do not commit `.env` files, database dumps, API tokens, service-role keys, or private user data. Report vulnerabilities privately to the repository maintainers rather than opening a public issue.
