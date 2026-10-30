import asyncio
from contextlib import asynccontextmanager

import httpx
import pytest
from fastapi import HTTPException
from starlette.requests import Request
from starlette.responses import Response

from app import main
from app.security import InvalidSessionError, SESSION_COOKIE_NAME


def _request_with_stale_cookie(path="/api/v1/profile"):
    return Request({
        "type": "http",
        "method": "GET",
        "path": path,
        "headers": [(b"cookie", f"{SESSION_COOKIE_NAME}=old-session".encode())],
        "client": ("127.0.0.1", 4321),
    })


def test_invalid_protected_response_does_not_clear_a_newer_shared_cookie():
    response = asyncio.run(
        main.invalid_session_response(_request_with_stale_cookie(), InvalidSessionError())
    )

    assert response.status_code == 401
    assert b"INVALID_SESSION" in response.body
    assert "set-cookie" not in response.headers
    assert response.headers["cache-control"] == "no-store"


def test_session_read_reports_invalid_cookie_without_mutating_it(monkeypatch):
    async def invalid_session(_token):
        return None

    monkeypatch.setattr(main, "resolve_session_token", invalid_session)
    response = Response()
    payload = asyncio.run(main.current_local_session(_request_with_stale_cookie(), response))

    assert payload == {"user": None}
    assert "set-cookie" not in response.headers
    assert response.headers["cache-control"] == "no-store"


def test_optional_auth_uses_guest_for_invalid_cookie_but_preserves_other_errors(monkeypatch):
    async def invalid_session(_request):
        raise InvalidSessionError()

    monkeypatch.setattr(main, "require_user", invalid_session)
    assert asyncio.run(main._optional_active_user(_request_with_stale_cookie())) is None

    async def unavailable(_request):
        raise HTTPException(status_code=503, detail={"code": "DATABASE_UNAVAILABLE"})

    monkeypatch.setattr(main, "require_user", unavailable)
    with pytest.raises(HTTPException) as storage_error:
        asyncio.run(main._optional_active_user(_request_with_stale_cookie()))
    assert storage_error.value.status_code == 503

    async def valid_user(_request):
        return {"id": "deleted-user"}

    async def deletion_pending(_user):
        raise HTTPException(status_code=403, detail={"code": "ACCOUNT_DELETION_PENDING"})

    monkeypatch.setattr(main, "require_user", valid_user)
    monkeypatch.setattr(main, "require_active_user", deletion_pending)
    with pytest.raises(HTTPException) as account_error:
        asyncio.run(main._optional_active_user(_request_with_stale_cookie()))
    assert account_error.value.status_code == 403


class _SearchConnection:
    async def fetchrow(self, sql, *_values):
        if "FROM candidate_home" in sql:
            return {"total": 0, "geocoded": 0}
        if "FROM neighbourhood_resource" in sql:
            return {"schools": 0, "childcare": 0, "care": 0}
        raise AssertionError(f"Unexpected query: {sql}")


class _SearchPool:
    def __init__(self):
        self.connection = _SearchConnection()

    @asynccontextmanager
    async def acquire(self):
        yield self.connection


def test_stale_cookie_keeps_plain_search_available_but_saved_places_auth_required(monkeypatch):
    async def invalid_session(_request):
        raise InvalidSessionError()

    async def empty_homes(*_args, **_kwargs):
        return [], [], 0, None, False, []

    monkeypatch.setattr(main, "require_user", invalid_session)
    monkeypatch.setattr(main, "require_pool", _SearchPool)
    monkeypatch.setattr(main, "_query_homes", empty_homes)
    monkeypatch.setattr(main, "_ALLOWED_ORIGINS", ("http://localhost:3000",))

    async def request_searches():
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            headers = {"Origin": "http://localhost:3000"}
            client.cookies.set(SESSION_COOKIE_NAME, "old-session")
            plain = await client.post("/api/v1/search", json={}, headers=headers)
            personal = await client.post(
                "/api/v1/search",
                json={"place_constraints": [{"place_id": "b40c0e69-a760-4e4f-82b7-33fa6bc76d75", "max_distance_m": 1000}]},
                headers=headers,
            )
            return plain, personal

    plain, personal = asyncio.run(request_searches())

    assert plain.status_code == 200
    assert plain.json()["items"] == []
    assert "set-cookie" not in plain.headers
    assert personal.status_code == 401
    assert personal.json()["detail"]["code"] == "AUTH_REQUIRED"
    assert "set-cookie" not in personal.headers
