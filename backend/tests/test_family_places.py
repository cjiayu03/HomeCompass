import asyncio
from datetime import datetime, timezone
from uuid import UUID

import pytest
from pydantic import ValidationError

from app import main
from app.schemas import (
    PersonalPlaceRequest,
    PlaceConstraint,
    PlaceSuggestionRequest,
    SearchRequest,
)


@pytest.mark.parametrize(
    ("latitude", "longitude"),
    [
        (1.8, 103.8),  # Malaysia, north of Singapore
        (0.8, 103.8),  # Indonesia, south of Singapore
        (1.3, 103.0),  # west of Singapore
        (1.3, 104.5),  # east of Singapore
    ],
)
def test_personal_place_rejects_coordinates_clearly_outside_singapore(latitude, longitude):
    with pytest.raises(ValidationError):
        PersonalPlaceRequest(
            label="Work",
            latitude=latitude,
            longitude=longitude,
            geocode_source="manual",
        )


@pytest.mark.parametrize("source", ["manual", "OneMap"])
def test_personal_place_rejects_pulau_nipa_for_explicit_geocode_sources(source):
    with pytest.raises(ValidationError):
        PersonalPlaceRequest(
            label="Work",
            latitude=1.141667,
            longitude=103.661111,
            geocode_source=source,
        )


@pytest.mark.parametrize(
    ("latitude", "longitude"),
    [
        (1.24, 103.60),  # offshore southwest of the mainland outline
        (1.30, 104.03),  # water east of the mainland envelope
    ],
)
def test_personal_place_rejects_points_outside_the_land_envelopes(latitude, longitude):
    with pytest.raises(ValidationError):
        PersonalPlaceRequest(
            label="Work",
            latitude=latitude,
            longitude=longitude,
            geocode_source="manual",
        )


@pytest.mark.parametrize(
    ("latitude", "longitude"),
    [
        (1.2868108, 103.8545349),  # central Singapore
        (1.44, 103.79),  # Woodlands, north
        (1.33, 103.63),  # Tuas, west
        (1.35, 103.98),  # Changi, east
        (1.265, 103.82),  # HarbourFront, south mainland
        (1.24, 103.83),  # Sentosa, south
        (1.40, 104.05),  # Pulau Tekong, offshore east
    ],
)
def test_personal_place_accepts_named_singapore_land_with_manual_source(latitude, longitude):
    request = PersonalPlaceRequest(
        label="Work",
        latitude=latitude,
        longitude=longitude,
        geocode_source="manual",
    )

    assert (request.latitude, request.longitude) == (latitude, longitude)
    assert request.geocode_source == "manual"


@pytest.mark.parametrize(("latitude", "longitude"), [(float("nan"), 103.8), (1.3, float("inf"))])
def test_personal_place_rejects_non_finite_coordinates(latitude, longitude):
    with pytest.raises(ValidationError):
        PersonalPlaceRequest(label="Work", latitude=latitude, longitude=longitude)


def test_personal_place_rejects_a_label_that_is_only_whitespace():
    with pytest.raises(ValidationError):
        PersonalPlaceRequest(label="   ", latitude=1.3, longitude=103.8)


def test_personal_place_requires_a_label():
    with pytest.raises(ValidationError):
        PersonalPlaceRequest(latitude=1.3, longitude=103.8)


@pytest.mark.parametrize("kind", ["workplace", "school", "childcare", "elder-care", "other"])
def test_personal_place_accepts_each_supported_kind(kind):
    request = PersonalPlaceRequest(label="Family place", latitude=1.3, longitude=103.8, kind=kind)

    assert request.kind.value == kind


def test_personal_place_defaults_new_optional_fields_for_existing_callers():
    request = PersonalPlaceRequest(label="Home", latitude=1.3, longitude=103.8)

    assert request.kind.value == "other"
    assert request.geocode_source is None
    assert request.geocoded_at is None


def test_personal_place_rejects_an_unsupported_kind():
    with pytest.raises(ValidationError):
        PersonalPlaceRequest(label="Clinic", latitude=1.3, longitude=103.8, kind="clinic")


@pytest.mark.parametrize("source", ["OneMap", "manual"])
def test_personal_place_keeps_supported_geocode_provenance(source):
    geocoded_at = datetime(2026, 10, 20, tzinfo=timezone.utc)
    request = PersonalPlaceRequest(
        label="Office",
        latitude=1.3,
        longitude=103.8,
        geocode_source=source,
        geocoded_at=geocoded_at,
    )

    assert request.model_dump()["geocode_source"] == source
    assert request.model_dump()["geocoded_at"] == geocoded_at


def test_personal_place_rejects_an_unsupported_geocode_source():
    with pytest.raises(ValidationError):
        PersonalPlaceRequest(
            label="Office",
            latitude=1.3,
            longitude=103.8,
            geocode_source="browser",
        )


@pytest.mark.parametrize("distance", [1, 100_000])
def test_personal_place_accepts_inclusive_maximum_distance_bounds(distance):
    request = PersonalPlaceRequest(
        label="Office",
        latitude=1.3,
        longitude=103.8,
        maximum_distance_m=distance,
    )

    assert request.maximum_distance_m == distance


@pytest.mark.parametrize("distance", [0, 100_001])
def test_personal_place_rejects_maximum_distances_outside_bounds(distance):
    with pytest.raises(ValidationError):
        PersonalPlaceRequest(
            label="Office",
            latitude=1.3,
            longitude=103.8,
            maximum_distance_m=distance,
        )


def test_search_constraint_exposes_a_typed_place_id_and_distance():
    place_id = UUID("c4c0f6aa-6dcb-44a0-9000-bc0caaad08f0")
    request = SearchRequest(
        place_constraints=[{"place_id": str(place_id), "max_distance_m": 5_000}]
    )

    constraint = request.place_constraints[0]
    assert constraint.place_id == place_id
    assert constraint.max_distance_m == 5_000


@pytest.mark.parametrize("distance", [0, 100_000])
def test_place_constraint_accepts_inclusive_distance_bounds(distance):
    constraint = PlaceConstraint(
        place_id=UUID("c4c0f6aa-6dcb-44a0-9000-bc0caaad08f0"),
        max_distance_m=distance,
    )

    assert constraint.max_distance_m == distance


@pytest.mark.parametrize("distance", [-1, 100_001])
def test_place_constraint_rejects_distances_outside_bounds(distance):
    with pytest.raises(ValidationError):
        PlaceConstraint(
            place_id=UUID("c4c0f6aa-6dcb-44a0-9000-bc0caaad08f0"),
            max_distance_m=distance,
        )


def test_search_rejects_duplicate_place_ids_within_its_constraints():
    place_id = "c4c0f6aa-6dcb-44a0-9000-bc0caaad08f0"

    with pytest.raises(ValidationError):
        SearchRequest(
            place_constraints=[
                {"place_id": place_id, "max_distance_m": 5_000},
                {"place_id": place_id.upper(), "max_distance_m": 10_000},
            ]
        )


def test_search_rejects_more_than_ten_place_constraints():
    constraints = [
        {"place_id": str(UUID(int=index)), "max_distance_m": 5_000}
        for index in range(1, 12)
    ]

    with pytest.raises(ValidationError):
        SearchRequest(place_constraints=constraints)


def test_search_accepts_ten_distinct_place_constraints():
    constraints = [
        {"place_id": str(UUID(int=index)), "max_distance_m": 5_000}
        for index in range(1, 11)
    ]

    assert len(SearchRequest(place_constraints=constraints).place_constraints) == 10


def test_place_suggestion_request_trims_a_nonblank_query():
    request = PlaceSuggestionRequest(query="  1 Harbour Road  ")

    assert request.query == "1 Harbour Road"


def test_place_suggestion_request_rejects_a_blank_query():
    with pytest.raises(ValidationError):
        PlaceSuggestionRequest(query="   ")


class _PlaceConnection:
    def __init__(self, rows=()):
        self.rows = list(rows)
        self.operations = []

    async def fetch(self, sql, *values):
        self.operations.append((sql, values))
        user_id = values[0]
        if "WHERE user_id=$1" in sql:
            return [row for row in self.rows if row["user_id"] == user_id]
        return self.rows

    async def execute(self, sql, *values):
        self.operations.append((sql, values))
        return "DELETE 1" if sql.lstrip().startswith("DELETE") else "INSERT 0 1"


class _PlacePool:
    def __init__(self, connection):
        self.connection = connection

    def acquire(self):
        return self

    async def __aenter__(self):
        return self.connection

    async def __aexit__(self, *_args):
        return None


def test_get_places_filters_by_owner_and_serializes_provenance(monkeypatch):
    updated_at = datetime(2026, 10, 20, tzinfo=timezone.utc)
    geocoded_at = datetime(2026, 10, 19, tzinfo=timezone.utc)
    connection = _PlaceConnection([
        {
            "id": UUID("4f9aa092-3534-4fc2-9c1e-e8708a28d890"),
            "user_id": "user-1",
            "label": "Office",
            "address": "10 Example Road",
            "latitude": 1.3,
            "longitude": 103.8,
            "kind": "workplace",
            "geocode_source": "OneMap",
            "geocoded_at": geocoded_at,
            "maximum_distance_m": 2500,
            "updated_at": updated_at,
        },
        {
            "id": UUID("30a1089c-0121-4c8e-ae99-d1dfe3e0d09c"),
            "user_id": "user-2",
            "label": "Private school",
            "address": "Private Address",
            "latitude": 1.31,
            "longitude": 103.81,
            "kind": "school",
            "geocode_source": "manual",
            "geocoded_at": None,
            "maximum_distance_m": None,
            "updated_at": updated_at,
        },
    ])
    monkeypatch.setattr(main, "require_pool", lambda: _PlacePool(connection))

    payload = asyncio.run(main.get_places({"id": "user-1"}))

    assert len(payload["items"]) == 1
    item = payload["items"][0]
    assert item == {
        "id": "4f9aa092-3534-4fc2-9c1e-e8708a28d890",
        "label": "Office",
        "address": "10 Example Road",
        "latitude": 1.3,
        "longitude": 103.8,
        "kind": "workplace",
        "geocodeSource": "OneMap",
        "geocodedAt": geocoded_at.isoformat(),
        "maximumDistanceM": 2500,
        "updatedAt": updated_at.isoformat(),
    }
    sql, values = connection.operations[0]
    assert "WHERE user_id=$1" in sql
    assert values == ("user-1",)


def test_create_place_persists_explicit_manual_provenance_and_kind(monkeypatch):
    connection = _PlaceConnection()

    async def ensure_user(_connection, _user):
        return None

    monkeypatch.setattr(main, "ensure_user", ensure_user)
    monkeypatch.setattr(main, "require_pool", lambda: _PlacePool(connection))
    request = PersonalPlaceRequest(
        label="School pickup",
        address="1 Example Road",
        latitude=1.3,
        longitude=103.8,
        maximum_distance_m=3500,
        kind="school",
        geocode_source="manual",
    )

    payload = asyncio.run(main.create_place(request, {"id": "user-1"}))

    sql, values = connection.operations[0]
    assert "kind" in sql and "geocode_source" in sql and "geocoded_at" in sql
    assert values[1:4] == ("user-1", "School pickup", "1 Example Road")
    assert values[6:] == (3500, "school", "manual", None)
    assert payload["kind"] == "school"
    assert payload["geocode_source"] == "manual"
    assert payload["geocoded_at"] is None


def test_create_place_rejects_missing_provenance(monkeypatch):
    connection = _PlaceConnection()

    async def ensure_user(_connection, _user):
        return None

    monkeypatch.setattr(main, "ensure_user", ensure_user)
    monkeypatch.setattr(main, "require_pool", lambda: _PlacePool(connection))
    request = PersonalPlaceRequest(label="Office", latitude=1.3, longitude=103.8)

    with pytest.raises(main.HTTPException) as error:
        asyncio.run(main.create_place(request, {"id": "user-1"}))

    assert error.value.status_code == 422
    assert connection.operations == []


def test_delete_place_scopes_deletion_to_the_active_owner(monkeypatch):
    connection = _PlaceConnection()
    monkeypatch.setattr(main, "require_pool", lambda: _PlacePool(connection))
    place_id = "4f9aa092-3534-4fc2-9c1e-e8708a28d890"

    payload = asyncio.run(main.delete_place(place_id, {"id": "user-1"}))

    sql, values = connection.operations[0]
    assert "DELETE FROM personal_place WHERE id=$1 AND user_id=$2" in sql
    assert values == (UUID(place_id), "user-1")
    assert payload == {"status": "deleted"}
