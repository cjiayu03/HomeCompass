import asyncio

import httpx

from app.ai import gemini_configuration_ready
from app.main import app, score_preview
from app.schemas import ScoreRequest
from app.security import is_configured_value, supabase_auth_config


def test_health_is_explicit_about_unconfigured_providers(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_MONTHLY_BUDGET_USD", raising=False)
    async def request_health():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            return await client.get("/health")

    response = asyncio.run(request_health())
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["database"] == "unavailable"
    assert response.json()["auth"] == "unconfigured"
    assert response.json()["ai"] == "unconfigured"


def test_private_and_search_routes_fail_closed_without_configuration(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("NEXT_PUBLIC_SUPABASE_URL", raising=False)
    async def request_private_routes():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            return (await client.get("/api/v1/profile"),
                    await client.post("/api/v1/search", json={"budget": 450000}),
                    await client.post("/api/v1/ai/interpret", json={"text": "near a school"}))

    profile_response, search_response, ai_response = asyncio.run(request_private_routes())
    assert profile_response.status_code == 401
    assert search_response.status_code == 503
    assert ai_response.status_code == 503


def test_supabase_example_placeholders_are_treated_as_unconfigured(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://your-project.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "replace-me")
    assert supabase_auth_config() == (None, None)
    assert not is_configured_value("replace-me-server-only")


def test_gemini_example_key_is_not_treated_as_ready(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "replace-me")
    monkeypatch.setenv("GEMINI_MONTHLY_BUDGET_USD", "5")
    monkeypatch.setenv("GEMINI_INPUT_USD_PER_MILLION", "0.75")
    monkeypatch.setenv("GEMINI_OUTPUT_USD_PER_MILLION", "3.75")
    assert not gemini_configuration_ready()


def test_score_preview_validates_ranges_and_keeps_missing_data_unavailable():
    zero = score_preview(ScoreRequest(criteria={"school": 0}))
    assert zero["score"] == 0
    assert zero["coverage"] == 1
    result = score_preview(ScoreRequest(criteria={"school": 100, "care": 50}, weights={"school": 3, "care": 1}))
    assert result["score"] == 87.5
    assert result["coverage"] == 1
    missing = score_preview(ScoreRequest(criteria={"school": 90, "care": None}, weights={"school": 1, "care": 1}))
    assert missing["score"] == 90
    assert missing["coverage"] == 0.5
    try:
        score_preview(ScoreRequest(criteria={"school": 101}))
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 422
    else:
        raise AssertionError("out-of-range score should be rejected")
