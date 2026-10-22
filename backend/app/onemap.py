"""Bounded, server-side address suggestions through OneMap."""

from __future__ import annotations

import asyncio
from typing import Any

import httpx
from pydantic import ValidationError

from .schemas import PersonalPlaceRequest, PlaceSuggestionRequest

ONEMAP_SEARCH_URL = "https://www.onemap.gov.sg/api/common/elastic/search"
_PROVIDER_ID = "OneMap"
_MAX_PAGES = 3
_RETRY_DELAYS = (0.1, 0.25)
_MAX_ATTEMPTS = len(_RETRY_DELAYS) + 1


class OneMapProviderError(RuntimeError):
    """A safe error raised when OneMap cannot provide usable candidates."""


async def _search_page(
    query: str,
    token: str,
    client: httpx.AsyncClient,
    page_num: int,
) -> dict[str, Any]:
    for attempt in range(_MAX_ATTEMPTS):
        try:
            response = await client.get(
                ONEMAP_SEARCH_URL,
                params={
                    "searchVal": query,
                    "returnGeom": "Y",
                    "getAddrDetails": "Y",
                    "pageNum": page_num,
                },
                headers={"Authorization": token},
                follow_redirects=False,
            )
        except Exception:
            if attempt == _MAX_ATTEMPTS - 1:
                raise OneMapProviderError("OneMap address search is temporarily unavailable.") from None
            await asyncio.sleep(_RETRY_DELAYS[attempt])
            continue

        status_code = response.status_code
        if status_code in {401, 403}:
            raise OneMapProviderError("OneMap authorization failed. Check the server configuration.")
        if status_code == 429 or 500 <= status_code <= 599:
            if attempt == _MAX_ATTEMPTS - 1:
                raise OneMapProviderError("OneMap address search is temporarily unavailable.")
            await asyncio.sleep(_RETRY_DELAYS[attempt])
            continue
        if not 200 <= status_code < 300:
            raise OneMapProviderError("OneMap address search failed.")

        try:
            payload = response.json()
        except Exception:
            raise OneMapProviderError("OneMap returned a malformed search response.") from None
        if not isinstance(payload, dict) or not isinstance(payload.get("results"), list):
            raise OneMapProviderError("OneMap returned a malformed search response.")
        return payload

    raise OneMapProviderError("OneMap address search is temporarily unavailable.")


def _page_count(payload: dict[str, Any]) -> int:
    value = payload.get("totalNumPages", 1)
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise OneMapProviderError("OneMap returned a malformed search response.")
    try:
        count = int(value)
    except ValueError:
        raise OneMapProviderError("OneMap returned a malformed search response.") from None
    if count < 0:
        raise OneMapProviderError("OneMap returned a malformed search response.")
    return min(_MAX_PAGES, max(1, count))


def _normalize_candidate(result: Any, token: str) -> dict[str, str | float] | None:
    if not isinstance(result, dict):
        return None
    address = result.get("ADDRESS")
    if not isinstance(address, str):
        return None
    address = " ".join(address.split())
    if not address or token.casefold() in address.casefold():
        return None

    try:
        place = PersonalPlaceRequest.model_validate({
            "label": _PROVIDER_ID,
            "address": address,
            "latitude": result.get("LATITUDE"),
            "longitude": result.get("LONGITUDE"),
            "geocode_source": _PROVIDER_ID,
        })
    except (ValidationError, TypeError, ValueError, OverflowError):
        return None

    return {
        "address": address,
        "latitude": place.latitude,
        "longitude": place.longitude,
        "provider": _PROVIDER_ID,
    }


async def search_address_candidates(
    query: str,
    token: str,
    client: httpx.AsyncClient,
) -> list[dict[str, str | float]]:
    """Search OneMap and return only normalized, Singapore-validated candidates."""
    try:
        normalized_query = PlaceSuggestionRequest(query=query).query
    except ValidationError:
        raise OneMapProviderError("A valid address search query is required.") from None
    if not isinstance(token, str) or not token.strip():
        raise OneMapProviderError("OneMap configuration is incomplete.")

    first_page = await _search_page(normalized_query, token, client, 1)
    results = list(first_page["results"])
    page_count = _page_count(first_page)
    for page_num in range(2, page_count + 1):
        page = await _search_page(normalized_query, token, client, page_num)
        results.extend(page["results"])

    return [
        candidate
        for result in results
        if (candidate := _normalize_candidate(result, token)) is not None
    ]
