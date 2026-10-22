# HomeCompass local authentication design

## Context

HomeCompass currently uses Supabase Auth for email/password and Google sign-in. The FastAPI service verifies Supabase access tokens, while application-owned records already live in the local Postgres/PostGIS database. The frontend keeps a browser workspace and optionally syncs it to account-owned rows.

The goal is to remove the external identity-provider dependency and Google sign-in, while keeping account-backed features on the existing local stack. Current Supabase identities are explicitly out of scope for migration.

## Goals

- Support local email/password registration, sign-in, sign-out, and password changes.
- Keep authentication, sessions, and account data within FastAPI and the existing Postgres database.
- Preserve the current account-scoped API boundary and revoke sessions on logout/account deletion.
- Remove Supabase and Google auth configuration, client libraries, callback handling, and documentation.
- Leave existing Supabase-linked Postgres rows untouched and unlinked; new accounts start with new IDs, even when using an email present on an old row.

## Non-goals

- Import, merge, or delete current Supabase identities or their associated local rows.
- Email verification, password-reset email, Google/OAuth, or a hosted identity service.
- Onboarding changes. Signup continues to enter the current app flow; onboarding is a separate follow-up.

## Identity and persistence

FastAPI owns account registration and credential verification. Add a `local_auth_identity` table containing `user_id`, normalized unique email, Argon2id password hash, and timestamps. Add a `local_auth_session` table containing `user_id`, a unique hash of the session token, creation/expiry timestamps, and revocation state. Both tables reference `user_account(id)` with cascading deletion.

New local accounts receive a new UUID and a `user_account` row with a null email. Their email lives in `local_auth_identity`; this avoids colliding with legacy `user_account.email` values and ensures a new signup never implicitly claims old saved records. Existing rows and their saved data are not modified. The current `user_account.email` uniqueness constraint can remain.

Registration validates and normalizes email and accepts passwords of 8–128 characters. Hash passwords with Argon2id; never store plaintext passwords or raw session tokens. Rate-limit unauthenticated registration and login attempts. Login failures use a generic invalid-credentials response. A database outage returns the existing explicit storage-unavailable response.

## Session and request flow

Login and successful registration issue a cryptographically random opaque session token. Store only its SHA-256 hash in Postgres. Return the raw token only in an `HttpOnly`, `SameSite=Lax`, path-wide cookie with a 30-day expiry; set `Secure` when HTTPS is used (`AUTH_COOKIE_SECURE=true`, false for local HTTP). Logout revokes the matching database session and clears the cookie. Expired or revoked tokens fail authentication.

FastAPI's `require_user` resolves the cookie against `local_auth_session`; protected routes continue to use `require_active_user`. The backend user object includes the local user ID but does not copy the auth email into `user_account`, preserving legacy email uniqueness. A session endpoint returns the signed-in user's email to the frontend.

Because the browser calls the API directly, frontend API requests include credentials. FastAPI allows credentials only for explicitly configured `CORS_ORIGINS`; every state-changing browser request must carry an `Origin` matching that allowlist, including registration and login. This protects state-changing routes from cross-site requests. The local frontend and API use the same hostname (for example, `localhost`) on their existing separate ports.

## API and frontend changes

Add additive schema migration 008 for local identities and sessions, update backend migration-readiness checks, and make the Compose migration service apply the complete existing chain through 008, including 007 for saved searches. Add local auth endpoints under `/api/v1/auth`: register, login, logout, current session, and change password. Password change verifies the current password and revokes other sessions. Add a local operator command that prompts for a new password without echoing it, for recovery when no email service exists.

Replace Supabase behavior in `AuthProvider`, `AuthForm`, `AppShell`, `WorkspaceProvider`, the account page, and direct authenticated fetches. Centralize cookie credential handling in the API client and include it on direct `fetch` calls. Keep email/password forms; remove the Google button and unused name metadata. Account deletion removes the local account and cascaded records/sessions in one database transaction; it makes no Supabase request.

Remove the Supabase callback route, session proxy, Supabase client helpers, `@supabase/*` dependencies, Supabase environment variables and Docker build arguments. Update README/backend setup guidance and account/privacy copy to describe local auth and its recovery limitation. No Supabase data or credentials are read or altered as part of cutover.

## Error handling and verification

- Duplicate local email: clear registration error with a sign-in path.
- Wrong email/password, expired session, or revoked session: generic sign-in/session error; clear the invalid browser cookie.
- Password change: require the current password; on success revoke other sessions and retain the current session.
- Missing database: auth endpoints return a clear `503`; no in-memory fallback account is created.
- Apply schema migration 008 additively; do not drop or rewrite existing account rows.

Per the user's instruction, do not run automated tests. Before implementation is reported complete, run the frontend production build and non-test backend syntax/import checks; report any verification limitations.

## Implementation boundary

This design covers replacing Supabase auth only. The already-started, uncommitted 3D map work is separate and must remain untouched. The onboarding page is deferred until local auth is complete.
