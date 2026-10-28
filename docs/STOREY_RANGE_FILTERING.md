# Storey-range filtering contract

## Status

**Stage 3 changes are in place; full verification remains open.** Backend search and frontend local requirements use the inclusive overlap rule below. Frontend explanations and the storey preference contribution use the same rule. The focused frontend checks, browser check, production build and backend regression checks passed, but the full frontend suite has failures also present on the stage 2 baseline, and an isolated PostgreSQL execution check was not available. Resolve or assess these verification limits before marking the feature fully verified.

## Meaning of a match

HDB resale records are historical transactions. A source value such as `04 TO 06` is a reported band, not the exact floor of the transaction. Overlap indicates a **possible match** with the user's requested storeys; it does not establish which floor the flat was on or that the transaction is a current listing.

For a valid source band `[L, U]` and optional requested bounds `[min, max]`, endpoints are inclusive. The band matches when both applicable conditions hold:

- If `min` is set, `U >= min`.
- If `max` is set, `L <= max`.

Omit the corresponding comparison when a bound is absent. With no active hard storey bound, do not exclude a record because of its storey data. Other filters still apply.

## Source parsing shared by backend and frontend

The importer in `backend/app/sources/data_gov_sg.py` strips outer whitespace and saves `storey_range` as text or null; it does **not** validate the range. The checked repository fixtures include `04 TO 06` and `01 TO 03`. The following is the agreed target parser, not a claim that all possible upstream formats have been surveyed:

1. The value must be text. Remove leading and trailing ASCII spaces (`U+0020`) only. Null, empty text and non-text values are unknown.
2. Match the **entire** remaining string against `[0-9]{1,3} +TO +[0-9]{1,3}`: ASCII digits, uppercase `TO`, and one or more ASCII spaces on each side of `TO`. No signs, decimal points, additional text, tabs, newlines or alternate separators are accepted. One-digit and three-digit endpoints and repeated spaces are supported by this policy even though the checked examples use two digits and single spaces.
3. Convert both endpoints to integers, including leading zeroes. A valid source band has `1 <= L <= U <= 999`. For a single-storey band use a pair such as `05 TO 05`; a bare `05` is unknown. A missing, blank, malformed, out-of-range or reversed band is unknown, not zero and not a disjoint result.
4. Python/SQL and JavaScript must implement these same steps and limits. Validate the whole bounded string before any integer cast so malformed or excessively long values cannot cause SQL cast failures. Do not use loose digit extraction. Preserve the original source text for display.

The source endpoint limit above is a parser safety bound; it is separate from the request validation limit of 100 and does not assert that the data contains floors above 100. If an upstream format changes, review the source and update the contract and both implementations together.

## Request validation

The existing `SearchRequest` accepts optional integer `min_storey` and `max_storey`, each from 1 through 100 inclusive. The lower bound must not exceed the upper bound when both are supplied; equal bounds are valid. Missing or null bounds are unset. The current Pydantic schema performs its existing integer coercions; this stage does not redefine those coercions or change the API fields. Inputs rejected by existing validation are rejected before filtering.

## Must-haves, preferences and explanations

Each requested bound can be enabled as a hard requirement or kept as a preference. Only enabled hard bounds participate in filtering. A missing or invalid source band fails an active hard storey bound because the match cannot be established; it remains eligible on storey grounds when no hard storey bound is active. A disabled hard requirement must not exclude a record. Other active requirements can still exclude it.

A preference retains alternatives. Evaluate the applicable storey preference bounds together as one combined storey criterion: a known overlapping band contributes **100**, a known disjoint band contributes **0**, and unknown evidence contributes nothing to the score or its covered weight. If neither preference bound is set, there is no storey criterion. Bounds selected as hard requirements are still evaluated in the same interval terms wherever displayed. This policy changes the storey contribution only; it does not prescribe changes to other ranking dimensions, their weights, or which results are loaded.

Explanations must distinguish overlap, disjoint and unknown. Show the reported band and describe an overlap as possible, rather than claiming an exact floor. Unknown must be described as unavailable, never as outside the target. If hard and preference bounds differ, explanations must identify which bounds they evaluate.

## Acceptance examples

These are the intended backend and frontend outcomes; see the verification status above. Each row with a hard constraint assumes the listed bounds are enabled and all other requirements pass. `—` means the bound is unset. “Eligible” means not excluded on storey grounds; the actual floor is never established by the band.

| Case | Reported band | Requested min | Requested max | Expected storey outcome |
| --- | --- | ---: | ---: | --- |
| Partial overlap, source starts below | `04 TO 06` | 5 | 8 | Eligible: possible overlap at 5–6 |
| Partial overlap, source ends above | `07 TO 09` | 5 | 8 | Eligible: possible overlap at 7–8 |
| Source contained by request | `05 TO 06` | 4 | 8 | Eligible: possible overlap |
| Request contained by source | `04 TO 09` | 5 | 8 | Eligible: possible overlap |
| Touch at lower boundary | `02 TO 05` | 5 | 8 | Eligible: possible overlap at 5 |
| Touch at upper boundary | `08 TO 10` | 5 | 8 | Eligible: possible overlap at 8 |
| Equal requested bounds | `04 TO 06` | 5 | 5 | Eligible: possible overlap at 5 |
| Single-storey source band | `05 TO 05` | 5 | 5 | Eligible: possible overlap at 5 |
| Disjoint below | `01 TO 03` | 5 | 8 | Excluded: known band is disjoint |
| Disjoint above | `09 TO 12` | 5 | 8 | Excluded: known band is disjoint |
| Minimum only, overlapping | `04 TO 06` | 5 | — | Eligible: upper end reaches minimum |
| Minimum only, disjoint | `01 TO 03` | 5 | — | Excluded |
| Maximum only, overlapping | `04 TO 06` | — | 5 | Eligible: lower end reaches maximum |
| Maximum only, disjoint | `07 TO 09` | — | 5 | Excluded |
| Neither bound | `04 TO 06` | — | — | Eligible on storey grounds |
| Missing / blank source | null / `   ` | 5 | 8 | Excluded: unknown evidence |
| Malformed source | `floor 04 TO 06` / `04-06` / `04 to 06` | 5 | 8 | Excluded: unknown evidence |
| Reversed or invalid source | `09 TO 04` / `00 TO 03` / `1000 TO 1001` | 5 | 8 | Excluded: unknown evidence |
| Unknown with no hard bound | null / `04-06` | — | — | Eligible on storey grounds; explanation says unavailable |
| Disabled hard bounds | null / `01 TO 03` | 5, disabled | 8, disabled | Eligible on storey grounds; preference may still be evaluated if selected |
| Request outside allowed bounds | any | 0 or 101 | — | Rejected by request validation |
| Reversed request bounds | any | 9 | 5 | Rejected by request validation |

For a known disjoint band retained as a soft preference, its storey contribution is 0; for a known overlap it is 100. For unknown source evidence the contribution is omitted. With one preference bound, use the same one-sided comparison as in the table.
