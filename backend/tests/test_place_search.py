import asyncio
import math
import re
from datetime import date, datetime, timezone
from uuid import UUID

import httpx
import pytest

from app import main
from app.security import require_active_user


USER = {"id": "user-1"}
PLACE_A = UUID("4f9aa092-3534-4fc2-9c1e-e8708a28d890")
PLACE_B = UUID("30a1089c-0121-4c8e-ae99-d1dfe3e0d09c")
ONEMAP_TOKEN = "server-only-test-onemap-token"
_EARTH_RADIUS_M = 6_371_008.8


@pytest.fixture(autouse=True)
def restore_dependency_overrides():
    previous = dict(main.app.dependency_overrides)
    main.app.dependency_overrides.clear()
    yield
    main.app.dependency_overrides.clear()
    main.app.dependency_overrides.update(previous)


class _SearchConnection:
    def __init__(self, *, owned_ids=(), home_rows=(), places=(), total=1, geocoded=1):
        self.owned_ids = set(owned_ids)
        self.home_rows = list(home_rows)
        self.places = {place["id"]: place for place in places}
        self.total = total
        self.geocoded = geocoded
        self.ownership_query = None
        self.search_query = None
        self.search_values = None
        self.place_evaluations = []

    async def fetch(self, sql, *values):
        if "SELECT id FROM personal_place" in sql:
            self.ownership_query = (sql, values)
            requested_ids = set(values[1])
            return [{"id": place_id} for place_id in self.owned_ids if place_id in requested_ids]
        if "FROM candidate_home h JOIN source_snapshot" in sql:
            self.search_query = sql
            self.search_values = values
            if "selected_place_constraints AS" in sql:
                rows, self.place_evaluations = _evaluate_generated_place_filter_sql_semantics(
                    sql, values, self.home_rows, self.places
                )
                return rows
            return self.home_rows
        raise AssertionError(f"Unexpected query: {sql}")

    async def fetchrow(self, sql, *_values):
        if "SELECT count(*) AS total" in sql:
            return {"total": self.total, "geocoded": self.geocoded}
        if "FROM neighbourhood_resource" in sql:
            return {"schools": 1, "childcare": 1, "care": 1}
        raise AssertionError(f"Unexpected query: {sql}")


def _evaluate_generated_place_filter_sql_semantics(sql, values, candidate_rows, places):
    """Deterministically exercise place-filter outcomes without claiming PostGIS ran."""
    normalized_sql = " ".join(sql.split())
    assert "ST_Distance(h.geometry::geography,p.geometry::geography)" in normalized_sql
    assert (
        "'distanceM', CASE WHEN h.geometry IS NULL OR p.geometry IS NULL THEN NULL"
        in normalized_sql
    )
    assert (
        "ST_Distance(h.geometry::geography,p.geometry::geography) <= selected.maximum_distance_m"
        in normalized_sql
    )
    assert (
        "bool_and(CASE WHEN p.id IS NULL OR h.geometry IS NULL OR p.geometry IS NULL THEN FALSE"
        in normalized_sql
    )
    assert "place_constraint_result.every_place_matches IS TRUE" in normalized_sql

    constraint_parameters = re.search(
        r"FROM unnest\(\$(\d+)::uuid\[\],\s*\$(\d+)::integer\[\]\)\s+AS requested",
        sql,
    )
    ownership_join = re.search(
        r"LEFT JOIN personal_place p ON p\.id\s*=\s*selected\.place_id\s+AND\s+"
        r"p\.user_id\s*=\s*\$(\d+)",
        normalized_sql,
    )
    assert constraint_parameters is not None
    assert ownership_join is not None
    assert re.search(r"COUNT\(p\.id\)\s*=\s*COUNT\(\*\)", normalized_sql)

    place_ids = values[int(constraint_parameters.group(1)) - 1]
    maximum_distances = values[int(constraint_parameters.group(2)) - 1]
    owner_id = values[int(ownership_join.group(1)) - 1]
    assert len(place_ids) == len(maximum_distances)
    assert all(str(place_id) not in sql for place_id in place_ids)

    evaluations = []
    matching_rows = []
    for home in candidate_rows:
        place_distances = []
        every_place_matches = bool(place_ids)
        for place_id, maximum_distance_m in sorted(
            zip(place_ids, maximum_distances), key=lambda constraint: str(constraint[0])
        ):
            place = places.get(place_id)
            if place is None or place["user_id"] != owner_id:
                distance_m = None
                every_place_matches = False
            else:
                distance_m = _test_spherical_geography_distance_m(home, place)
                if distance_m is None or distance_m > maximum_distance_m:
                    every_place_matches = False
            place_distances.append({
                "placeId": str(place_id),
                "label": place["label"] if place is not None else None,
                "distanceM": distance_m,
                "maximumDistanceM": maximum_distance_m,
                "method": "straight-line",
            })

        evaluations.append({
            "homeId": home["id"],
            "placeDistances": place_distances,
            "everyPlaceMatches": every_place_matches,
        })
        if every_place_matches:
            matching_rows.append({**home, "place_distances": place_distances})

    return matching_rows, evaluations


def _test_spherical_geography_distance_m(home, place):
    """Approximate PostGIS geography distance for fixtures far from each cutoff."""
    coordinates = (home["latitude"], home["longitude"], place["latitude"], place["longitude"])
    if any(coordinate is None for coordinate in coordinates):
        return None

    home_lat, home_lon, place_lat, place_lon = map(math.radians, coordinates)
    latitude_delta = place_lat - home_lat
    longitude_delta = place_lon - home_lon
    haversine = (
        math.sin(latitude_delta / 2) ** 2
        + math.cos(home_lat) * math.cos(place_lat) * math.sin(longitude_delta / 2) ** 2
    )
    return 2 * _EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(haversine)))


class _Pool:
    def __init__(self, connection, query_connection=None):
        self.connection = connection
        self.query_connection = query_connection
        self.acquire_count = 0

    def acquire(self):
        return self

    async def __aenter__(self):
        connection = self.connection
        if self.acquire_count and self.query_connection is not None:
            connection = self.query_connection
        self.acquire_count += 1
        return connection

    async def __aexit__(self, *_args):
        return None


class _CreateConnection:
    def __init__(self):
        self.operation = None

    async def execute(self, sql, *values):
        self.operation = (sql, values)
        return "INSERT 0 1"


def _home_row(*, home_id="home-1", latitude=1.3, longitude=103.8):
    return {
        "id": home_id,
        "address": "Example Street",
        "town": "BISHAN",
        "flat_type": "4 ROOM",
        "price_observation_cents": 45_000_000,
        "observed_on": date(2026, 9, 1),
        "source_semantics": "historical_transaction",
        "floor_area_sqm": 90,
        "geocode_status": "resolved" if latitude is not None else "pending",
        "geometry_source": "onemap" if latitude is not None else None,
        "geocoded_at": datetime(2026, 10, 1, tzinfo=timezone.utc) if latitude is not None else None,
        "latitude": latitude,
        "longitude": longitude,
        "school_name": "Example School",
        "school_distance_m": 200,
        "childcare_name": "Example Childcare",
        "childcare_distance_m": 1000,
        "care_name": "Example Clinic",
        "care_distance_m": 1500,
        "in_dengue_cluster": False,
        "source_id": "hdb-resale",
        "source_version": "2026-09",
        "retrieved_at": datetime(2026, 10, 18, 12, tzinfo=timezone.utc),
        "place_distances": [],
    }


def _place_row(place_id, label, *, latitude, longitude, user_id=USER["id"]):
    return {
        "id": place_id,
        "label": label,
        "latitude": latitude,
        "longitude": longitude,
        "user_id": user_id,
    }


def _search_dependency():
    route = next(route for route in main.app.routes if getattr(route, "path", None) == "/api/v1/search")
    return next((dependency.call for dependency in route.dependant.dependencies if dependency.name == "user"), None)


def _user_override(user):
    async def provide_user():
        return user

    return provide_user


def _post_search(monkeypatch, connection, payload, *, user=USER, query_connection=None):
    pool = _Pool(connection, query_connection)
    monkeypatch.setattr(main, "require_pool", lambda: pool)
    dependency = _search_dependency()
    if dependency is not None and user is not None:
        main.app.dependency_overrides[dependency] = _user_override(user)

    async def request_search():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app), base_url="http://test"
        ) as client:
            return await client.post("/api/v1/search", json=payload)

    return asyncio.run(request_search())


def test_place_suggestions_require_an_active_user():
    async def request_suggestions():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app), base_url="http://test"
        ) as client:
            return await client.get("/api/v1/places/suggest", params={"q": "Harbour Road"})

    response = asyncio.run(request_suggestions())

    assert response.status_code == 401


def test_place_suggestions_return_provider_labelled_candidates_without_the_token(monkeypatch):
    calls = []

    async def suggest(query, token, _client):
        calls.append((query, token))
        return [{
            "address": "10 Example Road, Singapore",
            "latitude": 1.3,
            "longitude": 103.8,
            "provider": "OneMap",
        }]

    monkeypatch.setenv("ONEMAP_ACCESS_TOKEN", ONEMAP_TOKEN)
    monkeypatch.setattr(main, "search_address_candidates", suggest, raising=False)
    main.app.dependency_overrides[require_active_user] = _user_override(USER)

    async def request_suggestions():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app), base_url="http://test"
        ) as client:
            return await client.get("/api/v1/places/suggest", params={"q": "  Harbour Road "})

    response = asyncio.run(request_suggestions())

    assert response.status_code == 200
    payload = response.json()
    assert calls == [("Harbour Road", ONEMAP_TOKEN)]
    assert payload["items"][0]["provider"] == "OneMap"
    assert payload["items"][0]["address"] == "10 Example Road, Singapore"
    assert payload["items"][0]["latitude"] == 1.3
    assert payload["items"][0]["longitude"] == 103.8
    assert payload["items"][0]["selection_token"]
    assert ONEMAP_TOKEN not in response.text


def test_selected_provider_candidate_can_be_created_with_server_provenance(monkeypatch):
    async def suggest(_query, _token, _client):
        return [{
            "address": "10 Example Road, Singapore",
            "latitude": 1.3,
            "longitude": 103.8,
            "provider": "OneMap",
        }]

    monkeypatch.setenv("ONEMAP_ACCESS_TOKEN", ONEMAP_TOKEN)
    monkeypatch.setattr(main, "search_address_candidates", suggest, raising=False)
    main.app.dependency_overrides[require_active_user] = _user_override(USER)
    connection = _CreateConnection()
    monkeypatch.setattr(main, "require_pool", lambda: _Pool(connection))

    async def ensure_user(_connection, _user):
        return None

    monkeypatch.setattr(main, "ensure_user", ensure_user)

    async def select_and_create():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app), base_url="http://test"
        ) as client:
            suggestion_response = await client.get(
                "/api/v1/places/suggest", params={"q": "Example Road"}
            )
            assert suggestion_response.status_code == 200
            candidate = suggestion_response.json()["items"][0]
            create_response = await client.post(
                "/api/v1/places",
                json={
                    "label": "Work",
                    "address": candidate["address"],
                    "latitude": candidate["latitude"],
                    "longitude": candidate["longitude"],
                    "maximum_distance_m": 4000,
                    "kind": "workplace",
                    "geocode_source": "OneMap",
                    "selection_token": candidate["selection_token"],
                },
            )
            return suggestion_response, create_response

    suggestion_response, response = asyncio.run(select_and_create())

    assert suggestion_response.status_code == 200
    assert response.status_code == 200
    place = response.json()
    assert place["kind"] == "workplace"
    assert place["geocode_source"] == "OneMap"
    assert place["geocoded_at"]
    sql, values = connection.operation
    assert "user_id" in sql and "kind" in sql and "geocode_source" in sql and "geocoded_at" in sql
    assert values[1:4] == (USER["id"], "Work", "10 Example Road, Singapore")
    assert values[6:9] == (4000, "workplace", "OneMap")
    assert values[9] is not None
    assert ONEMAP_TOKEN not in response.text


def test_provider_candidate_cannot_be_changed_after_selection(monkeypatch):
    async def suggest(_query, _token, _client):
        return [{
            "address": "10 Example Road, Singapore",
            "latitude": 1.3,
            "longitude": 103.8,
            "provider": "OneMap",
        }]

    monkeypatch.setenv("ONEMAP_ACCESS_TOKEN", ONEMAP_TOKEN)
    monkeypatch.setattr(main, "search_address_candidates", suggest, raising=False)
    main.app.dependency_overrides[require_active_user] = _user_override(USER)
    connection = _CreateConnection()
    monkeypatch.setattr(main, "require_pool", lambda: _Pool(connection))

    async def request_tampered_candidate():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app), base_url="http://test"
        ) as client:
            candidate_response = await client.get(
                "/api/v1/places/suggest", params={"q": "Example Road"}
            )
            assert candidate_response.status_code == 200
            candidate = candidate_response.json()["items"][0]
            return await client.post(
                "/api/v1/places",
                json={
                    "label": "Work",
                    "address": candidate["address"],
                    "latitude": 1.31,
                    "longitude": candidate["longitude"],
                    "kind": "workplace",
                    "geocode_source": "OneMap",
                    "selection_token": candidate["selection_token"],
                },
            )

    response = asyncio.run(request_tampered_candidate())

    assert response.status_code == 422
    assert connection.operation is None
    assert ONEMAP_TOKEN not in response.text


def test_search_rejects_place_constraints_without_an_active_user(monkeypatch):
    connection = _SearchConnection()
    response = _post_search(
        monkeypatch,
        connection,
        {"place_constraints": [{"place_id": str(PLACE_A), "max_distance_m": 1000}]},
        user=None,
    )

    assert response.status_code == 401
    assert connection.search_query is None


def test_search_applies_owned_place_range_and_returns_straight_line_distance(monkeypatch):
    connection = _SearchConnection(
        owned_ids=[PLACE_A],
        home_rows=[_home_row()],
        places=[_place_row(PLACE_A, "Office", latitude=1.3038, longitude=103.8)],
    )

    response = _post_search(
        monkeypatch,
        connection,
        {"place_constraints": [{"place_id": str(PLACE_A), "max_distance_m": 1000}]},
    )

    assert response.status_code == 200
    item = response.json()["items"][0]
    assert item["sourceSemantics"] == "historical_transaction"
    assert len(item["placeDistances"]) == 1
    distance = item["placeDistances"][0]
    assert distance["placeId"] == str(PLACE_A)
    assert distance["label"] == "Office"
    assert 400 < distance["distanceM"] < 450
    assert distance["maximumDistanceM"] == 1000
    assert distance["method"] == "straight-line"
    assert [PLACE_A] in connection.search_values
    assert [1000] in connection.search_values
    assert USER["id"] in connection.search_values


def test_search_excludes_a_home_outside_the_selected_place_limit(monkeypatch):
    connection = _SearchConnection(
        owned_ids=[PLACE_A],
        home_rows=[_home_row(latitude=1.31, longitude=103.8)],
        places=[_place_row(PLACE_A, "Office", latitude=1.3, longitude=103.8)],
    )

    response = _post_search(
        monkeypatch,
        connection,
        {"place_constraints": [{"place_id": str(PLACE_A), "max_distance_m": 250}]},
    )

    assert response.status_code == 200
    assert response.json()["items"] == []
    evaluated = connection.place_evaluations[0]
    assert evaluated["placeDistances"][0]["distanceM"] > 250
    assert evaluated["everyPlaceMatches"] is False
    assert [250] in connection.search_values


def test_search_requires_every_selected_place_constraint_to_pass(monkeypatch):
    connection = _SearchConnection(
        owned_ids=[PLACE_A, PLACE_B],
        home_rows=[
            _home_row(home_id="both-pass", latitude=1.305, longitude=103.8),
            _home_row(home_id="fails-school", latitude=1.3, longitude=103.8),
        ],
        places=[
            _place_row(PLACE_A, "Office", latitude=1.3, longitude=103.8),
            _place_row(PLACE_B, "School", latitude=1.31, longitude=103.8),
        ],
    )

    response = _post_search(
        monkeypatch,
        connection,
        {
            "place_constraints": [
                {"place_id": str(PLACE_A), "max_distance_m": 800},
                {"place_id": str(PLACE_B), "max_distance_m": 800},
            ]
        },
    )

    assert response.status_code == 200
    items = response.json()["items"]
    assert [item["id"] for item in items] == ["both-pass"]
    distances = items[0]["placeDistances"]
    assert [distance["placeId"] for distance in distances] == [str(PLACE_B), str(PLACE_A)]
    assert all(500 < distance["distanceM"] < 600 for distance in distances)
    evaluations = {item["homeId"]: item for item in connection.place_evaluations}
    failed_home = evaluations["fails-school"]
    failed_distances = {item["placeId"]: item["distanceM"] for item in failed_home["placeDistances"]}
    assert failed_distances[str(PLACE_A)] == 0
    assert failed_distances[str(PLACE_B)] > 800
    assert failed_home["everyPlaceMatches"] is False
    assert [PLACE_A, PLACE_B] in connection.search_values
    assert [800, 800] in connection.search_values


def test_search_excludes_a_place_deleted_after_ownership_precheck(monkeypatch):
    precheck_connection = _SearchConnection(owned_ids=[PLACE_A, PLACE_B])
    query_connection = _SearchConnection(
        home_rows=[_home_row()],
        places=[_place_row(PLACE_A, "Office", latitude=1.3, longitude=103.8)],
    )

    response = _post_search(
        monkeypatch,
        precheck_connection,
        {
            "place_constraints": [
                {"place_id": str(PLACE_A), "max_distance_m": 800},
                {"place_id": str(PLACE_B), "max_distance_m": 800},
            ]
        },
        query_connection=query_connection,
    )

    assert response.status_code == 200
    assert response.json()["items"] == []
    assert query_connection.place_evaluations[0]["everyPlaceMatches"] is False


def test_search_rejects_foreign_or_unknown_place_ids_without_place_data(monkeypatch):
    connection = _SearchConnection(owned_ids=[PLACE_A])
    response = _post_search(
        monkeypatch,
        connection,
        {"place_constraints": [{"place_id": str(PLACE_B), "max_distance_m": 1000}]},
    )

    assert response.status_code == 422
    payload = response.json()
    assert "Private school" not in response.text
    assert "Private Address" not in response.text
    assert "PLACE_CONSTRAINT_UNAVAILABLE" in response.text
    assert connection.search_query is None
    sql, values = connection.ownership_query
    assert "SELECT id FROM personal_place" in sql
    assert "user_id=$1" in sql
    assert values == (USER["id"], [PLACE_B])


def test_null_home_geometry_has_no_place_distance_and_remains_visible_unfiltered(monkeypatch):
    null_home = _home_row(latitude=None, longitude=None)
    connection = _SearchConnection(
        owned_ids=[PLACE_A],
        home_rows=[null_home],
        places=[_place_row(PLACE_A, "Office", latitude=1.3, longitude=103.8)],
        total=1,
        geocoded=0,
    )
    response = _post_search(
        monkeypatch,
        connection,
        {"place_constraints": [{"place_id": str(PLACE_A), "max_distance_m": 1}]},
    )

    assert response.status_code == 200
    assert response.json()["items"] == []
    evaluation = connection.place_evaluations[0]
    assert evaluation["placeDistances"][0]["distanceM"] is None
    assert evaluation["everyPlaceMatches"] is False

    unfiltered_connection = _SearchConnection(home_rows=[null_home])
    unfiltered_response = _post_search(monkeypatch, unfiltered_connection, {}, user=None)

    assert unfiltered_response.status_code == 200
    assert len(unfiltered_response.json()["items"]) == 1
    item = unfiltered_response.json()["items"][0]
    assert item["lat"] is None
    assert item["lng"] is None
    assert item["placeDistances"] == []


def test_unconstrained_search_adds_empty_place_distances_and_keeps_historical_source(monkeypatch):
    connection = _SearchConnection(home_rows=[_home_row()])
    response = _post_search(monkeypatch, connection, {}, user=None)

    assert response.status_code == 200
    item = response.json()["items"][0]
    assert item["sourceSemantics"] == "historical_transaction"
    assert item["risks"] == ["Historical resale transaction; not a current listing"]
    assert item.get("placeDistances") == []
    assert "scorePolicyVersion" in response.json()


def test_legacy_homes_route_does_not_gain_search_only_place_metadata(monkeypatch):
    connection = _SearchConnection(home_rows=[_home_row()])
    monkeypatch.setattr(main, "require_pool", lambda: _Pool(connection))

    async def request_homes():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app), base_url="http://test"
        ) as client:
            return await client.get("/api/v1/homes")

    response = asyncio.run(request_homes())

    assert response.status_code == 200
    assert "placeDistances" not in response.json()["items"][0]
