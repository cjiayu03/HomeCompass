from __future__ import annotations

import logging
import os
from typing import Any

import asyncpg
from fastapi import HTTPException

logger = logging.getLogger(__name__)
_pool: asyncpg.Pool | None = None


def _asyncpg_dsn(value: str) -> str:
    return value.replace("postgresql+asyncpg://", "postgresql://", 1).replace("postgresql+psycopg://", "postgresql://", 1)


async def open_pool() -> None:
    global _pool
    dsn = os.getenv("DATABASE_URL")
    if not dsn:
        logger.info("DATABASE_URL is not configured; persistence routes will return 503.")
        return
    try:
        serverless = os.getenv("VERCEL") == "1"
        default_pool_max = "1" if serverless else "10"
        _pool = await asyncpg.create_pool(
            _asyncpg_dsn(dsn),
            min_size=1,
            max_size=max(1, int(os.getenv("DATABASE_POOL_MAX", default_pool_max))),
            command_timeout=10,
            statement_cache_size=0 if serverless else 100,
        )
        async with _pool.acquire() as connection:
            await connection.execute("SELECT 1")
    except (OSError, asyncpg.PostgresError, ValueError):
        logger.exception("Could not connect to the configured PostgreSQL database.")
        _pool = None


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def require_pool() -> asyncpg.Pool:
    if _pool is None:
        raise HTTPException(status_code=503, detail={"code": "DATABASE_UNAVAILABLE", "message": "Persistent storage is not configured or is unavailable."})
    return _pool


async def ensure_user(connection: asyncpg.Connection, user: dict[str, Any]) -> None:
    user_id = user["id"]
    await connection.execute(
        """INSERT INTO user_account (id, email) VALUES ($1, $2)
           ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email
           WHERE user_account.status = 'active'""",
        user_id,
        user.get("email"),
    )
    status = await connection.fetchval("SELECT status FROM user_account WHERE id = $1", user_id)
    if status != "active":
        raise HTTPException(status_code=403, detail={"code": "ACCOUNT_INACTIVE", "message": "This account is not active."})


async def ensure_profile(connection: asyncpg.Connection, user_id: Any) -> asyncpg.Record:
    await connection.execute(
        """INSERT INTO family_profile (id, user_id, adults, children, older_adults)
           VALUES ($1, $1, 1, 0, 0) ON CONFLICT (user_id) DO NOTHING""",
        user_id,
    )
    return await connection.fetchrow("SELECT adults, children, older_adults, budget_cents, locale, updated_at FROM family_profile WHERE user_id = $1", user_id)
