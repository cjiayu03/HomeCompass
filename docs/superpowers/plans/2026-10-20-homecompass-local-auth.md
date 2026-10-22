# HomeCompass Local Authentication Implementation Plan

## Goal

Replace Supabase Auth with local email/password accounts and database-backed sessions, preserving account-scoped HomeCompass features. Do not implement onboarding in this phase.

## Architecture

The browser talks directly to FastAPI with `credentials: 'include'`, using the same hostname for frontend and API (for example, `localhost` on ports 3000 and 8000). FastAPI stores Argon2id password hashes and SHA-256 hashes of opaque session tokens in Postgres. The browser receives only an HttpOnly session cookie. Existing API handlers continue to receive a local user ID through `require_active_user`.

Routes:

- `POST /api/v1/auth/register` and `/login`: validate credentials, create/verify the identity, create a DB session, set the cookie; return `{ "user": { "id", "email" } }`.
- `POST /api/v1/auth/logout`: revoke the current session, clear the cookie, return `{ "ok": true }`.
- `GET /api/v1/auth/session`: return `{ "user": null }` when signed out, otherwise `{ "user": { "id", "email" } }`; clear an invalid/expired cookie.
- `POST /api/v1/auth/password`: verify current password, update the hash, revoke other sessions, and retain the current session.

The cookie is HttpOnly, SameSite=Lax, path `/`, and expires after 30 days. `AUTH_COOKIE_SECURE` controls its Secure flag. CORS remains limited to explicit `CORS_ORIGINS`; unsafe browser requests require an Origin in that allowlist.

## Tech Stack

Existing FastAPI, asyncpg, Postgres/PostGIS, Next.js, React, and npm workspaces. Add `argon2-cffi==25.1.0` for password hashing. Keep existing API and database ownership boundaries.

## Spec

Implement [the approved local-auth design](../specs/2026-10-21-homecompass-local-auth-design.md). Existing Supabase identities and rows are not imported, linked, modified, or deleted. A new account always gets a fresh UUID and a `user_account` row with null email. Migration `008` is additive; Compose applies the full migration chain `001`–`008`, including existing `007_saved_searches.sql`.

### Task 1 — Schema and auth primitives

1. Add `database/migrations/008_local_auth.sql` with `local_auth_identity` and `local_auth_session`, unique normalized email and token-hash constraints, timestamps, expiry/revocation state, and cascading foreign keys to `user_account(id)`.
2. Add `argon2-cffi==25.1.0` in `backend/requirements.txt` and implement `backend/app/local_auth.py` helpers: email normalization, 8–128-character password validation, Argon2id hash/verify, cryptographically random token generation, and SHA-256 token hashing. Never persist plaintext passwords or raw tokens.
3. Extend `backend/app/migrations.py` schema verification and latest version from 7 to 8, checking the new tables and required columns/constraints. Update `backend/app/readiness.py` to report local-auth readiness rather than Supabase configuration.
4. Update the `migrate` service in `docker-compose.yml` to apply migrations `001` through `008` in order; pass `AUTH_COOKIE_SECURE` to the API with a local-HTTP-safe default.

### Task 2 — Backend account/session lifecycle

1. Add request schemas in `backend/app/schemas.py` for registration/login and password change. Validate normalized email and password length before persistence.
2. Add transaction-safe database operations in `backend/app/database.py` (or a narrowly scoped auth repository there): create a fresh user and identity atomically; look up identity by normalized email; create/resolve/revoke sessions by token hash; update a password; delete a local account transactionally. Duplicate local email must map to a clear registration error that points toward sign-in. Never write the local auth email to legacy `user_account.email`.
3. Replace Supabase/Bearer verification in `backend/app/security.py` with an HttpOnly-cookie session resolver. Preserve `require_user` and `require_active_user` semantics so private routes remain account-scoped; invalid, expired, and revoked sessions do not authenticate.
4. Add the five `/api/v1/auth` operations in `backend/app/main.py`. Set/clear cookie attributes from configuration, rate-limit registration/login with the existing limiter, use generic wrong-credential errors, and return a clear 503 if Postgres is unavailable. Enforce the configured Origin allowlist on state-changing browser requests, including auth requests. Keep CORS credentialed and allow only configured origins.
5. Replace the Supabase admin deletion in `DELETE /api/v1/account` with one local transaction so account-owned rows and auth sessions cascade. Add `backend/app/auth_admin.py` with a `python -m app.auth_admin set-password <email>` operator command that prompts without echoing, updates the local password hash, and revokes existing sessions.

### Task 3 — Frontend auth and cookie requests

1. Replace Supabase logic in `frontend/components/auth-provider.jsx` with a context exposing `{ user, loading, signIn({email,password}), signUp({email,password}), signOut(), refreshSession() }` backed by the local auth endpoints.
2. Update `frontend/components/auth-form.jsx` and auth pages to keep email/password only; remove Google and unused name metadata. Keep the current post-signup app flow; onboarding is deferred.
3. Update `frontend/lib/api-client.js` so `requestJson` defaults to `credentials: 'include'`. Refactor `frontend/components/workspace-provider.jsx` to use the auth user state for signed-in behavior and cookie credentials for every account/sync request; remove access-token and Bearer-header handling.
4. Update `frontend/components/app-shell.jsx`, `frontend/app/(workspace)/account/page.jsx`, and `frontend/app/(workspace)/explore/page.jsx` for the local user/session shape. Include credentials on direct fetches, implement current-password/new-password UI, and retain account deletion with clear local-auth/privacy wording.

### Task 4 — Remove Supabase configuration and documentation

1. Remove `frontend/app/auth/callback/route.js`, `frontend/proxy.js`, and `frontend/lib/supabase/{browser,config,proxy,server}.js`; remove `@supabase/ssr` and `@supabase/supabase-js` from `frontend/package.json` and regenerate the lockfile without disturbing the existing 3D-map dependency changes.
2. Remove Supabase variables/build args from root and frontend `.env.example`, `frontend/Dockerfile`, and `docker-compose.yml`. Keep unrelated integrations and map configuration intact.
3. Update `README.md`, `backend/README.md`, and `ops/README.md` with local-auth setup, migration 008, cookie configuration, and the no-email recovery limitation. Search the app/docs for stale Supabase auth claims and remove only auth-provider references; do not alter external data-source usage unrelated to Supabase Auth.

### Task 5 — Non-test verification and handoff

1. Run `git diff --check`.
2. Run `python -m compileall -q backend/app` and a non-test backend import/startup check that does not require external credentials.
3. Run the frontend production build with `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000 npm --workspace frontend run build`.
4. Use `rg` to confirm no active Supabase auth/client/env references remain. Inspect the final diff and status to confirm the uncommitted 3D-map work remains intact and no unrelated deliverables are staged.

## Global Constraints

- Do not run, add, or modify automated tests; the user asked to skip tests. Do only the syntax/import, production-build, and diff checks listed above.
- No Supabase account/data migration, linking, deletion, or requests. Do not add Google, verification-email, or password-reset-email flows.
- Keep all auth and session persistence in the existing local Postgres database; no in-memory fallback.
- Use Argon2id for passwords and store only SHA-256 hashes of random session tokens.
- Preserve existing legacy account rows and `user_account.email` uniqueness; local identities use a separate normalized email field.
- Onboarding is deferred until auth is complete.
- The existing uncommitted 3D-map changes are separate user work. Preserve them, including their `package.json`/lockfile changes; do not stage or commit them as part of auth.
- Do not push.

## Review Focus

- A new local signup using an email present on a legacy row always receives a fresh UUID and cannot access that row's saved data.
- Passwords and session tokens are never stored in plaintext; cookie flags, expiry, logout, revocation, and password-change behavior are consistent.
- CORS is explicit and credentialed, while Origin validation covers every state-changing browser request and does not accidentally weaken other API boundaries.
- Account deletion and operator password recovery have clear transaction and session-revocation behavior; DB outages fail closed.
- Compose/readiness require migration 008 without skipping migration 007, and Supabase auth references are removed without touching unrelated external data integrations.
- Frontend lockfile changes preserve the already-started 3D-map dependency work.
