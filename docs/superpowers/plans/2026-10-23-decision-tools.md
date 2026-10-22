# HomeCompass decision tools implementation

Goal: implement the ten approved improvements using the existing UI, local accounts and public imported data, with no paid dependencies.

Architecture: extend FastAPI search and market evidence; store account planning state in Postgres; retain browser-scoped guest planning and photo storage. Extend Explore with explicit hard requirements, preference ranking, scenarios and map overlap. Extend Shortlist/Compare with a decision board, viewing journal and printable summary.

Constraints: preserve existing work; no Git staging, commits or pushes; no course deliverable edits; no paid APIs; no full automated test suite per user preference. Use source dates, missing-data labels, historical transaction semantics and reduced-motion support throughout.

- [x] Reconnect native PostGIS and apply additive migrations; verify API readiness and local auth.
- [x] Extend parameterized search filters and historical market endpoint; add planning workspace storage.
- [x] Implement owner-scoped planning provider, scenarios, decision state and local photo persistence.
- [x] Add requirements/preference controls, explicit explainable ranking, live trade-off preview and active chips.
- [x] Add family distance overlap, hover/selection map feedback, neighbourhood summaries and robust 3D fallback.
- [x] Add historical price chart with cohorts, counts, dates and quartiles.
- [x] Add decision board, ratings, viewing checklist/photos, comparison differences and print summary.
- [x] Run production build and focused browser/API smoke, record actual limitations and leave the app running.

Verification: production build, Python compilation and whitespace checks passed. Actual API checks covered advanced filters, 24 monthly price cohorts, local signup/session, planning revisions 0–1–2, stale revision rejection, validation and account isolation. Browser checks covered signup to skippable onboarding, scenario sync, historical chart/table, notes/status persistence, IndexedDB photos after reload, comparison, escaped HTML export, PDF rendering, map overlay stacking, forced 3D failure recovery and mobile overflow. The final compact mobile map overlay was checked separately after visual review. Full automated suites were not run. Disposable verification accounts were removed.

Runtime: native private cluster is in ignored `.local/postgres`, not the main database. It contains 241,148 imported public resale records and 130,231 public resource records, copied without account data or credentials. `npm run local` starts the private database/API/frontend. Public download attempts were rejected by upstream/host validation; the existing public source cache was used instead. All code and documentation remain uncommitted; nothing was staged or pushed.

Review focus: account switching must not leak planning state; absent evidence must not become an inferred match; hard requirements must reach server search; charts must describe their cohort; photos need bounded storage; network failures must not erase saved decisions.
