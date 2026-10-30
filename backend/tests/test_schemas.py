from decimal import Decimal
from uuid import UUID

import pytest
from pydantic import ValidationError

import app.schemas as schemas
from app.schemas import BoundsRequest, FamilyProfileUpdate, ResourceRequest, SearchRequest
from app.pagination import encode_cursor


def test_search_request_defaults_to_empty_query_and_unset_optional_filters():
    request = SearchRequest()
    assert request.query == ""
    assert request.budget is None
    assert request.town is None
    assert request.max_school_distance_m is None
    assert request.place_constraints == []
    assert request.bounds is None
    assert request.limit == 50
    assert request.cursor is None


@pytest.mark.parametrize(
    "bounds",
    [
        {"west": 103.6, "south": 1.2, "east": 104.0, "north": 1.5},
        {"west": -122.5, "south": 37.5, "east": -121.5, "north": 38.0},
        {"west": -180, "south": -90, "east": 180, "north": 90},
    ],
)
def test_bounds_accept_singapore_and_world_coordinate_ranges(bounds):
    request = BoundsRequest(**bounds)

    assert request.model_dump() == bounds


@pytest.mark.parametrize(
    "bounds",
    [
        {"west": -180.1, "south": 0, "east": 10, "north": 1},
        {"west": 0, "south": -90.1, "east": 10, "north": 1},
        {"west": 170, "south": -10, "east": -170, "north": 10},
        {"west": 10, "south": 0, "east": 10, "north": 1},
        {"west": 0, "south": 2, "east": 10, "north": 1},
    ],
)
def test_bounds_reject_out_of_world_ordered_or_antimeridian_ranges(bounds):
    with pytest.raises(ValidationError):
        BoundsRequest(**bounds)


def test_resource_request_accepts_existing_comma_separated_bounds_format():
    request = ResourceRequest(bounds="103.6,1.2,104.0,1.5")

    assert request.bounds == BoundsRequest(west=103.6, south=1.2, east=104.0, north=1.5)


@pytest.mark.parametrize("limit", [1, 200])
def test_search_request_accepts_limits_within_inclusive_bounds(limit):
    assert SearchRequest(limit=limit).limit == limit


@pytest.mark.parametrize("limit", [0, -1, 201])
def test_search_request_rejects_limits_outside_bounds(limit):
    with pytest.raises(ValidationError):
        SearchRequest(limit=limit)


@pytest.mark.parametrize("limit", [1, 2000])
def test_resource_request_accepts_limits_within_inclusive_bounds(limit):
    assert ResourceRequest(limit=limit).limit == limit


@pytest.mark.parametrize("limit", [0, -1, 2001])
def test_resource_request_rejects_limits_outside_bounds(limit):
    with pytest.raises(ValidationError):
        ResourceRequest(limit=limit)


def test_resource_request_defaults_to_a_bounded_page_and_no_cursor():
    request = ResourceRequest()

    assert request.limit == 500
    assert request.cursor is None


def test_search_and_resource_requests_validate_their_cursor_shapes():
    home_cursor = encode_cursor({"score": "80.0", "observed_on": "2026-09-01", "id": "home-1"})
    resource_cursor = encode_cursor(
        {"resource_type": "moe_school", "name": "Example School", "id": "school-1"}
    )

    assert SearchRequest(cursor=home_cursor).cursor == home_cursor
    assert ResourceRequest(cursor=resource_cursor).cursor == resource_cursor
    with pytest.raises(ValidationError):
        SearchRequest(cursor=resource_cursor)
    with pytest.raises(ValidationError):
        ResourceRequest(cursor=home_cursor)


@pytest.mark.parametrize("budget", [0, 10_000_000])
def test_search_budget_accepts_inclusive_schema_boundaries(budget):
    assert SearchRequest(budget=budget).budget == budget


@pytest.mark.parametrize("budget", [-1, 10_000_001])
def test_search_budget_rejects_values_outside_schema_boundaries(budget):
    with pytest.raises(ValidationError):
        SearchRequest(budget=budget)


@pytest.mark.parametrize("distance", [0, 100_000])
def test_search_distance_accepts_inclusive_schema_boundaries(distance):
    assert SearchRequest(max_school_distance_m=distance).max_school_distance_m == distance


@pytest.mark.parametrize("distance", [-1, 100_001])
def test_search_distance_rejects_values_outside_schema_boundaries(distance):
    with pytest.raises(ValidationError):
        SearchRequest(max_school_distance_m=distance)


@pytest.mark.parametrize("field", ["min_storey", "max_storey"])
@pytest.mark.parametrize("value", [1, 100])
def test_search_storey_bounds_accept_inclusive_limits(field, value):
    request = SearchRequest(**{field: value})

    assert getattr(request, field) == value


@pytest.mark.parametrize("field", ["min_storey", "max_storey"])
@pytest.mark.parametrize("value", [-1, 0, 101, 1.5, "not-a-storey"])
def test_search_storey_bounds_reject_invalid_values(field, value):
    with pytest.raises(ValidationError):
        SearchRequest(**{field: value})


def test_search_storey_bounds_allow_equal_values_and_reject_reversed_range():
    request = SearchRequest(min_storey=5, max_storey=5)

    assert (request.min_storey, request.max_storey) == (5, 5)
    with pytest.raises(ValidationError, match="Minimum storey cannot exceed maximum storey"):
        SearchRequest(min_storey=6, max_storey=5)


def test_search_query_accepts_maximum_length_and_rejects_one_more_character():
    assert len(SearchRequest(query="x" * 160).query) == 160
    with pytest.raises(ValidationError):
        SearchRequest(query="x" * 161)


def _family_profile_update(**values):
    return FamilyProfileUpdate(adults=2, children=1, older_adults=0, **values)


def test_family_profile_priority_weights_default_and_fill_omitted_criteria():
    assert _family_profile_update().priority_weights == {
        "school": 2,
        "childcare": 2,
        "care": 2,
        "affordability": 1,
    }
    assert _family_profile_update(priority_weights={"school": 0, "care": 3}).priority_weights == {
        "school": 0,
        "childcare": 2,
        "care": 3,
        "affordability": 1,
    }


@pytest.mark.parametrize("weight", [0, 3, 1.25])
def test_family_profile_priority_weights_accept_finite_numeric_values_in_range(weight):
    assert _family_profile_update(priority_weights={"school": weight}).priority_weights["school"] == weight


@pytest.mark.parametrize(
    "weights",
    [
        {"unknown": 1},
        {"school": -0.01},
        {"school": 3.01},
        {"school": "1"},
        {"school": True},
        {"school": Decimal("3.0000000000000001")},
        {"school": float("nan")},
        {"school": float("inf")},
        {"school": float("-inf")},
    ],
)
def test_family_profile_priority_weights_reject_unknown_or_invalid_values(weights):
    with pytest.raises(ValidationError):
        _family_profile_update(priority_weights=weights)


@pytest.mark.parametrize("number", ["NaN", "Infinity", "-Infinity"])
def test_family_profile_priority_weights_reject_json_non_finite_numbers(number):
    payload = (
        '{"adults":2,"children":1,"older_adults":0,'
        f'"priority_weights":{{"school":{number}}}'
        '}'
    )
    with pytest.raises(ValidationError):
        FamilyProfileUpdate.model_validate_json(payload)


def test_search_request_accepts_an_optional_snake_case_priority_weight_snapshot():
    assert SearchRequest().priority_weights is None

    request = SearchRequest(priority_weights={"school": 0.5})

    assert request.priority_weights == {
        "school": 0.5,
        "childcare": 2,
        "care": 2,
        "affordability": 1,
    }
    assert request.model_dump()["priority_weights"]["school"] == 0.5


def test_search_request_rejects_invalid_priority_weight_snapshots():
    with pytest.raises(ValidationError):
        SearchRequest(priority_weights={"school": 4})


def _saved_search_create_model():
    model = getattr(schemas, "SavedSearchCreate", None)
    assert model is not None, "saved-search creation schema has not been implemented"
    return model


def _saved_search_payload(**overrides):
    payload = {
        "name": "Bishan family search",
        "mode": "structured",
        "criteria": {"query": "Bishan", "budget": 900_000, "limit": 20},
        "priority_weights": {"school": 1.5},
        "place_constraints": [
            {
                "place_id": "c4c0f6aa-6dcb-44a0-9000-bc0caaad08f0",
                "max_distance_m": 5_000,
            }
        ],
        "scoring_version": "home-fit-v1",
    }
    payload.update(overrides)
    return payload


def test_saved_search_create_normalizes_search_and_policy_snapshots():
    request = _saved_search_create_model().model_validate(_saved_search_payload())

    assert request.name == "Bishan family search"
    assert request.mode == "structured"
    assert isinstance(request.criteria, SearchRequest)
    assert request.criteria.query == "Bishan"
    assert request.criteria.limit == 20
    assert request.priority_weights == {
        "school": 1.5,
        "childcare": 2,
        "care": 2,
        "affordability": 1,
    }
    assert request.criteria.priority_weights == request.priority_weights
    assert request.place_constraints[0].place_id == UUID(
        "c4c0f6aa-6dcb-44a0-9000-bc0caaad08f0"
    )
    assert request.criteria.place_constraints == request.place_constraints
    assert request.scoring_version == "home-fit-v1"


def test_saved_search_without_explicit_weights_snapshots_default_policy():
    payload = _saved_search_payload(
        criteria={"query": "Bishan"},
        priority_weights=None,
        place_constraints=None,
    )
    request = _saved_search_create_model().model_validate(payload)
    expected_weights = {
        "school": 2,
        "childcare": 2,
        "care": 2,
        "affordability": 1,
    }

    assert request.priority_weights == expected_weights
    assert request.criteria.priority_weights == expected_weights
    assert request.place_constraints == []
    assert request.criteria.place_constraints == []


def test_saved_search_name_is_bounded_and_non_blank():
    model = _saved_search_create_model()

    assert len(model.model_validate(_saved_search_payload(name="x" * 80)).name) == 80
    for name in ("x" * 81, "   "):
        with pytest.raises(ValidationError):
            model.model_validate(_saved_search_payload(name=name))


def test_saved_search_criteria_reuses_search_request_query_bounds():
    model = _saved_search_create_model()

    assert len(
        model.model_validate(
            _saved_search_payload(criteria={"query": "x" * 160})
        ).criteria.query
    ) == 160
    with pytest.raises(ValidationError):
        model.model_validate(_saved_search_payload(criteria={"query": "x" * 161}))


def test_saved_search_criteria_discards_pagination_cursor():
    model = _saved_search_create_model()
    cursor = encode_cursor({"score": "80.0", "observed_on": "2026-09-01", "id": "home-1"})

    request = model.model_validate(
        _saved_search_payload(criteria={"query": "Bishan", "cursor": cursor})
    )

    assert request.criteria.cursor is None
    assert request.model_dump()["criteria"]["cursor"] is None

    request_from_search_request = model.model_validate(
        _saved_search_payload(
            criteria=SearchRequest(query="Bishan", cursor=cursor)
        )
    )
    assert request_from_search_request.criteria.cursor is None


def test_saved_search_criteria_rejects_unknown_fields_inside_bounds_only():
    model = _saved_search_create_model()
    bounds = {
        "west": 103.6,
        "south": 1.2,
        "east": 104.0,
        "north": 1.5,
        "annotation": "not a search bound",
    }
    valid_bounds = {key: value for key, value in bounds.items() if key != "annotation"}

    criteria = model.model_validate(
        _saved_search_payload(criteria={"bounds": valid_bounds})
    ).criteria
    assert criteria.bounds.model_dump() == valid_bounds

    with pytest.raises(ValidationError):
        model.model_validate(_saved_search_payload(criteria={"bounds": bounds}))

    # Keep the established behavior of ordinary search requests unchanged.
    assert SearchRequest(bounds=bounds).bounds is not None


def test_saved_search_caps_place_constraints_at_ten():
    model = _saved_search_create_model()
    constraints = [
        {
            "place_id": f"c4c0f6aa-6dcb-44a0-9000-bc0caaad08{index:02x}",
            "max_distance_m": 5_000,
        }
        for index in range(11)
    ]

    assert len(
        model.model_validate(
            _saved_search_payload(place_constraints=constraints[:10])
        ).place_constraints
    ) == 10
    with pytest.raises(ValidationError):
        model.model_validate(_saved_search_payload(place_constraints=constraints))


def test_saved_search_caps_policy_version_at_sixty_characters():
    model = _saved_search_create_model()

    assert len(
        model.model_validate(
            _saved_search_payload(scoring_version="v" * 60)
        ).scoring_version
    ) == 60
    with pytest.raises(ValidationError):
        model.model_validate(_saved_search_payload(scoring_version="v" * 61))


def test_saved_search_create_rejects_unknown_fields():
    model = _saved_search_create_model()

    for payload in (
        _saved_search_payload(unexpected=True),
        _saved_search_payload(criteria={"query": "Bishan", "unexpected": True}),
        _saved_search_payload(
            place_constraints=[
                {
                    "place_id": "c4c0f6aa-6dcb-44a0-9000-bc0caaad08f0",
                    "max_distance_m": 5_000,
                    "unexpected": True,
                }
            ]
        ),
        _saved_search_payload(
            criteria={
                "query": "Bishan",
                "place_constraints": [
                    {
                        "place_id": "c4c0f6aa-6dcb-44a0-9000-bc0caaad08f0",
                        "max_distance_m": 5_000,
                        "unexpected": True,
                    }
                ],
            }
        ),
    ):
        with pytest.raises(ValidationError):
            model.model_validate(payload)


def test_guest_sync_request_rejects_unknown_top_level_fields():
    request_model = getattr(schemas, "GuestSyncRequest", None)
    assert request_model is not None, "guest sync schema has not been implemented"

    with pytest.raises(ValidationError):
        request_model.model_validate({"sync_key": "guest-1", "unexpected": True})


def test_guest_sync_request_accepts_bounded_home_selections_and_deduplicates():
    request_model = getattr(schemas, "GuestSyncRequest", None)
    assert request_model is not None, "guest sync schema has not been implemented"

    request = request_model.model_validate(
        {
            "sync_key": "guest-1",
            "shortlistHomeIds": ["hdb-1", "hdb-1", "hdb-2"],
            "compareHomeIds": ["hdb-2", "hdb-3"],
        }
    )

    assert request.shortlist_home_ids == ["hdb-1", "hdb-2"]
    assert request.compare_home_ids == ["hdb-2", "hdb-3"]


def test_guest_sync_request_caps_shortlist_at_two_hundred_and_compare_at_three():
    request_model = getattr(schemas, "GuestSyncRequest", None)
    assert request_model is not None, "guest sync schema has not been implemented"

    assert len(
        request_model.model_validate(
            {
                "sync_key": "guest-1",
                "shortlistHomeIds": [f"hdb-{index}" for index in range(200)],
                "compareHomeIds": ["hdb-a", "hdb-b", "hdb-c"],
            }
        ).shortlist_home_ids
    ) == 200
    with pytest.raises(ValidationError):
        request_model.model_validate(
            {
                "sync_key": "guest-1",
                "shortlistHomeIds": [f"hdb-{index}" for index in range(201)],
            }
        )
    with pytest.raises(ValidationError):
        request_model.model_validate(
            {
                "sync_key": "guest-1",
                "compareHomeIds": ["hdb-a", "hdb-b", "hdb-c", "hdb-d"],
            }
        )


def test_guest_sync_request_accepts_bounded_profile_history_and_confirmed_places():
    request_model = getattr(schemas, "GuestSyncRequest", None)
    assert request_model is not None, "guest sync schema has not been implemented"

    request = request_model.model_validate(
        {
            "sync_key": "guest-2",
            "brief": {
                "adults": 2,
                "children": 1,
                "olderAdults": 0,
                "budgetCents": 900_000_00,
                "priorityWeights": {"school": 1.5},
            },
            "history": [
                {
                    "mode": "structured",
                    "criteria": {"query": "Bishan", "limit": 20},
                    "sourceSnapshotIds": ["c4c0f6aa-6dcb-44a0-9000-bc0caaad08f0"],
                    "scoringVersion": "home-fit-v1",
                }
            ],
            "places": [
                {
                    "label": "Work",
                    "address": "1 Harbour Road",
                    "latitude": 1.3,
                    "longitude": 103.8,
                    "maximumDistanceM": 5_000,
                    "kind": "workplace",
                }
            ],
            "confirmPlaces": True,
            "confirmBrief": True,
        }
    )

    assert request.brief.older_adults == 0
    assert request.brief.budget_cents == 900_000_00
    assert request.brief.priority_weights == {"school": 1.5}
    assert request.history[0].source_snapshot_ids == [
        UUID("c4c0f6aa-6dcb-44a0-9000-bc0caaad08f0")
    ]
    assert request.places[0].maximum_distance_m == 5_000
    assert request.confirm_places is True
    assert request.confirm_brief is True


@pytest.mark.parametrize(
    "payload",
    [
        {"sync_key": "guest-1", "brief": {"unexpected": "value"}},
        {
            "sync_key": "guest-1",
            "history": [
                {
                    "mode": "structured",
                    "criteria": {"query": "Bishan", "unexpected": "value"},
                }
            ],
        },
        {
            "sync_key": "guest-1",
            "places": [
                {
                    "label": "Work",
                    "latitude": 1.3,
                    "longitude": 103.8,
                    "selectionToken": "private-token",
                }
            ],
        },
        {"sync_key": "guest-1", "confirmPlaces": "true"},
        {"sync_key": "guest-1", "shortlistHomeIds": [123]},
        {"sync_key": "guest-1", "syncKey": "alias-is-not-supported"},
    ],
)
def test_guest_sync_request_rejects_unknown_fields_and_coercive_values(payload):
    with pytest.raises(ValidationError):
        schemas.GuestSyncRequest.model_validate(payload)


def test_guest_sync_request_caps_nested_collections_and_string_fields():
    request_model = schemas.GuestSyncRequest
    history_item = {
        "mode": "structured",
        "criteria": {"query": "Bishan"},
    }
    place = {
        "label": "Work",
        "latitude": 1.3,
        "longitude": 103.8,
    }

    for payload in (
        {"sync_key": "guest-1", "history": [history_item] * 101},
        {"sync_key": "guest-1", "places": [place] * 21},
        {
            "sync_key": "guest-1",
            "history": [
                {
                    **history_item,
                    "sourceSnapshotIds": [
                        "c4c0f6aa-6dcb-44a0-9000-bc0caaad08f0"
                    ]
                    * 21,
                }
            ],
        },
        {"sync_key": "guest-1", "brief": {"adults": True}},
        {"sync_key": "guest-1", "brief": {"adults": 31}},
        {
            "sync_key": "guest-1",
            "history": [
                {"mode": "structured", "criteria": {"query": "x" * 161}}
            ],
        },
        {"sync_key": "guest-1", "places": [{**place, "label": "x" * 81}]},
        {"sync_key": "guest-1", "places": [{**place, "address": "x" * 241}]},
        {"sync_key": "guest-1", "places": [{**place, "latitude": 1.0}]},
        {"sync_key": "guest-1", "sync_key": "x" * 129},
    ):
        with pytest.raises(ValidationError):
            request_model.model_validate(payload)


def test_guest_sync_request_normalizes_place_text_and_deduplicates_history_sources():
    source_id = "c4c0f6aa-6dcb-44a0-9000-bc0caaad08f0"
    request = schemas.GuestSyncRequest.model_validate(
        {
            "sync_key": "guest-1",
            "history": [
                {
                    "mode": "structured",
                    "criteria": {"query": "Bishan"},
                    "sourceSnapshotIds": [source_id, source_id],
                }
            ],
            "places": [
                {
                    "label": " Work ",
                    "address": " 1 Harbour Road ",
                    "latitude": 1.3,
                    "longitude": 103.8,
                }
            ],
        }
    )

    assert request.history[0].source_snapshot_ids == [UUID(source_id)]
    assert request.places[0].label == "Work"
    assert request.places[0].address == "1 Harbour Road"


def test_search_and_profile_accept_more_than_three_towns():
    from app.schemas import SearchRequest, FamilyProfileUpdate
    towns = ['Bishan', 'Queenstown', 'Tampines', 'Woodlands']
    assert len(SearchRequest(towns=towns).towns) == 4
    assert len(FamilyProfileUpdate(adults=2, children=0, older_adults=0, preferred_towns=towns).preferred_towns) == 4


def test_decision_preserves_checklist_labels_and_singapore_offset():
    from app.schemas import PlanningDecision
    decision = PlanningDecision(checklist={'custom-id': False}, checklistLabels={'custom-id': '看阳光'}, visitDate='2026-11-01T14:30+08:00')
    assert decision.checklistLabels['custom-id'] == '看阳光'
    assert decision.visitDate.endswith('+08:00')


def test_legacy_visit_is_explicitly_normalized_to_singapore():
    from app.schemas import PlanningDecision
    assert PlanningDecision(visitDate='2026-11-01T14:30').visitDate == '2026-11-01T14:30+08:00'
