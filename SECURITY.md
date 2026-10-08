# Environment and secret handling

## Local setup

- Keep root `.env` and frontend `.env.local` on the developer's machine. Both are ignored by Git.
- Commit root and frontend `.env.example` templates. They contain public defaults, blank fields
  and conspicuous replacement placeholders only. Never put a working credential in a template.
- Never commit database passwords, `DATABASE_URL`, Supabase service-role keys, data.gov.sg
  private keys, OneMap tokens or Gemini keys. Keep backend credentials server side.
- `NEXT_PUBLIC_*` values are intentionally public browser configuration. The Supabase publishable
  key may be used there; passwords, tokens, service-role keys and database URLs must not.
  Next.js embeds `NEXT_PUBLIC_*` values in browser JavaScript at build time.

## GitHub Actions

CI scans Git history for secrets, runs unit/contract tests, builds the frontend and validates
Compose configuration without live credentials.
Do not add secrets to this workflow for the checks that already run.

If a later approved deployment or external integration needs credentials, store only the required
values in a protected GitHub Environment's Actions Secrets. Grant access to the specific job or
step that needs each secret, use read-only minimum permissions elsewhere, and require approval for
production deployment. Pass individual values through that step's process environment; do not
write the complete environment to a generated `.env` file, artifact, log or cache.
Never expose secrets to fork pull-request builds or use `pull_request_target` to execute
untrusted pull-request code with credentials. The current pull-request CI is credential-free.

GitHub Actions secrets are available only to workflow jobs that explicitly receive them.
They do not automatically configure a deployed application. Configure server-side runtime secrets
in the selected hosting platform's secret store; no production host is selected here.

## Review checks

- Check `git status --short` before staging; stage named source paths and examples deliberately.
- `git check-ignore .env frontend/.env.local` should report ignored paths.
- `git check-ignore .env.example frontend/.env.example` should report they are not ignored.
- Review staged diff for credentials before every PR. If an actual secret ever enters Git history,
  revoke/rotate it immediately; removing the visible file alone does not revoke it.

This repository's local `.env.example` files use placeholders. They are intended to be committed.
