import pytest
from pydantic import ValidationError

from app.schemas import SearchRequest


def test_search_request_defaults_to_empty_query_and_unset_optional_filters():
    request = SearchRequest()
    assert request.query == ""
    assert request.budget is None
    assert request.town is None
    assert request.max_school_distance_m is None


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


def test_search_query_accepts_maximum_length_and_rejects_one_more_character():
    assert len(SearchRequest(query="x" * 160).query) == 160
    with pytest.raises(ValidationError):
        SearchRequest(query="x" * 161)
