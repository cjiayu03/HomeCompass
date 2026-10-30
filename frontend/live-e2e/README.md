# Live authentication checks

These Playwright checks use a real Chromium browser, the running Next.js app, and the configured local API/database. They create unique `hc-live-*@example.test` accounts and delete every account they create. Reports include only statuses and booleans; Playwright traces, screenshots, and videos are disabled.

## Prerequisites

- Start the local API/database and frontend using the repository's normal local setup.
- Confirm the API readiness endpoint reports ready and the frontend is available at `http://localhost:3000`.
- Install the locked frontend dependencies and the Playwright Chromium build.

Run the isolated suite from the repository root:

```sh
npm --workspace frontend run test:e2e:auth-live
```

The config does not start a server. Set `HOMECOMPASS_E2E_BASE_URL` and `HOMECOMPASS_API_BASE_URL` when using different local origins. Keep the frontend and API hostnames consistent with their cookie and CORS configuration.

The sanitized JSON report is written to `/private/tmp/homecompass-auth-live-report.json`. Override that location with `HOMECOMPASS_E2E_REPORT_PATH`. Playwright output files go to `/private/tmp/homecompass-auth-live-results` by default and contain no recordings or traces.

The checks cover no-JavaScript credential form method/URL behavior, browser signup/login/logout and wrong-password behavior, sign-out failure/retry, session persistence across tabs/reload, a delayed real 401 response during an account switch, real session revocation during pending guest sync, guest data retention, and successful same-account resync. The normal mocked E2E suite does not discover this directory; use the separate live config explicitly.
