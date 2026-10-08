"""Batch geocode HDB transaction and MOE school addresses with OneMap.

OneMap requires a team-registered token. Keep it in the repository-root
``.env`` as ``ONEMAP_ACCESS_TOKEN``; this command never prints or persists the token.
Example: ``python -m app.sources.onemap_geocode --home-limit 100 --school-limit 400``.
Queries are sequential and throttled; repeat the command to continue a batch.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import re
import sys
import unicodedata
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

import asyncpg
import httpx

from ..local_env import load_local_project_env

SEARCH_URL = "https://www.onemap.gov.sg/api/common/elastic/search"
SOURCE_ID = "onemap_geocoding"
HDB_BUILDING_SOURCE_ID = "d_16b157c52ed637edd6ba1232e026258d"
_ROAD_WORDS = {
    "AVE": "AVENUE", "RD": "ROAD", "ST": "STREET", "DR": "DRIVE",
    "CRES": "CRESCENT", "CL": "CLOSE", "PL": "PLACE", "TER": "TERRACE",
    "HTS": "HEIGHTS", "BT": "BUKIT", "NTH": "NORTH", "STH": "SOUTH",
    "CTRL": "CENTRAL", "LOR": "LORONG", "JLN": "JALAN", "UPP": "UPPER",
    "GDNS": "GARDENS", "PK": "PARK", "TG": "TANJONG", "KG": "KAMPONG",
    "MKT": "MARKET",
    "CWEALTH": "COMMONWEALTH",
}
_SG_BOUNDS = (103.0, 1.0, 105.0, 2.0)
_SEARCH_ATTEMPTS = 5
_RETRY_DELAYS = (2, 4, 8, 16)
_CHECKPOINT_SIZE = 50
_HOME_QUEUE_QUERY = """SELECT DISTINCT address FROM candidate_home
   WHERE geometry IS NULL
     AND (geocode_status='pending' OR ($2::boolean AND geocode_status='failed'))
   ORDER BY address LIMIT $1"""
_SCHOOL_QUEUE_QUERY = """WITH latest AS (
     SELECT DISTINCT ON (source_id) id FROM source_snapshot
     WHERE source_id=$1 AND status IN ('valid','degraded') ORDER BY source_id,retrieved_at DESC
   )
   SELECT r.id,r.name,r.attributes FROM neighbourhood_resource r
   JOIN latest s ON s.id=r.source_snapshot_id
   WHERE r.resource_type='moe_school' AND r.geometry IS NULL
     AND (COALESCE(r.attributes->>'geocodeStatus','pending')='pending'
          OR ($3::boolean AND COALESCE(r.attributes->>'geocodeStatus','pending')='failed'))
   ORDER BY r.name LIMIT $2"""
_HDB_BUILDING_POSTALS_QUERY = """WITH latest AS (
     SELECT id FROM source_snapshot WHERE source_id=$1 AND status IN ('valid','degraded')
     ORDER BY retrieved_at DESC LIMIT 1
   )
   SELECT r.source_snapshot_id, r.attributes->>'BLK_NO' AS block, r.attributes->>'POSTAL_COD' AS postal
   FROM neighbourhood_resource r JOIN latest s ON s.id=r.source_snapshot_id
   WHERE r.resource_type='hdb_building' AND r.geometry IS NOT NULL"""
_HDB_FOOTPRINT_CONTAINS_QUERY = """SELECT EXISTS (
     SELECT 1 FROM neighbourhood_resource r
     WHERE r.resource_type='hdb_building' AND r.source_snapshot_id=$1::uuid
       AND r.attributes->>'POSTAL_COD'=$2
       AND upper(ltrim(r.attributes->>'BLK_NO','0'))=$3
       AND ST_Covers(r.geometry,ST_SetSRID(ST_MakePoint($4,$5),4326))
   )"""
_HOME_GEOCODE_UPDATE_QUERY = """UPDATE candidate_home
   SET geometry=ST_SetSRID(ST_MakePoint($2,$3),4326),geocode_status='resolved',
       geometry_source='onemap',geometry_source_snapshot_id=$4::uuid,geocoded_at=$5
   WHERE address=$1 AND geometry IS NULL"""
_SCHOOL_GEOCODE_UPDATE_QUERY = """UPDATE neighbourhood_resource
   SET geometry=ST_SetSRID(ST_MakePoint($2,$3),4326),
       location_source_snapshot_id=$4::uuid,
       attributes=attributes || jsonb_build_object(
         'geocodeSource','OneMap','geocodedAt',$5::text,'geocodeStatus','resolved',
         'geocodeSourceSnapshotId',$4::uuid::text)
   WHERE id=$1 AND geometry IS NULL"""


def _address_parts(address: str) -> tuple[str, str] | None:
    parts = address.strip().split(maxsplit=1)
    return (parts[0].lstrip("0") or "0", parts[1]) if len(parts) == 2 else None


def _normalize_road(value: str) -> str:
    text = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii").upper()
    text = text.replace("'", "")
    text = re.sub(r"^ST\.?\s+", "SAINT ", text)
    words = re.findall(r"[A-Z0-9]+", text)
    words = ["SINGAPORE" if word == "SG" else _ROAD_WORDS.get(word, word) for word in words]
    return " ".join(word for word in words if word != "SINGAPORE")


def _is_singapore_point(lon: Any, lat: Any) -> bool:
    try:
        x, y = float(lon), float(lat)
    except (TypeError, ValueError):
        return False
    west, south, east, north = _SG_BOUNDS
    return west <= x <= east and south <= y <= north


def _home_candidates(address: str, results: list[dict[str, Any]]) -> list[tuple[str, float, float]]:
    parts = _address_parts(address)
    if not parts:
        return []
    block, street = parts
    normalized_street = _normalize_road(street)
    matches: list[tuple[str, float, float]] = []
    for item in results:
        result_block = str(item.get("BLK_NO") or "").strip().lstrip("0") or "0"
        road = str(item.get("ROAD_NAME") or "").strip()
        if not road:
            result_parts = _address_parts(str(item.get("ADDRESS") or ""))
            road = result_parts[1] if result_parts else ""
        postal = str(item.get("POSTAL") or item.get("POSTAL_CODE") or "").strip()
        building = str(item.get("BUILDING") or "").upper()
        if re.search(r"\b(?:CAR\s*PARK|CARPARK|MSCP)\b", building):
            continue
        if result_block == block and _normalize_road(road) == normalized_street and re.fullmatch(r"\d{6}", postal):
            lon, lat = item.get("LONGITUDE"), item.get("LATITUDE")
            if _is_singapore_point(lon, lat):
                matches.append((postal, float(lon), float(lat)))
    return matches


def _match_home(
    address: str, results: list[dict[str, Any]], hdb_postals: set[str] | None = None,
) -> tuple[float, float] | None:
    matches = _home_candidates(address, results)
    unique = {(lon, lat) for _postal, lon, lat in matches}
    if len(unique) == 1:
        return next(iter(unique))
    if hdb_postals:
        verified = {(lon, lat) for postal, lon, lat in matches if postal in hdb_postals}
        if len(verified) == 1:
            return next(iter(verified))
    return None


async def _match_home_footprint(
    pool: asyncpg.Pool,
    building_snapshot_id: Any,
    address: str,
    results: list[dict[str, Any]],
    hdb_postals: set[str] | None,
) -> tuple[float, float] | None:
    parts = _address_parts(address)
    if not parts or not building_snapshot_id or not hdb_postals:
        return None
    candidates = {
        (postal, lon, lat) for postal, lon, lat in _home_candidates(address, results)
        if postal in hdb_postals
    }
    if len(candidates) < 2:
        return None
    verified = set()
    async with pool.acquire() as connection:
        for postal, lon, lat in candidates:
            inside = await connection.fetchval(
                _HDB_FOOTPRINT_CONTAINS_QUERY, building_snapshot_id, postal, parts[0].upper(), lon, lat,
            )
            if inside:
                verified.add((lon, lat))
    return next(iter(verified)) if len(verified) == 1 else None


def _normalize_school_name(value: str) -> str:
    text = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii").upper()
    text = re.sub(r"\bST\.\s+", "SAINT ", text)
    text = text.replace("'", "")
    return " ".join(re.findall(r"[A-Z0-9]+", text))


def _school_postal(attributes: dict[str, Any]) -> str | None:
    raw = str(
        attributes.get("POSTAL_CODE")
        or attributes.get("POSTAL_COD")
        or attributes.get("postal_code")
        or ""
    ).strip()
    return raw.zfill(6) if raw.isdigit() and len(raw) in {5, 6} else None


def _match_postal(
    postal: str, results: list[dict[str, Any]], school_name: str | None = None,
) -> tuple[float, float] | None:
    matches: list[tuple[str, float, float]] = []
    for item in results:
        result_postal = str(item.get("POSTAL") or item.get("POSTAL_CODE") or "").strip()
        lon, lat = item.get("LONGITUDE"), item.get("LATITUDE")
        if result_postal == postal and _is_singapore_point(lon, lat):
            matches.append((str(item.get("BUILDING") or ""), float(lon), float(lat)))
    unique = {(lon, lat) for _name, lon, lat in matches}
    if len(unique) == 1:
        return next(iter(unique))
    if school_name:
        target = _normalize_school_name(school_name)
        named = {(lon, lat) for name, lon, lat in matches if _normalize_school_name(name) == target}
        if len(named) == 1:
            return next(iter(named))
    return None


async def _search_page(client: httpx.AsyncClient, token: str, query: str, page_num: int) -> dict[str, Any]:
    for attempt in range(_SEARCH_ATTEMPTS):
        try:
            response = await client.get(
                SEARCH_URL,
                params={"searchVal": query, "returnGeom": "Y", "getAddrDetails": "Y", "pageNum": page_num},
                headers={"Authorization": token},
            )
        except httpx.TransportError as exc:
            if attempt == _SEARCH_ATTEMPTS - 1:
                raise RuntimeError("OneMap disconnected repeatedly; completed checkpoints are saved. Rerun to resume pending records.") from exc
            await asyncio.sleep(_RETRY_DELAYS[attempt])
            continue
        if response.status_code == 401 or response.status_code == 403:
            raise RuntimeError("OneMap rejected the configured token. Refresh it; tokens expire after three days.")
        if response.status_code == 429:
            if attempt == _SEARCH_ATTEMPTS - 1:
                raise RuntimeError("OneMap rate limit persisted after bounded retries; stop and retry later.")
            try:
                wait = min(120, max(1, int(response.headers.get("Retry-After", "5"))))
            except ValueError:
                wait = 5 * (attempt + 1)
            await asyncio.sleep(wait)
            continue
        if response.status_code in {500, 502, 503, 504}:
            if attempt == _SEARCH_ATTEMPTS - 1:
                raise RuntimeError(f"OneMap returned HTTP {response.status_code} after bounded retries; completed checkpoints are saved.")
            await asyncio.sleep(_RETRY_DELAYS[attempt])
            continue
        response.raise_for_status()
        data = response.json()
        if not isinstance(data, dict):
            raise RuntimeError("OneMap returned a malformed search response.")
        return data
    raise RuntimeError("OneMap search exhausted its retry attempts.")


async def _search(client: httpx.AsyncClient, token: str, query: str) -> list[dict[str, Any]]:
    first_page = await _search_page(client, token, query, 1)
    results = list(first_page.get("results") or [])
    try:
        page_count = min(10, max(1, int(first_page.get("totalNumPages") or 1)))
    except (TypeError, ValueError):
        page_count = 1
    for page_num in range(2, page_count + 1):
        await asyncio.sleep(0.5)
        page = await _search_page(client, token, query, page_num)
        results.extend(page.get("results") or [])
    return results


def _snapshot_report(totals: dict[str, int], run_state: str, requested: dict[str, int]) -> dict[str, Any]:
    return {
        "provider": "SLA OneMap Search API",
        "matchRule": "Exact normalized HDB block/street with a unique building postal point; official HDB building postals and footprint containment resolve otherwise ambiguous results. Schools require an exact postal point or a unique exact school-name result at that postal code.",
        "runState": run_state,
        "requested": requested,
        **totals,
    }


async def _start_snapshot(pool: asyncpg.Pool, retrieved: datetime, requested: dict[str, int]) -> Any:
    snapshot_id = uuid4()
    initial_report = _snapshot_report({
        "homeAddressesChecked": 0, "homeAddressesResolved": 0, "homeAddressesUnmatched": 0,
        "schoolsChecked": 0, "schoolsResolved": 0, "schoolsUnmatched": 0, "requests": 0,
    }, "in_progress", requested)
    digest = hashlib.sha256(b"").hexdigest()
    async with pool.acquire() as connection:
        await connection.execute(
            """INSERT INTO source_snapshot (id,source_id,source_url,source_version,content_hash,source_updated_at,retrieved_at,
               geometry_srid,row_count,rejected_count,status,validation_report)
               VALUES ($1,$2,$3,$4,$5,$6,$6,4326,0,0,'degraded',$7::jsonb)""",
            snapshot_id, SOURCE_ID, SEARCH_URL, retrieved.date().isoformat(), digest, retrieved,
            json.dumps(initial_report),
        )
    return snapshot_id


async def _save_checkpoint(
    pool: asyncpg.Pool,
    snapshot_id: Any,
    retrieved: datetime,
    homes: list[tuple[str, str, float, float]],
    schools: list[tuple[str, float, float]],
    rejected_homes: list[str],
    rejected_schools: list[str],
    totals: dict[str, int],
    requested: dict[str, int],
    digest: str,
    *,
    complete: bool,
) -> str:
    unmatched = totals["homeAddressesUnmatched"] + totals["schoolsUnmatched"]
    state = "valid" if complete and unmatched == 0 else "degraded"
    report = _snapshot_report(totals, "complete" if complete else "in_progress", requested)
    async with pool.acquire() as connection:
        async with connection.transaction():
            if homes:
                await connection.executemany(
                    _HOME_GEOCODE_UPDATE_QUERY,
                    [(address, lon, lat, snapshot_id, retrieved) for address, _kind, lon, lat in homes],
                )
            if schools:
                await connection.executemany(
                    _SCHOOL_GEOCODE_UPDATE_QUERY,
                    [(resource_id, lon, lat, snapshot_id, retrieved.isoformat()) for resource_id, lon, lat in schools],
                )
            if rejected_homes:
                await connection.execute(
                    "UPDATE candidate_home SET geocode_status='failed' WHERE address=ANY($1::text[]) AND geometry IS NULL",
                    rejected_homes,
                )
            if rejected_schools:
                await connection.executemany(
                    """UPDATE neighbourhood_resource SET attributes=attributes || jsonb_build_object(
                         'geocodeStatus','failed','geocodeCheckedAt',$2::text,'geocodeSourceSnapshotId',$3::text)
                       WHERE id=$1 AND geometry IS NULL""",
                    [(resource_id, retrieved.isoformat(), str(snapshot_id)) for resource_id in rejected_schools],
                )
            await connection.execute(
                """UPDATE source_snapshot SET content_hash=$1,row_count=$2,rejected_count=$3,status=$4,
                   validation_report=$5::jsonb WHERE id=$6""",
                digest, totals["homeAddressesResolved"] + totals["schoolsResolved"], unmatched, state,
                json.dumps(report), snapshot_id,
            )
    return state


async def _mark_interrupted(pool: asyncpg.Pool, snapshot_id: Any, error: BaseException) -> None:
    async with pool.acquire() as connection:
        await connection.execute(
            """UPDATE source_snapshot SET status='degraded',validation_report=validation_report || $1::jsonb
               WHERE id=$2""",
            json.dumps({"runState": "interrupted", "errorType": type(error).__name__,
                        "interruptedAt": datetime.now(timezone.utc).isoformat()}), snapshot_id,
        )


async def run(home_limit: int, school_limit: int, pause_seconds: float, retry_failed: bool = False) -> dict[str, Any]:
    load_local_project_env()
    token = os.getenv("ONEMAP_ACCESS_TOKEN", "").strip()
    if not token:
        raise RuntimeError("Set ONEMAP_ACCESS_TOKEN in the backend environment first. No geocoding request was sent.")
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is required for OneMap geocoding.")
    dsn = database_url.replace("postgresql+asyncpg://", "postgresql://", 1).replace("postgresql+psycopg://", "postgresql://", 1)
    pool = await asyncpg.create_pool(dsn, min_size=1, max_size=2, command_timeout=120)
    try:
        async with pool.acquire() as connection:
            home_rows = await connection.fetch(
                _HOME_QUEUE_QUERY, home_limit, retry_failed,
            ) if home_limit else []
            school_rows = await connection.fetch(
                _SCHOOL_QUEUE_QUERY, "d_688b934f82c1059ed0a6993d2a829089", school_limit, retry_failed,
            ) if school_limit else []
            building_rows = await connection.fetch(
                _HDB_BUILDING_POSTALS_QUERY, HDB_BUILDING_SOURCE_ID,
            ) if home_rows else []

        if not home_rows and not school_rows:
            return {
                "snapshotId": None,
                "state": "already_complete",
                "requests": 0,
                "homeAddressesResolved": 0,
                "homeAddressesUnmatched": 0,
                "schoolsResolved": 0,
                "schoolsUnmatched": 0,
                "retrievedAt": datetime.now(timezone.utc).isoformat(),
            }

        retrieved = datetime.now(timezone.utc)
        requested = {"homeAddresses": len(home_rows), "schools": len(school_rows)}
        building_snapshot_id = building_rows[0]["source_snapshot_id"] if building_rows else None
        hdb_postals_by_block: dict[str, set[str]] = {}
        for row in building_rows:
            raw_block = str(row["block"] or "").strip().upper()
            postal = str(row["postal"] or "").strip()
            if raw_block and re.fullmatch(r"\d{6}", postal):
                block = raw_block.lstrip("0") or "0"
                hdb_postals_by_block.setdefault(block, set()).add(postal)
        snapshot_id = await _start_snapshot(pool, retrieved, requested)
        totals = {
            "homeAddressesChecked": 0,
            "homeAddressesResolved": 0,
            "homeAddressesUnmatched": 0,
            "schoolsChecked": 0,
            "schoolsResolved": 0,
            "schoolsUnmatched": 0,
            "requests": 0,
        }
        homes: list[tuple[str, str, float, float]] = []
        schools: list[tuple[str, float, float]] = []
        rejected_homes: list[str] = []
        rejected_schools: list[str] = []
        digest = hashlib.sha256()
        processed_since_checkpoint = 0

        def include_in_digest(kind: str, identifier: str, point: tuple[float, float] | None) -> None:
            payload = json.dumps(
                {"kind": kind, "identifier": identifier, "point": point},
                sort_keys=True,
                separators=(",", ":"),
            )
            digest.update(payload.encode())
            digest.update(b"\n")

        async def checkpoint(*, complete: bool = False) -> str:
            nonlocal processed_since_checkpoint
            state = await _save_checkpoint(
                pool, snapshot_id, retrieved, homes, schools, rejected_homes, rejected_schools,
                totals, requested, digest.hexdigest(), complete=complete,
            )
            homes.clear()
            schools.clear()
            rejected_homes.clear()
            rejected_schools.clear()
            processed_since_checkpoint = 0
            return state

        def log_checkpoint(label: str, done: int, count: int) -> None:
            print(
                f"OneMap {label}: {done}/{count} checked; "
                f"{totals['homeAddressesResolved']} homes and {totals['schoolsResolved']} schools saved",
                file=sys.stderr,
                flush=True,
            )

        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(20, connect=8), follow_redirects=False) as client:
                for index, row in enumerate(home_rows, start=1):
                    address = row["address"]
                    result = await _search(client, token, address)
                    totals["requests"] += 1
                    totals["homeAddressesChecked"] += 1
                    block = _address_parts(address)
                    point = _match_home(
                        address, result,
                        hdb_postals_by_block.get(block[0].upper()) if block else None,
                    )
                    if point is None:
                        point = await _match_home_footprint(
                            pool, building_snapshot_id, address, result,
                            hdb_postals_by_block.get(block[0].upper()) if block else None,
                        )
                    if point:
                        homes.append((address, "home", point[0], point[1]))
                        totals["homeAddressesResolved"] += 1
                    else:
                        rejected_homes.append(address)
                        totals["homeAddressesUnmatched"] += 1
                    include_in_digest("home", address, point)
                    processed_since_checkpoint += 1
                    if processed_since_checkpoint >= _CHECKPOINT_SIZE:
                        await checkpoint()
                        log_checkpoint("home addresses", index, len(home_rows))
                    elif index % 50 == 0:
                        print(f"OneMap home addresses checked: {index}/{len(home_rows)}", file=sys.stderr, flush=True)
                    if index < len(home_rows) or school_rows:
                        await asyncio.sleep(pause_seconds)

                for index, row in enumerate(school_rows, start=1):
                    attributes = row["attributes"] or {}
                    if isinstance(attributes, str):
                        attributes = json.loads(attributes)
                    postal = _school_postal(attributes)
                    point = None
                    if postal:
                        result = await _search(client, token, postal)
                        totals["requests"] += 1
                        point = _match_postal(postal, result, row["name"])
                    totals["schoolsChecked"] += 1
                    if point:
                        schools.append((row["id"], point[0], point[1]))
                        totals["schoolsResolved"] += 1
                    else:
                        rejected_schools.append(row["id"])
                        totals["schoolsUnmatched"] += 1
                    include_in_digest("school", str(row["id"]), point)
                    processed_since_checkpoint += 1
                    if processed_since_checkpoint >= _CHECKPOINT_SIZE:
                        await checkpoint()
                        log_checkpoint("schools", index, len(school_rows))
                    elif index % 50 == 0:
                        print(f"OneMap school postcodes checked: {index}/{len(school_rows)}", file=sys.stderr, flush=True)
                    if index < len(school_rows):
                        await asyncio.sleep(pause_seconds)

            status = await checkpoint(complete=True)
            return {
                "snapshotId": str(snapshot_id),
                "state": status,
                "runState": "complete",
                "requests": totals["requests"],
                "homeAddressesResolved": totals["homeAddressesResolved"],
                "homeAddressesUnmatched": totals["homeAddressesUnmatched"],
                "schoolsResolved": totals["schoolsResolved"],
                "schoolsUnmatched": totals["schoolsUnmatched"],
                "retrievedAt": retrieved.isoformat(),
            }
        except BaseException as exc:
            # Flush the small in-memory batch before marking the run interrupted. That way a
            # transient failure only leaves the currently failing record pending.
            try:
                if processed_since_checkpoint:
                    await checkpoint()
                await _mark_interrupted(pool, snapshot_id, exc)
            except Exception as checkpoint_error:
                print(
                    f"Could not persist OneMap interruption metadata ({type(checkpoint_error).__name__}).",
                    file=sys.stderr,
                    flush=True,
                )
            raise
    finally:
        await pool.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Geocode missing HDB and MOE locations through OneMap.")
    parser.add_argument("--home-limit", type=int, default=100, help="Maximum unique HDB addresses for this sequential batch (default: 100).")
    parser.add_argument("--school-limit", type=int, default=400, help="Maximum unlocated current MOE records (default: 400).")
    parser.add_argument("--pause-seconds", type=float, default=1.1, help="Delay between OneMap requests, at least 0.5 seconds (default: 1.1).")
    parser.add_argument("--retry-failed", action="store_true", help="Retry previously ambiguous/unmatched addresses as well as pending records.")
    args = parser.parse_args()
    if args.home_limit < 0 or args.school_limit < 0 or args.pause_seconds < 0.5:
        parser.error("limits must be non-negative and pause-seconds must be at least 0.5")
    print(json.dumps(asyncio.run(run(args.home_limit, args.school_limit, args.pause_seconds, args.retry_failed)), indent=2))


if __name__ == "__main__":
    main()
