from datetime import datetime, timezone
from decimal import Decimal

import pytest

from app.scoring import (
    DEFAULT_WEIGHTS,
    POLICY_VERSION,
    score_affordability,
    score_distance,
    score_home_evidence,
)


@pytest.mark.parametrize(
    ("distance_m", "target_m", "expected"),
    [
        (0, 1_000, 100.0),
        (500, 1_000, 50.0),
        (1_000, 1_000, 0.0),
        (1_500, 1_000, 0.0),
    ],
)
def test_distance_score_is_linear_to_target_and_clamped(distance_m, target_m, expected):
    assert score_distance(distance_m, target_m) == expected


def test_distance_score_rounds_to_one_decimal_place():
    assert score_distance(1, 3) == 66.7


@pytest.mark.parametrize(
    ("distance_m", "target_m"),
    [
        (None, 1_000),
        (float("nan"), 1_000),
        (float("inf"), 1_000),
        (-1, 1_000),
        (100, None),
        (100, 0),
        (100, -1),
        (100, float("inf")),
        ("100", 1_000),
        (True, 1_000),
    ],
)
def test_invalid_distance_or_target_has_no_score(distance_m, target_m):
    assert score_distance(distance_m, target_m) is None


@pytest.mark.parametrize(
    ("price_cents", "budget_cents", "expected"),
    [
        (0, 100_000, 100.0),
        (100_000, 100_000, 50.0),
        (200_000, 100_000, 0.0),
        (300_000, 100_000, 0.0),
    ],
)
def test_affordability_score_is_bounded_price_fit(price_cents, budget_cents, expected):
    assert score_affordability(price_cents, budget_cents) == expected


@pytest.mark.parametrize(
    ("price_cents", "budget_cents"),
    [
        (100_000, None),
        (None, 100_000),
        (-1, 100_000),
        (100_000, 0),
        (100_000, -1),
        (float("nan"), 100_000),
        (100_000, float("inf")),
        ("100000", 100_000),
        (True, 100_000),
    ],
)
def test_invalid_price_or_budget_has_no_affordability_score(price_cents, budget_cents):
    assert score_affordability(price_cents, budget_cents) is None


def test_policy_defaults_name_the_four_weighted_criteria():
    assert DEFAULT_WEIGHTS == {
        "school": 2,
        "childcare": 2,
        "care": 2,
        "affordability": 1,
    }


def test_all_evidence_returns_weighted_score_and_component_records():
    result = score_home_evidence(
        evidence={
            "school": 0,
            "childcare": 1_000,
            "care": 2_000,
            "affordability": 600_000,
        },
        weights=DEFAULT_WEIGHTS,
        targets={
            "school": 1_000,
            "childcare": 2_000,
            "care": 4_000,
            "affordability": 600_000,
        },
    )

    assert result["score"] == 64.3
    assert result["coverage"] == 1.0
    assert result["missingEvidence"] == []
    components = {component["name"]: component for component in result["components"]}
    assert components["school"] == {
        "name": "school",
        "rawValue": 0,
        "targetValue": 1_000,
        "normalizedValue": 100.0,
        "weight": 2.0,
        "contribution": 28.6,
        "evidenceStatus": "available",
    }
    assert components["childcare"]["rawValue"] == 1_000
    assert components["childcare"]["normalizedValue"] == 50.0
    assert components["care"]["normalizedValue"] == 50.0
    assert components["affordability"]["rawValue"] == 600_000
    assert components["affordability"]["normalizedValue"] == 50.0
    for component in result["components"]:
        assert {
            "rawValue",
            "normalizedValue",
            "weight",
            "contribution",
            "evidenceStatus",
        }.issubset(component)
    assert round(sum(component["contribution"] for component in result["components"]), 1) == result["score"]


def test_component_contributions_reconcile_at_reviewer_rounding_boundary():
    result = score_home_evidence(
        evidence={
            "school": 498,
            "childcare": 498,
            "care": 498,
            "affordability": 2_490,
        },
        weights={"school": 1, "childcare": 1, "care": 1, "affordability": 1},
        targets={
            "school": 1_000,
            "childcare": 1_000,
            "care": 1_000,
            "affordability": 2_500,
        },
    )

    assert result["score"] == 50.2
    assert sum(
        Decimal(str(component["contribution"]))
        for component in result["components"]
    ) == Decimal("50.2")


def test_missing_high_weight_school_evidence_is_omitted_and_reduces_coverage():
    result = score_home_evidence(
        evidence={"childcare": 0, "care": 0, "affordability": 0},
        weights=DEFAULT_WEIGHTS,
        targets={"school": 1_000, "childcare": 1_000, "care": 1_000, "affordability": 100_000},
    )

    assert result["score"] == 100.0
    assert result["coverage"] == 0.71
    assert result["missingEvidence"] == ["school"]
    school = next(component for component in result["components"] if component["name"] == "school")
    assert school["rawValue"] is None
    assert school["normalizedValue"] is None
    assert school["contribution"] is None
    assert school["evidenceStatus"] == "missing"


def test_missing_all_criteria_returns_no_score_and_explains_missing_evidence():
    result = score_home_evidence(evidence={}, weights=None, targets={})

    assert result["score"] is None
    assert result["coverage"] == 0.0
    assert result["missingEvidence"] == ["school", "childcare", "care", "affordability"]
    assert all(component["evidenceStatus"] == "missing" for component in result["components"])


def test_zero_total_weight_returns_no_score_even_when_evidence_exists():
    result = score_home_evidence(
        evidence={"school": 0},
        weights={"school": 0, "childcare": 0, "care": 0, "affordability": 0},
        targets={"school": 1_000},
    )

    assert result["score"] is None
    assert result["coverage"] == 0.0
    assert result["missingEvidence"] == ["childcare", "care", "affordability"]


def test_score_is_null_when_available_weight_is_below_half():
    result = score_home_evidence(
        evidence={"affordability": 0},
        weights=DEFAULT_WEIGHTS,
        targets={"affordability": 100_000},
    )

    assert result["coverage"] == 0.14
    assert result["score"] is None


def test_score_is_available_at_exactly_half_coverage():
    result = score_home_evidence(
        evidence={"school": 0},
        weights={"school": 1, "childcare": 1, "care": 0, "affordability": 0},
        targets={"school": 1_000},
    )

    assert result["coverage"] == 0.5
    assert result["score"] == 100.0


def test_non_finite_or_negative_weights_are_safely_normalized():
    result = score_home_evidence(
        evidence={"school": 0, "childcare": 0},
        weights={
            "school": float("nan"),
            "childcare": -3,
            "care": float("inf"),
            "affordability": 0,
        },
        targets={"school": 1_000, "childcare": 1_000},
    )

    assert result["score"] is None
    assert result["coverage"] == 0.0
    assert all(component["weight"] == 0 for component in result["components"])


def test_invalid_evidence_or_target_is_reported_as_missing():
    result = score_home_evidence(
        evidence={"school": float("nan"), "childcare": -1},
        weights={"school": 1, "childcare": 1, "care": 0, "affordability": 0},
        targets={"school": 1_000, "childcare": 1_000},
    )

    assert result["score"] is None
    assert result["coverage"] == 0.0
    assert result["missingEvidence"] == ["school", "childcare", "care", "affordability"]
    assert all(component["rawValue"] is None for component in result["components"])


def test_price_without_a_valid_budget_is_not_scored_as_affordability():
    result = score_home_evidence(
        evidence={"affordability": 500_000},
        weights={"school": 0, "childcare": 0, "care": 0, "affordability": 1},
        targets={},
    )

    assert result["score"] is None
    assert result["coverage"] == 0.0
    assert result["missingEvidence"] == ["school", "childcare", "care", "affordability"]
    affordability = next(component for component in result["components"] if component["name"] == "affordability")
    assert affordability["rawValue"] == 500_000
    assert affordability["targetValue"] is None
    assert affordability["normalizedValue"] is None
    assert affordability["evidenceStatus"] == "missing"


def test_policy_result_identifies_version_and_utc_scoring_time():
    result = score_home_evidence(evidence={}, weights=None, targets={})

    assert result["policyVersion"] == POLICY_VERSION == "home-fit-v1"
    scored_at = datetime.fromisoformat(result["scoredAt"])
    assert scored_at.tzinfo is not None
    assert scored_at.utcoffset() == timezone.utc.utcoffset(scored_at)
