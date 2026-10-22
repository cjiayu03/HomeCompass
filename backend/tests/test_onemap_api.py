import asyncio

import httpx
import pytest

from app.onemap import OneMapProviderError, search_address_candidates


SEARCH_URL = "https://www.onemap.gov.sg/api/common/elastic/search"
TOKEN = "test-secret-token"


def _result(**overrides):
    return {
        "ADDRESS": "  10   Example Road, Singapore  ",
        "LATITUDE": "1.3000",
        "LONGITUDE": "103.8500",
        "SEARCHVAL": "unused provider detail",
        **overrides,
    }


def _search(handler, *, query="10 Example Road", token=TOKEN):
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await search_address_candidates(query, token, client)

    return asyncio.run(run())


def test_valid_candidate_is_normalized_and_uses_only_fixed_onemap_endpoint():
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(200, json={"results": [_result()], "totalNumPages": 1})

    candidates = _search(handler, query="https://attacker.example/path")

    assert candidates == [{
        "address": "10 Example Road, Singapore",
        "latitude": 1.3,
        "longitude": 103.85,
        "provider": "OneMap",
    }]
    assert set(candidates[0]) == {"address", "latitude", "longitude", "provider"}
    assert requests[0].url.scheme == "https"
    assert requests[0].url.host == "www.onemap.gov.sg"
    assert requests[0].url.path == "/api/common/elastic/search"
    assert requests[0].url.params["searchVal"] == "https://attacker.example/path"
    assert requests[0].headers["Authorization"] == TOKEN


def test_malformed_json_is_rejected_with_a_safe_provider_error():
    def handler(_request):
        return httpx.Response(200, content=b"not-json")

    with pytest.raises(OneMapProviderError) as error:
        _search(handler)

    assert TOKEN not in str(error.value)


@pytest.mark.parametrize("status_code", [401, 403])
def test_unauthorized_responses_become_safe_provider_errors(status_code):
    def handler(_request):
        return httpx.Response(status_code, text=f"rejected {TOKEN}")

    with pytest.raises(OneMapProviderError) as error:
        _search(handler)

    assert TOKEN not in str(error.value)


@pytest.mark.parametrize("status_code", [429, 503])
def test_rate_limit_and_server_errors_are_retried(monkeypatch, status_code):
    attempts = 0

    async def no_wait(_seconds):
        return None

    monkeypatch.setattr("app.onemap.asyncio.sleep", no_wait)

    def handler(_request):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            return httpx.Response(status_code)
        return httpx.Response(200, json={"results": [_result()], "totalNumPages": 1})

    assert len(_search(handler)) == 1
    assert attempts == 2


def test_server_error_retries_are_bounded(monkeypatch):
    attempts = 0

    async def no_wait(_seconds):
        return None

    monkeypatch.setattr("app.onemap.asyncio.sleep", no_wait)

    def handler(_request):
        nonlocal attempts
        attempts += 1
        return httpx.Response(503)

    with pytest.raises(OneMapProviderError):
        _search(handler)

    assert attempts == 3


def test_out_of_singapore_and_malformed_coordinates_are_discarded():
    def handler(_request):
        return httpx.Response(200, json={"results": [
            _result(),
            _result(ADDRESS="outside", LATITUDE="1.2", LONGITUDE="103.8"),
            _result(ADDRESS="malformed", LATITUDE="not-a-number"),
            _result(ADDRESS="non-finite", LONGITUDE="nan"),
        ], "totalNumPages": 1})

    candidates = _search(handler)

    assert [candidate["address"] for candidate in candidates] == [
        "10 Example Road, Singapore"
    ]


def test_upstream_echo_of_token_is_never_returned():
    def handler(_request):
        return httpx.Response(200, json={
            "results": [_result(ADDRESS=f"{TOKEN} address")],
            "totalNumPages": 1,
        })

    candidates = _search(handler)

    assert TOKEN not in repr(candidates)
    assert candidates == []


def test_search_caps_upstream_pages_at_three():
    requested_pages = []

    def handler(request):
        page = int(request.url.params["pageNum"])
        requested_pages.append(page)
        return httpx.Response(200, json={
            "results": [_result(ADDRESS=f"Page {page}")],
            "totalNumPages": 20,
        })

    candidates = _search(handler)

    assert requested_pages == [1, 2, 3]
    assert [candidate["address"] for candidate in candidates] == [
        "Page 1", "Page 2", "Page 3"
    ]
