from __future__ import annotations

from dataclasses import dataclass
from datetime import date
import re
from typing import Iterable


@dataclass(frozen=True)
class CandidateHome:
    id: str
    address: str
    town: str
    flat_type: str
    price_observation: int
    score: int | None
    latitude: float
    longitude: float
    source: str
    source_updated: date | None
    school: str
    childcare: str
    care: str
    risk: str
    highlights: tuple[str, ...]
    risks: tuple[str, ...]


HOMES: tuple[CandidateHome, ...] = (
    CandidateHome("blk-118", "118 Jalan Bukit Merah", "Bukit Merah", "4-room", 488000, None, 1.283, 103.817, "Illustrative fixture · not official data", None, "Not connected", "Not connected", "Not connected", "Not assessed", (), ("Illustrative address, price and map point; not a real source record",)),
    CandidateHome("blk-254", "254 Serangoon Avenue 2", "Serangoon", "5-room", 535000, None, 1.355, 103.871, "Illustrative fixture · not official data", None, "Not connected", "Not connected", "Not connected", "Not assessed", (), ("Illustrative address, price and map point; not a real source record",)),
    CandidateHome("blk-611", "611 Bedok Reservoir Road", "Bedok", "4-room", 442000, None, 1.337, 103.930, "Illustrative fixture · not official data", None, "Not connected", "Not connected", "Not connected", "Not assessed", (), ("Illustrative address, price and map point; not a real source record",)),
    CandidateHome("blk-49", "49 Toa Payoh East", "Toa Payoh", "4-room", 476000, None, 1.333, 103.849, "Illustrative fixture · not official data", None, "Not connected", "Not connected", "Not connected", "Not assessed", (), ("Illustrative address, price and map point; not a real source record",)),
    CandidateHome("blk-802", "802 Tampines Street 81", "Tampines", "4-room", 421000, None, 1.348, 103.936, "Illustrative fixture · not official data", None, "Not connected", "Not connected", "Not connected", "Not assessed", (), ("Illustrative address, price and map point; not a real source record",)),
)


def serialize_home(home: CandidateHome) -> dict:
    return {
        "id": home.id,
        "address": home.address,
        "town": home.town,
        "type": home.flat_type,
        "price": home.price_observation,
        "score": home.score,
        "lat": home.latitude,
        "lng": home.longitude,
        "source": home.source,
        "sourceUpdated": home.source_updated.isoformat() if home.source_updated else "Illustrative only",
        "school": home.school,
        "childcare": home.childcare,
        "care": home.care,
        "risk": home.risk,
        "highlights": list(home.highlights),
        "risks": list(home.risks),
    }


def _distance_m(text: str) -> int | None:
    match = re.search(r"([0-9]+(?:\.[0-9]+)?)\s*(km|m)", text.lower())
    if not match:
        return None
    value = float(match.group(1))
    return round(value * 1000) if match.group(2) == "km" else round(value)


def search_homes(query: str = "", budget: int | None = None, town: str | None = None, flat_type: str | None = None, max_school_distance_m: int | None = None, max_childcare_distance_m: int | None = None, max_care_distance_m: int | None = None) -> list[dict]:
    normalized = query.strip().lower()
    result: Iterable[CandidateHome] = HOMES
    if budget is not None:
        result = (home for home in result if home.price_observation <= budget)
    if town:
        result = (home for home in result if home.town.lower() == town.lower())
    if flat_type:
        result = (home for home in result if home.flat_type.lower() == flat_type.lower())
    if max_school_distance_m is not None:
        result = (home for home in result if (_distance_m(home.school) is not None and _distance_m(home.school) <= max_school_distance_m))
    if max_childcare_distance_m is not None:
        result = (home for home in result if (_distance_m(home.childcare) is not None and _distance_m(home.childcare) <= max_childcare_distance_m))
    if max_care_distance_m is not None:
        result = (home for home in result if (_distance_m(home.care) is not None and _distance_m(home.care) <= max_care_distance_m))
    if normalized:
        result = (home for home in result if normalized in " ".join((home.address, home.town, home.school, home.childcare, home.care, *home.highlights)).lower())
    return [serialize_home(home) for home in result]


def weighted_score(criteria: dict[str, float | None], weights: dict[str, float] | None = None) -> dict:
    """Return a transparent weighted score; unavailable stays null, never zero."""
    weights = weights or {}
    available = {name: value for name, value in criteria.items() if value is not None}
    if not available:
        return {"score": None, "coverage": 0, "components": {}, "weights": {}, "explanation": "No criterion data is available."}
    normalized_weights = {name: max(float(weights.get(name, 1)), 0.0) for name in criteria}
    available_weight = sum(normalized_weights[name] for name in available)
    total_weight = sum(normalized_weights.values())
    if available_weight == 0:
        return {"score": None, "coverage": 0, "components": available, "weights": normalized_weights, "explanation": "Available criteria have no positive weight."}
    score = round(sum(float(value) * normalized_weights[name] for name, value in available.items()) / available_weight, 1)
    coverage = round(available_weight / total_weight, 2) if total_weight else 0
    return {"score": score, "coverage": coverage, "components": available, "weights": normalized_weights, "explanation": "Weighted average of available criterion scores; missing data was excluded and remains visible."}
