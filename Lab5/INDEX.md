# HomeCompass submission index

## AI use (FAQ Q3)

We used AI tools during development and we disclose them here. Every member can explain the parts we submit.

| Where | Tool | What it did | How we checked it |
|---|---|---|---|
| Labs 1–3 | AI assistants, as the labs required | Requirement critique, technology-stack recommendation, and the initial application skeleton | Reports in [Lab 1](../Lab1/AI_Critique.pdf), [Lab 2](../Lab2/AIStackRecommendationReport.pdf) and [Lab 3](../Lab3/AIProjectInitialisationReport.pdf). The original AI skeleton is kept separately in `Lab3/OriginalAISkeleton.zip` |
| Application code | Claude Code (Anthropic), an AI coding agent | Helped plan, write and refactor features in the frontend and backend | We reviewed each change before merging it through a pull request. GitHub Actions runs a secret scan, the backend tests, a frontend build and a Compose check on every push and pull request |
| Lab 4 test cases | Claude Code | Drafted the black-box and basis-path test code | We fixed each expected result from the written scoring rule in the [README](../README.md#how-the-home-fit-score-is-calculated), not from the code, so a test can disagree with the code. We worked examples by hand (for example BB-19 = 60.7 and BB-20 = 75). We ran every case and planted four deliberate bugs, and the tests caught all four ([results](Lab4_Test_Results.md)) |
| Lab 4 coding-agent exercises | Claude Code | Rebuilt a deleted control class and drafted class diagrams, as Lab 4 §3.3 requires | Our findings, including the mistakes we caught, are in the [reflections](../Lab4/Coding_Agent_Reflections.md). The agent's draft diagrams invented some class names. The class model in the SRS uses the real classes and modules, checked against the code |
| Documentation and slides | Claude Code | Helped draft and edit parts of the documentation and the presentation slides | We checked the figures, counts and claims against the code and the live site before submitting |
| Inside the product | Google Gemini | The optional housing assistant and AI summaries for signed-in users | It runs on our server with a monthly budget. It is a product feature, separate from the development tools above |

## Lab 5 submission

- [Demo video](https://drive.google.com/file/d/1Q-R8Qwimznhnw8bJaSLYyrW1Gcc5qLE-/view) (Google Drive)
- [Final Software Requirements Specification (PDF)](SRS.pdf)
  - **Use case diagram in the SRS** · Figure 2.2, printed p. 4 ([PDF page 12](SRS.pdf#page=12)) · [Standalone image](srs-figures/use-case-model.png)
  - **Use case descriptions in the SRS** · Appendix C, printed pp. 68–101 ([PDF pages 76–109](SRS.pdf#page=76))
  - [UI mockups](srs-figures/ui-mockups/)
  - [System architecture](srs-figures/system-architecture.jpg)
  - [Full class model](Class_Model.md) · [Editable draw.io file](srs-figures/ClassModel.drawio)
  - [Key classes for structured search and scoring](srs-figures/key-classes-search-and-scoring.png)
  - [Key classes for the decision board, summary, and sharing](srs-figures/key-classes-decision-board.png)
  - [UI state machine / dialog map](srs-figures/ui-state-machine-dialog-map.png)

## Implementation and verification

- Source code · [Frontend](../frontend/) · [Backend](../backend/)
- Test cases · [Frontend](../frontend/test/) · [Browser](../frontend/e2e/) · [Backend](../backend/tests/)
- [Database migrations](../database/migrations/)
- [Operations guide](../ops/README.md)
- [Lab 4 test results on the deployed release](Lab4_Test_Results.md) · [Original case descriptions and expected results](../Lab4/Test_Cases_and_Results.md)
- [Lab 4 coding-agent exercises](../Lab4/Coding_Agent_Reflections.md)
- [Demo script](../Lab4/Demo_Script.pdf)
- [Presentation slides](../Lab4/Presentation_Slides.pdf)

## Earlier lab deliverables

- [Lab 1 requirements, dictionary, use cases, mockups and AI critique](../Lab1/)
- [Lab 2 models and stack recommendation](../Lab2/)
- [Lab 3 models, application skeleton and AI initialisation report](../Lab3/)
- [Lab 4 test evidence and demo materials](../Lab4/)
