# Team handover

Updated 8 October 2026.

## Baseline and evidence

HomeCompass imports the Next.js/React, FastAPI and PostGIS prototype from
`aryashmullick/sc2006-private` at `ce64d471e2f351d2648e1704a697553e04be37c8`
(Git author `AR9157`). Branding, setup, CI and import preparation used Codex assistance.
Existing Lab1/Lab2 artifacts are retained. Confirm individual course credits with the team.

The working import branch is `chore/import-prototype-baseline`, based on local `dev` and
lab main `b97de1b50a45cb1182e3c0d4cf39e04a8a15b860`. Preparation is local and uncommitted;
no push, PR or repository protection changes have been made. Recheck remote state before work.

Pre-push checks passed: 74 backend tests, a clean frontend build on Node 22.23.3,
Compose configuration parsing and Gitleaks scans of the candidate and Git history.
GitHub CI has not run yet. Live database
imports, Supabase flows, Gemini, Docker runtime and performance/recovery targets still need
verification. No database contents or provider credentials are included. README records
startup and checks; CONTRIBUTING.md records the backlog/review workflow; SECURITY.md covers env handling.

## Code map and immediate fixes

| Area | Files | Next action |
|---|---|---|
| Shared browser state | frontend/components/workspace-provider.jsx | Fix same-origin save path, separate record cache from search results, isolate private state per account |
| Search/ranking | backend/app/main.py, domain.py, schemas.py | Current score is null; search sorts by observed_on. Agree scoring policy before implementing ranking |
| API ownership | backend/app/security.py, main.py, database.py | Verify real two-account isolation, persistence and deletion retry with Supabase |
| Saved UI | frontend/app/(workspace)/shortlist/page.jsx, compare/page.jsx | Verify reorder/sort and 2–3 record comparisons across searches/reloads |
| Map | frontend/components/map-panel.jsx, map-view.jsx | Add interactive geocoding and owner pins; batch geocoding is separate |
| Government imports | backend/app/sources/*.py | Reproduce source snapshots/geocoding, replace wildcard download host workaround with verified hosts |
| Data schema | database/migrations/001–004 | Apply in order. Add a new migration for new changes; preserve history |
| AI | backend/app/ai.py | Keep disabled pending owner-confirmed model/rates/budget; verify actual provider schema before enabling |
| Setup | .env.example, docker-compose.yml, frontend/.env.example | Use database hostname in Compose; token forwarding is now included in the export |
| Existing tests | backend/tests/test_*.py | Extend behavior tests for the assigned change; do not relabel mocked checks as live evidence |

Confirmed defects by source inspection:
- toggleShortlist reads NEXT_PUBLIC_API_BASE_URL without `|| ''`, then calls replace().
  On same-origin configuration this throws; changes remain local and the UI reports a sync failure.
- Selected/saved homes are resolved from the current homes search array. New searches replace
  that array, so IDs can outlive the records needed to render them.
- Browser storage keys are shared across users; logout/account switches need isolation.
- Profile updates ignore HTTP failure responses.

## Decisions and dependencies

Resolve live listings versus historical records; minimum five versus up-to-N results;
minimum versus maximum personal-pin distance; scoring normalization/weights/missing values/ties;
dengue buffer/freshness; childcare eligibility; languages; history retention;
Supabase topology; hosting; Gemini model/budget/rates.

Shared browser storage currently retains household/profile/shortlist data across account
changes. Fix account scoping and clear private state before enabling real multi-user use.

The requirements and tracker were last read on 3 October. Check their latest versions:

- [Requirements](https://docs.google.com/document/d/1XPU41SpH0uFbXdD0EC686Vmm3AU4vuFAPrxjPR1ZCcI/edit)
- [Team tracker](https://docs.google.com/document/d/1ls3LhpA1gNnM-XzhH_EykAtTC1E2WmXKNZa6iaZ-m2k/edit)

Lab3 editable models/use cases/architecture remain in the private source repository's `lab3/`
folder. Review them against the requirements and implementation before rendering exports.
The original AI ZIP/report and later Lab4/5 evidence remain separate coursework tasks.
Record results and contribution credits as work is completed.

## Next-agent brief

Read README.md, CONTRIBUTING.md, SECURITY.md and this handover, then inspect applicable
AGENTS.md instructions. Confirm the repository, current remote branches and import status.
Take an assigned backlog item on a branch from latest dev. Preserve Lab1/Lab2; resolve
requirements conflicts with the team. Implement observable acceptance criteria, run relevant
checks, update affected design/traceability and prepare a PR into dev with results and limits.
Push only when the human has authorized it; main releases require integration review.
