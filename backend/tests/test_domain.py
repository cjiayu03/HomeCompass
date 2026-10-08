from app.domain import search_homes, weighted_score


def test_unfiltered_search_returns_all_labelled_fixtures():
    results = search_homes()
    assert len(results) == 5
    assert all(item["source"] == "Illustrative fixture · not official data" for item in results)


def test_budget_filter_returns_only_qualifying_homes():
    results = search_homes(budget=450000)
    assert results
    assert all(item["price"] <= 450000 for item in results)


def test_search_budget_boundary_is_inclusive_and_just_below_excludes():
    at_boundary = search_homes(budget=421000)
    below_boundary = search_homes(budget=420999)
    assert any(item["id"] == "blk-802" for item in at_boundary)
    assert all(item["id"] != "blk-802" for item in below_boundary)


def test_search_town_and_flat_type_filters_are_case_insensitive():
    results = search_homes(town="bedok", flat_type="4-ROOM")
    assert len(results) == 1
    assert results[0]["town"] == "Bedok"


def test_search_query_matches_fixture_text_without_inventing_missing_evidence():
    assert len(search_homes(query="bedok")) == 1
    assert search_homes(query="school") == []


def test_missing_score_is_not_zero():
    result = weighted_score({"school": 90, "care": None, "budget": 80})
    assert result["score"] == 85
    assert result["coverage"] == 0.67
    assert "care" not in result["components"]


def test_all_missing_scores_are_unavailable():
    result = weighted_score({"school": None, "care": None})
    assert result["score"] is None
    assert result["coverage"] == 0


def test_weighted_score_exposes_weights_and_uses_available_weight():
    result = weighted_score({"school": 100, "care": 50}, {"school": 3, "care": 1})
    assert result["score"] == 87.5
    assert result["coverage"] == 1
    assert result["weights"]["school"] == 3


def test_missing_high_weight_reduces_coverage_without_becoming_zero():
    result = weighted_score({"school": None, "care": 80}, {"school": 3, "care": 1})
    assert result["score"] == 80
    assert result["coverage"] == 0.25


def test_missing_amenity_distances_do_not_match_a_hard_distance_filter():
    results = search_homes(max_school_distance_m=520)
    assert results == []


def test_all_distance_filters_exclude_unavailable_fixture_distances():
    assert search_homes(max_school_distance_m=1000) == []
    assert search_homes(max_childcare_distance_m=1000) == []
    assert search_homes(max_care_distance_m=1000) == []


def test_weighted_score_returns_one_available_criterion_without_changing_it():
    result = weighted_score({"school": 42.5})
    assert result["score"] == 42.5
    assert result["coverage"] == 1


def test_weighted_score_with_only_zero_weight_is_unavailable():
    result = weighted_score({"school": 90}, {"school": 0})
    assert result["score"] is None
    assert result["coverage"] == 0
    assert "no positive weight" in result["explanation"]
