from __future__ import annotations

import os

from . import database
from .ai import gemini_configuration_ready
from .migrations import (
    LATEST_MIGRATION_VERSION,
    MigrationSetError,
    latest_migration_version,
    migration_status,
)


_SOURCE_COUNTS_QUERY = """
SELECT
    (SELECT count(*) FROM candidate_home) AS homes,
    (SELECT count(*) FROM neighbourhood_resource) AS resources
"""


def _snapshot(
    *,
    database_state: str,
    migration_state: str,
    migration_details: dict[str, int | None | bool] | None = None,
    source_data: dict[str, str | int],
) -> dict:
    if migration_details is None:
        migration_details = _unknown_migration_status()
    migrations_ready = migration_state == "ready"
    database_ready = database_state == "ready"
    auth_state = (
        "ready"
        if database_ready and migrations_ready
        else "pending"
        if database_ready
        else "unavailable"
    )
    return {
        "application": "ready",
        "database": database_state,
        "migrations": migration_state,
        "migrationStatus": migration_details,
        "sourceData": source_data,
        "auth": auth_state,
        "ai": "configured" if gemini_configuration_ready() else "unconfigured",
        "ready": database_ready and migrations_ready,
    }


def _unknown_migration_status() -> dict[str, int | None | bool]:
    try:
        latest = latest_migration_version()
    except MigrationSetError:
        latest = LATEST_MIGRATION_VERSION
    return {"applied": None, "latest": latest, "ready": False}


async def readiness_snapshot() -> dict:
    """Return categorical service readiness without exposing configuration values."""
    if not os.getenv("DATABASE_URL", "").strip():
        return _snapshot(
            database_state="unconfigured",
            migration_state="unavailable",
            source_data={"state": "unavailable", "homes": 0, "resources": 0},
        )

    pool = database._pool
    if pool is None:
        return _snapshot(
            database_state="unavailable",
            migration_state="unavailable",
            source_data={"state": "unavailable", "homes": 0, "resources": 0},
        )

    try:
        async with pool.acquire() as connection:
            migration_details = await migration_status(connection)
            if not migration_details["ready"]:
                return _snapshot(
                    database_state="ready",
                    migration_state="pending",
                    migration_details=migration_details,
                    source_data={"state": "unavailable", "homes": 0, "resources": 0},
                )

            counts = await connection.fetchrow(_SOURCE_COUNTS_QUERY)
    except Exception:
        return _snapshot(
            database_state="unavailable",
            migration_state="unavailable",
            source_data={"state": "unavailable", "homes": 0, "resources": 0},
        )

    homes = int(counts["homes"])
    resources = int(counts["resources"])
    return _snapshot(
        database_state="ready",
        migration_state="ready",
        migration_details=migration_details,
        source_data={
            "state": "available" if homes or resources else "not_imported",
            "homes": homes,
            "resources": resources,
        },
    )
