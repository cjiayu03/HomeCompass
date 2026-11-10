# Lab 4: Coding Agent Exercises and Reflections

| | |
|---|---|
| Project | HomeCompass (SC2006) |
| Prepared by | Leo, Aryash, Jia Yu |
| Assistant used | Claude Code (Anthropic) in the Claude desktop app, model Claude Opus 5.5 (`claude-opus-5-5`). The same assistant and model were used for both exercises, each in a fresh session that had no memory of earlier work. |
| Date | 4 November 2026 |
| Code base | `main` at `862201c` |
| AI use | Both exercises were carried out by the assistant, as Lab 4 §3.3 requires. This report was drafted with the same assistant, from the assistant's reports and our own checks of its output. |

## How both exercises were run

- **Isolated copy.** Each exercise ran in a separate copy of the repository, made with `git archive` so the copy had no Git history. The original repository was not touched.
- **Rules given to the assistant.** It could read and write only inside its copy. It could not use GitHub, the web or the original folder. It could create only the file the task asked for.
- **Checks afterwards.** We compared each copy with the original commit to confirm that only the requested file had been created. Then we checked the output ourselves instead of relying on the assistant's own report.

---

## Exercise 1 (§3.3.2): regenerating the ScoringService control class

### What we deleted

We deleted `backend/app/scoring.py`. It implements the «control» class `ScoringService`, the subject of our black-box tests in `Lab4/Test_Cases_and_Results.md`. Without it the backend could not start: 21 test files failed to import.

### How we prompted the assistant and what we provided

The prompt, verbatim:

> "Our backend module backend/app/scoring.py has been deleted. It implements the «control» class ScoringService from our design class diagram (score(home, request) and explain(result)). Please recreate it from scratch so the backend imports again and the scoring tests pass."

Materials named in the prompt:

- **Tests:** `test_scoring.py`, `test_search_scoring.py` and our new `test_lab4_scoring_blackbox.py` (71 tests in total).
- **Design:** `Lab3/ClassDiagram.jpg`, the README section "How the home-fit score is calculated", and section 1.1 of our test report.
- **Callers:** the five modules that import from `scoring.py`.
- **Everything else:** the rest of the codebase in the copy.

The assistant could run the tests itself, as an in-IDE agent would. We did not give it the original file, or a version with only the function bodies deleted.

### Iteration

One prompt was enough. The run took about 2.5 minutes and 18 tool calls.

- **How it worked out what to build:**
  - The import statements in the callers fixed the public names it needed (`DEFAULT_WEIGHTS`, `POLICY_VERSION`, `score_home_evidence`).
  - The tests fixed the result fields.
  - The README and our test report gave the formulas.
- **The design diagram didn't help.** The class diagram image is 29,404 pixels wide, and at the size the assistant could view, its text was unreadable.
- **The tests guided the debugging.** It ran the scoring tests twice:
  - Run 1: 70 passed, 1 failed. `test_invalid_evidence_or_target_is_reported_as_missing` failed because a negative distance was kept as the raw value instead of being reported as missing. It fixed this.
  - Run 2: all 71 passed.

### Outcome

- **All the tests pass.** The rebuilt module passes all 71 scoring tests, and the full backend suite gives 541 passed, 4 skipped: the same as with the original. We re-ran both ourselves.
- **It is bigger than the original:** 406 lines against 196. It also added `ScoringService`, `ScoringResult` and `CriterionScore` classes that match the design diagram. Nothing in the application uses them, and no test checks them.
- **It is not identical to the original.** Our tests only check chosen cases, so we compared the original and rebuilt modules on 20,000 random inputs (`Lab4/evidence/experiment1/compare_with_original.py`):

  | Difference | Random cases affected (of 20,000) |
  |---|---|
  | When there is no overall score, the original still reports each component's contribution; the rebuilt version reports none | 6,854 |
  | If the supplied weights leave out a criterion, the original uses that criterion's default weight; the rebuilt version uses 0 | 4,967 |
  | Values ending in exactly .x5 are rounded differently: the rebuilt version always rounds halves up, the original uses Python's `round()` | 567 component scores, 338 overall scores, 175 coverage values |
  | `score_distance` alone | 162 |

  None of these differences is caught by our 71 tests.

The rebuilt file is kept as `Lab4/evidence/experiment1/scoring_rebuilt.py`. It is renamed so the application never loads it.

### Did it meet our expectations?

**It did better than we expected at producing working code.** We expected some failing tests, or a request for the function skeleton. Instead it reached a passing suite in one prompt and two test runs. The tests and the written formula were enough to rebuild the main behaviour.

**It also showed us the limits of our tests.** "All tests pass" did not mean "same behaviour". The assistant had to guess wherever the tests and documents were silent, and each guess was reasonable but different from the original:

- how to round exact halves;
- what to report when there is no score;
- what a missing weight means.

The rebuilt version's rounding may even match the database's ranking rounding (PostgreSQL rounds halves away from zero) better than the original does. We could not confirm this, because the database was not available during the check.

### What we would do differently

- **Add tests for the gaps the comparison found:** an exact .x5 boundary for each rounding step, a partial weights dictionary, and the contributions when coverage is below 50%. With those tests, a regenerated class would have to match the original exactly.
- **Give the assistant a readable design.** A cropped image of the `ScoringService` part of the diagram, or a text version, would have let it check the design itself.
- **Ask for a minimal implementation.** The unused classes it added would have been left out.

---

## Exercise 2 (§3.3.3): generating the updated class diagrams for Lab 5

### Which experiment we chose and why

We chose the manual's suggestion "attempt to generate the updated class diagrams required for your Lab#5 SDLC submission". Our Lab 3 diagram is out of date, and Lab 5 §3.2.2 requires class diagrams that match the current code, so the output would be useful as well as an experiment.

### How we prompted the assistant and what we provided

The prompt, verbatim:

> "Our Lab 3 design class diagram (Lab3/ClassDiagram.jpg) is out of date. For the Lab 5 submission we need updated class diagrams of the key classes and their relationships, reflecting how the codebase is arranged now. The lab manual says: 'use your judgement to present the most important classes in detail; minor details of the system can be omitted or simplified.'
> Please write Lab5/ClassDiagram.md containing:
> 1. One or more Mermaid classDiagram blocks covering the key classes of the current system, grouped sensibly. Use the «boundary», «control» and «entity» stereotypes like the Lab 3 diagram. Where the Python or JavaScript code implements a design class as a module of functions rather than a class, show it as a class with the stereotype and note the module path.
> 2. Below each diagram, a short table mapping every diagram class to the file(s) that implement it.
> 3. A section 'Changes since Lab 3' listing classes added, removed or renamed compared with Lab3/ClassDiagram.jpg.
> Only show attributes and methods that actually exist in the code. Do not invent anything."

We also asked it to check every class, attribute and method against the code before finishing. It had the whole codebase: backend, frontend and database migrations, plus the Lab 3 diagram.

### Iteration

One prompt was enough. The run took about 9 minutes and 41 tool calls.

- **Reading the old diagram.** It could not read the oversized Lab 3 image at the size it was shown. On its own initiative it wrote a small script that ran macOS text recognition over overlapping tiles of the image, which recovered almost all the class names and members. Relationship lines and multiplicities could not be recovered.
- **Choosing the classes.** It traced each use case from the UI page to its API route, then to the service module, then to the database table.
- **Drafts and self-checks.** It wrote one draft, then ran two self-check passes:
  - **Pass 1, by hand,** found four wrong relationships, which it fixed:
    - `MapView` makes no API calls; the calls are in `MapPanel` and `MapAddressSearch`.
    - `ComparisonView` does not use the planning provider directly.
    - The Sources page loads its data through `WorkspaceProvider`.
    - Three AI functions return tuples, not the model types it had first written.
  - **Pass 2, a script,** checked all 405 members against their source files. The script's first version failed, because macOS `sed` lacks a feature it used, so it rewrote the script. After that, the only change was correcting three column types from `float` to `double`.

### Outcome

`Lab5/ClassDiagram.md` contains:

- six Mermaid diagrams: search and scoring, AI assistance, accounts and sessions, profile and places, saved work and planning, and data ingestion, resources and maps;
- 80 distinct classes and 97 relationships;
- a class-to-file mapping table after each diagram;
- a "Changes since Lab 3" section listing renamed, added and removed classes, each with a reason.

**Our own checks:**

- **Every method is real.** We extracted all 151 methods from the diagrams. Each one has a real definition in the code (`def`, `function`, `const …=`), so none is invented.
- **A sample of attributes checks out.** All 40 attributes in a random sample exist in the code or the database schema.
- **The copy was otherwise unchanged.** Only `Lab5/ClassDiagram.md` was added.
- **Rendering was checked later.** All six diagrams render with Mermaid 11.4.1.

### Did it meet our expectations?

**It met them on accuracy and exceeded them on effort.** We expected invented method names, a common problem when AI tools describe code. Instead its self-checks found and fixed real mistakes, and our own checks found no invented members. We did not expect it to find its own way to read the oversized Lab 3 image.

**Some judgement calls need the team's review.** The output is a design view, not a literal copy of the code, so the team needs to agree with these choices:

- It grouped the route functions in `main.py` into design classes such as `SearchController` and `MapController`, and gave many modules design names (for example `PostgresRepository` for `database.py`). These classes do not exist in the code. A team member spotted this on review: our checks had confirmed that every method exists, but not that every class name does. We renamed each box to its real module (`main`, `database`, `scoring` and so on), as in our SRS code-level diagram, and kept the Lab 3 name in a note for traceability.
- It treated the React context providers as «control» classes.
- It marked `HouseholdMember` as removed, because no application code uses its table.
- The diagrams are long: 1,115 lines in total. For the Lab 5 presentation we would show only the diagram for the use case we trace.

### What we would do differently

- **Supply the old diagram as text.** A readable source for the Lab 3 diagram, such as its original diagram file, would have avoided the workaround with text recognition and recovered the relationships too.
- **Tell it to use real class and module names**, and check names as well as members. We checked every method but missed the invented class names.
- **Ask for one diagram per demo use case first.** That gives a smaller output that is easier to review, before asking for full coverage.
- **Render the Mermaid** (for example at mermaid.live) as part of the task, to catch syntax problems early.

---

## Summary

| | Exercise 1 | Exercise 2 |
|---|---|---|
| Task | Regenerate the deleted `ScoringService` (`scoring.py`) | Generate updated Lab 5 class diagrams |
| Prompts needed | 1 | 1 |
| Assistant's own iterations | 2 test runs | 1 draft and 2 self-check passes |
| Result | All 71 scoring tests and 541 backend tests pass | 6 diagrams, 80 classes; all 151 methods verified |
| Main lesson | Passing tests did not guarantee identical behaviour. Our tests need cases at the rounding and missing-weight boundaries. | Accurate when asked to verify against the code, but the design-level grouping needs human review |
