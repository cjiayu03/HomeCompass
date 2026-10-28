# Storey-range filtering: implementation plan

## Branch and delivery

- Repository: `/Users/leo/Desktop/2006-SCSL-S1`
- Feature branch: `storey-range-filtering`
- Starting point: `79c45a2` on `feature/map-controls`
- Delivery: three sequential commits/pushes on this branch, reviewed and merged together after stage 3.
- Stages 1–3 have code and documentation changes in place. Full verification remains open: the frontend suite has failures also present on the stage 2 baseline, and isolated PostgreSQL execution was unavailable.
- No remote push is authorized. The prompts below authorize a local commit for their own stage only; push to GitHub only on a later explicit user instruction.

## Why these stages

1. Establish the interval policy and acceptance examples before changing behavior.
2. Implement the API rule and prove it independently.
3. Align local filtering, explanations, storey preferences, and final documentation.

The stages are review checkpoints on one feature branch. Review the final changes and outstanding verification limits before merging or deploying.

## Evidence from the current code

- `backend/README.md` describes intersecting ranges.
- `docs/DECISION_TOOLS.md` describes inclusive overlap and unknown evidence.
- `backend/app/main.py`, `_query_homes`, now applies inclusive overlap for active storey bounds, with strict source-band validation.
- `frontend/lib/planning.js`, `applyLocalRequirements`, uses inclusive overlap for active storey bounds.
- The same frontend file uses the shared storey parser for `evaluateHome` and `previewRank`.
- `backend/app/schemas.py`, `SearchRequest`, already validates storey bounds from 1 through 100 and rejects minimum greater than maximum. Reuse that validation.
- Backend tests such as `test_search_scoring.py` use fake database connections returning predefined rows. Such a stub alone cannot prove PostgreSQL actually filters intervals correctly.

## Stage plan

| Stage / future push | Scope | Completion evidence | Suggested commit |
| --- | --- | --- | --- |
| 1 | Policy, supported source formats, acceptance cases, existing validation coverage | Clear examples including boundaries, open bounds and unknown values; validation tests pass where added | `docs(search): define storey range overlap contract` |
| 2 | Backend SQL parsing and inclusive overlap predicates; backend regression coverage; API documentation | Returned records or meaningful SQL verification demonstrate overlap behavior; no-filter behavior and pagination preserved | `fix(search): apply inclusive storey range overlap in API` |
| 3 | Frontend parsing and overlap helper; local filtering, evidence explanations and storey preference consistency; UI guidance and final docs | Frontend cases match the contract; partial overlap is explained as possible overlap, never an exact floor; final relevant suites/build pass | `fix(search): align frontend storey filtering and explanations` |

## Policy established in stage 1

Use inclusive overlap because the source reports a transaction's storey band, not its exact floor. A reported interval `[L, U]` matches a requested interval `[min, max]` when `U >= min` and `L <= max`, omitting the comparison for an unset bound. For example, `04 TO 06` matches a requested range of `05 TO 08` but does not establish that the exact transaction floor was 5 or 6.

A home with missing, malformed or reversed source storeys is excluded when a storey must-have is active, and is not excluded solely for missing storeys when no such must-have is active. A disabled must-have does not filter. Missing evidence must be explained as unavailable, not outside the range. Retain soft-preference alternatives and define the storey-only preference contribution using the same interval policy. Avoid changes to unrelated weights, global ranking, or other features.

Verify supported source formats against the importer and stored/fixture examples before defining the parser. Do not accept arbitrary strings simply because they contain digits. Retain existing request field names and validation bounds.

## Prompt for stage 1

Copy this prompt to an implementation agent:

> Work on feature 6 only: define the storey-range filtering contract for HomeCompass.
>
> Repository: `/Users/leo/Desktop/2006-SCSL-S1`. Use the existing local branch `storey-range-filtering`. Read applicable AGENTS.md instructions and `docs/STOREY_RANGE_FILTERING_PLAN.md`. Inspect status before editing and preserve unrelated work. If on another branch or if unexpected changes overlap this task, report that before changing branches or overwriting work.
>
> Implement stage 1 only. Read `backend/app/main.py` (`_query_homes`), `backend/app/schemas.py` (`SearchRequest`), the source importer, `frontend/lib/planning.js`, `backend/README.md`, and `docs/DECISION_TOOLS.md`.
>
> Create `docs/STOREY_RANGE_FILTERING.md` as the target behavior contract. Explain inclusive interval overlap: source [L,U] matches if U >= requested minimum and L <= requested maximum, ignoring absent bounds. The input is a historical transaction storey band, so overlap is a possible match and does not reveal an exact floor. Mark the contract as a target until stages 2 and 3 are complete.
>
> Include an acceptance table covering partial overlap in each direction, full containment in both directions, equal endpoints, equal requested bounds, disjoint intervals, minimum-only, maximum-only, neither bound, missing/blank/malformed/reversed source ranges, invalid request values and min > max. Check supported source string formats against the actual importer and examples. Define identical parsing behavior for Python/SQL and JavaScript, without broadly extracting any digits from arbitrary text.
>
> Specify must-have versus preference behavior. Unknown source storeys fail active hard storey filters but stay eligible with no active hard storey filter. Disabled storey must-haves must not exclude records. Storey explanations and any storey-only preference contribution must use the same overlap rule and distinguish unknown evidence. Specify a storey-only contribution of 100 for overlap, 0 for disjoint ranges and no contribution for unavailable evidence; use one combined storey criterion when either bound is set. Do not alter other ranking dimensions.
>
> Inspect existing request-validation tests and add only missing meaningful cases for the existing 1..100 and min <= max rules. Run tests you change. Do not change runtime filter behavior in this stage or commit deliberately failing tests. Explain current containment versus the target contract honestly.
>
> Review the diff. Include the planning file in this first stage if still untracked and accurate. Create one local commit containing only this stage, suggested message `docs(search): define storey range overlap contract`. Do not push to GitHub. Report the commit, changed files, checks and the remaining work for stages 2 and 3. Stop after stage 1.

## Prompt for stage 2

Copy this after stage 1 is complete:

> Implement stage 2 of HomeCompass feature 6: backend inclusive storey-range overlap.
>
> Repository: `/Users/leo/Desktop/2006-SCSL-S1`. Use existing branch `storey-range-filtering`. Read applicable AGENTS.md instructions, `docs/STOREY_RANGE_FILTERING_PLAN.md` and the completed `docs/STOREY_RANGE_FILTERING.md`. Inspect status and the previous stage's changes. Preserve unrelated work. Verify the policy document exists before implementing.
>
> Change the storey predicates used by `_query_homes` in `backend/app/main.py` from containment to inclusive overlap: reported upper >= requested minimum; reported lower <= requested maximum. Keep values parameterized and reuse existing SearchRequest validation and API field names. Parse only the source formats defined in stage 1, with identical semantics to the planned frontend parser. Invalid/missing/reversed source intervals must not match an active storey constraint, must not cause cast errors, and must not exclude records solely for storey evidence if no storey constraint is active.
>
> Cover both POST search and GET home filtering paths where they share or independently build predicates. Preserve filtering before counting and pagination, so items and totals agree. Inspect saved-search replay/scenario paths that reuse these criteria and verify they still apply the same server rule without changing their payloads or adding unrelated replay features.
>
> Add backend regression coverage from the policy table. Verify the SQL predicates themselves and, when an isolated PostgreSQL test connection is available, execute the actual implementation-generated predicates against isolated sample rows to demonstrate inclusion and exclusion. A mock connection returning the same rows regardless of SQL is insufficient evidence of filtering correctness. Do not alter the application's real data or start an infrastructure migration. If real SQL execution is unavailable, report that limit explicitly and still add meaningful predicate/parameter coverage.
>
> Update the backend README with concrete overlap examples and unknown-data behavior. Keep the policy document accurate about backend completion and frontend work remaining. Run relevant backend tests, then the full backend suite if the focused checks pass and dependencies are available. Report blockers accurately.
>
> Review the diff and create one local commit containing only this stage, suggested message `fix(search): apply inclusive storey range overlap in API`. Do not push to GitHub. Report the commit, changed behavior, checks, remaining verification limits and frontend work still pending. Stop after stage 2.

## Prompt for stage 3

Copy this after stage 2 is complete:

> Implement stage 3 of HomeCompass feature 6: frontend parity and completion.
>
> Repository: `/Users/leo/Desktop/2006-SCSL-S1`. Use existing branch `storey-range-filtering`. Read applicable AGENTS.md instructions, including the required relevant local Next.js guide before writing frontend code. Read `docs/STOREY_RANGE_FILTERING_PLAN.md`, `docs/STOREY_RANGE_FILTERING.md` and the backend changes from stage 2. Inspect status first and preserve unrelated changes. Verify both prior stages are present.
>
> In `frontend/lib/planning.js`, introduce one reusable, strict source-storey parser and inclusive-overlap evaluator matching the contract and backend. Use it in `applyLocalRequirements` and the storey evidence in `evaluateHome`; remove duplicated digit extraction for these paths. Inspect all call sites for local preview, decision explanations, shortlist/compare summaries and restored scenarios so each follows the same rule.
>
> Match the backend's handling of missing/malformed/reversed source ranges, minimum-only, maximum-only, equal endpoints, no bounds and disabled must-haves. Unknown data must be shown as unavailable. An overlapping record must not be described as outside the requested range or as a confirmed exact floor. Soft preferences retain alternatives. Align only the storey-specific contribution in `previewRank` with stage 1: one combined criterion, 100 overlap, 0 disjoint and missing evidence omitted. Preserve other ranking dimensions and weights.
>
> Add concise helper text to the existing storey controls explaining that reported bands overlap the chosen range and exact floors are unavailable. Follow the existing UI and validation patterns, including handling min > max before applying a local search. Update `docs/DECISION_TOOLS.md` and relevant backend/frontend guidance to describe the completed behavior consistently. Mark the policy document as implemented only after required checks pass.
>
> Add meaningful Vitest coverage for the contract and for actual local filtering and decision explanations, not just helper implementation details. Confirm local/API expectations agree for partial overlap, touching boundaries, disjoint and missing data. Check that restored criteria and disabled must-haves behave correctly. Run focused frontend tests, then the frontend suite and production build; run relevant backend regression checks for the final combined change. Use an existing UI verification workflow when available to check the filter guidance and a partial-overlap example. Do not claim unrun or blocked checks passed.
>
> Review the combined three-stage diff. Create one local commit containing only this stage, suggested message `fix(search): align frontend storey filtering and explanations`. Do not push to GitHub. Report the commit, example results, checks and any unresolved limitation. Stop with the feature ready for review; do not implement dengue or address search.
