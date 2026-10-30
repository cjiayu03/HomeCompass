"""Build the nearest-resource evidence cache used by globally ranked searches.

Run after importing HDB homes, amenity sources, or OneMap coordinates with
``python -m app.scoring_evidence``. Refreshing happens outside request handling
because it evaluates all homes and can take longer than the API command limit.
"""

from __future__ import annotations

import asyncio
import json
import os
from uuid import uuid4

import asyncpg

from .local_env import load_local_project_env


_REFRESH_LOCK_KEY = 1213154637

_LATEST_RESOURCES = """WITH latest_resource_sources AS (
  SELECT DISTINCT ON (source_id) id
  FROM source_snapshot
  WHERE status IN ('valid','degraded')
  ORDER BY source_id, retrieved_at DESC
)"""

_INSERT_EVIDENCE = _LATEST_RESOURCES + """, evidence_rows AS (
  SELECT h.id AS home_id,
         school.name AS school_name,
         school.distance_m AS school_distance_m,
         childcare.name AS childcare_name,
         childcare.distance_m AS childcare_distance_m,
         care.name AS care_name,
         care.distance_m AS care_distance_m
  FROM candidate_home h
  LEFT JOIN LATERAL (
    SELECT r.name,
           ST_Distance(h.geometry::geography, r.geometry::geography) AS distance_m
    FROM neighbourhood_resource r
    JOIN latest_resource_sources latest ON latest.id = r.source_snapshot_id
    WHERE h.geometry IS NOT NULL
      AND r.resource_type = 'moe_school'
      AND r.geometry IS NOT NULL
    ORDER BY h.geometry::geography <-> r.geometry::geography
    LIMIT 1
  ) school ON TRUE
  LEFT JOIN LATERAL (
    SELECT r.name,
           ST_Distance(h.geometry::geography, r.geometry::geography) AS distance_m
    FROM neighbourhood_resource r
    JOIN latest_resource_sources latest ON latest.id = r.source_snapshot_id
    WHERE h.geometry IS NOT NULL
      AND r.resource_type IN ('childcare','kindergarten')
      AND r.geometry IS NOT NULL
    ORDER BY h.geometry::geography <-> r.geometry::geography
    LIMIT 1
  ) childcare ON TRUE
  LEFT JOIN LATERAL (
    SELECT r.name,
           ST_Distance(h.geometry::geography, r.geometry::geography) AS distance_m
    FROM neighbourhood_resource r
    JOIN latest_resource_sources latest ON latest.id = r.source_snapshot_id
    WHERE h.geometry IS NOT NULL
      AND r.resource_type IN ('chas_clinic','dementia_gtp')
      AND r.geometry IS NOT NULL
    ORDER BY h.geometry::geography <-> r.geometry::geography
    LIMIT 1
  ) care ON TRUE
)
INSERT INTO home_scoring_evidence (
  generation_id, home_id, school_name, school_distance_m,
  childcare_name, childcare_distance_m, care_name, care_distance_m
)
SELECT $1, home_id, school_name, school_distance_m,
       childcare_name, childcare_distance_m, care_name, care_distance_m
FROM evidence_rows"""


async def refresh_home_scoring_evidence(connection: asyncpg.Connection) -> dict:
    """Atomically publish one complete evidence generation."""
    generation_id = uuid4()
    async with connection.transaction(isolation="repeatable_read"):
        await connection.execute("SELECT pg_advisory_xact_lock($1)", _REFRESH_LOCK_KEY)
        await connection.execute("SET LOCAL statement_timeout = 0")
        await connection.execute(_INSERT_EVIDENCE, generation_id)
        home_snapshot_ids = await connection.fetchval(
            """SELECT COALESCE(array_agg(snapshot_id ORDER BY snapshot_id), '{}'::uuid[])
               FROM (SELECT DISTINCT source_snapshot_id AS snapshot_id FROM candidate_home) homes"""
        )
        resource_snapshot_ids = await connection.fetchval(
            _LATEST_RESOURCES + """ SELECT COALESCE(array_agg(id ORDER BY id), '{}'::uuid[])
                 FROM latest_resource_sources"""
        )
        row_count = await connection.fetchval(
            "SELECT count(*) FROM home_scoring_evidence WHERE generation_id = $1",
            generation_id,
        )
        await connection.execute(
            """INSERT INTO home_scoring_evidence_state (
                   singleton, generation_id, home_snapshot_ids,
                   resource_snapshot_ids, row_count, refreshed_at
               ) VALUES (TRUE, $1, $2::uuid[], $3::uuid[], $4, now())
               ON CONFLICT (singleton) DO UPDATE SET
                   generation_id = EXCLUDED.generation_id,
                   home_snapshot_ids = EXCLUDED.home_snapshot_ids,
                   resource_snapshot_ids = EXCLUDED.resource_snapshot_ids,
                   row_count = EXCLUDED.row_count,
                   refreshed_at = EXCLUDED.refreshed_at""",
            generation_id,
            home_snapshot_ids,
            resource_snapshot_ids,
            row_count,
        )
        await connection.execute(
            "DELETE FROM home_scoring_evidence WHERE generation_id <> $1",
            generation_id,
        )

    return {
        "generationId": str(generation_id),
        "homes": row_count,
        "homeSnapshots": len(home_snapshot_ids),
        "resourceSnapshots": len(resource_snapshot_ids),
    }


async def run_refresh() -> dict:
    load_local_project_env()
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is required to refresh scoring evidence.")
    dsn = database_url.replace("postgresql+asyncpg://", "postgresql://", 1).replace(
        "postgresql+psycopg://", "postgresql://", 1
    )
    connection = await asyncpg.connect(dsn, command_timeout=900)
    try:
        return await refresh_home_scoring_evidence(connection)
    finally:
        await connection.close()


if __name__ == "__main__":
    print(json.dumps(asyncio.run(run_refresh()), indent=2))
