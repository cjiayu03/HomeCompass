import asyncio

import httpx
import pytest

from app import main
from app.onemap import OneMapProviderError
from app.rate_limit import RateLimiter


TOKEN = "private-onemap-token"


def request(payload, *, headers=None, cookies=None):
    async def send():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app),
            base_url="http://test",
            cookies=cookies or {},
        ) as client:
            return await client.post(
                "/api/v1/map/address-search",
                json=payload,
                headers=headers or {},
            )

    return asyncio.run(send())


@pytest.fixture(autouse=True)
def isolated_rate_limiter(monkeypatch):
    monkeypatch.setattr(
        main,
        "address_search_limiter",
        RateLimiter(max_requests=20, window_seconds=60),
    )


def test_guest_search_returns_only_public_fields_and_deduplicates(monkeypatch):
    monkeypatch.setenv("ONEMAP_ACCESS_TOKEN", TOKEN)
    received = []

    async def suggest(query, token, _client):
        received.append((query, token))
        return [
            {
                "address": "  10   Example Road ",
                "latitude": 1.3,
                "longitude": 103.85,
                "provider": "untrusted-provider",
                "selection_token": "save-signature",
                "internal": "private provider data",
            },
            {
                "address": "10 Example Road",
                "latitude": 1.3,
                "longitude": 103.85,
                "selection_token": "another-save-signature",
            },
            {
                "address": "10 Example Road",
                "latitude": 1.3002,
                "longitude": 103.85,
            },
        ]

    monkeypatch.setattr(main, "search_address_candidates", suggest)
    response = request({"query": "  10   Example Road  "})

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert received == [("10   Example Road", TOKEN)]
    assert response.json() == {
        "items": [
            {
                "address": "10 Example Road",
                "latitude": 1.3,
                "longitude": 103.85,
                "provider": "OneMap",
            },
            {
                "address": "10 Example Road",
                "latitude": 1.3002,
                "longitude": 103.85,
                "provider": "OneMap",
            },
        ]
    }
    assert TOKEN not in response.text
    assert "save-signature" not in response.text
    assert "private provider data" not in response.text


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"query": None},
        {"query": 123456},
        {"query": ["123456"]},
        {"query": ""},
        {"query": "   "},
        {"query": "x" * 161},
    ],
)
def test_invalid_queries_are_rejected_before_provider_call(monkeypatch, payload):
    monkeypatch.setenv("ONEMAP_ACCESS_TOKEN", TOKEN)
    called = False

    async def suggest(*_args):
        nonlocal called
        called = True
        return []

    monkeypatch.setattr(main, "search_address_candidates", suggest)
    response = request(payload)

    assert response.status_code == 422
    assert called is False


def test_unicode_and_punctuation_are_preserved_in_query(monkeypatch):
    monkeypatch.setenv("ONEMAP_ACCESS_TOKEN", TOKEN)
    received = []

    async def suggest(query, _token, _client):
        received.append(query)
        return []

    monkeypatch.setattr(main, "search_address_candidates", suggest)
    response = request({"query": "  #08-12, Blk 6 東京 Rd  "})

    assert response.status_code == 200
    assert response.json() == {"items": []}
    assert received == ["#08-12, Blk 6 東京 Rd"]


def test_unconfigured_provider_has_safe_retryable_response(monkeypatch):
    monkeypatch.delenv("ONEMAP_ACCESS_TOKEN", raising=False)
    response = request({"query": "Bishan MRT"})

    assert response.status_code == 503
    assert response.headers["cache-control"] == "no-store"
    assert response.json()["detail"]["code"] == "ONEMAP_UNCONFIGURED"


@pytest.mark.parametrize(
    "provider_result",
    [
        {"not": "a candidate list"},
        [{"address": "Outside Singapore", "latitude": 1.2, "longitude": 103.8}],
        [{"address": "NaN Road", "latitude": float("nan"), "longitude": 103.85}],
        [{"address": "Malformed Road", "latitude": "north", "longitude": 103.85}],
        [{"address": "Token Road", "latitude": 1.3, "longitude": 103.85, "internal": TOKEN}],
    ],
)
def test_malformed_or_unusable_provider_candidates_never_escape(monkeypatch, provider_result):
    monkeypatch.setenv("ONEMAP_ACCESS_TOKEN", TOKEN)

    async def suggest(*_args):
        return provider_result

    monkeypatch.setattr(main, "search_address_candidates", suggest)
    response = request({"query": "Bishan MRT"})

    if isinstance(provider_result, dict):
        assert response.status_code == 502
        assert response.json()["detail"]["code"] == "ONEMAP_UNAVAILABLE"
    elif provider_result[0].get("internal"):
        assert response.status_code == 200
        assert response.json() == {
            "items": [{
                "address": "Token Road",
                "latitude": 1.3,
                "longitude": 103.85,
                "provider": "OneMap",
            }]
        }
    else:
        assert response.status_code == 200
        assert response.json() == {"items": []}
    assert TOKEN not in response.text


def test_unexpected_provider_timeout_is_mapped_to_a_safe_failure(monkeypatch):
    monkeypatch.setenv("ONEMAP_ACCESS_TOKEN", TOKEN)

    async def timeout(*_args):
        raise TimeoutError(f"upstream timeout {TOKEN}")

    monkeypatch.setattr(main, "search_address_candidates", timeout)
    response = request({"query": "Bishan MRT"})

    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "ONEMAP_UNAVAILABLE"
    assert TOKEN not in response.text
    assert response.headers["cache-control"] == "no-store"


def test_public_rate_limit_has_retry_after(monkeypatch):
    monkeypatch.setattr(
        main,
        "address_search_limiter",
        RateLimiter(max_requests=1, window_seconds=60),
    )
    monkeypatch.setenv("ONEMAP_ACCESS_TOKEN", TOKEN)

    async def no_results(*_args):
        return []

    monkeypatch.setattr(main, "search_address_candidates", no_results)
    assert request({"query": "Bishan"}).status_code == 200
    limited = request({"query": "Bishan"})

    assert limited.status_code == 429
    assert limited.headers["retry-after"]
    assert limited.json()["detail"]["code"] == "RATE_LIMITED"


def test_stale_cookie_is_guest_only_with_an_allowed_origin(monkeypatch):
    monkeypatch.setenv("ONEMAP_ACCESS_TOKEN", TOKEN)
    calls = 0

    async def no_results(*_args):
        nonlocal calls
        calls += 1
        return []

    monkeypatch.setattr(main, "search_address_candidates", no_results)
    cookie = {main.SESSION_COOKIE_NAME: "expired-session"}
    allowed_origin = {"Origin": main._ALLOWED_ORIGINS[0]}

    response = request({"query": "Bishan"}, headers=allowed_origin, cookies=cookie)
    assert response.status_code == 200
    assert "set-cookie" not in response.headers

    missing_origin = request({"query": "Bishan"}, cookies=cookie)
    assert missing_origin.status_code == 403
    assert missing_origin.json()["detail"]["code"] == "INVALID_ORIGIN"
    assert calls == 1


def test_public_results_are_capped_after_deduplication(monkeypatch):
    monkeypatch.setenv("ONEMAP_ACCESS_TOKEN", TOKEN)

    async def suggest(*_args):
        return [
            {"address": "1 Example Road", "latitude": 1.3, "longitude": 103.85},
            {"address": " 1   Example Road ", "latitude": 1.3, "longitude": 103.85},
            *[
                {"address": f"{index} Example Road", "latitude": 1.3, "longitude": 103.85}
                for index in range(2, 15)
            ],
        ]

    monkeypatch.setattr(main, "search_address_candidates", suggest)
    response = request({"query": "Example Road"})
    items = response.json()["items"]

    assert response.status_code == 200
    assert len(items) == 10
    assert [item["address"] for item in items] == [
        "1 Example Road",
        *[f"{index} Example Road" for index in range(2, 11)],
    ]
