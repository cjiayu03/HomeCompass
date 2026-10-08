from __future__ import annotations

from pydantic import BaseModel, Field
from typing import Literal


class SearchRequest(BaseModel):
    query: str = Field(default="", max_length=160)
    budget: int | None = Field(default=None, ge=0, le=10_000_000)
    town: str | None = Field(default=None, max_length=80)
    flat_type: str | None = Field(default=None, max_length=40)
    max_school_distance_m: int | None = Field(default=None, ge=0, le=100_000)
    max_childcare_distance_m: int | None = Field(default=None, ge=0, le=100_000)
    max_care_distance_m: int | None = Field(default=None, ge=0, le=100_000)


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


class PersonalPlaceRequest(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    address: str | None = Field(default=None, max_length=240)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    maximum_distance_m: int | None = Field(default=None, ge=1, le=100_000)


class ApiError(BaseModel):
    code: str
    message: str
