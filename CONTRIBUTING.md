# Team development workflow

This follows the supplied SC2006 GitHub appendix: main is stable, dev integrates ongoing
work, and each contributor branches from dev. The existing code import is attributed in
README; retain truthful author/AI assistance and experiment records.

Read [SECURITY.md](SECURITY.md) before configuring local environment files or GitHub Actions.

## Branches and review

1. Create dev from current main. Initially both point to the existing Lab1/Lab2 commit.
2. Create `chore/import-prototype-baseline` from dev for this application package.
   Open a PR with **base dev**. Keep the import and new preparation changes explicit.
3. Future work uses `feature/<issue>-<topic>`, `fix/<issue>-<topic>` or
   `docs/<issue>-<topic>`, branched from the latest dev.
4. Fetch/reconcile current dev before requesting merge. Do not rewrite another person's branch.
5. Require a teammate review and passing relevant checks; squash feature PRs into dev.
6. After integrated acceptance, source/requirements review and demo rehearsal, open dev → main.
   Tag the verified revision for the release. A baseline import is not a finished release.

Ask the repository admin to protect main and dev: PRs, one approval, required CI checks,
resolved conversations, and no force pushes/deletions. The admin should confirm these
settings; none were changed by this preparation task.

## Small Scrum cycle

Maintain one product backlog. Each item contains a requirement/use-case reference, observable
acceptance criteria, one accountable owner, reviewer, dependencies and actual evidence.
Use a board with Backlog → Ready → In progress → Review → Done. Unassigned items stay unassigned.

Use one-week sprints if that fits the actual lab schedule. Start with the sprint goal
“reproducible local setup and reliable save/reload/compare flow.”
At sprint planning select work the team can finish; in a brief daily check record progress,
next action and blockers. End with a working demonstration and a short retrospective.
Keep brief dated records of the meetings and their outcomes.

## Definition of Done

- Acceptance criteria are demonstrated and linked to the requirement.
- Relevant automated/manual tests have actual results and limitations recorded.
- A teammate reviewed the PR; CI passed; errors/empty/offline states are covered as relevant.
- Changes merged into dev; setup, diagrams and traceability updated when affected.
- Provider-dependent work remains partial until its real journey is verified.

A passing unit suite does not close OAuth, database ownership or recovery tasks.

## Proposed backlog order

Task IDs below are local planning IDs, not existing GitHub issue numbers.

| ID | Task | Completion evidence |
|---|---|---|
| B01 | Reproduce setup and import data | Teammate clean checkout, migrations, real query/source counts and provenance |
| B02 | Fix same-origin shortlist writes | Save/remove with NEXT_PUBLIC_API_BASE_URL unset and working Next.js proxy |
| B03 | Retain saved/compared homes across searches | Save A/B, search unrelated records, reload and compare A/B |
| B04 | Isolate account state | A signs out, B signs in; neither sees or writes the other's private state |
| B05 | Reconcile requirements and ranking policy | Team decision and synchronized requirements/design/tests |
| B06 | Implement criterion scoring and ranking | Worked examples, missing-data/tie/boundary tests, ranked real records |
| B07 | Pins, history and address navigation | Owner-scoped end-to-end journeys |
| B08 | Routes, care costs and source freshness | Approved semantics, provenance and boundary cases |
| B09 | AI modes, translations and usability | Configured provider evidence, shared filters/history, human review |
| B10 | Course evidence and release | Actual experiments, tested cases, synchronized exports, video and peer review |

Each feature owner supplies their tests and evidence. Documentation work runs alongside
implementation; don't leave it all to one person at the end.
