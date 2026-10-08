from __future__ import annotations

import os
from uuid import UUID

import httpx
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .database import ensure_user, require_pool

bearer = HTTPBearer(auto_error=False)


def is_configured_value(value: str | None) -> bool:
    if not value or not value.strip():
        return False
    normalized = value.strip().lower()
    return not any(marker in normalized for marker in ("your-project", "replace-me", "changeme"))


def supabase_auth_config() -> tuple[str | None, str | None]:
    project_url = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    api_key = os.getenv("SUPABASE_PUBLISHABLE_KEY") or os.getenv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") or os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    if not is_configured_value(project_url) or not is_configured_value(api_key):
        return None, None
    return project_url, api_key


def supabase_auth_configured() -> bool:
    project_url, api_key = supabase_auth_config()
    return bool(project_url and api_key)


async def require_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)) -> dict:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail={"code": "AUTH_REQUIRED", "message": "Sign in to access this resource."}, headers={"WWW-Authenticate": "Bearer"})
    project_url, api_key = supabase_auth_config()
    if not project_url or not api_key:
        raise HTTPException(status_code=503, detail={"code": "AUTH_UNCONFIGURED", "message": "Supabase authentication is not configured on the API."})
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(
                f"{project_url.rstrip('/')}/auth/v1/user",
                headers={"apikey": api_key, "Authorization": f"Bearer {credentials.credentials}"},
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail={"code": "AUTH_PROVIDER_UNAVAILABLE", "message": "The identity provider could not be reached."}) from exc
    if response.status_code == 401 or response.status_code == 403:
        raise HTTPException(status_code=401, detail={"code": "INVALID_SESSION", "message": "Your session is invalid or expired."}, headers={"WWW-Authenticate": "Bearer"})
    if response.status_code != 200:
        raise HTTPException(status_code=503, detail={"code": "AUTH_PROVIDER_ERROR", "message": "The identity provider could not verify this session."})
    try:
        payload = response.json()
        user_id = UUID(payload["id"])
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(status_code=401, detail={"code": "INVALID_SESSION", "message": "The identity provider returned an invalid account."}) from exc
    return {"id": user_id, "email": payload.get("email")}


async def require_active_user(user: dict = Depends(require_user)) -> dict:
    pool = require_pool()
    async with pool.acquire() as connection:
        async with connection.transaction():
            await ensure_user(connection, user)
            state = await connection.fetchval("SELECT status FROM account_deletion WHERE user_id = $1", user["id"])
            if state in {"pending_auth_delete", "complete"}:
                raise HTTPException(status_code=403, detail={"code": "ACCOUNT_DELETION_PENDING", "message": "This account is being deleted."})
    return user
