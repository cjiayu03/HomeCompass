# HomeCompass

HomeCompass is an SC2006 prototype for exploring Singapore HDB resale homes and neighbourhood information. Browse homes on a map, check source information, and try the shortlist and comparison views. Sample results are illustrative.

## Run the frontend

Requires Node.js 22 or later and npm. From the repository root:

```bash
npm ci
npm run dev
```

Open http://localhost:3000. The frontend can show sample results without a backend. Saved data and source information need the API and database.

## Run the full application

Install Docker, then copy `.env.example` to `.env`. Set a local database password in `POSTGRES_PASSWORD` and use the same password in `DATABASE_URL`, with `database` as its host. From the repository root:

```bash
docker compose config --quiet
docker compose up --build -d
```

Open http://localhost:3000. Check API status at http://localhost:8000/health. To stop the services:

```bash
docker compose down
```

## Run the API without Docker

Requires Python 3.12. From the repository root:

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
cd backend
../.venv/bin/python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

The API health check and documentation are at `/health` and `/docs`. Without PostGIS, persistent data routes are unavailable.

## Import data (optional)

With the Docker stack running, you can import the source snapshots:

```bash
docker compose run --rm api python -m app.sources.data_gov_sg
docker compose run --rm api python -m app.sources.data_gov_resources
docker compose run --rm api python -m app.sources.onemap_geocode --home-limit 100 --school-limit 400
```

Geocoding needs a valid server-side `ONEMAP_ACCESS_TOKEN`. Imported resale records are historical transactions, not current listings.

## Run checks

```bash
cd backend
../.venv/bin/python -m pytest -q
cd ..
npm ci
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000 npm run build
```

## Environment files

Use `.env.example` as a template for local configuration. Keep `.env` and `frontend/.env.local` on your computer; never commit real credentials. Values beginning with `NEXT_PUBLIC_` are visible to browser users.
