# Gemini application prompts

Recorded on 10 November 2026 from the application source. This document covers runtime prompts sent by HomeCompass to Gemini. It does not record prompts used by coding assistants during development.

The implementation is the source of truth: [ai.py](../backend/app/ai.py) builds the prompts and provider requests, [schemas.py](../backend/app/schemas.py) defines their response contracts, and [main.py](../backend/app/main.py) exposes the application endpoints. Update this document when these contracts change.

## Request format and configuration

Both features use the Gemini Interactions endpoint, `https://generativelanguage.googleapis.com/v1beta/interactions`. The code sends each complete prompt as a single `input` string; there is no separate system-instruction field or conversation history in these requests.

`_interaction_body()` requests JSON using the relevant Pydantic-generated JSON schema in `response_format`. It also sends `store: false`, `thinking_level: "low"`, and a bounded `max_output_tokens` value. `store: false` is a request setting, not evidence of the provider's broader retention policy.

| Server setting | Behaviour in the source |
| --- | --- |
| `GEMINI_MODEL` | Defaults to `gemini-3.8-flash`; the deployed value can override it. This records the code default, not a verified model-availability claim. |
| `GEMINI_API_KEY` | Required; used in the server request header, never included in the prompt. |
| `GEMINI_MONTHLY_BUDGET_USD` | A positive monthly spend cap is required. The backend reserves estimated cost before a request. |
| `GEMINI_INPUT_USD_PER_MILLION`, `GEMINI_OUTPUT_USD_PER_MILLION` | Required finite, non-negative rates for cost accounting. Verify rates for the selected model before enabling it. |
| `GEMINI_MAX_OUTPUT_TOKENS` | Defaults to 512; permitted range is 64–2048. |

These are configuration names only; no credentials or live environment values are included here. Both AI endpoints require an authenticated account. The interpretation endpoint also applies the shared AI rate limiter.

## 1. Natural-language search interpretation

**Purpose:** convert a user's housing-search text into structured filters. Gemini does not query the database, select homes, or calculate home-fit scores. The application executes the subsequent search against its own records.

**Endpoint:** `POST /api/v1/ai/interpret`

**Implementation:** `interpret_query()` in [ai.py](../backend/app/ai.py)

**Response contract:** `QueryInterpretation`, containing `InterpretationFilters` (which inherits `SearchRequest`).

### Exact prompt template

The following is the complete template. `{request.text}` is replaced by the validated input text. There is one blank line before `Query:`; the instruction sentences form one paragraph.

```text
Interpret a Singapore public-housing search query into only explicit filters. Do not invent a budget, town, flat type, distance threshold, prices, amenities, safety facts, or recommendations. Keep the original text in filters.query. Add priorities only for school access, childcare, care access, or affordability. If a value or distance threshold is not explicit and materially needed, set needs_clarification=true and ask one concise question. The application will search its own verified records; do not provide factual claims.

Query: {request.text}
```

### Illustrative input and response

These examples demonstrate the contract. They are not captured provider responses or evidence of a successful live Gemini run. Responses can omit fields for which the schema supplies defaults.

Input:

```json
{"text":"Find 4-room flats in Toa Payoh with a budget of SGD 650000."}
```

Illustrative Gemini JSON, before the endpoint adds metadata:

```json
{
  "filters": {
    "query": "Find 4-room flats in Toa Payoh with a budget of SGD 650000.",
    "town": "TOA PAYOH",
    "flat_type": "4 ROOM",
    "budget": 650000
  },
  "detected_priorities": [],
  "needs_clarification": false,
  "clarifying_question": null
}
```

For an ambiguous input such as `Find a home near a school`, the prompt asks Gemini to request an explicit distance threshold when materially needed, rather than invent one.

### Validation and failure behaviour

- `InterpretRequest` validates the incoming text. The provider receives a `QueryInterpretation` JSON schema; the backend then parses the returned JSON with `model_validate_json()`.
- `SearchRequest` constrains filter types and ranges, including budget, distances, result limit, and floor/storey ranges. Detected priorities are restricted to `schools`, `childcare`, `care_access`, and `affordability`.
- After validation, the backend sets `result.filters.query` to the original request text, overriding any model rewrite of that field.
- Invalid structured output returns HTTP 502 with `AI_SCHEMA_INVALID`. The endpoint adds provider/model information and a grounding statement to successful responses.
- The frontend's `applySearch()` merges interpreted filters with the current search criteria. On a non-authentication interpretation failure it searches the words as typed with the existing structured criteria and displays a notice. Authentication failures propagate instead. A returned clarification question is surfaced as a notice; it does not automatically pause the search.

Schema validation checks shape and bounds; it does not prove that every extracted value was explicitly present in the user's text. The instruction against inventing values is a prompt constraint, not a complete semantic verification mechanism.

## 2. Historical transaction overview

**Purpose:** provide a short, neutral explanation of one imported HDB resale transaction using an allowlist of transaction fields. The implemented prompt does not generate an amenity-based suitability assessment or household recommendation.

**Endpoint:** `POST /api/v1/ai/summaries/{home_id}`

**Implementation:** `record_summary()` in [main.py](../backend/app/main.py), calling `summarize_record()` in [ai.py](../backend/app/ai.py)

**Response contract:** `RecordSummary`, containing an `overview` and up to four `SummaryObservation` objects.

### Evidence supplied to Gemini

The endpoint builds this allowlist from the selected database record, omitting fields whose values are `None`:

| Field | Value sent |
| --- | --- |
| `town` | Recorded town |
| `flat_type` | Recorded flat type |
| `transaction_month` | Transaction date formatted as `YYYY-MM` |
| `resale_price` | Transaction price formatted as `SGD 450,000.00`, for example |
| `floor_area_sqm` | Numeric floor area |
| `storey_range` | Recorded storey band |

The payload contains no account identity, home address, private notes, viewing photos, personal-place coordinates, or search history. Source metadata is attached to the API response by the backend rather than supplied in this prompt. The search-interpretation feature separately sends the text entered by the user; that text is not automatically redacted.

### Exact prompt template

`{evidence_json}` below stands for `json.dumps(evidence, ensure_ascii=False, separators=(',', ':'))`. There is one blank line before `Evidence JSON:`; the instruction sentences form one paragraph.

```text
Write a short, neutral overview of this one historical HDB resale transaction using only the JSON evidence below. Do not infer whether a home is currently available, whether its price is affordable, nearby amenities, travel, risk, or suitability. Each observation must cite one or more exact evidence_fields from the provided record. If the record lacks enough information, say so.

Evidence JSON: {evidence_json}
```

### Illustrative evidence and response

Synthetic evidence, shown in the compact format inserted into the prompt:

```json
{"town":"TOA PAYOH","flat_type":"4 ROOM","transaction_month":"2025-01","resale_price":"SGD 450,000.00","floor_area_sqm":90.0,"storey_range":"04 TO 06"}
```

Illustrative Gemini JSON, not a recorded live response:

```json
{
  "overview": "A historical 4-room HDB resale transaction in Toa Payoh, recorded in January 2025.",
  "observations": [
    {
      "text": "The recorded transaction price is SGD 450,000.00.",
      "evidence_fields": ["resale_price"]
    },
    {
      "text": "The recorded floor area is 90 square metres.",
      "evidence_fields": ["floor_area_sqm"]
    }
  ]
}
```

### Validation and failure behaviour

- If the selected record does not exist, the endpoint returns HTTP 404 with `HOME_NOT_FOUND` before requesting a summary.
- The provider receives `RecordSummary.model_json_schema()`. The backend validates the returned JSON with `RecordSummary.model_validate_json()`.
- The overview is limited to 480 characters. Each observation has 1–200 characters and one to three field references; at most four observations are allowed.
- Reference names are restricted to the six allowed fields. The backend additionally checks that every referenced field actually exists in this record's evidence. An absent reference returns HTTP 502 with `AI_EVIDENCE_REFERENCE_INVALID`; other schema failures return `AI_SCHEMA_INVALID`.
- The endpoint attaches the source dataset ID, version and URL, and explicitly labels the result as historical evidence with no score, amenity-distance, route or suitability claim.

Field-reference validation does not prove that each sentence follows from its references. The backend does not independently verify the meaning of generated prose, and the overview has no mandatory field-reference list. The prompt narrows the requested content; the numeric home-fit score and factual record display remain separate from this summary.

## Shared failures and verification

Missing configuration, invalid token limits, an exhausted budget, provider rejection, rate limiting, timeouts, empty responses and malformed output produce explicit API errors. The backend does not substitute an invented AI response. The existing record data and structured-search functionality do not require an AI summary to be generated.

[test_ai.py](../backend/tests/test_ai.py) covers the provider request shape, response-text extraction, usage parsing, missing-budget readiness, and permitted summary reference names. These tests use local inputs and do not establish live provider availability or factual correctness of generated prose.

To run those tests from the repository root with the project environment:

```bash
.venv/bin/python -m pytest -q backend/tests/test_ai.py
```

A live demonstration should separately record the configured model, date, sanitised input, actual response and any failure. No live Gemini request was made to produce the examples in this document.
