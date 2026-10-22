from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
import math
from numbers import Real
from typing import Mapping


POLICY_VERSION = "home-fit-v1"
DEFAULT_WEIGHTS = {
    "school": 2,
    "childcare": 2,
    "care": 2,
    "affordability": 1,
}

_CRITERIA = tuple(DEFAULT_WEIGHTS)
_MINIMUM_COVERAGE = 0.50


def _finite_number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (Real, Decimal)):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return number if math.isfinite(number) else None


def score_distance(distance_m: object, target_m: object) -> float | None:
    """Score a non-negative distance against a positive target."""
    distance = _finite_number(distance_m)
    target = _finite_number(target_m)
    if distance is None or target is None or distance < 0 or target <= 0:
        return None
    return round(max(0.0, 100.0 * (1.0 - distance / target)), 1)


def score_affordability(price_cents: object, budget_cents: object) -> float | None:
    """Return bounded price fit: 100 at zero price, 50 at budget, 0 at 2x."""
    price = _finite_number(price_cents)
    budget = _finite_number(budget_cents)
    if price is None or budget is None or price < 0 or budget <= 0:
        return None
    fit = 50.0 + 50.0 * ((budget - price) / budget)
    return round(min(100.0, max(0.0, fit)), 1)


def _weight(value: object) -> float:
    number = _finite_number(value)
    return max(number, 0.0) if number is not None else 0.0


def _raw_value(value: object, *, allow_minimum: bool = True) -> int | float | None:
    number = _finite_number(value)
    if number is None or number < 0 or (not allow_minimum and number == 0):
        return None
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    return number


def score_home_evidence(
    evidence: Mapping[str, object],
    weights: Mapping[str, object] | None,
    targets: Mapping[str, object],
) -> dict:
    """Score present home evidence and expose its weighted component shares.

    Evidence and targets use the four criterion names. The first three
    criteria use distances in meters; affordability uses price and budget in
    cents. Each available component's contribution is its share of the
    available-evidence score.
    """
    supplied_weights = weights or {}
    normalized_weights = {
        name: _weight(supplied_weights.get(name, default))
        for name, default in DEFAULT_WEIGHTS.items()
    }

    raw_values: dict[str, int | float | None] = {}
    target_values: dict[str, int | float | None] = {}
    normalized_values: dict[str, float | None] = {}
    for name in _CRITERIA:
        raw = evidence.get(name)
        target = targets.get(name)
        normalized = (
            score_affordability(raw, target)
            if name == "affordability"
            else score_distance(raw, target)
        )
        raw_values[name] = _raw_value(raw)
        target_values[name] = _raw_value(target, allow_minimum=False)
        normalized_values[name] = normalized

    maximum_weight = max(normalized_weights.values(), default=0.0)
    scaled_weights = {
        name: weight / maximum_weight if maximum_weight > 0 else 0.0
        for name, weight in normalized_weights.items()
    }
    total_weight = math.fsum(scaled_weights.values())
    available_weight = math.fsum(
        scaled_weights[name]
        for name in _CRITERIA
        if normalized_values[name] is not None
    )
    coverage = available_weight / total_weight if total_weight > 0 else 0.0
    weighted_average = (
        math.fsum(
            normalized_values[name] * scaled_weights[name]
            for name in _CRITERIA
            if normalized_values[name] is not None
        )
        / available_weight
        if available_weight > 0
        else None
    )
    score = (
        round(weighted_average, 1)
        if weighted_average is not None and coverage >= _MINIMUM_COVERAGE
        else None
    )

    rounded_contributions: dict[str, float | None] = {}
    available_criteria = [
        name for name in _CRITERIA if normalized_values[name] is not None
    ]
    if available_weight > 0 and weighted_average is not None:
        exact_tenths = {
            name: (
                normalized_values[name] * scaled_weights[name] / available_weight
            )
            * 10
            for name in available_criteria
        }
        contribution_tenths = {
            name: math.floor(value) for name, value in exact_tenths.items()
        }
        rounded_total = score if score is not None else round(weighted_average, 1)
        remaining_tenths = int(Decimal(str(rounded_total)) * 10) - sum(
            contribution_tenths.values()
        )
        if remaining_tenths > 0:
            allocation_order = sorted(
                available_criteria,
                key=lambda name: exact_tenths[name] - contribution_tenths[name],
                reverse=True,
            )
        else:
            allocation_order = sorted(
                available_criteria,
                key=lambda name: exact_tenths[name] - contribution_tenths[name],
            )
        direction = 1 if remaining_tenths > 0 else -1
        for index in range(abs(remaining_tenths)):
            name = allocation_order[index % len(allocation_order)]
            contribution_tenths[name] += direction
        rounded_contributions = {
            name: contribution_tenths[name] / 10 for name in available_criteria
        }
    else:
        rounded_contributions = {name: 0.0 for name in available_criteria}

    components = []
    missing_evidence = []
    for name in _CRITERIA:
        normalized = normalized_values[name]
        if normalized is None:
            missing_evidence.append(name)
            contribution = None
            evidence_status = "missing"
        else:
            contribution = rounded_contributions[name]
            evidence_status = "available"
        components.append(
            {
                "name": name,
                "rawValue": raw_values[name],
                "targetValue": target_values[name],
                "normalizedValue": normalized,
                "weight": normalized_weights[name],
                "contribution": contribution,
                "evidenceStatus": evidence_status,
            }
        )

    return {
        "score": score,
        "coverage": round(coverage, 2),
        "components": components,
        "missingEvidence": missing_evidence,
        "policyVersion": POLICY_VERSION,
        "scoredAt": datetime.now(timezone.utc).isoformat(),
    }
