import asyncio

import httpx
import pytest

from app import main
from app.onemap import OneMapProviderError
from app.rate_limit import RateLimiter


def request(payload):
    async def send():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
            return await client.post("/api/v1/map/address-search", json=payload)
    return asyncio.run(send())


@pytest.fixture(autouse=True)
def limiter(monkeypatch):
    monkeypatch.setattr(main, "address_search_limiter", RateLimiter(max_requests=20, window_seconds=60))


def test_guest_can_search_without_exposing_token_or_save_signature(monkeypatch):
    monkeypatch.setenv("ONEMAP_ACCESS_TOKEN", "private-onemap-token")
    calls = []
    async def suggest(query, token, _client):
        calls.append((query, token))
        return [{"address": "1 Example Road", "latitude": 1.31, "longitude": 103.85, "provider": "OneMap", "internal": "private"}]
    monkeypatch.setattr(main, "search_address_candidates", suggest)
    response = request({"query": "  Example Road  "})
    assert response.status_code == 200
    assert response.json() == {"items": [{"address": "1 Example Road", "latitude": 1.31, "longitude": 103.85, "provider": "OneMap"}]}
    assert calls == [("Example Road", "private-onemap-token")]
    assert response.headers["cache-control"] == "no-store"
    assert "private" not in response.text


def test_invalid_queries_and_missing_configuration(monkeypatch):
    monkeypatch.delenv("ONEMAP_ACCESS_TOKEN", raising=False)
    assert request({"query": " "}).status_code == 422
    assert request({"query": "x" * 161}).status_code == 422
    response = request({"query": "123456"})
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "ONEMAP_UNCONFIGURED"


def test_provider_failure_is_safe_and_empty_results_are_valid(monkeypatch):
    monkeypatch.setenv("ONEMAP_ACCESS_TOKEN", "private-onemap-token")
    async def fail(*_args):
        raise OneMapProviderError("private-onemap-token")
    monkeypatch.setattr(main, "search_address_candidates", fail)
    response = request({"query": "Example"})
    assert response.status_code == 502
    assert "private-onemap-token" not in response.text
    async def empty(*_args):
        return []
    monkeypatch.setattr(main, "search_address_candidates", empty)
    assert request({"query": "Example"}).json() == {"items": []}


def test_public_search_is_rate_limited(monkeypatch):
    monkeypatch.setattr(main, "address_search_limiter", RateLimiter(max_requests=1, window_seconds=60))
    monkeypatch.setenv("ONEMAP_ACCESS_TOKEN", "private-onemap-token")
    async def empty(*_args):
        return []
    monkeypatch.setattr(main, "search_address_candidates", empty)
    assert request({"query": "Example"}).status_code == 200
    assert request({"query": "Example"}).status_code == 429


def test_signed_in_cookie_with_allowed_origin_and_result_cap(monkeypatch):
    monkeypatch.setenv("ONEMAP_ACCESS_TOKEN", "private-onemap-token")
    async def suggest(*_args):
        return [{"address": f"{i} Example Road", "latitude": 1.31, "longitude": 103.85, "provider": "OneMap"} for i in range(12)]
    monkeypatch.setattr(main, "search_address_candidates", suggest)
    async def send():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test", cookies={"homecompass_session": "existing-session"}) as client:
            return await client.post("/api/v1/map/address-search", json={"query": "Example"}, headers={"Origin": main._ALLOWED_ORIGINS[0]})
    response = asyncio.run(send())
    assert response.status_code == 200
    assert len(response.json()["items"]) == 10
