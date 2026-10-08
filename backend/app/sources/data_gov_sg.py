from __future__ import annotations

import asyncio
import csv
import hashlib
import io
import json
import os
import zipfile
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from urllib.parse import urlparse
from uuid import uuid4

import asyncpg
import httpx

from ..local_env import load_local_project_env

HDB_RESALE_DATASET_ID = "d_8b84c4ee58e3cfc0ece0d773c8ca6abc"
HDB_DATASET_URL = f"https://data.gov.sg/datasets/{HDB_RESALE_DATASET_ID}/view"
DATASET_API_ROOT = "https://api-open.data.gov.sg/v1/public/api/datasets"
MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024
MAX_RECORDS = 350_000
EXPECTED_FIELDS = {"month", "town", "flat_type", "block", "street_name", "storey_range", "floor_area_sqm", "flat_model", "lease_commence_date", "remaining_lease", "resale_price"}


def _csv_payload(payload: bytes) -> bytes:
    if payload.startswith(b"PK\x03\x04"):
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            csv_names = [name for name in archive.namelist() if name.lower().endswith(".csv") and not name.startswith("/") and ".." not in name.split("/")]
            if len(csv_names) != 1:
                raise ValueError("Expected exactly one CSV file inside the source archive.")
            info = archive.getinfo(csv_names[0])
            if info.file_size > MAX_DOWNLOAD_BYTES:
                raise ValueError("Expanded source CSV exceeded the configured size limit.")
            return archive.read(csv_names[0])
    return payload


def parse_hdb_rows(payload: bytes) -> tuple[list[tuple], int, date]:
    content = _csv_payload(payload)
    reader = csv.DictReader(io.StringIO(content.decode("utf-8-sig", errors="strict")))
    if not reader.fieldnames or not EXPECTED_FIELDS.issubset({str(field).strip().lower() for field in reader.fieldnames}):
        raise ValueError("The HDB export does not match the expected public resale-price schema.")
    normalized_fields = {str(field).strip().lower(): field for field in reader.fieldnames}
    rows: list[tuple] = []
    rejected = 0
    newest_month = date.min
    exact_row_occurrences: dict[str, int] = {}
    for index, raw in enumerate(reader, start=1):
        if index > MAX_RECORDS:
            raise ValueError("Source record count exceeded the configured safety limit.")
        row = {key: (raw.get(column) or "").strip() for key, column in normalized_fields.items()}
        try:
            month_text = row["month"]
            year, month = (int(part) for part in month_text.split("-", 1))
            month_date = date(year, month, 1)
            price = Decimal(row["resale_price"])
            if price <= 0 or not price.is_finite():
                raise ValueError("price")
            address = f"{row['block']} {row['street_name']}".strip()
            town = row["town"].strip()
            flat_type = row["flat_type"].strip()
            if not all((address, town, flat_type)):
                raise ValueError("identity")
            cents = int(price * 100)
            # The official export has no transaction primary key. Preserve identical source rows
            # with deterministic occurrence suffixes instead of silently collapsing possible sales.
            stable_data = json.dumps({key: row[key] for key in sorted(EXPECTED_FIELDS)}, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            occurrence = exact_row_occurrences.get(stable_data, 0)
            exact_row_occurrences[stable_data] = occurrence + 1
            candidate_id = "hdb-" + hashlib.sha256(f"{stable_data}|{occurrence}".encode("utf-8")).hexdigest()[:40]
            area = Decimal(row["floor_area_sqm"]) if row["floor_area_sqm"] else None
            if area is not None and (not area.is_finite() or area <= 0 or area > 1000):
                raise ValueError("floor_area_sqm")
            rows.append((candidate_id, address, town.title(), flat_type.upper(), cents, month_date, area, row["storey_range"] or None,
                         int(row["lease_commence_date"]) if row["lease_commence_date"].isdigit() else None,
                         row["flat_model"] or None, row["remaining_lease"] or None))
            newest_month = max(newest_month, month_date)
        except (ValueError, InvalidOperation, ArithmeticError):
            rejected += 1
    if not rows:
        raise ValueError("No valid HDB resale records were found; existing data was not replaced.")
    return rows, rejected, newest_month


def _safe_download_url(value: str) -> str:
    parsed = urlparse(value)
    configured_hosts = {host.strip().lower() for host in os.getenv("DATA_GOV_SG_DOWNLOAD_HOSTS", "data.gov.sg,api-open.data.gov.sg,storage.data.gov.sg").split(",") if host.strip()}
    host = (parsed.hostname or "").lower()
    trusted = "*" in configured_hosts or host in configured_hosts or any(host.endswith("." + allowed) for allowed in configured_hosts)
    if parsed.scheme != "https" or not host or not trusted or parsed.username or parsed.password:
        safe_host = host or "<missing>"
        raise ValueError(
            "The dataset API returned a download URL rejected by the HTTPS host policy "
            f"(scheme={parsed.scheme or '<missing>'!r}, host={safe_host!r}); "
            "the URL was not fetched. Configure verified HTTPS hosts in DATA_GOV_SG_DOWNLOAD_HOSTS."
        )
    return value


async def download_hdb_csv(client: httpx.AsyncClient, *, api_key: str | None = None, dataset_id: str = HDB_RESALE_DATASET_ID,
                           poll_interval_seconds: float = 6.0, max_polls: int = 20) -> bytes:
    if not dataset_id.startswith("d_") or not dataset_id.replace("_", "").isalnum():
        raise ValueError("Invalid data.gov.sg dataset ID.")
    headers = {"x-api-key": api_key} if api_key else {}
    root = f"{DATASET_API_ROOT}/{dataset_id}"
    initiated = await client.get(f"{root}/initiate-download", headers=headers)
    initiated.raise_for_status()
    download_url = None
    for attempt in range(max_polls):
        response = await client.get(f"{root}/poll-download", headers=headers)
        response.raise_for_status()
        result = response.json().get("data", {})
        if result.get("url"):
            download_url = _safe_download_url(str(result["url"]))
            break
        state = str(result.get("status", "")).lower()
        if state and state not in {"processing", "pending", "in_progress", "in progress"}:
            raise RuntimeError(f"data.gov.sg download failed with status {state!r}.")
        if attempt + 1 < max_polls:
            await asyncio.sleep(poll_interval_seconds)
    if not download_url:
        raise TimeoutError("data.gov.sg did not make the export available before the polling deadline.")
    chunks: list[bytes] = []
    received = 0
    # Signed export links should be fetched directly. Do not let an HTTPS link
    # redirect the importer to an unchecked destination (including when the
    # temporary DATA_GOV_SG_DOWNLOAD_HOSTS=* development override is enabled).
    # The API key authenticates only the data.gov.sg control-plane calls. The
    # signed export URL is a separate host and must never receive that key.
    async with client.stream("GET", download_url, follow_redirects=False) as result:
        if result.is_redirect:
            raise ValueError("The HDB export URL redirected; configure its final HTTPS download host and retry.")
        result.raise_for_status()
        if result.url.host and not _safe_download_url(str(result.url)):
            raise ValueError("The final dataset download URL is not trusted.")
        async for chunk in result.aiter_bytes():
            received += len(chunk)
            if received > MAX_DOWNLOAD_BYTES:
                raise ValueError("The HDB export exceeded the configured download size limit.")
            chunks.append(chunk)
    return b"".join(chunks)


async def import_hdb_resale(pool: asyncpg.Pool, payload: bytes, *, dataset_id: str = HDB_RESALE_DATASET_ID) -> dict:
    if len(payload) > MAX_DOWNLOAD_BYTES:
        raise ValueError("The HDB export exceeded the configured download size limit.")
    rows, rejected, newest_month = parse_hdb_rows(payload)
    snapshot_id = uuid4()
    checksum = hashlib.sha256(payload).hexdigest()
    retrieved = datetime.now(timezone.utc)
    status = "degraded" if rejected else "valid"
    inserted = 0
    async with pool.acquire() as connection:
        async with connection.transaction():
            await connection.execute(
                """INSERT INTO source_snapshot (id, source_id, source_url, source_version, content_hash, source_updated_at,
                   retrieved_at, row_count, rejected_count, status, validation_report)
                   VALUES ($1, $2, $3, $4, $5, NULL, $6, 0, $7, 'staged', $8::jsonb)""",
                snapshot_id, dataset_id, HDB_DATASET_URL, newest_month.isoformat(), checksum, retrieved, rejected,
                json.dumps({"schema": "hdb-resale-jan-2017-onwards/v1", "geometry": "not supplied by source; geocoding required", "semantics": "historical transaction, not current listing"}),
            )
            insert_sql = """INSERT INTO candidate_home (id, source_snapshot_id, address, town, flat_type, price_observation_cents,
                            observed_on, geometry, source_semantics, floor_area_sqm, storey_range, lease_commence_year, flat_model, remaining_lease)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, 'historical_transaction', $8, $9, $10, $11, $12)
                         ON CONFLICT (id) DO UPDATE SET source_snapshot_id=EXCLUDED.source_snapshot_id, address=EXCLUDED.address,
                           town=EXCLUDED.town, flat_type=EXCLUDED.flat_type, price_observation_cents=EXCLUDED.price_observation_cents,
                           observed_on=EXCLUDED.observed_on, floor_area_sqm=EXCLUDED.floor_area_sqm, storey_range=EXCLUDED.storey_range,
                           lease_commence_year=EXCLUDED.lease_commence_year, flat_model=EXCLUDED.flat_model, remaining_lease=EXCLUDED.remaining_lease"""
            for start in range(0, len(rows), 1000):
                batch = [(row[0], snapshot_id, *row[1:]) for row in rows[start:start + 1000]]
                await connection.executemany(insert_sql, batch)
                inserted += len(batch)
            await connection.execute(
                """UPDATE source_snapshot SET row_count=$1, status=$2, validation_report=$3::jsonb WHERE id=$4""",
                inserted, status, json.dumps({"schema": "hdb-resale-jan-2017-onwards/v1", "rejected": rejected,
                  "geometry": "not supplied by source; geocoding required", "semantics": "historical transaction, not current listing"}), snapshot_id,
            )
    return {"snapshotId": str(snapshot_id), "sourceId": dataset_id, "rows": inserted, "rejected": rejected,
            "contentSha256": checksum, "sourceUpdatedThrough": newest_month.isoformat(), "status": status,
            "semantics": "historical resale transactions; not current availability or asking prices"}


async def run_import() -> dict:
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is required to import the HDB dataset.")
    dsn = database_url.replace("postgresql+asyncpg://", "postgresql://", 1).replace("postgresql+psycopg://", "postgresql://", 1)
    dataset_id = os.getenv("HDB_RESALE_DATASET_ID", HDB_RESALE_DATASET_ID)
    async with httpx.AsyncClient(timeout=httpx.Timeout(45, connect=8), follow_redirects=True) as client:
        payload = await download_hdb_csv(client, api_key=os.getenv("DATA_GOV_SG_API_KEY"), dataset_id=dataset_id)
    pool = await asyncpg.create_pool(dsn, min_size=1, max_size=3, command_timeout=120)
    try:
        return await import_hdb_resale(pool, payload, dataset_id=dataset_id)
    finally:
        await pool.close()


if __name__ == "__main__":
    load_local_project_env()
    print(json.dumps(asyncio.run(run_import()), indent=2))
