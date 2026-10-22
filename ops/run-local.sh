#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"
backend_python="${HOMECOMPASS_PYTHON:-$project_root/.venv/bin/python}"
if [[ ! -x "$backend_python" ]]; then
  echo 'Create .venv and install backend/requirements.txt, or set HOMECOMPASS_PYTHON to its Python executable.'
  exit 1
fi
"$backend_python" ops/native_database.py
(cd backend && exec "$backend_python" -m uvicorn app.main:app --host 127.0.0.1 --port 8000) &
api_process=$!
trap 'kill "$api_process" 2>/dev/null || true' EXIT INT TERM
BACKEND_URL=http://127.0.0.1:8000 NEXT_PUBLIC_API_BASE_URL= npm --workspace frontend run dev -- --hostname 127.0.0.1 --port 3000
