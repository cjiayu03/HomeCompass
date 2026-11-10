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


@pytest.mark.parametrize(('text', 'towns', 'expected'), [
    ('Find 4-room flats in Clementi under $700,000', ['Clementi', 'Bedok', 'Bishan'], ['Clementi']),
    ('请帮我找一套大巴窑（Toa Payoh）的四房式组屋，预算为65万新元。', ['Toa Payoh', 'Bedok', 'Clementi'], ['Toa Payoh']),
    ('Find flats in Clementi or Bedok', ['Clementi', 'Bedok', 'Bishan'], ['Clementi', 'Bedok']),
    ('找大巴窑的组屋', ['Toa Payoh', 'Bedok'], ['Toa Payoh']),
    ('Clementi 或大巴窑', ['Clementi', 'Toa Payoh', 'Bedok'], ['Clementi', 'Toa Payoh']),
])
def test_interpretation_drops_unmentioned_towns_when_explicit_names_are_present(monkeypatch, text, towns, expected):
    import json
    from app import ai
    from app.schemas import InterpretRequest

    async def generate(*args):
        return json.dumps({'filters': {'towns': towns, 'budget': 650000, 'flat_type': '4 ROOM'}}), 'test-model'

    monkeypatch.setattr(ai, '_generate_json', generate)
    import asyncio
    result, _ = asyncio.run(ai.interpret_query(InterpretRequest(text=text)))
    assert result.filters.towns == expected
    assert result.filters.budget == 650000
    assert result.filters.flat_type == '4 ROOM'
    assert result.filters.query == text
def test_zero_budget_requires_explicit_free_tier_and_zero_rates(monkeypatch):
    monkeypatch.setenv('GEMINI_API_KEY', 'configured-for-test')
    monkeypatch.setenv('GEMINI_MONTHLY_BUDGET_USD', '0')
    monkeypatch.setenv('GEMINI_INPUT_USD_PER_MILLION', '0')
    monkeypatch.setenv('GEMINI_OUTPUT_USD_PER_MILLION', '0')
    monkeypatch.delenv('GEMINI_FREE_TIER', raising=False)
    assert not gemini_configuration_ready()
    monkeypatch.setenv('GEMINI_FREE_TIER', 'true')
    assert gemini_configuration_ready()
    monkeypatch.setenv('GEMINI_OUTPUT_USD_PER_MILLION', '1')
    assert not gemini_configuration_ready()


def test_free_tier_reserves_zero_even_with_earlier_paid_usage(monkeypatch):
    import asyncio
    from decimal import Decimal
    from app import ai

    class Transaction:
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
    class Connection(Transaction):
        def transaction(self): return Transaction()
        async def execute(self, *args): pass
        async def fetchval(self, query, reserve, month, cap):
            assert '($3 = 0 OR spent_usd + reserved_usd + $1 <= $3)' in query
            return cap == 0 and reserve == 0
    class Pool:
        def acquire(self): return Connection()

    monkeypatch.setenv('GEMINI_API_KEY', 'configured-for-test')
    monkeypatch.setenv('GEMINI_MONTHLY_BUDGET_USD', '0')
    monkeypatch.setenv('GEMINI_FREE_TIER', 'true')
    monkeypatch.setenv('GEMINI_INPUT_USD_PER_MILLION', '0')
    monkeypatch.setenv('GEMINI_OUTPUT_USD_PER_MILLION', '0')
    monkeypatch.setattr(ai, 'require_pool', lambda: Pool())
    _, reserve, cap, _ = asyncio.run(ai._reserve_usage(100, 100))
    assert reserve == cap == Decimal('0')


def test_positive_budget_still_requires_valid_rates(monkeypatch):
    monkeypatch.setenv('GEMINI_API_KEY', 'configured-for-test')
    monkeypatch.setenv('GEMINI_MONTHLY_BUDGET_USD', '5')
    monkeypatch.delenv('GEMINI_FREE_TIER', raising=False)
    monkeypatch.setenv('GEMINI_INPUT_USD_PER_MILLION', '0.75')
    monkeypatch.setenv('GEMINI_OUTPUT_USD_PER_MILLION', '3.75')
    assert gemini_configuration_ready()
    monkeypatch.setenv('GEMINI_OUTPUT_USD_PER_MILLION', '-1')
    assert not gemini_configuration_ready()


def test_zero_budget_rejects_nonzero_rate_before_provider_request(monkeypatch):
    import asyncio
    from fastapi import HTTPException
    from app.ai import _reserve_usage

    monkeypatch.setenv('GEMINI_API_KEY', 'configured-for-test')
    monkeypatch.setenv('GEMINI_MONTHLY_BUDGET_USD', '0')
    monkeypatch.setenv('GEMINI_FREE_TIER', 'true')
    monkeypatch.setenv('GEMINI_INPUT_USD_PER_MILLION', '0')
    monkeypatch.setenv('GEMINI_OUTPUT_USD_PER_MILLION', '0.01')
    with pytest.raises(HTTPException) as error:
        asyncio.run(_reserve_usage(100, 100))
    assert error.value.detail['code'] == 'AI_BUDGET_INVALID'


def test_model_defaults_to_lite_only_for_free_tier_and_respects_override(monkeypatch):
    from app.ai import _gemini_model
    monkeypatch.delenv('GEMINI_MODEL', raising=False)
    monkeypatch.delenv('GEMINI_FREE_TIER', raising=False)
    assert _gemini_model() == 'gemini-3.8-flash'
    monkeypatch.setenv('GEMINI_FREE_TIER', 'true')
    assert _gemini_model() == 'gemini-3.5-flash-lite'
    monkeypatch.setenv('GEMINI_MODEL', 'custom-model')
    assert _gemini_model() == 'custom-model'
