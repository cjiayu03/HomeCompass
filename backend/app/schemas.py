from __future__ import annotations

from collections.abc import Mapping
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from enum import Enum
import json
import math
from numbers import Real
import re
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StrictInt,
    field_validator,
    model_validator,
)

from .scoring import DEFAULT_WEIGHTS
from .pagination import MAX_CURSOR_LENGTH, decode_cursor


_AUTH_EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class AuthCredentials(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_auth_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not _AUTH_EMAIL_PATTERN.fullmatch(normalized):
            raise ValueError("Enter a valid email address.")
        return normalized


class PasswordChangeRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


# Coarse WGS84 guard for the coordinate fields. Country membership is checked
# against the simplified safety polygons below, not by this rectangle alone.
SINGAPORE_PLACE_LATITUDE_MIN = 1.13
SINGAPORE_PLACE_LATITUDE_MAX = 1.47
SINGAPORE_PLACE_LONGITUDE_MIN = 103.59
SINGAPORE_PLACE_LONGITUDE_MAX = 104.07

# Simplified WGS84 safety envelopes in (longitude, latitude) order. The
# mainland outline and the named Sentosa/Tekong footprints retain the places
# supported by this API. These are not cadastral shorelines: polygon edges and
# unrepresented offshore areas are rejected, while small water areas inside a
# simplified footprint may still be accepted.
SINGAPORE_PLACE_GEOFENCE = (
    (
        (103.60, 1.26),
        (103.61, 1.30),
        (103.62, 1.34),
        (103.66, 1.40),
        (103.70, 1.44),
        (103.76, 1.46),
        (103.86, 1.465),
        (103.91, 1.45),
        (103.95, 1.42),
        (103.99, 1.39),
        (104.00, 1.36),
        (103.99, 1.33),
        (103.95, 1.30),
        (103.90, 1.275),
        (103.84, 1.255),
        (103.78, 1.25),
        (103.72, 1.25),
        (103.66, 1.25),
    ),
    (
        (103.81, 1.225),
        (103.815, 1.24),
        (103.825, 1.255),
        (103.842, 1.26),
        (103.855, 1.25),
        (103.86, 1.235),
        (103.845, 1.22),
        (103.825, 1.22),
    ),
    (
        (104.02, 1.39),
        (104.035, 1.38),
        (104.065, 1.38),
        (104.08, 1.395),
        (104.075, 1.42),
        (104.055, 1.435),
        (104.03, 1.425),
        (104.02, 1.41),
    ),
)


def _point_in_polygon(latitude: float, longitude: float, polygon) -> bool:
    """Return whether a point is strictly inside a lon/lat polygon."""
    inside = False
    previous_longitude, previous_latitude = polygon[-1]

    for current_longitude, current_latitude in polygon:
        cross_product = (longitude - previous_longitude) * (
            current_latitude - previous_latitude
        ) - (latitude - previous_latitude) * (
            current_longitude - previous_longitude
        )
        on_segment = (
            math.isclose(cross_product, 0.0, rel_tol=0.0, abs_tol=1e-12)
            and min(previous_longitude, current_longitude)
            <= longitude
            <= max(previous_longitude, current_longitude)
            and min(previous_latitude, current_latitude)
            <= latitude
            <= max(previous_latitude, current_latitude)
        )
        if on_segment:
            return False

        crosses_latitude = (current_latitude > latitude) != (
            previous_latitude > latitude
        )
        if crosses_latitude:
            crossing_longitude = previous_longitude + (
                (latitude - previous_latitude)
                * (current_longitude - previous_longitude)
                / (current_latitude - previous_latitude)
            )
            if longitude < crossing_longitude:
                inside = not inside

        previous_longitude, previous_latitude = current_longitude, current_latitude

    return inside


class PlaceConstraint(BaseModel):
    place_id: UUID
    max_distance_m: int = Field(ge=0, le=100_000)


def _reject_duplicate_place_constraints(value):
    place_ids = [constraint.place_id for constraint in value]
    if len(place_ids) != len(set(place_ids)):
        raise ValueError("A place may appear only once in search constraints.")
    return value


def _normalize_town_names(value: object) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError("Towns must be a list.")
    normalized = []
    seen = set()
    for town in value:
        if not isinstance(town, str):
            raise ValueError("Towns must be text values.")
        town = town.strip()
        if not town or len(town) > 80:
            raise ValueError("Towns must contain 1 to 80 characters.")
        key = town.casefold()
        if key in seen:
            raise ValueError("Towns must be unique.")
        seen.add(key)
        normalized.append(town)
    return normalized


def _normalize_priority_weights(value: object) -> dict[str, float | int]:
    if not isinstance(value, Mapping):
        raise ValueError("Priority weights must be an object.")

    unknown = set(value) - DEFAULT_WEIGHTS.keys()
    if unknown:
        raise ValueError("Priority weights contain an unsupported criterion.")

    weights: dict[str, float | int] = dict(DEFAULT_WEIGHTS)
    for criterion, weight in value.items():
        if isinstance(weight, bool) or not isinstance(weight, (Real, Decimal)):
            raise ValueError("Priority weights must be numeric.")
        try:
            number = float(weight)
        except (TypeError, ValueError, OverflowError) as exc:
            raise ValueError("Priority weights must be finite numbers between 0 and 3.") from exc
        try:
            in_range = 0 <= weight <= 3
        except (InvalidOperation, TypeError, ValueError, OverflowError):
            in_range = False
        if not math.isfinite(number) or not in_range:
            raise ValueError("Priority weights must be finite numbers between 0 and 3.")
        weights[criterion] = number
    return weights


class BoundsRequest(BaseModel):
    west: float = Field(ge=-180, le=180)
    south: float = Field(ge=-90, le=90)
    east: float = Field(ge=-180, le=180)
    north: float = Field(ge=-90, le=90)

    @model_validator(mode="before")
    @classmethod
    def parse_comma_separated_bounds(cls, value):
        if not isinstance(value, str):
            return value
        parts = [part.strip() for part in value.split(",")]
        if len(parts) != 4:
            raise ValueError("Bounds must use west,south,east,north coordinates.")
        try:
            west, south, east, north = (float(part) for part in parts)
        except ValueError:
            raise ValueError("Bounds must use west,south,east,north coordinates.") from None
        return {"west": west, "south": south, "east": east, "north": north}

    @field_validator("west", "south", "east", "north")
    @classmethod
    def validate_finite_bounds(cls, value):
        if not math.isfinite(value):
            raise ValueError("Bounds must contain finite coordinates.")
        return value

    @model_validator(mode="after")
    def validate_bounds_order(self):
        if self.west >= self.east or self.south >= self.north:
            raise ValueError("Bounds must be ordered west-to-east and south-to-north.")
        return self


def _validate_request_cursor(value: str | None, expected_keys: frozenset[str]):
    if value is None:
        return None
    payload = decode_cursor(value)
    if frozenset(payload) != expected_keys:
        raise ValueError("Invalid pagination cursor.")
    return value


class SearchRequest(BaseModel):
    query: str = Field(default="", max_length=160)
    budget: int | None = Field(default=None, ge=0, le=10_000_000)
    town: str | None = Field(default=None, max_length=80)
    towns: list[str] = Field(default_factory=list, max_length=3)
    flat_type: str | None = Field(default=None, max_length=40)
    bounds: BoundsRequest | None = None
    limit: int = Field(default=50, ge=1, le=200)
    cursor: str | None = Field(default=None, min_length=1, max_length=MAX_CURSOR_LENGTH)
    max_school_distance_m: int | None = Field(default=None, ge=0, le=100_000)
    max_childcare_distance_m: int | None = Field(default=None, ge=0, le=100_000)
    max_care_distance_m: int | None = Field(default=None, ge=0, le=100_000)
    min_floor_area_sqm: float | None = Field(default=None, ge=0, le=1_000, allow_inf_nan=False)
    max_floor_area_sqm: float | None = Field(default=None, ge=0, le=1_000, allow_inf_nan=False)
    min_storey: int | None = Field(default=None, ge=1, le=100)
    max_storey: int | None = Field(default=None, ge=1, le=100)
    min_remaining_lease_years: int | None = Field(default=None, ge=0, le=99)
    observed_after: date | None = None
    max_price_per_sqm: float | None = Field(default=None, ge=0, le=1_000_000, allow_inf_nan=False)
    priority_weights: dict[str, float] | None = None
    place_constraints: list[PlaceConstraint] = Field(default_factory=list, max_length=10)

    @field_validator("cursor")
    @classmethod
    def validate_home_cursor(cls, value):
        return _validate_request_cursor(value, frozenset({"observed_on", "id"}))

    @field_validator("towns", mode="before")
    @classmethod
    def validate_towns(cls, value):
        return _normalize_town_names(value)

    @field_validator("priority_weights", mode="before")
    @classmethod
    def validate_priority_weights(cls, value):
        if value is None:
            return None
        return _normalize_priority_weights(value)

    @field_validator("place_constraints")
    @classmethod
    def reject_duplicate_place_constraints(cls, value):
        return _reject_duplicate_place_constraints(value)

    @model_validator(mode="after")
    def validate_advanced_filter_ranges(self):
        if (
            self.min_floor_area_sqm is not None
            and self.max_floor_area_sqm is not None
            and self.min_floor_area_sqm > self.max_floor_area_sqm
        ):
            raise ValueError("Minimum floor area cannot exceed maximum floor area.")
        if (
            self.min_storey is not None
            and self.max_storey is not None
            and self.min_storey > self.max_storey
        ):
            raise ValueError("Minimum storey cannot exceed maximum storey.")
        return self


MAX_PLANNING_WORKSPACE_BYTES = 112 * 1024
_MAX_PLANNING_JSON_DEPTH = 8
_MAX_PLANNING_JSON_NODES = 10_000
_UNSAFE_PLANNING_KEYS = frozenset(
    {
        "proto",
        "prototype",
        "constructor",
        "file",
        "files",
        "blob",
        "blobs",
        "photo",
        "photos",
        "photourl",
        "photourls",
        "photodata",
        "photodataurl",
        "image",
        "images",
        "imageurl",
        "imageurls",
        "imagedata",
        "imagedataurl",
        "dataurl",
    }
)
_DATETIME_LOCAL_PATTERN = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$"
)


def _validate_planning_json_value(value: object, *, depth: int = 0, nodes=None) -> None:
    if nodes is None:
        nodes = [0]
    nodes[0] += 1
    if nodes[0] > _MAX_PLANNING_JSON_NODES:
        raise ValueError("Planning workspace contains too many values.")
    if depth > _MAX_PLANNING_JSON_DEPTH:
        raise ValueError("Planning workspace data is nested too deeply.")
    if value is None or isinstance(value, bool):
        return
    if isinstance(value, str):
        if "\x00" in value:
            raise ValueError("Planning workspace text cannot contain null characters.")
        if len(value) > 4_000:
            raise ValueError("Planning workspace text must be at most 4000 characters.")
        return
    if isinstance(value, int):
        if abs(value) > 1_000_000_000:
            raise ValueError("Planning workspace numbers are outside the supported range.")
        return
    if isinstance(value, float):
        if not math.isfinite(value) or abs(value) > 1_000_000_000:
            raise ValueError("Planning workspace numbers must be finite and bounded.")
        return
    if isinstance(value, list):
        if len(value) > 100:
            raise ValueError("Planning workspace arrays may contain at most 100 values.")
        for item in value:
            _validate_planning_json_value(item, depth=depth + 1, nodes=nodes)
        return
    if isinstance(value, dict):
        if len(value) > 200:
            raise ValueError("Planning workspace objects may contain at most 200 fields.")
        for key, item in value.items():
            if not isinstance(key, str) or not key or len(key) > 100 or "\x00" in key:
                raise ValueError("Planning workspace object keys must be short text values.")
            normalized_key = key.casefold().replace("_", "").replace("-", "")
            if normalized_key in _UNSAFE_PLANNING_KEYS:
                raise ValueError("Photos and unsafe object keys are not accepted by the planning API.")
            _validate_planning_json_value(item, depth=depth + 1, nodes=nodes)
        return
    raise ValueError("Planning workspace values must be JSON data.")


class PlanningWeights(BaseModel):
    model_config = ConfigDict(extra="forbid")

    budget: float = Field(ge=0, le=100, allow_inf_nan=False)
    space: float = Field(ge=0, le=100, allow_inf_nan=False)
    location: float = Field(ge=0, le=100, allow_inf_nan=False)

    @field_validator("budget", "space", "location", mode="before")
    @classmethod
    def reject_boolean_or_text_weights(cls, value):
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError("Scenario weights must be finite numbers from 0 to 100.")
        return value


class PlanningScenario(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")
    name: str = Field(min_length=1, max_length=100)
    brief: dict[str, Any] = Field(max_length=40)
    weights: PlanningWeights
    createdAt: str = Field(min_length=1, max_length=40)

    @field_validator("name", mode="before")
    @classmethod
    def trim_scenario_name(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("createdAt")
    @classmethod
    def validate_scenario_created_at(cls, value: str) -> str:
        if "T" not in value:
            raise ValueError("createdAt must be an ISO date-time string.")
        try:
            datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            raise ValueError("createdAt must be an ISO date-time string.") from None
        return value


class PlanningRating(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(default="", max_length=80)
    score: StrictInt = Field(ge=1, le=5)


class PlanningDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal['research', 'visit', 'considering', 'ruled-out'] = 'research'
    notes: str = Field(default="", max_length=4_000)
    pros: str = Field(default="", max_length=2_000)
    cons: str = Field(default="", max_length=2_000)
    ratings: list[PlanningRating] = Field(default_factory=list, max_length=20)
    checklist: dict[str, StrictBool] = Field(default_factory=dict, max_length=50)
    visitDate: str | None = Field(default=None, max_length=19)

    @field_validator("visitDate")
    @classmethod
    def validate_visit_date(cls, value: str | None) -> str | None:
        if value in (None, ""):
            return value
        if not _DATETIME_LOCAL_PATTERN.fullmatch(value):
            raise ValueError(
                "visitDate must use the local datetime format YYYY-MM-DDTHH:MM."
            )
        try:
            parsed = datetime.fromisoformat(value)
        except ValueError:
            raise ValueError("visitDate must use the local datetime format YYYY-MM-DDTHH:MM.") from None
        if parsed.tzinfo is not None:
            raise ValueError("visitDate must be a local datetime without a timezone.")
        return value


class PlanningWorkspaceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scenarios: list[PlanningScenario] = Field(default_factory=list, max_length=50)
    decisions: dict[str, PlanningDecision] = Field(default_factory=dict, max_length=200)
    revision: StrictInt = Field(ge=0, le=2_147_483_647)

    @field_validator("decisions", mode="before")
    @classmethod
    def validate_decision_home_ids(cls, value):
        if not isinstance(value, dict):
            raise ValueError("decisions must be an object keyed by home ID.")
        for home_id in value:
            if (
                not isinstance(home_id, str)
                or not home_id.strip()
                or len(home_id) > 160
                or any(ord(character) < 32 for character in home_id)
            ):
                raise ValueError("Decision keys must be bounded home ID strings.")
        return value

    @model_validator(mode="after")
    def validate_workspace_size_and_json(self):
        scenario_ids = [scenario.id for scenario in self.scenarios]
        if len(scenario_ids) != len(set(scenario_ids)):
            raise ValueError("Scenario IDs must be unique within a workspace.")
        payload = self.model_dump(mode="json")
        _validate_planning_json_value(payload)
        encoded = json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
        if len(encoded.encode("utf-8")) > MAX_PLANNING_WORKSPACE_BYTES:
            raise ValueError("Planning workspace must not exceed 112 KiB.")
        return self


class ResourceRequest(BaseModel):
    resource_type: list[str] | None = None
    bounds: BoundsRequest | None = None
    include_unlocated: bool = False
    limit: int = Field(default=500, ge=1, le=2_000)
    cursor: str | None = Field(default=None, min_length=1, max_length=MAX_CURSOR_LENGTH)

    @field_validator("cursor")
    @classmethod
    def validate_resource_cursor(cls, value):
        return _validate_request_cursor(value, frozenset({"resource_type", "name", "id"}))


class ScoreRequest(BaseModel):
    criteria: dict[str, float | None]
    weights: dict[str, float] = Field(default_factory=dict)


class InterpretRequest(BaseModel):
    text: str = Field(min_length=1, max_length=500)


class SaveRequest(BaseModel):
    home_id: str = Field(min_length=1, max_length=80)


class ShortlistOrderRequest(BaseModel):
    ordered_home_ids: list[str] = Field(min_length=1, max_length=200)


class FamilyProfileUpdate(BaseModel):
    adults: int = Field(ge=1, le=30)
    children: int = Field(ge=0, le=30)
    older_adults: int = Field(ge=0, le=30)
    budget_cents: int | None = Field(default=None, ge=0, le=10_000_000_00)
    locale: Literal["en-SG", "zh-SG", "ms-SG", "ta-SG"] = "en-SG"
    priority_weights: dict[str, float] = Field(default_factory=lambda: dict(DEFAULT_WEIGHTS))
    preferred_towns: list[str] = Field(default_factory=list, max_length=3)
    preferred_flat_type: str | None = Field(default=None, max_length=40)
    max_school_distance_m: int | None = Field(default=None, ge=0, le=100_000)
    max_childcare_distance_m: int | None = Field(default=None, ge=0, le=100_000)
    max_care_distance_m: int | None = Field(default=None, ge=0, le=100_000)
    onboarding_completed: StrictBool | None = None

    @field_validator("preferred_towns", mode="before")
    @classmethod
    def validate_preferred_towns(cls, value):
        return _normalize_town_names(value)

    @field_validator("preferred_flat_type")
    @classmethod
    def normalize_preferred_flat_type(cls, value):
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @field_validator("priority_weights", mode="before")
    @classmethod
    def validate_priority_weights(cls, value):
        return _normalize_priority_weights(value)


class InterpretationFilters(SearchRequest):
    pass


class QueryInterpretation(BaseModel):
    filters: InterpretationFilters
    detected_priorities: list[Literal["schools", "childcare", "care_access", "affordability"]] = Field(default_factory=list, max_length=4)
    needs_clarification: bool = False
    clarifying_question: str | None = Field(default=None, max_length=240)


class SummaryObservation(BaseModel):
    text: str = Field(min_length=1, max_length=200)
    evidence_fields: list[Literal["town", "flat_type", "transaction_month", "resale_price", "floor_area_sqm", "storey_range"]] = Field(min_length=1, max_length=3)


class RecordSummary(BaseModel):
    overview: str = Field(min_length=1, max_length=480)
    observations: list[SummaryObservation] = Field(default_factory=list, max_length=4)


class SearchHistoryRequest(BaseModel):
    mode: Literal["structured", "natural_language"]
    criteria: SearchRequest
    scoring_version: str | None = Field(default=None, max_length=60)


class SavedSearchPlaceConstraint(PlaceConstraint):
    model_config = ConfigDict(extra="forbid")


class SavedSearchBounds(BoundsRequest):
    model_config = ConfigDict(extra="forbid")


class SavedSearchCriteria(SearchRequest):
    """Persistable search criteria; cursors are request-time state, never saved."""

    model_config = ConfigDict(extra="forbid")
    bounds: SavedSearchBounds | None = None
    place_constraints: list[SavedSearchPlaceConstraint] = Field(
        default_factory=list, max_length=10
    )

    @model_validator(mode="before")
    @classmethod
    def discard_saved_search_cursor(cls, value):
        if isinstance(value, SearchRequest):
            value = value.model_dump()
        if isinstance(value, Mapping):
            criteria = dict(value)
            criteria["cursor"] = None
            return criteria
        return value


class SavedSearchSourceSummary(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    source_id: str = Field(alias="sourceId", min_length=1, max_length=80)
    source_version: str | None = Field(
        default=None, alias="sourceVersion", max_length=120
    )
    retrieved_at: datetime = Field(alias="retrievedAt")


class SavedSearchResultMeta(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    data_mode: Literal["live", "fixture", "mixed", "error"] = Field(
        alias="dataMode"
    )
    retrieved_at: datetime = Field(alias="retrievedAt")
    source_summary: list[SavedSearchSourceSummary] = Field(
        default_factory=list, alias="sourceSummary", max_length=20
    )
    warnings: list[Annotated[str, Field(max_length=240)]] = Field(
        default_factory=list, max_length=20
    )
    count: StrictInt = Field(ge=0)
    total: StrictInt = Field(ge=0)
    score_policy_version: str | None = Field(
        default=None, alias="scorePolicyVersion", max_length=60
    )


class SavedSearchCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=80)
    mode: Literal["structured", "natural_language"]
    criteria: SavedSearchCriteria
    priority_weights: dict[str, float] | None = None
    place_constraints: list[SavedSearchPlaceConstraint] | None = Field(
        default=None, max_length=10
    )
    scoring_version: str | None = Field(default=None, max_length=60)
    last_run_at: datetime | None = None
    last_source_snapshot_ids: list[UUID] | None = Field(default=None, max_length=20)
    last_result_meta: SavedSearchResultMeta | None = None

    @field_validator("name", mode="before")
    @classmethod
    def trim_saved_search_name(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("priority_weights", mode="before")
    @classmethod
    def validate_saved_search_priority_weights(cls, value):
        if value is None:
            return None
        return _normalize_priority_weights(value)

    @field_validator("place_constraints")
    @classmethod
    def reject_duplicate_saved_search_place_constraints(cls, value):
        if value is None:
            return None
        return _reject_duplicate_place_constraints(value)

    @model_validator(mode="after")
    def align_search_and_saved_snapshots(self):
        criteria_weights = self.criteria.priority_weights
        if (
            self.priority_weights is not None
            and criteria_weights is not None
            and self.priority_weights != criteria_weights
        ):
            raise ValueError("Saved-search weights must match its search criteria.")
        if self.priority_weights is None:
            self.priority_weights = criteria_weights or dict(DEFAULT_WEIGHTS)
        if criteria_weights is None:
            self.criteria = self.criteria.model_copy(
                update={"priority_weights": self.priority_weights}
            )

        criteria_places = self.criteria.place_constraints
        if self.place_constraints is None:
            self.place_constraints = criteria_places
        elif criteria_places and self.place_constraints != criteria_places:
            raise ValueError("Saved-search places must match its search criteria.")
        elif not criteria_places:
            self.criteria = self.criteria.model_copy(
                update={"place_constraints": self.place_constraints}
            )
        return self


class SavedSearchScorePolicy(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    priority_weights: dict[str, float] = Field(
        default_factory=lambda: {
            criterion: float(weight)
            for criterion, weight in DEFAULT_WEIGHTS.items()
        },
        alias="priorityWeights",
    )
    scoring_version: str | None = Field(
        default=None, alias="scoringVersion", max_length=60
    )

    @field_validator("priority_weights", mode="before")
    @classmethod
    def validate_saved_search_policy_weights(cls, value):
        if value is None:
            return {
                criterion: float(weight)
                for criterion, weight in DEFAULT_WEIGHTS.items()
            }
        return _normalize_priority_weights(value)


class SavedSearchPlace(SavedSearchPlaceConstraint):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    place_id: UUID = Field(alias="placeId")
    max_distance_m: int = Field(alias="maxDistanceM", ge=0, le=100_000)


class SavedSearchRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    id: UUID
    name: str = Field(min_length=1, max_length=80)
    mode: Literal["structured", "natural_language"]
    criteria: SavedSearchCriteria
    places: list[SavedSearchPlace] = Field(default_factory=list, max_length=10)
    score_policy: SavedSearchScorePolicy = Field(alias="scorePolicy")
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")
    last_run_at: datetime | None = Field(default=None, alias="lastRunAt")
    last_source_snapshot_ids: list[UUID] = Field(
        default_factory=list, alias="lastSourceSnapshotIds", max_length=20
    )
    last_result_meta: SavedSearchResultMeta | None = Field(
        default=None, alias="lastResultMeta"
    )


def serialize_saved_search_record(record: SavedSearchRecord) -> dict[str, object]:
    """Serialize a validated saved-search record using the API wire names."""
    return record.model_dump(mode="json", by_alias=True)


class PlaceKind(str, Enum):
    workplace = "workplace"
    school = "school"
    childcare = "childcare"
    elder_care = "elder-care"
    other = "other"


class GuestSyncModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class GuestSyncBrief(GuestSyncModel):
    adults: StrictInt | None = Field(default=None, ge=1, le=30)
    children: StrictInt | None = Field(default=None, ge=0, le=30)
    older_adults: StrictInt | None = Field(
        default=None, alias="olderAdults", ge=0, le=30
    )
    budget_cents: StrictInt | None = Field(
        default=None, alias="budgetCents", ge=0, le=10_000_000_00
    )
    locale: Literal["en-SG", "zh-SG", "ms-SG", "ta-SG"] | None = None
    priority_weights: dict[str, float] | None = Field(
        default=None, alias="priorityWeights"
    )

    @field_validator("priority_weights", mode="before")
    @classmethod
    def validate_priority_weights(cls, value):
        if value is None:
            return None
        normalized = _normalize_priority_weights(value)
        return {criterion: normalized[criterion] for criterion in value}


class GuestSyncBounds(GuestSyncModel):
    west: float = Field(ge=-180, le=180)
    south: float = Field(ge=-90, le=90)
    east: float = Field(ge=-180, le=180)
    north: float = Field(ge=-90, le=90)

    @field_validator("west", "south", "east", "north", mode="before")
    @classmethod
    def require_numeric_coordinates(cls, value):
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError("Bounds must contain numeric coordinates.")
        return value

    @field_validator("west", "south", "east", "north")
    @classmethod
    def validate_finite_guest_bounds(cls, value):
        if not math.isfinite(value):
            raise ValueError("Bounds must contain finite coordinates.")
        return value

    @model_validator(mode="after")
    def validate_guest_bounds_order(self):
        if self.west >= self.east or self.south >= self.north:
            raise ValueError("Bounds must be ordered west-to-east and south-to-north.")
        return self


class GuestSyncPlaceConstraint(GuestSyncModel):
    place_id: UUID
    max_distance_m: StrictInt = Field(ge=0, le=100_000)


class GuestSyncSearchCriteria(GuestSyncModel):
    query: str = Field(default="", max_length=160)
    budget: StrictInt | None = Field(default=None, ge=0, le=10_000_000)
    town: str | None = Field(default=None, max_length=80)
    flat_type: str | None = Field(default=None, max_length=40)
    bounds: GuestSyncBounds | None = None
    limit: StrictInt = Field(default=50, ge=1, le=200)
    cursor: str | None = Field(default=None, min_length=1, max_length=MAX_CURSOR_LENGTH)
    max_school_distance_m: StrictInt | None = Field(default=None, ge=0, le=100_000)
    max_childcare_distance_m: StrictInt | None = Field(default=None, ge=0, le=100_000)
    max_care_distance_m: StrictInt | None = Field(default=None, ge=0, le=100_000)
    priority_weights: dict[str, float] | None = None
    place_constraints: list[GuestSyncPlaceConstraint] = Field(
        default_factory=list, max_length=10
    )

    @field_validator("cursor")
    @classmethod
    def validate_guest_history_cursor(cls, value):
        return _validate_request_cursor(value, frozenset({"observed_on", "id"}))

    @field_validator("priority_weights", mode="before")
    @classmethod
    def validate_guest_priority_weights(cls, value):
        if value is None:
            return None
        return _normalize_priority_weights(value)

    @field_validator("place_constraints")
    @classmethod
    def reject_duplicate_guest_place_constraints(cls, value):
        place_ids = [constraint.place_id for constraint in value]
        if len(place_ids) != len(set(place_ids)):
            raise ValueError("A place may appear only once in search constraints.")
        return value


class GuestSyncHistoryEntry(GuestSyncModel):
    mode: Literal["structured", "natural_language"]
    criteria: GuestSyncSearchCriteria
    source_snapshot_ids: list[UUID] = Field(
        default_factory=list, alias="sourceSnapshotIds", max_length=20
    )
    scoring_version: str | None = Field(
        default=None, alias="scoringVersion", max_length=60
    )

    @field_validator("source_snapshot_ids")
    @classmethod
    def deduplicate_source_snapshot_ids(cls, values):
        return list(dict.fromkeys(values))


class GuestSyncPlace(GuestSyncModel):
    label: str = Field(min_length=1, max_length=80)
    address: str | None = Field(default=None, max_length=240)
    latitude: float = Field(
        ge=SINGAPORE_PLACE_LATITUDE_MIN,
        le=SINGAPORE_PLACE_LATITUDE_MAX,
    )
    longitude: float = Field(
        ge=SINGAPORE_PLACE_LONGITUDE_MIN,
        le=SINGAPORE_PLACE_LONGITUDE_MAX,
    )
    maximum_distance_m: StrictInt | None = Field(
        default=None, alias="maximumDistanceM", ge=1, le=100_000
    )
    kind: PlaceKind = PlaceKind.other

    @field_validator("label", mode="before")
    @classmethod
    def trim_guest_place_label(cls, value):
        if isinstance(value, str):
            value = value.strip()
            if not value:
                raise ValueError("A place label is required.")
        return value

    @field_validator("address", mode="before")
    @classmethod
    def trim_guest_place_address(cls, value):
        if isinstance(value, str):
            value = value.strip()
            return value or None
        return value

    @field_validator("latitude", "longitude", mode="before")
    @classmethod
    def require_numeric_guest_coordinates(cls, value):
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError("Coordinates must be numeric.")
        return value

    @field_validator("latitude", "longitude")
    @classmethod
    def validate_finite_guest_coordinates(cls, value):
        if not math.isfinite(value):
            raise ValueError("Coordinates must be finite numbers.")
        return value

    @model_validator(mode="after")
    def validate_guest_place_geofence(self):
        if not any(
            _point_in_polygon(self.latitude, self.longitude, polygon)
            for polygon in SINGAPORE_PLACE_GEOFENCE
        ):
            raise ValueError("Coordinates must fall inside the Singapore place geofence.")
        return self


GuestHomeId = Annotated[
    str,
    Field(
        strict=True,
        min_length=1,
        max_length=80,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$",
    ),
]


class GuestSyncRequest(GuestSyncModel):
    sync_key: str = Field(
        min_length=1,
        max_length=128,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$",
    )
    brief: GuestSyncBrief | None = None
    shortlist_home_ids: list[GuestHomeId] = Field(
        default_factory=list, alias="shortlistHomeIds", max_length=200
    )
    compare_home_ids: list[GuestHomeId] = Field(
        default_factory=list, alias="compareHomeIds", max_length=3
    )
    history: list[GuestSyncHistoryEntry] = Field(default_factory=list, max_length=100)
    places: list[GuestSyncPlace] | None = Field(default=None, max_length=20)
    confirm_places: StrictBool = Field(default=False, alias="confirmPlaces")
    confirm_brief: StrictBool = Field(default=False, alias="confirmBrief")

    @field_validator("shortlist_home_ids", "compare_home_ids")
    @classmethod
    def deduplicate_home_ids(cls, values):
        return list(dict.fromkeys(values))


class PlaceSuggestionRequest(BaseModel):
    query: str = Field(min_length=1, max_length=160)

    @field_validator("query", mode="before")
    @classmethod
    def require_nonblank_query(cls, value):
        if isinstance(value, str):
            value = value.strip()
            if not value:
                raise ValueError("A place search query is required.")
        return value


class PersonalPlaceRequest(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    address: str | None = Field(default=None, max_length=240)
    latitude: float = Field(
        ge=SINGAPORE_PLACE_LATITUDE_MIN,
        le=SINGAPORE_PLACE_LATITUDE_MAX,
    )
    longitude: float = Field(
        ge=SINGAPORE_PLACE_LONGITUDE_MIN,
        le=SINGAPORE_PLACE_LONGITUDE_MAX,
    )
    maximum_distance_m: int | None = Field(default=None, ge=1, le=100_000)
    kind: PlaceKind = PlaceKind.other
    geocode_source: Literal["OneMap", "manual"] | None = None
    geocoded_at: datetime | None = None
    selection_token: str | None = Field(default=None, min_length=64, max_length=64)

    @field_validator("latitude", "longitude")
    @classmethod
    def validate_finite_coordinates(cls, value):
        if not math.isfinite(value):
            raise ValueError("Coordinates must be finite numbers.")
        return value

    @model_validator(mode="after")
    def validate_singapore_place_coordinates(self):
        if not any(
            _point_in_polygon(self.latitude, self.longitude, polygon)
            for polygon in SINGAPORE_PLACE_GEOFENCE
        ):
            raise ValueError("Coordinates must fall inside the Singapore place geofence.")
        return self

    @field_validator("label", mode="before")
    @classmethod
    def require_nonblank_label(cls, value):
        if isinstance(value, str):
            value = value.strip()
            if not value:
                raise ValueError("A place label is required.")
        return value


class ApiError(BaseModel):
    code: str
    message: str
