import pytest
from pydantic import ValidationError

from app.ai import _interaction_body, _text_from_interaction, _usage_tokens, gemini_configuration_ready
from app.schemas import RecordSummary


def test_interactions_api_model_output_extraction_uses_current_steps_shape():
    response = {"steps": [{"type": "model_output", "content": [{"type": "text", "text": "{\"filters\":{}}"}]}]}
    assert _text_from_interaction(response) == '{"filters":{}}'


def test_interactions_api_request_uses_current_structured_output_shape():
    schema = {"type": "object", "properties": {"ok": {"type": "boolean"}}}
    body = _interaction_body("gemini-3.8-flash", "interpret", schema, 128)
    assert body["store"] is False
    assert body["generation_config"] == {"max_output_tokens": 128, "thinking_level": "low"}
    assert "max_output_tokens" not in body
    assert body["response_format"] == {"type": "text", "mime_type": "application/json", "schema": schema}


def test_interactions_usage_is_optional_but_normalized_when_present():
    assert _usage_tokens({"usage": {"input_tokens": 44, "output_tokens": 18}}) == (44, 18)
    assert _usage_tokens({}) is None


def test_gemini_configuration_is_unavailable_when_monthly_cap_is_blank(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "configured-for-test")
    monkeypatch.setenv("GEMINI_MONTHLY_BUDGET_USD", "")
    monkeypatch.setenv("GEMINI_INPUT_USD_PER_MILLION", "0.75")
    monkeypatch.setenv("GEMINI_OUTPUT_USD_PER_MILLION", "3.75")
    assert gemini_configuration_ready() is False


def test_record_summary_references_are_restricted_to_source_field_names():
    result = RecordSummary.model_validate({"overview": "A dated transaction.", "observations": [{"text": "Four-room record.", "evidence_fields": ["flat_type"]}]})
    assert result.observations[0].evidence_fields == ["flat_type"]
    with pytest.raises(ValidationError):
        RecordSummary.model_validate({"overview": "Near a school.", "observations": [{"text": "Near a school.", "evidence_fields": ["nearby_school"]}]})
