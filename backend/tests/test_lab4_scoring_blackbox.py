"""Lab 4 black-box tests for the ScoringService control class (app/scoring.py).

Each case ID (BB-xx) matches a row in Lab4/Test_Cases_and_Results.md. The
cases were chosen by equivalence-class partitioning and boundary-value
analysis; see that report for the class and boundary each case covers.
"""

import math

import pytest

from app.scoring import score_affordability, score_distance, score_home_evidence

TARGETS = {"school": 1_500, "childcare": 2_000, "care": 2_000}


@pytest.mark.parametrize(
    ("distance_m", "target_m", "expected"),
    [
        pytest.param(0, 1_500, 100.0, id="BB-01 distance at lower boundary"),
        pytest.param(750, 1_500, 50.0, id="BB-02 nominal distance"),
        pytest.param(1_499, 1_500, 0.1, id="BB-03 just inside target"),
        pytest.param(1_500, 1_500, 0.0, id="BB-04 distance equals target"),
        pytest.param(1_501, 1_500, 0.0, id="BB-05 just beyond target"),
        pytest.param(-0.1, 1_500, None, id="BB-06 just below zero"),
        pytest.param(True, 1_500, None, id="BB-07 boolean distance"),
        pytest.param(math.nan, 1_500, None, id="BB-08 non-finite distance"),
        pytest.param(100, 0, None, id="BB-09 target at zero boundary"),
        pytest.param(100, "1500", None, id="BB-10 non-numeric target"),
        pytest.param(0.1, 1_500, 100.0, id="BB-26 just above zero distance"),
        pytest.param(0, -0.1, None, id="BB-27 just below zero target"),
        pytest.param(0, 0.1, 100.0, id="BB-28 just above zero target"),
    ],
)
def test_score_distance(distance_m, target_m, expected):
    assert score_distance(distance_m, target_m) == expected


@pytest.mark.parametrize(
    ("price", "budget", "expected"),
    [
        pytest.param(0, 100, 100.0, id="BB-11 zero price"),
        pytest.param(99, 100, 50.5, id="BB-12 just under budget"),
        pytest.param(100, 100, 50.0, id="BB-13 price equals budget"),
        pytest.param(101, 100, 49.5, id="BB-14 just over budget"),
        pytest.param(200, 100, 0.0, id="BB-15 twice the budget"),
        pytest.param(201, 100, 0.0, id="BB-16 beyond twice the budget"),
        pytest.param(-1, 100, None, id="BB-17 negative price"),
        pytest.param(50, 0, None, id="BB-18 budget at zero boundary"),
        pytest.param(1, 100, 99.5, id="BB-29 just above zero price"),
        pytest.param(199, 100, 0.5, id="BB-30 just below twice budget"),
        pytest.param(0, -1, None, id="BB-31 just below zero budget"),
        pytest.param(0, 1, 100.0, id="BB-32 just above zero budget"),
    ],
)
def test_score_affordability(price, budget, expected):
    assert score_affordability(price, budget) == expected


def components_by_name(result):
    return {component["name"]: component for component in result["components"]}


def test_bb19_all_evidence_with_default_weights():
    result = score_home_evidence(
        {"school": 600, "childcare": 500, "care": 1_000, "affordability": 45_000_000},
        None,
        {**TARGETS, "affordability": 50_000_000},
    )
    components = components_by_name(result)

    assert result["score"] == 60.7
    assert result["coverage"] == 1.0
    assert result["missingEvidence"] == []
    assert {name: component["normalizedValue"] for name, component in components.items()} == {
        "school": 60.0, "childcare": 75.0, "care": 50.0, "affordability": 55.0,
    }
    assert {name: component["contribution"] for name, component in components.items()} == {
        "school": 17.1, "childcare": 21.4, "care": 14.3, "affordability": 7.9,
    }


def test_bb20_coverage_exactly_half_is_scored_and_missing_is_not_zero():
    result = score_home_evidence(
        {"school": 0, "childcare": 1_000},
        {"school": 1, "childcare": 1, "care": 1, "affordability": 1},
        {**TARGETS, "affordability": None},
    )

    assert result["score"] == 75.0
    assert result["coverage"] == 0.5
    assert result["missingEvidence"] == ["care", "affordability"]


UNEVEN_WEIGHTS = {"school": 1, "childcare": 1, "care": 1, "affordability": 0.98}


def test_bb21_coverage_just_below_half_is_not_scored():
    result = score_home_evidence(
        {"school": 0, "affordability": 50},
        UNEVEN_WEIGHTS,
        {**TARGETS, "affordability": 100},
    )

    # Raw coverage is 1.98 / 3.98 = 0.4975, below the 50% threshold.
    assert result["score"] is None
    assert result["coverage"] == 0.5
    assert result["missingEvidence"] == ["childcare", "care"]


def test_bb22_coverage_just_above_half_is_scored():
    result = score_home_evidence(
        {"school": 0, "childcare": 1_000},
        UNEVEN_WEIGHTS,
        {**TARGETS, "affordability": 100},
    )

    # Raw coverage is 2 / 3.98 = 0.5025, above the 50% threshold.
    assert result["score"] == 75.0
    assert result["coverage"] == 0.5


def test_bb23_no_evidence_is_not_scored():
    result = score_home_evidence({}, None, {**TARGETS, "affordability": None})

    assert result["score"] is None
    assert result["coverage"] == 0.0
    assert result["missingEvidence"] == ["school", "childcare", "care", "affordability"]


def test_bb24_all_zero_weights_are_not_scored():
    result = score_home_evidence(
        {"school": 600, "childcare": 500, "care": 1_000, "affordability": 45_000_000},
        {"school": 0, "childcare": 0, "care": 0, "affordability": 0},
        {**TARGETS, "affordability": 50_000_000},
    )

    assert result["score"] is None
    assert result["coverage"] == 0.0


def test_bb25_negative_weight_is_treated_as_zero():
    result = score_home_evidence(
        {"school": 600, "childcare": 500, "care": 1_000, "affordability": 45_000_000},
        {"school": -5, "childcare": 1, "care": 1, "affordability": 1},
        {**TARGETS, "affordability": 50_000_000},
    )
    components = components_by_name(result)

    assert result["score"] == 60.0
    assert result["coverage"] == 1.0
    assert components["school"]["weight"] == 0.0
    assert components["school"]["contribution"] == 0.0
