"""Import registered public Singapore geospatial datasets into PostGIS.

Run from ``backend`` with ``python -m app.sources.data_gov_resources``. The
importer stores source provenance and promotes each layer atomically. It keeps
non-geocoded address sources too, so an unconfigured geocoder is reported as a
limitation rather than silently dropping school records.
"""

from __future__ import annotations

import asyncio
import csv
import hashlib
from html.parser import HTMLParser
import io
import json
import os
import re
import sys
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import PurePosixPath
from typing import Any
from urllib.parse import urlparse
from uuid import uuid4

import asyncpg
import httpx

from ..local_env import load_local_project_env
from .data_gov_sg import DATASET_API_ROOT, MAX_DOWNLOAD_BYTES, _safe_download_url


@dataclass(frozen=True)
class SourceDefinition:
    dataset_id: str
    resource_type: str
    format: str
    name_fields: tuple[str, ...]
    status_fields: tuple[str, ...] = ("STATUS", "OPERATIONAL_STATUS", "ACTIVE_STATUS")
    description: str = ""

    @property
    def url(self) -> str:
        return f"https://data.gov.sg/datasets/{self.dataset_id}/view"


# All IDs point to first-party data.gov.sg catalogues. MOE's current list is
# address/postcode-only; coordinates are intentionally left NULL until OneMap
# authorization is configured.
SOURCES: tuple[SourceDefinition, ...] = (
    SourceDefinition("d_16b157c52ed637edd6ba1232e026258d", "hdb_building", "geojson", ("BLK_NO", "BLOCK_NO", "NAME"), description="HDB active building footprints; geometry is the building boundary."),
    SourceDefinition("d_17f5382f26140b1fdae0ba2ef6239d2f", "hdb_property", "csv", ("BLK_NO", "BLK_NO_TEXT", "BLOCK", "STREET"), description="HDB block/property attributes; no coordinates supplied."),
    SourceDefinition("d_dc343c021aa470fc71da90d31e552a9a", "silver_zone", "geojson", ("NAME", "SILVER_ZONE", "LOCATION", "DESCRIPTION")),
    SourceDefinition("d_e2d10e591bc8560b8946a0da24790fa5", "dementia_gtp", "geojson", ("NAME", "FACILITY_NAME", "LOCATION", "DESCRIPTION")),
    SourceDefinition("d_548c33ea2d99e29ec63a7cc9edcccedc", "chas_clinic", "geojson", ("HCI_NAME", "NAME", "CLINIC_NAME")),
    SourceDefinition("d_f706de1427279e61fe41e89e24d440fa", "community_club", "geojson", ("NAME", "CC_NAME"), description="PA community-club location snapshot; does not establish current opening hours or availability."),
    SourceDefinition("d_f0fd1b3643ed8bd34bd403dedd7c1533", "eldercare", "geojson", ("NAME", "HCI_NAME"), description="MOH Eldercare Services location snapshot only; not a complete directory of hospitals, polyclinics or all health facilities."),
    SourceDefinition("d_14d807e20158338fd578c2913953516e", "park_facility", "geojson", ("NAME", "CLASS"), description="NParks representative park-facility points; unnamed facilities retain their published facility class."),
    SourceDefinition("d_688b934f82c1059ed0a6993d2a829089", "moe_school", "csv", ("SCHOOL_NAME", "SCHOOL", "NAME"), description="Current MOE school directory; coordinates are not published in this CSV."),
    SourceDefinition("d_5d668e3f544335f8028f546827b773b4", "childcare", "geojson", ("NAME", "CENTRE_NAME", "CHILDCARE_NAME")),
    SourceDefinition("d_77e6e0d58ce4743dab1f26dfcbbeb6f4", "student_care", "geojson", ("NAME", "CENTRE_NAME", "STUDENT_CARE_CENTRE", "NAME_OF_STUDENT_CARE_CENTRE")),
    SourceDefinition("d_7fe9a72b1afff18e48111772c8d0fd39", "kindergarten", "geojson", ("NAME", "CENTRE_NAME", "KINDERGARTEN_NAME")),
    SourceDefinition("d_696c994c50745b079b3684f0e90ffc53", "childcare_registry", "csv", ("CENTRE_NAME", "NAME")),
    SourceDefinition("d_44cfe12f2858ae503a093dfc075a28be", "childcare_fees", "csv", ("CENTRE_NAME", "NAME")),
    SourceDefinition("d_253a7e348279bf0a87666a71f7ea2e67", "childcare_charges", "csv", ("CENTRE_NAME", "NAME")),
    SourceDefinition("d_abf023b38d9bc451484e3d67b562bc5c", "school_zone", "geojson", ("NAME", "SCHOOL", "DESCRIPTION"), description="LTA school-zone polygons, not school point locations."),
    SourceDefinition("d_dbfabf16158d1b0e1c420627c0819168", "dengue_cluster", "geojson", ("LOCALITY", "NAME", "CLUSTER_NAME")),
)

_BY_ID = {source.dataset_id: source for source in SOURCES}
_MAX_FEATURES = 350_000
_SINGAPORE_BOUNDS = (103.0, 1.0, 105.0, 2.0)


def _normal_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def _pick(record: dict[str, Any], candidates: tuple[str, ...]) -> Any:
    normalized = {_normal_key(str(key)): value for key, value in record.items()}
    for key in candidates:
        value = normalized.get(_normal_key(key))
        if value is not None and str(value).strip():
            return value
    return None


def _public_attributes(record: dict[str, Any]) -> dict[str, Any]:
    # Retain public, useful evidence while avoiding direct contact details that
    # the app does not need for discovery or distance calculations.
    return {
        str(key): value
        for key, value in record.items()
        if not any(term in _normal_key(str(key)) for term in ("email", "telephone", "phone", "mobile", "contactperson", "principal", "viceprincipal"))
        and not ("description" in _normal_key(str(key)) and isinstance(value, str) and re.search(r"(?i)(?:tel|phone|email|contact)\s*[:#]", value))
    }


class _TableText(HTMLParser):
    """Read simple key/value tables embedded by some legacy GeoJSON exports."""

    def __init__(self) -> None:
        super().__init__()
        self.cells: list[str] = []
        self._in_cell = False
        self._parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() in {"td", "th"}:
            # Export tables begin with a two-column "Attributes" heading.
            # It is not a key/value cell and would shift every following pair.
            self._in_cell = not any(key.lower() == "colspan" and value != "1" for key, value in attrs)
            self._parts = []

    def handle_data(self, data: str) -> None:
        if self._in_cell:
            self._parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in {"td", "th"} and self._in_cell:
            self.cells.append(" ".join(" ".join(self._parts).split()))
            self._in_cell = False


def _flatten_description(properties: dict[str, Any]) -> dict[str, Any]:
    flattened = dict(properties)
    description = properties.get("Description") or properties.get("description")
    if not isinstance(description, str) or "<" not in description:
        return flattened
    parser = _TableText()
    parser.feed(description)
    for index in range(0, len(parser.cells) - 1, 2):
        key, value = parser.cells[index:index + 2]
        if key and key not in flattened:
            flattened[key] = value
    flattened.pop("Description", None)
    flattened.pop("description", None)
    return flattened


def _unpack(payload: bytes, expected: str) -> bytes:
    if len(payload) > MAX_DOWNLOAD_BYTES:
        raise ValueError("The source export exceeded the 100 MB download limit.")
    if not payload.startswith(b"PK\x03\x04"):
        return payload
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        candidates = [
            entry for entry in archive.infolist()
            if not entry.is_dir()
            and ".." not in PurePosixPath(entry.filename).parts
            and not PurePosixPath(entry.filename).is_absolute()
            and entry.filename.lower().endswith((".geojson", ".json", ".csv"))
        ]
        candidates = [entry for entry in candidates if entry.filename.lower().endswith(expected)] or candidates
        if len(candidates) != 1:
            raise ValueError(f"Expected one {expected or 'data'} file inside the source archive; found {len(candidates)}.")
        if candidates[0].file_size > MAX_DOWNLOAD_BYTES:
            raise ValueError("Expanded source file exceeded the 100 MB limit.")
        return archive.read(candidates[0])


def _read_geojson(payload: bytes) -> list[tuple[str, str | None, dict[str, Any], str | None]]:
    data = json.loads(_unpack(payload, ".geojson").decode("utf-8-sig", errors="strict"))
    if not isinstance(data, dict) or data.get("type") != "FeatureCollection" or not isinstance(data.get("features"), list):
        raise ValueError("Expected a GeoJSON FeatureCollection.")
    if len(data["features"]) > _MAX_FEATURES:
        raise ValueError("Feature count exceeded the configured safety limit.")
    rows: list[tuple[str, str | None, dict[str, Any], str | None]] = []
    for feature in data["features"]:
        if not isinstance(feature, dict) or feature.get("type") != "Feature":
            continue
        properties = feature.get("properties") or {}
        geometry = feature.get("geometry")
        if not isinstance(properties, dict) or not isinstance(geometry, dict) or geometry.get("type") not in {
            "Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon", "GeometryCollection",
        }:
            continue
        rows.append(("", json.dumps(geometry, ensure_ascii=False, separators=(",", ":")), _public_attributes(_flatten_description(properties)), None))
    return rows


def _read_csv(payload: bytes) -> list[tuple[str, str | None, dict[str, Any], str | None]]:
    content = _unpack(payload, ".csv")
    reader = csv.DictReader(io.StringIO(content.decode("utf-8-sig", errors="strict")))
    if not reader.fieldnames:
        raise ValueError("The source CSV has no header row.")
    rows: list[tuple[str, str | None, dict[str, Any], str | None]] = []
    for index, row in enumerate(reader, start=1):
        if index > _MAX_FEATURES:
            raise ValueError("Record count exceeded the configured safety limit.")
        properties = {str(key).strip(): (value or "").strip() for key, value in row.items() if key}
        rows.append(("", None, _public_attributes(properties), None))
    return rows


def parse_resource_payload(source: SourceDefinition, payload: bytes) -> tuple[list[tuple[str, str | None, dict[str, Any], str | None]], int]:
    raw_rows = _read_geojson(payload) if source.format == "geojson" else _read_csv(payload)
    rows: list[tuple[str, str | None, dict[str, Any], str | None]] = []
    rejected = 0
    for _, geometry, attributes, _ in raw_rows:
        name = _pick(attributes, source.name_fields)
        if name and source.resource_type == "hdb_building":
            name = f"HDB block {name}"
        if name and source.resource_type == "hdb_property":
            street = _pick(attributes, ("STREET", "STREET_NAME"))
            name = f"{name} {street}".strip() if street else f"HDB block {name}"
        if not name:
            if source.resource_type == "hdb_building":
                block = _pick(attributes, ("BLK_NO", "BLOCK_NO"))
                name = f"HDB block {block}" if block else None
            elif source.resource_type == "hdb_property":
                block = _pick(attributes, ("BLK_NO", "BLK_NO_TEXT", "BLOCK"))
                street = _pick(attributes, ("STREET", "STREET_NAME"))
                name = " ".join(str(value) for value in (block, street) if value)
        if not name:
            rejected += 1
            continue
        record_id = _pick(attributes, ("OBJECTID", "OBJECT_ID", "HCI_CODE", "SCHOOL_CODE", "POSTAL_CD", "POSTAL_COD", "CENTRE_ID", "CENTRE_CODE", "ENTITYID", "ID"))
        stable = json.dumps(attributes, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        stable_key = str(record_id) if record_id is not None else ""
        row_hash = hashlib.sha256(f"{source.dataset_id}|{stable_key}|{stable}|{geometry or ''}".encode("utf-8")).hexdigest()[:40]
        status = _pick(attributes, source.status_fields)
        rows.append((f"{source.resource_type}-{row_hash}", geometry, attributes, str(status) if status is not None else None))
        rows[-1] = (rows[-1][0], rows[-1][1], {**attributes, "_source_name": str(name)}, rows[-1][3])
    if not rows:
        raise ValueError("No valid source records were found; the previous layer was left untouched.")
    return rows, rejected


def source_update_time(rows: list[tuple[str, str | None, dict[str, Any], str | None]]) -> datetime | None:
    values: list[datetime] = []
    for _, _, attributes, _ in rows:
        raw = _pick(attributes, ("FMEL_UPD_D", "LAST_UPDATED", "UPDATED_AT", "UPDATE_DATE", "DATA_AS_OF"))
        if raw is None:
            continue
        text = str(raw).strip()
        for fmt in ("%Y%m%d%H%M%S", "%Y%m%d", "%Y-%m-%d", "%Y-%m-%dT%H:%M:%S%z"):
            try:
                parsed = datetime.strptime(text, fmt)
                values.append(parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc))
                break
            except ValueError:
                continue
    return max(values) if values else None


async def _control_request(client: httpx.AsyncClient, url: str, headers: dict[str, str]) -> httpx.Response:
    delays = (8, 20, 45, 90)
    for attempt in range(len(delays) + 1):
        response = await client.get(url, headers=headers)
        if response.status_code != 429 or attempt == len(delays):
            response.raise_for_status()
            return response
        retry_after = response.headers.get("Retry-After", "")
        try:
            wait_seconds = min(120, max(1, int(retry_after)))
        except ValueError:
            wait_seconds = delays[attempt]
        await asyncio.sleep(wait_seconds)
    raise AssertionError("unreachable")


async def download_dataset(client: httpx.AsyncClient, source: SourceDefinition, *, api_key: str | None = None) -> bytes:
    if not source.dataset_id.startswith("d_") or not source.dataset_id.replace("_", "").isalnum():
        raise ValueError("Invalid data.gov.sg dataset ID.")
    headers = {"x-api-key": api_key} if api_key else {}
    root = f"{DATASET_API_ROOT}/{source.dataset_id}"
    await _control_request(client, f"{root}/initiate-download", headers)
    download_url = None
    for attempt in range(24):
        response = await _control_request(client, f"{root}/poll-download", headers)
        result = response.json().get("data", {})
        if result.get("url"):
            download_url = _safe_download_url(str(result["url"]))
            break
        state = str(result.get("status", "")).lower()
        if state and state not in {"processing", "pending", "in_progress", "in progress"}:
            raise RuntimeError(f"data.gov.sg download failed with status {state!r} for {source.dataset_id}.")
        await asyncio.sleep(min(12, 3 + attempt))
    if not download_url:
        raise TimeoutError(f"data.gov.sg did not prepare {source.dataset_id} before the polling deadline.")
    chunks: list[bytes] = []
    received = 0
    async with client.stream("GET", download_url, follow_redirects=False) as response:
        if response.is_redirect:
            raise ValueError(f"Export link for {source.dataset_id} redirected; the redirect was not followed.")
        response.raise_for_status()
        parsed = urlparse(str(response.url))
        _safe_download_url(str(response.url))
        if not parsed.hostname:
            raise ValueError("Source export resolved to a URL with no host.")
        async for chunk in response.aiter_bytes():
            received += len(chunk)
            if received > MAX_DOWNLOAD_BYTES:
                raise ValueError(f"Export for {source.dataset_id} exceeded the 100 MB download limit.")
            chunks.append(chunk)
    return b"".join(chunks)


async def import_resource(pool: asyncpg.Pool, source: SourceDefinition, payload: bytes) -> dict[str, Any]:
    rows, rejected = parse_resource_payload(source, payload)
    snapshot_id = uuid4()
    retrieved = datetime.now(timezone.utc)
    updated = source_update_time(rows)
    checksum = hashlib.sha256(payload).hexdigest()
    status = "degraded" if rejected else "valid"
    inserted = 0
    async with pool.acquire() as connection:
        async with connection.transaction():
            await connection.execute(
                """INSERT INTO source_snapshot (id, source_id, source_url, source_version, content_hash, source_updated_at,
                   retrieved_at, geometry_srid, row_count, rejected_count, status, validation_report)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,4326,0,$8,'staged',$9::jsonb)""",
                snapshot_id, source.dataset_id, source.url, updated.isoformat() if updated else None, checksum, updated,
                retrieved, rejected,
                json.dumps({"schema": "data.gov.sg-resource/v1", "resourceType": source.resource_type,
                            "geometry": "EPSG:4326 GeoJSON where published; address-only records remain unlocated",
                            "note": source.description}, ensure_ascii=False),
            )
            sql = """INSERT INTO neighbourhood_resource (id,source_snapshot_id,resource_type,name,geometry,status,attributes)
                     VALUES ($1,$2,$3,$4,CASE WHEN $5::text IS NULL THEN NULL ELSE ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON($5),4326)) END,$6,$7::jsonb)
                     ON CONFLICT (id) DO UPDATE SET source_snapshot_id=EXCLUDED.source_snapshot_id,
                       resource_type=EXCLUDED.resource_type,name=EXCLUDED.name,
                       geometry=COALESCE(EXCLUDED.geometry,neighbourhood_resource.geometry),
                       location_source_snapshot_id=CASE WHEN EXCLUDED.geometry IS NOT NULL THEN NULL ELSE neighbourhood_resource.location_source_snapshot_id END,
                       status=EXCLUDED.status,attributes=EXCLUDED.attributes"""
            for offset in range(0, len(rows), 500):
                batch = []
                for resource_id, geometry, attributes, row_status in rows[offset:offset + 500]:
                    name = attributes.pop("_source_name")
                    batch.append((resource_id, snapshot_id, source.resource_type, name, geometry, row_status,
                                  json.dumps(attributes, ensure_ascii=False, separators=(",", ":"))))
                await connection.executemany(sql, batch)
                inserted += len(batch)
            await connection.execute(
                "UPDATE source_snapshot SET row_count=$1,status=$2,validation_report=validation_report || $3::jsonb WHERE id=$4",
                inserted, status,
                json.dumps({"rejected": rejected, "geocoded": sum(1 for _, geometry, _, _ in rows if geometry is not None),
                            "unlocated": sum(1 for _, geometry, _, _ in rows if geometry is None)}), snapshot_id,
            )
    return {"sourceId": source.dataset_id, "resourceType": source.resource_type, "snapshotId": str(snapshot_id),
            "rows": inserted, "rejected": rejected, "geocoded": sum(1 for _, geom, _, _ in rows if geom),
            "unlocated": sum(1 for _, geom, _, _ in rows if not geom), "sourceUpdatedAt": updated.isoformat() if updated else None,
            "retrievedAt": retrieved.isoformat(), "contentSha256": checksum, "state": status}


async def run_import(source_ids: list[str] | None = None) -> list[dict[str, Any]]:
    load_local_project_env()
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is required to import public resource layers.")
    dsn = database_url.replace("postgresql+asyncpg://", "postgresql://", 1).replace("postgresql+psycopg://", "postgresql://", 1)
    selected = [_BY_ID[source_id] for source_id in source_ids] if source_ids else list(SOURCES)
    api_key = os.getenv("DATA_GOV_SG_API_KEY") or None
    async with httpx.AsyncClient(timeout=httpx.Timeout(60, connect=10), follow_redirects=True) as client:
        pool = await asyncpg.create_pool(dsn, min_size=1, max_size=3, command_timeout=180)
        try:
            outcomes = []
            for source in selected:
                print(f"Fetching {source.dataset_id} ({source.resource_type})", file=sys.stderr, flush=True)
                payload = await download_dataset(client, source, api_key=api_key)
                outcome = await import_resource(pool, source, payload)
                outcomes.append(outcome)
                print(f"Imported {source.dataset_id}: {outcome['rows']:,} rows ({outcome['state']})", file=sys.stderr, flush=True)
                # Free anonymous catalogue quota is deliberately used serially.
                await asyncio.sleep(2)
            return outcomes
        finally:
            await pool.close()


if __name__ == "__main__":
    print(json.dumps(asyncio.run(run_import(sys.argv[1:] or None)), indent=2))
