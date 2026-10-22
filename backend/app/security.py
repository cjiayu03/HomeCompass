from __future__ import annotations

import os
from ipaddress import ip_address

import asyncpg
from fastapi import Depends, HTTPException, Request

from .database import ensure_user, require_pool, resolve_local_session
from .local_auth import hash_session_token

SESSION_COOKIE_NAME = "homecompass_session"


class InvalidSessionError(HTTPException):
    def __init__(self) -> None:
        super().__init__(
            status_code=401,
            detail={"code": "INVALID_SESSION", "message": "Your session is invalid or expired."},
        )


def is_configured_value(value: str | None) -> bool:
    if not value or not value.strip():
        return False
    normalized = value.strip().lower()
    return not any(marker in normalized for marker in ("your-project", "replace-me", "changeme"))


def session_cookie_secure() -> bool:
    value = os.getenv("AUTH_COOKIE_SECURE", "false").strip().lower()
    return value not in {"0", "false", "no", "off"}


def rate_limit_key(user: dict | None, request: Request) -> str:
    if user is not None and user.get("id") is not None:
        return f"user:{user['id']}"

    client = request.client
    host = client.host if client is not None else ""
    try:
        address = ip_address(host.split("%", 1)[0]).compressed
    except ValueError:
        address = "unknown"
    return f"client:{address}"


async def resolve_session_token(token: str) -> dict | None:
    try:
        session = await resolve_local_session(hash_session_token(token))
    except ValueError:
        return None
    except HTTPException:
        raise
    except (asyncpg.PostgresError, OSError) as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "DATABASE_UNAVAILABLE",
                "message": "Persistent storage is unavailable. Please try again.",
            },
        ) from exc
    if session is None:
        return None
    return {"id": session["user_id"], "session_id": session["session_id"]}


async def require_user(request: Request) -> dict:
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        raise HTTPException(
            status_code=401,
            detail={"code": "AUTH_REQUIRED", "message": "Sign in to access this resource."},
        )
    user = await resolve_session_token(token)
    if user is None:
        raise InvalidSessionError()
    return user


async def require_active_user(user: dict = Depends(require_user)) -> dict:
    pool = require_pool()
    try:
        async with pool.acquire() as connection:
            async with connection.transaction():
                await ensure_user(connection, user)
                state = await connection.fetchval("SELECT status FROM account_deletion WHERE user_id = $1", user["id"])
                if state in {"pending_auth_delete", "complete"}:
                    raise HTTPException(status_code=403, detail={"code": "ACCOUNT_DELETION_PENDING", "message": "This account is being deleted."})
    except HTTPException:
        raise
    except (asyncpg.PostgresError, OSError) as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "DATABASE_UNAVAILABLE",
                "message": "Persistent storage is unavailable. Please try again.",
            },
        ) from exc
    return user
