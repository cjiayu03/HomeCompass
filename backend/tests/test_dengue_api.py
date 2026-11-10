import asyncio
import json
from datetime import datetime, timedelta, timezone

import httpx

from app import main
from app.dengue import _VERIFIED_PROVENANCE


DENGUE_SOURCE_ID = "d_dbfabf16158d1b0e1c420627c0819168"
DENGUE_SOURCE_URL = f"https://data.gov.sg/datasets/{DENGUE_SOURCE_ID}/view"


def _snapshot(*, source_updated_at=None, state="valid", rejected=0, rows=1, completeness=None):
    now = datetime.now(timezone.utc)
    validation = {
        "sourceTimestampProvenance": _VERIFIED_PROVENANCE,
        "snapshotCompleteness": completeness or ("complete_export" if state == "valid" and rejected == 0 else "partial_export"),
    }
    return {
        "source_id": DENGUE_SOURCE_ID,
        "source_url": DENGUE_SOURCE_URL,
        "source_version": (source_updated_at or now).isoformat(),
        "source_updated_at": source_updated_at or (now - timedelta(hours=1)),
        "retrieved_at": now,
        "row_count": rows,
        "rejected_count": rejected,
        "status": state,
        # API codecs may return jsonb values as strings; exercise that path.
        "validation_report": json.dumps(validation),
    }


def _polygon_feature(identifier="cluster-1", count=10, name="Example cluster"):
    return {
        "id": identifier,
        "resource_type": "dengue_cluster",
        "name": name,
        "status": None,
        "attributes": {"LOCALITY": name, "CASE_SIZE": count, "FMEL_UPD_D": "20261027175046"},
        "geometry": '{"type":"Polygon","coordinates":[[[103.8,1.3],[103.81,1.3],[103.81,1.31],[103.8,1.3]]]}',
        "source_id": DENGUE_SOURCE_ID,
        "source_url": DENGUE_SOURCE_URL,
        "source_version": "2026-10-30T02:06:43+00:00",
        "source_updated_at": datetime.now(timezone.utc) - timedelta(hours=1),
        "retrieved_at": datetime.now(timezone.utc),
        "location_source_id": None,
        "location_retrieved_at": None,
    }


class ResourceConnection:
    def __init__(self, snapshot=None, features=(), counts=()):
        self.snapshot = snapshot
        self.features = list(features)
        self.counts = list(counts)
        self.resource_sql = None

    async def fetchrow(self, sql, *_values):
        if "FROM source_snapshot WHERE source_id=$1" in sql:
            return self.snapshot
        raise AssertionError(f"Unexpected fetchrow: {sql}")

    async def fetch(self, sql, *values):
        if "SELECT r.resource_type, count(*)" in sql:
            return self.counts if values[0] is True else [row for row in self.counts if row["resource_type"] != "dengue_cluster"]
        if "FROM neighbourhood_resource r JOIN latest s" in sql:
            self.resource_sql = (sql, values)
            enabled = values[1] is True
            rows = [row for row in self.features if row["resource_type"] != "dengue_cluster" or enabled]
            requested_types = values[0]
            if requested_types:
                rows = [row for row in rows if row["resource_type"] in requested_types]
            return rows[: values[-1] - 1]
        raise AssertionError(f"Unexpected fetch: {sql}")


class Pool:
    def __init__(self, connection):
        self.connection = connection

    def acquire(self):
        return self

    async def __aenter__(self):
        return self.connection

    async def __aexit__(self, *_args):
        return None


def _resource_response(monkeypatch, connection, *, params=None):
    monkeypatch.setattr(main, "require_pool", lambda: Pool(connection))

    async def send():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
            return await client.get("/api/v1/resources", params=params)

    return asyncio.run(send())


def test_resources_expose_fresh_source_metadata_and_official_case_bands(monkeypatch):
    snapshot = _snapshot()
    connection = ResourceConnection(snapshot, [_polygon_feature(count=18)], [{"resource_type": "dengue_cluster", "total": 1, "unlocated": 0}])
    response = _resource_response(monkeypatch, connection, params={"resource_type": "dengue_cluster", "limit": 1})

    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 1
    assert body["dengue"]["state"] == "fresh"
    assert body["dengue"]["complete"] is True
    properties = body["features"][0]["properties"]
    assert properties["caseCount"] == 18
    assert properties["alertLevel"] == "red"
    assert properties["categoryLabel"] == "High-risk cluster (10 or more cases)"
    assert properties["recordUpdatedAt"] == "2026-10-27T09:50:46+00:00"
    assert "$2::boolean IS TRUE" in connection.resource_sql[0]


def test_resources_return_snapshot_status_when_viewport_or_page_has_no_polygons(monkeypatch):
    snapshot = _snapshot(rows=0)
    connection = ResourceConnection(snapshot, [], [])
    response = _resource_response(monkeypatch, connection, params={"resource_type": "dengue_cluster", "bounds": "103.7,1.2,103.9,1.4", "limit": 1})

    assert response.status_code == 200
    body = response.json()
    assert body["features"] == []
    assert body["dengue"]["state"] == "fresh"
    assert body["dengue"]["rows"] == 0
    assert body["dengue"]["sourceUpdatedAt"] is not None


def test_resources_suppress_stale_or_unverified_dengue_polygons_server_side(monkeypatch):
    stale_snapshot = _snapshot(source_updated_at=datetime.now(timezone.utc) - timedelta(days=365))
    connection = ResourceConnection(stale_snapshot, [_polygon_feature()], [{"resource_type": "dengue_cluster", "total": 1, "unlocated": 0}])
    response = _resource_response(monkeypatch, connection, params={"resource_type": "dengue_cluster"})

    assert response.status_code == 200
    body = response.json()
    assert body["features"] == []
    assert body["counts"] == []
    assert body["dengue"]["state"] == "stale"
    assert body["dengue"]["usable"] is False


def test_resource_status_is_unavailable_even_without_a_snapshot(monkeypatch):
    response = _resource_response(monkeypatch, ResourceConnection(), params={"resource_type": "dengue_cluster"})
    assert response.status_code == 200
    body = response.json()
    assert body["features"] == []
    assert body["dengue"]["state"] == "source_unavailable"


class HomeConnection:
    def __init__(self, home):
        self.home = home

    async def fetchrow(self, sql, *_values):
        if "WHERE h.id=$1" in sql and "FROM candidate_home h JOIN source_snapshot s" in sql:
            return self.home
        if "count(*) AS total, count(*) FILTER" in sql:
            return {"total": 1, "geocoded": 1}
        if "AS schools" in sql and "FROM neighbourhood_resource" in sql:
            return {"schools": 1, "childcare": 1, "care": 1}
        if "SELECT count(*) AS total" in sql and "FROM candidate_home h" in sql:
            return {"total": 1}
        raise AssertionError(f"Unexpected fetchrow: {sql}")

    async def fetch(self, sql, *_values):
        if "FROM page_homes h JOIN source_snapshot" in sql:
            return [self.home]
        if "FROM shortlist s JOIN shortlist_entry" in sql:
            return [self.home]
        raise AssertionError(f"Unexpected fetch: {sql}")


def _home_record():
    now = datetime.now(timezone.utc)
    return {
        "id": "home-1", "address": "Example Street", "town": "BISHAN", "flat_type": "4 ROOM",
        "price_observation_cents": 45_000_000, "observed_on": None, "source_semantics": "historical_transaction",
        "floor_area_sqm": None, "storey_range": None, "lease_commence_year": None,
        "geocode_status": "resolved", "geometry_source": "onemap", "geocoded_at": now,
        "latitude": 1.32, "longitude": 103.84, "source_id": "hdb-resale", "source_version": "2026-09",
        "retrieved_at": now, "school_name": None, "school_distance_m": None, "childcare_name": None,
        "childcare_distance_m": None, "care_name": None, "care_distance_m": None,
        "dengue_snapshot_id": "snapshot-1", "dengue_source_id": DENGUE_SOURCE_ID,
        "dengue_source_url": DENGUE_SOURCE_URL, "dengue_source_version": now.isoformat(),
        "dengue_source_updated_at": now - timedelta(hours=1), "dengue_retrieved_at": now,
        "dengue_row_count": 1, "dengue_rejected_count": 0, "dengue_snapshot_status": "valid",
        "dengue_validation_report": json.dumps({
            "sourceTimestampProvenance": _VERIFIED_PROVENANCE,
            "snapshotCompleteness": "complete_export",
        }),
        "dengue_cluster_id": "cluster-1", "dengue_locality": "Example cluster",
        "dengue_case_count": 10, "dengue_feature_updated_at": "20261027175046",
    }


def test_search_detail_and_saved_home_paths_share_one_dengue_policy(monkeypatch):
    connection = HomeConnection(_home_record())
    monkeypatch.setattr(main, "require_pool", lambda: Pool(connection))
    previous = dict(main.app.dependency_overrides)
    main.app.dependency_overrides[main.require_active_user] = lambda: {"id": "test-user"}

    async def send():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
            homes = await client.get("/api/v1/homes", params={"limit": 1})
            search = await client.post("/api/v1/search", json={})
            detail = await client.get("/api/v1/homes/home-1")
            shortlist = await client.get("/api/v1/shortlists")
            return homes, search, detail, shortlist

    try:
        responses = asyncio.run(send())
    finally:
        main.app.dependency_overrides.clear()
        main.app.dependency_overrides.update(previous)

    assert all(response.status_code == 200 for response in responses)
    items = [responses[0].json()["items"][0], responses[1].json()["items"][0], responses[2].json(), responses[3].json()["items"][0]]
    assert {item["dengue"]["state"] for item in items} == {"active_cluster"}
    assert {item["dengue"]["severity"] for item in items} == {"red"}
    assert {item["dengue"]["caseCount"] for item in items} == {10}
    assert {item["dengue"]["locality"] for item in items} == {"Example cluster"}
    assert {item["risk"] for item in items} == {"Red alert · high-risk cluster (10 or more cases)"}
