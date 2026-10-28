from __future__ import annotations

import logging
import os
from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

import asyncpg
from fastapi import HTTPException

from .scoring import DEFAULT_WEIGHTS
from .sources.data_gov_sg import HDB_RESALE_DATASET_ID

logger = logging.getLogger(__name__)
_pool: asyncpg.Pool | None = None


class DuplicateLocalEmailError(Exception):
    """Raised when a local identity already owns the normalized email."""


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
           ON CONFLICT (id) DO UPDATE SET email = COALESCE(EXCLUDED.email, user_account.email)
           WHERE user_account.status = 'active'""",
        user_id,
        user.get("email"),
    )
    status = await connection.fetchval("SELECT status FROM user_account WHERE id = $1", user_id)
    if status != "active":
        raise HTTPException(status_code=403, detail={"code": "ACCOUNT_INACTIVE", "message": "This account is not active."})


async def register_local_account(
    email: str,
    password_hash: str,
    token_hash: str,
    expires_at: datetime,
) -> UUID:
    """Create a fresh account, identity, and first session in one transaction."""
    pool = require_pool()
    user_id = uuid4()
    async with pool.acquire() as connection:
        try:
            async with connection.transaction():
                await connection.execute(
                    "INSERT INTO user_account (id, email) VALUES ($1, NULL)",
                    user_id,
                )
                await connection.execute(
                    """INSERT INTO family_profile (
                           id, user_id, adults, children, older_adults,
                           locale, onboarding_completed
                       ) VALUES ($1, $1, 1, 0, 0, 'en-SG', FALSE)""",
                    user_id,
                )
                await connection.execute(
                    """INSERT INTO local_auth_identity (user_id, email, password_hash)
                       VALUES ($1, $2, $3)""",
                    user_id,
                    email,
                    password_hash,
                )
                await connection.execute(
                    """INSERT INTO local_auth_session (user_id, token_hash, expires_at)
                       VALUES ($1, $2, $3)""",
                    user_id,
                    token_hash,
                    expires_at,
                )
        except asyncpg.UniqueViolationError as exc:
            if exc.constraint_name == "local_auth_identity_email_unique":
                raise DuplicateLocalEmailError from exc
            raise
    return user_id


async def get_local_auth_identity_by_email(email: str):
    pool = require_pool()
    async with pool.acquire() as connection:
        return await connection.fetchrow(
            """SELECT identity.user_id, identity.email, identity.password_hash
               FROM local_auth_identity AS identity
               JOIN user_account AS account ON account.id = identity.user_id
               WHERE identity.email = $1 AND account.status = 'active'""",
            email,
        )


async def get_local_auth_identity_by_user_id(user_id: UUID):
    pool = require_pool()
    async with pool.acquire() as connection:
        return await connection.fetchrow(
            """SELECT user_id, email, password_hash
               FROM local_auth_identity WHERE user_id = $1""",
            user_id,
        )


async def get_local_auth_email_by_user_id(user_id: UUID) -> str | None:
    pool = require_pool()
    async with pool.acquire() as connection:
        return await connection.fetchval(
            "SELECT email FROM local_auth_identity WHERE user_id = $1",
            user_id,
        )


async def create_local_session(
    user_id: UUID,
    token_hash: str,
    expires_at: datetime,
    verified_password_hash: str,
) -> bool:
    pool = require_pool()
    async with pool.acquire() as connection:
        async with connection.transaction():
            # Recovery and password changes lock this same identity before
            # revoking sessions. An in-progress old-password login must either
            # insert before that revocation or fail this password recheck.
            identity = await connection.fetchval(
                """SELECT user_id FROM local_auth_identity
                   WHERE user_id = $1 AND password_hash = $2 FOR UPDATE""",
                user_id,
                verified_password_hash,
            )
            if identity is None:
                return False
            await connection.execute(
                """INSERT INTO local_auth_session (user_id, token_hash, expires_at)
                   VALUES ($1, $2, $3)""",
                user_id,
                token_hash,
                expires_at,
            )
    return True


async def resolve_local_session(token_hash: str):
    pool = require_pool()
    async with pool.acquire() as connection:
        return await connection.fetchrow(
            """SELECT auth_session.id AS session_id, identity.user_id
               FROM local_auth_session AS auth_session
               JOIN local_auth_identity AS identity ON identity.user_id = auth_session.user_id
               JOIN user_account AS account ON account.id = auth_session.user_id
               WHERE auth_session.token_hash = $1
                 AND auth_session.expires_at > now()
                 AND auth_session.revoked_at IS NULL
                 AND account.status = 'active'""",
            token_hash,
        )


async def revoke_local_session(token_hash: str) -> None:
    pool = require_pool()
    async with pool.acquire() as connection:
        await connection.execute(
            """UPDATE local_auth_session SET revoked_at = now()
               WHERE token_hash = $1 AND revoked_at IS NULL""",
            token_hash,
        )


async def change_local_password(
    user_id: UUID,
    current_session_id: UUID,
    current_hash: str,
    new_hash: str,
) -> bool:
    pool = require_pool()
    async with pool.acquire() as connection:
        async with connection.transaction():
            identity = await connection.fetchval(
                """SELECT user_id FROM local_auth_identity
                   WHERE user_id = $1 AND password_hash = $2 FOR UPDATE""",
                user_id,
                current_hash,
            )
            if identity is None:
                return False
            active_session = await connection.fetchval(
                """SELECT id FROM local_auth_session
                   WHERE user_id = $1 AND id = $2
                     AND revoked_at IS NULL AND expires_at > now()
                   FOR UPDATE""",
                user_id,
                current_session_id,
            )
            if active_session is None:
                return False
            updated = await connection.fetchval(
                """UPDATE local_auth_identity
                   SET password_hash = $3, updated_at = now()
                   WHERE user_id = $1 AND password_hash = $2
                   RETURNING user_id""",
                user_id,
                current_hash,
                new_hash,
            )
            if updated is None:
                return False
            await connection.execute("DELETE FROM password_recovery WHERE user_id = $1", user_id)
            await connection.execute(
                """UPDATE local_auth_session SET revoked_at = now()
                   WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL""",
                user_id,
                current_session_id,
            )
    return True


async def set_local_password_by_email(email: str, password_hash: str) -> bool:
    pool = require_pool()
    async with pool.acquire() as connection:
        async with connection.transaction():
            user_id = await connection.fetchval(
                """SELECT user_id FROM local_auth_identity
                   WHERE email = $1 FOR UPDATE""",
                email,
            )
            if user_id is None:
                return False
            await connection.execute(
                """UPDATE local_auth_identity
                   SET password_hash = $2, updated_at = now()
                   WHERE user_id = $1""",
                user_id,
                password_hash,
            )
            await connection.execute("DELETE FROM password_recovery WHERE user_id = $1", user_id)
            await connection.execute(
                """UPDATE local_auth_session SET revoked_at = now()
                   WHERE user_id = $1 AND revoked_at IS NULL""",
                user_id,
            )
    return True


async def delete_local_account(user_id: UUID) -> bool:
    pool = require_pool()
    async with pool.acquire() as connection:
        async with connection.transaction():
            identity = await connection.fetchval(
                """SELECT user_id FROM local_auth_identity
                   WHERE user_id = $1 FOR UPDATE""",
                user_id,
            )
            if identity is None:
                return False
            # This legacy status table has no foreign key; clean its account-scoped
            # record explicitly before the user row and cascading owned data go.
            await connection.execute(
                "DELETE FROM account_deletion WHERE user_id = $1",
                user_id,
            )
            result = await connection.execute(
                "DELETE FROM user_account WHERE id = $1",
                user_id,
            )
    return result.endswith(" 1")


async def ensure_profile(connection: asyncpg.Connection, user_id: Any) -> asyncpg.Record:
    await connection.execute(
        """INSERT INTO family_profile (id, user_id, adults, children, older_adults)
           VALUES ($1, $1, 1, 0, 0) ON CONFLICT (user_id) DO NOTHING""",
        user_id,
    )
    return await connection.fetchrow(
        """SELECT id, adults, children, older_adults, budget_cents, locale, updated_at,
                  preferred_towns, preferred_flat_type, max_school_distance_m,
                  max_childcare_distance_m, max_care_distance_m, onboarding_completed
           FROM family_profile WHERE user_id = $1""",
        user_id,
    )


async def get_current_search_options(connection: asyncpg.Connection) -> dict[str, list[str]]:
    rows = await connection.fetch(
        """WITH current_hdb_snapshot AS (
               SELECT id FROM source_snapshot
               WHERE source_id = $1 AND status IN ('valid', 'degraded')
               ORDER BY retrieved_at DESC LIMIT 1
           )
           SELECT DISTINCT 'town' AS kind, btrim(home.town) AS value
           FROM candidate_home home
           JOIN current_hdb_snapshot snapshot ON snapshot.id = home.source_snapshot_id
           WHERE NULLIF(btrim(home.town), '') IS NOT NULL
           UNION
           SELECT DISTINCT 'flat_type' AS kind, btrim(home.flat_type) AS value
           FROM candidate_home home
           JOIN current_hdb_snapshot snapshot ON snapshot.id = home.source_snapshot_id
           WHERE NULLIF(btrim(home.flat_type), '') IS NOT NULL
           ORDER BY kind, value""",
        HDB_RESALE_DATASET_ID,
    )
    return {
        "towns": [row["value"] for row in rows if row["kind"] == "town"],
        "flat_types": [row["value"] for row in rows if row["kind"] == "flat_type"],
    }


async def get_priority_weights(
    connection: asyncpg.Connection, profile_id: Any
) -> dict[str, float | int]:
    weights: dict[str, float | int] = dict(DEFAULT_WEIGHTS)
    rows = await connection.fetch(
        "SELECT criterion, weight FROM criterion_weight WHERE profile_id = $1",
        profile_id,
    )
    for row in rows:
        criterion = row["criterion"]
        if criterion in weights:
            weights[criterion] = float(row["weight"])
    return weights


async def replace_priority_weights(
    connection: asyncpg.Connection,
    profile_id: Any,
    weights: dict[str, float],
) -> None:
    criteria = list(DEFAULT_WEIGHTS)
    await connection.execute(
        "DELETE FROM criterion_weight WHERE profile_id = $1 AND criterion <> ALL($2::text[])",
        profile_id,
        criteria,
    )
    await connection.executemany(
        """INSERT INTO criterion_weight (profile_id, criterion, weight)
           VALUES ($1, $2, $3)
           ON CONFLICT (profile_id, criterion) DO UPDATE SET weight = EXCLUDED.weight""",
        [(profile_id, criterion, weights[criterion]) for criterion in criteria],
    )
