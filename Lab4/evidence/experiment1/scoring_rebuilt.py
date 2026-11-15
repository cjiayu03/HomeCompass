"""Home-fit scoring policy (the «control» class ScoringService).

The published rule (README, "How the home-fit score is calculated"):

* distance components (school, childcare, care):
  ``max(0, 100 × (1 − d / t))`` for distance ``d ≥ 0`` and target ``t > 0``;
* affordability: ``clamp(50 + 50 × (b − p) / b, 0, 100)`` for price ``p ≥ 0``
  and budget ``b > 0``;
* each component score is rounded to one decimal place;
* the overall score is the weighted average of the components that have
  valid evidence, rounded to one decimal place. Missing evidence is left out,
  never counted as zero;
* coverage = available component weight / all positive component weight; the
  overall score is reported only when coverage is at least 50%;
* invalid input (negative, non-numeric, boolean or non-finite) yields no
  component score, and negative or non-finite weights count as zero.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from fractions import Fraction
from typing import Any

POLICY_VERSION = "home-fit-v1"

CRITERIA: tuple[str, ...] = ("school", "childcare", "care", "affordability")
DISTANCE_CRITERIA: tuple[str, ...] = ("school", "childcare", "care")

DEFAULT_WEIGHTS: dict[str, int] = {
    "school": 2,
    "childcare": 2,
    "care": 2,
    "affordability": 1,
}

DEFAULT_DISTANCE_TARGETS_M: dict[str, int] = {
    "school": 1_500,
    "childcare": 2_000,
    "care": 2_000,
}

MINIMUM_COVERAGE = Fraction(1, 2)

__all__ = [
    "CRITERIA",
    "DEFAULT_DISTANCE_TARGETS_M",
    "DEFAULT_WEIGHTS",
    "POLICY_VERSION",
    "CriterionScore",
    "ScoringResult",
    "ScoringService",
    "score_affordability",
    "score_distance",
    "score_home_evidence",
]


# ---------------------------------------------------------------------------
# Input validation and rounding helpers
# ---------------------------------------------------------------------------

def _finite_number(value: Any) -> float | None:
    """Return ``value`` as a float when it is a finite real number.

    Booleans and strings are rejected even though Python can coerce them.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return number if math.isfinite(number) else None


def _exact(value: float) -> Fraction:
    # repr() gives the shortest decimal that round-trips, so 0.98 is 98/100.
    return Fraction(repr(float(value)))


def _round_half_up(value: Fraction | float, places: int) -> float:
    """Round half away from zero (as PostgreSQL ``ROUND(numeric)`` does)."""
    if isinstance(value, Fraction):
        decimal = Decimal(value.numerator) / Decimal(value.denominator)
    else:
        decimal = Decimal(repr(value))
    quantum = Decimal(1).scaleb(-places)
    return float(decimal.quantize(quantum, rounding=ROUND_HALF_UP))


def _clean_weight(value: Any) -> float:
    number = _finite_number(value)
    if number is None or number < 0:
        return 0.0
    return number


def _raw_value(value: Any) -> int | float | None:
    """Valid evidence is a finite, non-negative number; anything else is None."""
    number = _finite_number(value)
    if number is None or number < 0:
        return None
    if isinstance(value, (int, float)):
        return value
    return number


# ---------------------------------------------------------------------------
# Component scores
# ---------------------------------------------------------------------------

def score_distance(distance_m: Any, target_m: Any) -> float | None:
    """Linear 0–100 access score: 100 at the door, 0 at or beyond the target."""
    distance = _finite_number(distance_m)
    target = _finite_number(target_m)
    if distance is None or target is None or distance < 0 or target <= 0:
        return None
    exact = 100 * (1 - _exact(distance) / _exact(target))
    return _round_half_up(max(Fraction(0), exact), 1)


def score_affordability(price_cents: Any, budget_cents: Any) -> float | None:
    """Price fit against budget: 100 when free, 50 at budget, 0 at twice budget."""
    price = _finite_number(price_cents)
    budget = _finite_number(budget_cents)
    if price is None or budget is None or price < 0 or budget <= 0:
        return None
    exact_budget = _exact(budget)
    exact = 50 + 50 * (exact_budget - _exact(price)) / exact_budget
    return _round_half_up(min(Fraction(100), max(Fraction(0), exact)), 1)


def _component_score(name: str, raw: Any, target: Any) -> float | None:
    if name == "affordability":
        return score_affordability(raw, target)
    return score_distance(raw, target)


def _allocate_contributions(exact: dict[str, Fraction], total_tenths: int) -> dict[str, float]:
    """Round contributions to 0.1 so that they add up exactly to the score.

    Uses the largest-remainder method on tenths, so the displayed
    contributions always reconcile with the displayed overall score.
    """
    floors = {name: math.floor(value * 10) for name, value in exact.items()}
    remainders = sorted(
        exact,
        key=lambda name: (-(exact[name] * 10 - floors[name]), CRITERIA.index(name)),
    )
    shortfall = total_tenths - sum(floors.values())
    for name in remainders[: max(0, shortfall)]:
        floors[name] += 1
    return {name: float(Decimal(tenths) / 10) for name, tenths in floors.items()}


# ---------------------------------------------------------------------------
# Overall score
# ---------------------------------------------------------------------------

def score_home_evidence(
    evidence: Mapping[str, Any] | None,
    weights: Mapping[str, Any] | None,
    targets: Mapping[str, Any] | None,
) -> dict:
    """Score one home from raw evidence.

    ``evidence`` holds raw distances in metres (school, childcare, care) and the
    observed price in cents (affordability). ``targets`` holds the matching
    distance targets in metres and the budget in cents. ``weights`` defaults to
    :data:`DEFAULT_WEIGHTS` when ``None``; criteria absent from a supplied
    mapping get weight 0.
    """
    evidence = evidence or {}
    targets = targets or {}
    weights = DEFAULT_WEIGHTS if weights is None else weights

    components: list[dict] = []
    missing: list[str] = []
    available: dict[str, tuple[Fraction, Fraction]] = {}
    total_weight = Fraction(0)
    available_weight = Fraction(0)

    for name in CRITERIA:
        weight = _clean_weight(weights.get(name))
        raw = _raw_value(evidence.get(name))
        target = _raw_value(targets.get(name))
        normalized = _component_score(name, raw, target)
        exact_weight = _exact(weight)
        total_weight += exact_weight
        if normalized is None:
            missing.append(name)
        else:
            available_weight += exact_weight
            available[name] = (exact_weight, _exact(normalized))
        components.append({
            "name": name,
            "rawValue": raw,
            "targetValue": target if (target is not None and target > 0) else None,
            "normalizedValue": normalized,
            "weight": weight,
            "contribution": None,
            "evidenceStatus": "available" if normalized is not None else "missing",
        })

    if total_weight > 0:
        exact_coverage = available_weight / total_weight
    else:
        exact_coverage = Fraction(0)
    coverage = _round_half_up(exact_coverage, 2)

    score: float | None = None
    if total_weight > 0 and available_weight > 0 and exact_coverage >= MINIMUM_COVERAGE:
        exact_parts = {
            name: weight * value / available_weight
            for name, (weight, value) in available.items()
        }
        exact_score = sum(exact_parts.values(), Fraction(0))
        score_tenths = math.floor(exact_score * 10 + Fraction(1, 2))
        score = float(Decimal(score_tenths) / 10)
        contributions = _allocate_contributions(
            {name: part for name, part in exact_parts.items() if part != 0},
            score_tenths,
        )
        for component in components:
            if component["name"] in available:
                component["contribution"] = contributions.get(component["name"], 0.0)

    return {
        "score": score,
        "coverage": coverage,
        "components": components,
        "missingEvidence": missing,
        "policyVersion": POLICY_VERSION,
        "scoredAt": datetime.now(timezone.utc).isoformat(),
    }


# ---------------------------------------------------------------------------
# Design-model classes (ScoringService, ScoringResult, CriterionScore)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class CriterionScore:
    criterion: str
    raw_value: int | float | None
    target_value: int | float | None
    score: float | None
    weight: float
    contribution: float | None
    availability: str

    @property
    def explanation(self) -> str:
        label = _CRITERION_LABELS[self.criterion]
        if self.score is None:
            return f"{label}: no valid evidence, left out of the score (not counted as 0)."
        if self.criterion == "affordability":
            detail = (
                f"price ${self.raw_value / 100:,.0f} against budget "
                f"${self.target_value / 100:,.0f}"
            )
        else:
            detail = f"{self.raw_value:,.0f} m against a {self.target_value:,.0f} m target"
        contribution = "n/a" if self.contribution is None else f"{self.contribution:g}"
        return (
            f"{label}: {self.score:g}/100 ({detail}), weight {self.weight:g}, "
            f"contribution {contribution}."
        )


@dataclass(frozen=True)
class ScoringResult:
    overall_score: float | None
    coverage: float
    components: list[CriterionScore] = field(default_factory=list)
    missing_evidence: list[str] = field(default_factory=list)
    policy_version: str = POLICY_VERSION
    scored_at: str = ""

    @classmethod
    def from_dict(cls, payload: Mapping[str, Any]) -> "ScoringResult":
        return cls(
            overall_score=payload["score"],
            coverage=payload["coverage"],
            components=[
                CriterionScore(
                    criterion=item["name"],
                    raw_value=item["rawValue"],
                    target_value=item["targetValue"],
                    score=item["normalizedValue"],
                    weight=item["weight"],
                    contribution=item["contribution"],
                    availability=item["evidenceStatus"],
                )
                for item in payload["components"]
            ],
            missing_evidence=list(payload["missingEvidence"]),
            policy_version=payload.get("policyVersion", POLICY_VERSION),
            scored_at=payload.get("scoredAt", ""),
        )

    def to_dict(self) -> dict:
        return {
            "score": self.overall_score,
            "coverage": self.coverage,
            "components": [
                {
                    "name": item.criterion,
                    "rawValue": item.raw_value,
                    "targetValue": item.target_value,
                    "normalizedValue": item.score,
                    "weight": item.weight,
                    "contribution": item.contribution,
                    "evidenceStatus": item.availability,
                }
                for item in self.components
            ],
            "missingEvidence": list(self.missing_evidence),
            "policyVersion": self.policy_version,
            "scoredAt": self.scored_at,
        }


_CRITERION_LABELS = {
    "school": "School access",
    "childcare": "Childcare access",
    "care": "Care access",
    "affordability": "Affordability",
}


def _get(source: Any, key: str, default: Any = None) -> Any:
    if source is None:
        return default
    if isinstance(source, Mapping):
        return source.get(key, default)
    try:
        return source[key]
    except (KeyError, TypeError, IndexError):
        return getattr(source, key, default)


class ScoringService:
    """«control» ScoringService: score(home, request) and explain(result)."""

    def __init__(
        self,
        weights: Mapping[str, Any] | None = None,
        distance_targets: Mapping[str, Any] | None = None,
    ) -> None:
        self.weights = dict(DEFAULT_WEIGHTS if weights is None else weights)
        self.distance_targets = {**DEFAULT_DISTANCE_TARGETS_M, **(distance_targets or {})}

    def score(self, home: Any, request: Any = None) -> ScoringResult:
        """Score a candidate home against a search request.

        ``home`` supplies ``school_distance_m``, ``childcare_distance_m``,
        ``care_distance_m`` and ``price_observation_cents``. ``request`` may
        supply ``budget`` (dollars), ``max_<criterion>_distance_m`` targets and
        ``priority_weights``.
        """
        evidence = {
            "school": _get(home, "school_distance_m"),
            "childcare": _get(home, "childcare_distance_m"),
            "care": _get(home, "care_distance_m"),
            "affordability": _get(home, "price_observation_cents"),
        }
        targets: dict[str, Any] = {}
        for name in DISTANCE_CRITERIA:
            override = _get(request, f"max_{name}_distance_m")
            targets[name] = override if override is not None else self.distance_targets[name]
        budget = _finite_number(_get(request, "budget"))
        targets["affordability"] = budget * 100 if budget is not None else None
        weights = _get(request, "priority_weights") or self.weights
        return ScoringResult.from_dict(score_home_evidence(evidence, weights, targets))

    def explain(self, result: ScoringResult | Mapping[str, Any]) -> list[str]:
        """Plain-language explanation of a scoring result, one line per fact."""
        if not isinstance(result, ScoringResult):
            result = ScoringResult.from_dict(result)
        if result.overall_score is None:
            headline = (
                f"Insufficient evidence: coverage {result.coverage:.0%} is below the "
                f"50% needed for a score."
                if result.coverage < 0.5 or result.coverage == 0
                else "Insufficient evidence for a score."
            )
        else:
            headline = (
                f"Home-fit score {result.overall_score:g}/100 from "
                f"{result.coverage:.0%} weighted evidence coverage."
            )
        lines = [headline]
        lines.extend(item.explanation for item in result.components)
        if result.missing_evidence:
            lines.append("Missing evidence: " + ", ".join(result.missing_evidence) + ".")
        lines.append(
            f"Policy {result.policy_version}. A comparison aid, not a valuation or "
            "eligibility decision."
        )
        return lines
