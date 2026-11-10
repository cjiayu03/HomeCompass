# 2006-SCSL-S1 — `HomeCompass`

Prepared by xyz. This repository contains the historical Lab 1/Lab 2 files, Lab 3–5 course materials, and a Next.js/React + FastAPI implementation for a local or Docker/self-hosted demo.

Start at [`INDEX.md`](INDEX.md). The editable Markdown/Mermaid/PlantUML sources are intentionally retained so diagrams and written documents can be reviewed before exporting PDFs/JPEGs.

## Gemini integration

See [Gemini prompts](docs/GEMINI_PROMPTS.md) for the application's exact prompt templates, illustrative inputs and responses, response schemas, validation, and configuration requirements.

## Local run

```bash
npm install
npm run build
npm run verify:premium
```

For the integrated self-hosted stack, follow [`ops/README.md`](ops/README.md) and run `docker compose up --build -d` after creating a private `.env` from `.env.example`. You do not need Docker for native local work: start local PostGIS, run the backend, and use `npm run dev`/`npm run start` for the frontend. Email/password accounts and database-backed sessions are stored locally; existing Supabase accounts are not imported. Set `AUTH_COOKIE_SECURE=true` when serving the API over HTTPS (keep the local HTTP default for development). Password recovery requires the operator command documented in [`backend/README.md`](backend/README.md). The app also includes a guarded Gemini Interactions adapter. Import the HDB resale snapshot and registered government resource layers with `python -m app.sources.data_gov_sg` and `python -m app.sources.data_gov_resources` from `backend/`.

To host the web app and API on Vercel, follow [`VERCEL_DEPLOYMENT.md`](VERCEL_DEPLOYMENT.md). It deploys the Next.js frontend and FastAPI backend as two projects and requires a managed PostGIS database for persistent records.

The five fallback records are explicitly illustrative UI samples; their addresses, prices, map points and metrics are not official data. The local database has the HDB resale snapshot plus 14 imported public government layers, surfaced on the Sources page and map. Although the raw HDB and MOE files have no point geometry, the configured OneMap geocoder located all 9,750 distinct HDB addresses (241,148 historical transaction rows) and all 337 current MOE schools in the local database on 29 September 2026; no home address or school remains unlocated. New source imports need geocoding again. Fee joins, routes, scoring policy, AI spend cap, retention, public ingress and live production operations remain open. See [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md) before describing the current build as production-ready.

For frontend-only local work: `npm run dev`. For the API, see [`backend/README.md`](backend/README.md). Never commit `.env`, API keys, or service-role credentials. The project has not been pushed or deployed.

## Submission note

Export reviewed Markdown and diagram sources to readable PDF/JPEG files for the course's requested upload format, while retaining mandatory source code, tests and the original AI ZIP required by the later lab manuals. Do not include `/home/ubuntu/sc2006/team-private/` in a TA bundle.
