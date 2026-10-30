import asyncio
import json
import re
from datetime import date, datetime, timezone

import httpx
import pytest

from app import main
from app.pagination import decode_cursor, encode_cursor


class _PaginationConnection:
    def __init__(self, *, homes=(), resources=(), resource_counts=()):
        self.homes = list(homes)
        self.resources = list(resources)
        self.resource_counts = list(resource_counts)
        self.home_queries = []
        self.resource_queries = []

    async def fetchrow(self, sql, *values):
        if "count(*) AS total" in sql and "FROM candidate_home h" in sql:
            bounds = _bounds_from_query(sql, values, "h.geometry")
            return {"total": sum(_inside(row, bounds) for row in self.homes)}
        if "geocoded" in sql and "FROM candidate_home" in sql:
            return {"total": len(self.homes), "geocoded": len(self.homes)}
        if "FROM neighbourhood_resource" in sql:
            return {"schools": len(self.resources), "childcare": 0, "care": 0}
        raise AssertionError(f"Unexpected query: {sql}")

    async def fetch(self, sql, *values):
        if "SELECT r.resource_type, count(*)" in sql:
            return self.resource_counts
        if "FROM page_homes h JOIN source_snapshot" in sql:
            self.home_queries.append((sql, values))
            rows = [row for row in self.homes if _inside(row, _bounds_from_query(sql, values, "h.geometry"))]
            rows.sort(key=lambda row: (
                row.get("ranking_score") is None,
                -(row.get("ranking_score") or 0),
                row["observed_on"] is None,
                -row["observed_on"].toordinal() if row["observed_on"] is not None else 0,
                str(row["id"]),
            ))
            rows = _after_home_cursor(rows, sql, values)
            return rows[:_limit_from_query(sql, values)]
        if "FROM neighbourhood_resource r JOIN latest s" in sql:
            self.resource_queries.append((sql, values))
            rows = list(self.resources)
            type_filter = values[0]
            if type_filter:
                rows = [row for row in rows if row["resource_type"] in type_filter]
            bounds = _bounds_from_query(sql, values, "r.geometry")
            rows = [row for row in rows if _inside(row, bounds)]
            rows.sort(key=lambda row: (row["resource_type"], row["name"], str(row["id"])))
            rows = _after_resource_cursor(rows, sql, values)
            return rows[:_limit_from_query(sql, values)]
        raise AssertionError(f"Unexpected query: {sql}")


class _Pool:
    def __init__(self, connection):
        self.connection = connection

    def acquire(self):
        return self

    async def __aenter__(self):
        return self.connection

    async def __aexit__(self, *_args):
        return None


@pytest.fixture(autouse=True)
def restore_dependency_overrides():
    previous = dict(main.app.dependency_overrides)
    main.app.dependency_overrides.clear()
    yield
    main.app.dependency_overrides.clear()
    main.app.dependency_overrides.update(previous)


def _bounds_from_query(sql, values, geometry):
    match = re.search(
        rf"ST_Intersects\({re.escape(geometry)},\s*ST_MakeEnvelope\(\$(\d+),\s*\$(\d+),\s*\$(\d+),\s*\$(\d+),\s*4326\)\)",
        sql,
    )
    if match is None:
        return None
    return tuple(values[int(index) - 1] for index in match.groups())


def _inside(row, bounds):
    if bounds is None:
        return True
    west, south, east, north = bounds
    longitude = row.get("longitude")
    latitude = row.get("latitude")
    if longitude is None or latitude is None:
        geometry = row.get("geometry")
        if isinstance(geometry, str):
            geometry = json.loads(geometry)
        if not geometry or geometry.get("type") != "Point":
            return False
        longitude, latitude = geometry["coordinates"]
    return west <= longitude <= east and south <= latitude <= north


def _limit_from_query(sql, values):
    match = re.search(r"LIMIT\s+\$(\d+)", sql)
    assert match is not None
    return values[int(match.group(1)) - 1]


def _after_home_cursor(rows, sql, values):
    score_match = re.search(r"ranking_score < \$(\d+)::double precision", sql)
    match = re.search(r"observed_on < \$(\d+).*?id::text > \$(\d+)", sql, re.DOTALL)
    null_date = False
    if match is None:
        match = re.search(r"observed_on IS NULL AND id::text > \$(\d+)", sql)
        null_date = match is not None
    if match is not None:
        if null_date:
            observed_on = None
            identifier = str(values[int(match.group(1)) - 1])
        else:
            observed_on = values[int(match.group(1)) - 1]
            identifier = str(values[int(match.group(2)) - 1])
            if isinstance(observed_on, str):
                observed_on = date.fromisoformat(observed_on)
    else:
        return rows

    cursor_score = float(values[int(score_match.group(1)) - 1]) if score_match else None
    return [row for row in rows if (
        (row.get("ranking_score") is None and cursor_score is not None)
        or (cursor_score is None and row.get("ranking_score") is None and (
            row["observed_on"] is None and str(row["id"]) > identifier if null_date else
            row["observed_on"] is None or row["observed_on"] < observed_on
            or (row["observed_on"] == observed_on and str(row["id"]) > identifier)
        ))
        or (cursor_score is not None and row.get("ranking_score") is not None and (
            row["ranking_score"] < cursor_score
            or (row["ranking_score"] == cursor_score and (
                row["observed_on"] is None and str(row["id"]) > identifier if null_date else
                row["observed_on"] is None or row["observed_on"] < observed_on
                or (row["observed_on"] == observed_on and str(row["id"]) > identifier)
            ))
        ))
    )]


def _after_resource_cursor(rows, sql, values):
    match = re.search(
        r"r\.resource_type,\s*r\.name,\s*r\.id::text\) > \(\$(\d+)::text,\s*\$(\d+)::text,\s*\$(\d+)::text\)",
        sql,
    )
    if match is None:
        return rows
    cursor = tuple(str(values[int(index) - 1]) for index in match.groups())
    return [row for row in rows if (row["resource_type"], row["name"], str(row["id"])) > cursor]


def _home_row(identifier, observed_on, *, longitude=103.8, latitude=1.3):
    return {
        "id": identifier,
        "ranking_score": None,
        "address": f"{identifier} Street",
        "town": "BISHAN",
        "flat_type": "4 ROOM",
        "price_observation_cents": 45_000_000,
        "observed_on": observed_on,
        "source_semantics": "historical_transaction",
        "floor_area_sqm": 90,
        "geocode_status": "resolved",
        "geometry_source": "onemap",
        "geocoded_at": datetime(2026, 10, 1, tzinfo=timezone.utc),
        "latitude": latitude,
        "longitude": longitude,
        "school_name": None,
        "school_distance_m": None,
        "childcare_name": None,
        "childcare_distance_m": None,
        "care_name": None,
        "care_distance_m": None,
        "in_dengue_cluster": False,
        "source_id": "hdb-resale",
        "source_version": "2026-09",
        "retrieved_at": datetime(2026, 10, 18, 12, tzinfo=timezone.utc),
    }


def _resource_row(identifier, resource_type, name, longitude, latitude):
    return {
        "id": identifier,
        "resource_type": resource_type,
        "name": name,
        "status": "open",
        "attributes": {"district": "central"},
        "geometry": '{"type":"Point","coordinates":[%s,%s]}' % (longitude, latitude),
        "source_id": "school-source",
        "source_url": "https://example.test/school",
        "source_version": "2026-10",
        "retrieved_at": datetime(2026, 10, 18, 12, tzinfo=timezone.utc),
        "location_source_id": "onemap_geocoding",
        "location_retrieved_at": datetime(2026, 10, 18, 11, tzinfo=timezone.utc),
    }


def _response(monkeypatch, connection, method, path, *, params=None, json=None):
    monkeypatch.setattr(main, "require_pool", lambda: _Pool(connection))

    async def send():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app), base_url="http://test"
        ) as client:
            return await client.request(method, path, params=params, json=json)

    return asyncio.run(send())


def test_home_pages_continue_in_observed_date_id_order_and_keep_total(monkeypatch):
    rows = [
        {**_home_row("home-c", date(2026, 4, 1)), "ranking_score": 75.0},
        {**_home_row("home-b", date(2026, 4, 3)), "ranking_score": 90.0},
        _home_row("home-null", None),
        {**_home_row("home-a", date(2026, 4, 3)), "ranking_score": 90.0},
    ]
    connection = _PaginationConnection(homes=rows)

    first = _response(monkeypatch, connection, "GET", "/api/v1/homes", params={"limit": 2})

    assert first.status_code == 200
    first_payload = first.json()
    assert [item["id"] for item in first_payload["items"]] == ["home-a", "home-b"]
    assert first_payload["count"] == 2
    assert first_payload["total"] == 4
    assert first_payload["hasMore"] is True
    assert decode_cursor(first_payload["nextCursor"]) == {
        "score": "90.0", "observed_on": "2026-04-03", "id": "home-b"
    }
    first_sql, first_values = connection.home_queries[0]
    assert "ORDER BY ranking_score DESC NULLS LAST, observed_on DESC NULLS LAST, id" in first_sql
    assert _limit_from_query(first_sql, first_values) == 3

    second = _response(
        monkeypatch, connection, "GET", "/api/v1/homes",
        params={"limit": 2, "cursor": first_payload["nextCursor"]},
    )
    second_payload = second.json()
    assert [item["id"] for item in second_payload["items"]] == ["home-c", "home-null"]
    second_sql, _ = connection.home_queries[1]
    assert "ranking_score < $" in second_sql
    assert "OR ranking_score IS NULL" in second_sql
    assert second_payload["count"] == 2
    assert second_payload["total"] == 4
    assert second_payload["hasMore"] is False
    assert second_payload["nextCursor"] is None

    empty = _response(
        monkeypatch, connection, "GET", "/api/v1/homes",
        params={"limit": 2, "cursor": encode_cursor({"score": None, "observed_on": None, "id": "home-null"})},
    ).json()
    empty_sql, _ = connection.home_queries[2]
    assert "WHERE ranking_score IS NULL AND (observed_on IS NULL AND id::text > $" in empty_sql
    assert empty["items"] == []
    assert empty["count"] == 0
    assert empty["total"] == 4
    assert empty["hasMore"] is False
    assert empty["nextCursor"] is None


def test_home_bounds_are_parameterized_and_restrict_rows(monkeypatch):
    connection = _PaginationConnection(homes=[
        _home_row("inside", date(2026, 4, 3), longitude=103.8, latitude=1.3),
        _home_row("outside", date(2026, 4, 2), longitude=104.2, latitude=1.3),
    ])

    response = _response(
        monkeypatch, connection, "GET", "/api/v1/homes",
        params={"bounds": "103.7,1.2,103.9,1.4", "limit": 10},
    )

    assert response.status_code == 200
    assert [item["id"] for item in response.json()["items"]] == ["inside"]
    assert response.json()["total"] == 1
    sql, values = connection.home_queries[0]
    assert "ST_Intersects(h.geometry, ST_MakeEnvelope(" in sql
    assert "103.7,1.2,103.9,1.4" not in sql
    assert [103.7, 1.2, 103.9, 1.4] == [value for value in values if isinstance(value, float)]


def test_search_uses_validated_bounds_and_pagination_without_losing_criteria(monkeypatch):
    connection = _PaginationConnection(homes=[
        _home_row("inside", date(2026, 4, 3), longitude=103.8, latitude=1.3),
        _home_row("outside", date(2026, 4, 2), longitude=104.2, latitude=1.3),
    ])

    response = _response(
        monkeypatch, connection, "POST", "/api/v1/search",
        json={"bounds": "103.7,1.2,103.9,1.4", "limit": 1, "budget": 500_000},
    )

    assert response.status_code == 200
    payload = response.json()
    assert [item["id"] for item in payload["items"]] == ["inside"]
    assert payload["criteria"]["budget"] == 500_000
    assert payload["criteria"]["limit"] == 1
    assert payload["total"] == 1
    assert payload["unappliedCriteria"] == []
    assert any(
        "historical transaction observations" in limitation
        for limitation in payload["limitations"]
    )


def test_resource_pages_continue_by_type_name_id_and_keep_geojson_provenance(monkeypatch):
    resources = [
        _resource_row("resource-c", "moe_school", "C School", 103.8, 1.3),
        _resource_row("resource-b", "moe_school", "B School", 103.8, 1.3),
        _resource_row("resource-a", "moe_school", "A School", 103.8, 1.3),
    ]
    counts = [{"resource_type": "moe_school", "total": 3, "unlocated": 1}]
    connection = _PaginationConnection(resources=resources, resource_counts=counts)

    first = _response(monkeypatch, connection, "GET", "/api/v1/resources", params={"limit": 2})
    first_payload = first.json()
    assert first.status_code == 200
    assert first_payload["type"] == "FeatureCollection"
    assert [feature["id"] for feature in first_payload["features"]] == ["resource-a", "resource-b"]
    assert first_payload["count"] == 2
    assert first_payload["hasMore"] is True
    assert decode_cursor(first_payload["nextCursor"]) == {
        "resource_type": "moe_school", "name": "B School", "id": "resource-b"
    }
    assert first_payload["counts"] == [
        {"resourceType": "moe_school", "total": 3, "unlocated": 1}
    ]
    properties = first_payload["features"][0]["properties"]
    assert properties["sourceId"] == "school-source"
    assert properties["locationSourceId"] == "onemap_geocoding"
    sql, values = connection.resource_queries[0]
    assert "ORDER BY r.resource_type, r.name, r.id" in sql
    assert _limit_from_query(sql, values) == 3

    second = _response(
        monkeypatch, connection, "GET", "/api/v1/resources",
        params={"limit": 2, "cursor": first_payload["nextCursor"]},
    ).json()
    assert [feature["id"] for feature in second["features"]] == ["resource-c"]
    assert second["count"] == 1
    assert second["hasMore"] is False
    assert second["nextCursor"] is None
    assert second["counts"] == [
        {"resourceType": "moe_school", "total": 3, "unlocated": 1}
    ]


def test_resource_bounds_are_parameterized_and_restrict_features(monkeypatch):
    connection = _PaginationConnection(resources=[
        _resource_row("inside", "moe_school", "Inside", 103.8, 1.3),
        _resource_row("outside", "moe_school", "Outside", 104.2, 1.3),
    ])

    response = _response(
        monkeypatch, connection, "GET", "/api/v1/resources",
        params={"bounds": "103.7,1.2,103.9,1.4", "limit": 10},
    )

    assert response.status_code == 200
    assert [feature["id"] for feature in response.json()["features"]] == ["inside"]
    sql, values = connection.resource_queries[0]
    assert "ST_Intersects(r.geometry, ST_MakeEnvelope(" in sql
    assert "103.7,1.2,103.9,1.4" not in sql
    assert [103.7, 1.2, 103.9, 1.4] == [value for value in values if isinstance(value, float)]


@pytest.mark.parametrize(
    ("method", "path", "params", "body"),
    [
        ("GET", "/api/v1/homes", {"bounds": "180,-1,-180,1"}, None),
        ("GET", "/api/v1/homes", {"limit": "201"}, None),
        ("GET", "/api/v1/homes", {"limit": "0"}, None),
        ("POST", "/api/v1/search", None, {"bounds": {"west": 1, "south": 2, "east": 0, "north": 3}}),
        ("POST", "/api/v1/search", None, {"limit": 201}),
        ("POST", "/api/v1/search", None, {"limit": 0}),
        ("GET", "/api/v1/resources", {"bounds": "NaN,1,2,3"}, None),
        ("GET", "/api/v1/resources", {"limit": "2001"}, None),
        ("GET", "/api/v1/resources", {"limit": "0"}, None),
    ],
)
def test_invalid_bounds_and_page_limits_fail_with_422(monkeypatch, method, path, params, body):
    connection = _PaginationConnection()

    response = _response(monkeypatch, connection, method, path, params=params, json=body)

    assert response.status_code == 422
    assert connection.home_queries == []
    assert connection.resource_queries == []


def test_cursor_values_are_bound_parameters_not_sql_text(monkeypatch):
    marker = "x'); DROP TABLE candidate_home; --"
    cursor = encode_cursor({"score": "80.0", "observed_on": "2026-04-03", "id": marker})
    connection = _PaginationConnection(homes=[_home_row("home-a", date(2026, 4, 2))])

    response = _response(
        monkeypatch, connection, "GET", "/api/v1/homes", params={"cursor": cursor}
    )

    assert response.status_code == 200
    sql, values = connection.home_queries[0]
    assert marker not in sql
    assert marker in values
