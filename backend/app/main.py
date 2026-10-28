from __future__ import annotations

import hashlib
import hmac
import json
import os
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID, uuid4

import asyncpg
import httpx
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from . import database
from .ai import gemini_configuration_ready, interpret_query, summarize_record
from .contracts import live_result_metadata
from .database import (
    close_pool,
    ensure_profile,
    ensure_user,
    get_priority_weights,
    open_pool,
    replace_priority_weights,
    require_pool,
)
from .domain import weighted_score
from .onemap import OneMapProviderError, search_address_candidates
from .pagination import MAX_CURSOR_LENGTH, decode_cursor, encode_cursor
from .local_auth import (
    hash_password,
    hash_session_token,
    new_session_token,
    normalize_email,
    validate_password,
    verify_password,
)
from .rate_limit import RateLimiter
from .readiness import readiness_snapshot
from .scoring import DEFAULT_WEIGHTS, POLICY_VERSION, score_home_evidence
from . import saved_searches as saved_search_service
from .planning import router as planning_router
from .schemas import (
    AuthCredentials,
    FamilyProfileUpdate,
    GuestSyncRequest,
    InterpretRequest,
    PersonalPlaceRequest,
    PasswordChangeRequest,
    PlaceSuggestionRequest,
    ResourceRequest,
    SaveRequest,
    SavedSearchCreate,
    ScoreRequest,
    SearchHistoryRequest,
    SearchRequest,
    ShortlistOrderRequest,
)
from .security import (
    InvalidSessionError,
    SESSION_COOKIE_NAME,
    is_configured_value,
    rate_limit_key,
    require_active_user,
    require_user,
    resolve_session_token,
    session_cookie_secure,
)
from .sources.data_gov_sg import HDB_RESALE_DATASET_ID
from .sources.data_gov_resources import SOURCES as RESOURCE_SOURCES
from .sync import merge_guest_data
from .local_env import load_local_project_env

load_local_project_env()
APP_NAME = os.getenv("APP_NAME", "HomeCompass")
_DEFAULT_DISTANCE_TARGETS = {"school": 1_500, "childcare": 2_000, "care": 2_000}
ai_interpret_limiter: RateLimiter | None = None
auth_rate_limiter: RateLimiter | None = None
SESSION_LIFETIME = timedelta(days=30)
SESSION_MAX_AGE_SECONDS = int(SESSION_LIFETIME.total_seconds())
_STATE_CHANGING_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
_ALLOWED_ORIGINS = tuple(
    origin.strip().rstrip("/")
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
)
if "*" in _ALLOWED_ORIGINS:
    raise RuntimeError("CORS_ORIGINS must contain explicit origins when credentials are enabled.")

_LATEST_RESOURCE_CTE = """WITH latest_resource_sources AS (
    SELECT DISTINCT ON (source_id) id FROM source_snapshot
    WHERE status IN ('valid','degraded') ORDER BY source_id,retrieved_at DESC
)"""

_HOME_EVIDENCE_JOINS = """
LEFT JOIN LATERAL (
  SELECT r.name, ST_Distance(h.geometry::geography,r.geometry::geography) AS distance_m
  FROM neighbourhood_resource r JOIN latest_resource_sources latest ON latest.id=r.source_snapshot_id
  WHERE r.resource_type='moe_school' AND r.geometry IS NOT NULL AND h.geometry IS NOT NULL
  ORDER BY h.geometry::geography <-> r.geometry::geography LIMIT 1
) school_access ON TRUE
LEFT JOIN LATERAL (
  SELECT r.name, ST_Distance(h.geometry::geography,r.geometry::geography) AS distance_m
  FROM neighbourhood_resource r JOIN latest_resource_sources latest ON latest.id=r.source_snapshot_id
  WHERE r.resource_type IN ('childcare','kindergarten') AND r.geometry IS NOT NULL AND h.geometry IS NOT NULL
  ORDER BY h.geometry::geography <-> r.geometry::geography LIMIT 1
) childcare_access ON TRUE
LEFT JOIN LATERAL (
  SELECT r.name, ST_Distance(h.geometry::geography,r.geometry::geography) AS distance_m
  FROM neighbourhood_resource r JOIN latest_resource_sources latest ON latest.id=r.source_snapshot_id
  WHERE r.resource_type IN ('chas_clinic','dementia_gtp') AND r.geometry IS NOT NULL AND h.geometry IS NOT NULL
  ORDER BY h.geometry::geography <-> r.geometry::geography LIMIT 1
) care_access ON TRUE
"""


def _distance_label(record, name_key: str, distance_key: str, pending: str) -> str:
    if record["latitude"] is None:
        return "Home location is not matched yet"
    name = record[name_key]
    distance = record[distance_key]
    if name is None or distance is None:
        return pending
    return f"{name} · {round(float(distance)):,} m straight-line"


async def _optional_active_user(
    request: Request,
) -> dict | None:
    if not request.cookies.get(SESSION_COOKIE_NAME):
        return None
    user = await require_user(request)
    return await require_active_user(user)


def _get_ai_interpret_limiter() -> RateLimiter:
    global ai_interpret_limiter
    if ai_interpret_limiter is None:
        ai_interpret_limiter = RateLimiter()
    return ai_interpret_limiter


def _get_auth_rate_limiter() -> RateLimiter:
    global auth_rate_limiter
    if auth_rate_limiter is None:
        auth_rate_limiter = RateLimiter(max_requests=10, window_seconds=60)
    return auth_rate_limiter


def _check_auth_rate_limit(request: Request, email: str | None = None) -> None:
    limiter = _get_auth_rate_limiter()
    limiter.check(f"auth-ip:{rate_limit_key(None, request)}")
    if email:
        email_hash = hashlib.sha256(email.encode("utf-8")).hexdigest()
        limiter.check(f"auth-email:{email_hash}")


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=SESSION_MAX_AGE_SECONDS,
        path="/",
        secure=session_cookie_secure(),
        httponly=True,
        samesite="lax",
    )


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        path="/",
        secure=session_cookie_secure(),
        httponly=True,
        samesite="lax",
    )


def _storage_unavailable() -> HTTPException:
    return HTTPException(
        status_code=503,
        detail={
            "code": "DATABASE_UNAVAILABLE",
            "message": "Persistent storage is unavailable. Please try again.",
        },
    )


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global APP_NAME, ai_interpret_limiter, auth_rate_limiter
    load_local_project_env()
    APP_NAME = os.getenv("APP_NAME", APP_NAME)
    _app.title = APP_NAME
    ai_interpret_limiter = RateLimiter()
    auth_rate_limiter = RateLimiter(max_requests=10, window_seconds=60)
    await open_pool()
    try:
        yield
    finally:
        await close_pool()


app = FastAPI(title=APP_NAME, version="1.0.0", description="Evidence-led family home search API", lifespan=lifespan)
app.include_router(planning_router)
market_router = APIRouter(prefix="/api/v1/market", tags=["market"])
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(_ALLOWED_ORIGINS),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type"],
)


@app.exception_handler(InvalidSessionError)
async def clear_invalid_session_cookie(_request: Request, exc: InvalidSessionError):
    response = JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    _clear_session_cookie(response)
    return response


@app.middleware("http")
async def enforce_state_change_origin(request: Request, call_next):
    if request.method in _STATE_CHANGING_METHODS:
        origin_header = request.headers.get("origin")
        origin = origin_header.rstrip("/") if origin_header else None
        has_session_cookie = bool(request.cookies.get(SESSION_COOKIE_NAME))
        if (
            (origin is not None and origin not in _ALLOWED_ORIGINS)
            or (origin is None and has_session_cookie)
        ):
            return JSONResponse(
                status_code=403,
                content={
                    "detail": {
                        "code": "INVALID_ORIGIN",
                        "message": "This request origin is not allowed.",
                    }
                },
            )
    return await call_next(request)


def _score_home(record, *, budget_cents=None, weights=None, distance_targets=None) -> dict:
    targets = {
        name: (distance_targets or {}).get(name, default)
        for name, default in _DEFAULT_DISTANCE_TARGETS.items()
    }
    targets["affordability"] = budget_cents
    evidence = {
        "school": record["school_distance_m"],
        "childcare": record["childcare_distance_m"],
        "care": record["care_distance_m"],
        "affordability": record["price_observation_cents"],
    }
    return score_home_evidence(evidence, weights, targets)


def _home(record, score=None) -> dict:
    price_cents = record["price_observation_cents"]
    source_version = record["source_version"]
    floor_area_sqm = record["floor_area_sqm"]
    storey_range = _optional_record_value(record, "storey_range")
    lease_commence_year = _optional_record_value(record, "lease_commence_year")
    as_of_year = datetime.now(timezone.utc).year
    remaining_lease_years = _estimated_remaining_lease_years(
        lease_commence_year, as_of_year=as_of_year
    )
    price_per_sqm = (
        round((float(price_cents) / 100) / float(floor_area_sqm), 2)
        if price_cents is not None and floor_area_sqm is not None and float(floor_area_sqm) > 0
        else None
    )
    score_details = score if score is not None else _score_home(record, weights=DEFAULT_WEIGHTS)
    return {
        "id": record["id"],
        "address": record["address"],
        "town": record["town"],
        "type": record["flat_type"],
        "price": float(price_cents / 100) if price_cents is not None else None,
        "score": score_details["score"],
        "scoreDetails": {
            "coverage": score_details["coverage"],
            "components": score_details["components"],
            "missingEvidence": score_details["missingEvidence"],
            "policyVersion": score_details["policyVersion"],
            "scoredAt": score_details["scoredAt"],
        },
        "lat": record["latitude"],
        "lng": record["longitude"],
        "source": f"data.gov.sg · {record['source_id']}",
        "sourceUpdated": source_version or (record["retrieved_at"].date().isoformat() if record["retrieved_at"] else None),
        "sourceSemantics": record["source_semantics"],
        "geocodeSource": record["geometry_source"],
        "geocodedAt": record["geocoded_at"].isoformat() if record["geocoded_at"] else None,
        "school": _distance_label(record, "school_name", "school_distance_m", "No geocoded school in the current source snapshot"),
        "childcare": _distance_label(record, "childcare_name", "childcare_distance_m", "No geocoded childcare location in the current source snapshot"),
        "care": _distance_label(record, "care_name", "care_distance_m", "No geocoded clinic or care point in the current source snapshot"),
        "amenityDistancesM": {
            name: float(value) if value is not None else None
            for name in ('school', 'childcare', 'care')
            for value in [_optional_record_value(record, f'{name}_distance_m')]
        },
        "risk": "Location needed for cluster check" if record["latitude"] is None else "Inside a published active dengue-cluster polygon" if record["in_dengue_cluster"] else "No published cluster overlap",
        "highlights": [],
        "risks": ["Historical resale transaction; not a current listing"],
        "floorAreaSqm": float(floor_area_sqm) if floor_area_sqm is not None else None,
        "storeyRange": storey_range,
        "leaseCommenceDate": lease_commence_year,
        "remainingLeaseYears": remaining_lease_years,
        "remainingLeaseYearsEstimated": remaining_lease_years is not None,
        "remainingLeaseEstimateAsOfYear": as_of_year if remaining_lease_years is not None else None,
        "remainingLeaseEstimateMethod": (
            "99-year lease minus elapsed whole calendar years from the year-only commencement value"
            if remaining_lease_years is not None
            else None
        ),
        "pricePerSqm": price_per_sqm,
        "observedOn": record["observed_on"].isoformat() if record["observed_on"] else None,
        "geocodeStatus": record["geocode_status"],
    }


def _optional_record_value(record, key: str):
    try:
        return record[key]
    except (KeyError, IndexError, TypeError):
        return None


def _estimated_remaining_lease_years(lease_commence_year, *, as_of_year: int) -> int | None:
    if lease_commence_year is None:
        return None
    try:
        commencement_year = int(lease_commence_year)
    except (TypeError, ValueError, OverflowError):
        return None
    if commencement_year < 1900 or commencement_year > as_of_year + 1:
        return None
    elapsed_whole_calendar_years = max(0, as_of_year - commencement_year)
    return max(0, min(99, 99 - elapsed_whole_calendar_years))


def _latest_source_rows(rows) -> list:
    """Return one newest snapshot row per source, in stable source order."""
    latest = {}
    for row in rows:
        source_id = row["source_id"]
        if source_id not in latest or row["retrieved_at"] > latest[source_id]["retrieved_at"]:
            latest[source_id] = row
    return [latest[source_id] for source_id in sorted(latest)]


def _source_summary(rows) -> list[dict]:
    """Describe the newest source snapshot represented in returned rows."""
    return [
        {
            "sourceId": row["source_id"],
            "sourceVersion": row["source_version"],
            "retrievedAt": row["retrieved_at"].isoformat(),
        }
        for row in _latest_source_rows(rows)
    ]


def _result_source_snapshot_ids(rows) -> list[str]:
    """Identify the snapshots represented by the result's source summary."""
    snapshot_ids = []
    for row in _latest_source_rows(rows):
        try:
            snapshot_id = row["source_snapshot_id"]
        except (KeyError, IndexError):
            continue
        if snapshot_id is not None:
            snapshot_ids.append(str(snapshot_id))
    return snapshot_ids[:20]


def _validated_query_model(model, **values):
    try:
        return model.model_validate(values)
    except ValidationError as error:
        invalid_bounds = any("bounds" in item.get("loc", ()) for item in error.errors())
        if invalid_bounds:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "INVALID_BOUNDS",
                    "message": "Bounds must be ordered and use valid longitude/latitude coordinates.",
                },
            ) from None
        raise HTTPException(
            status_code=422,
            detail={"code": "INVALID_QUERY", "message": "One or more query parameters are invalid."},
        ) from None


def _storey_overlap_predicates(request: SearchRequest, values: list[object]) -> list[str]:
    """Build safe inclusive interval predicates for a validated search request."""
    if request.min_storey is None and request.max_storey is None:
        return []

    band = "btrim(h.storey_range, ' ')"
    # Check every character as well as the anchored pattern: a trailing newline
    # must not be accepted even if a regex engine treats it as an end anchor.
    valid_format = (
        f"({band} ~ '^[0-9]{{1,3}} +TO +[0-9]{{1,3}}$' "
        f"AND {band} !~ '[^0-9 TO]')"
    )
    low = f"(CASE WHEN {valid_format} THEN substring({band} FROM '^[0-9]{{1,3}}')::integer END)"
    high = f"(CASE WHEN {valid_format} THEN substring({band} FROM '[0-9]{{1,3}}$')::integer END)"
    predicates = [f"({low} BETWEEN 1 AND {high})"]
    if request.min_storey is not None:
        values.append(request.min_storey)
        predicates.append(f"{high} >= ${len(values)}")
    if request.max_storey is not None:
        values.append(request.max_storey)
        predicates.append(f"{low} <= ${len(values)}")
    return predicates


async def _query_homes(
    request: SearchRequest,
    priority_weights=None,
    *,
    user_id=None,
    include_place_distances=False,
):
    pool = require_pool()
    predicates: list[str] = []
    values: list[object] = []

    def add(column: str, operator: str, value: object) -> None:
        values.append(value)
        predicates.append(f"{column} {operator} ${len(values)}")

    if request.query.strip():
        add("(h.address ILIKE", "", f"%{request.query.strip()}%")
        # The expression predicate has its closing parenthesis attached separately to avoid interpolating user input.
        predicates[-1] = f"(h.address ILIKE ${len(values)} OR h.town ILIKE ${len(values)} OR h.flat_type ILIKE ${len(values)})"
    if request.budget is not None:
        add("h.price_observation_cents", "<=", request.budget * 100)
    if request.towns:
        values.append(request.towns)
        predicates.append(f"h.town = ANY(${len(values)}::text[])")
    elif request.town:
        add("h.town", "ILIKE", request.town)
    if request.flat_type:
        add("h.flat_type", "ILIKE", request.flat_type)
    if request.min_floor_area_sqm is not None:
        values.append(Decimal(str(request.min_floor_area_sqm)))
        predicates.append(f"h.floor_area_sqm >= ${len(values)}::numeric")
    if request.max_floor_area_sqm is not None:
        values.append(Decimal(str(request.max_floor_area_sqm)))
        predicates.append(f"h.floor_area_sqm <= ${len(values)}::numeric")
    predicates.extend(_storey_overlap_predicates(request, values))
    if request.min_remaining_lease_years is not None:
        as_of_year = datetime.now(timezone.utc).year
        values.extend([as_of_year, request.min_remaining_lease_years])
        year_param = len(values) - 1
        lease_param = len(values)
        estimated_lease_sql = (
            f"LEAST(99, GREATEST(0, 99 - "
            f"GREATEST(0, ${year_param} - h.lease_commence_year)))"
        )
        predicates.append(f"h.lease_commence_year BETWEEN 1900 AND ${year_param} + 1 AND {estimated_lease_sql} >= ${lease_param}")
    if request.observed_after is not None:
        add("h.observed_on", ">=", request.observed_after)
    if request.max_price_per_sqm is not None:
        values.append(Decimal(str(request.max_price_per_sqm)))
        predicates.append(
            "(h.price_observation_cents::numeric / "
            "NULLIF(h.floor_area_sqm, 0)::numeric / 100) "
            f"<= ${len(values)}::numeric"
        )
    location_checks = []
    for maximum, resource_types in [
        (request.max_school_distance_m, ['moe_school']),
        (request.max_childcare_distance_m, ['childcare', 'kindergarten']),
        (request.max_care_distance_m, ['chas_clinic', 'dementia_gtp']),
    ]:
        if maximum is not None:
            values.extend([resource_types, maximum])
            location_checks.append(f"""EXISTS (
                SELECT 1 FROM neighbourhood_resource r
                JOIN latest_resource_sources latest ON latest.id=r.source_snapshot_id
                WHERE r.resource_type = ANY(${len(values)-1}::text[])
                  AND r.geometry IS NOT NULL
                  AND ST_DWithin(r.geometry::geography, location.geometry::geography, ${len(values)}::double precision)
            )""")
    location_cte = ''
    if location_checks:
        location_cte = f""", candidate_locations AS MATERIALIZED (
            SELECT DISTINCT geometry FROM candidate_home WHERE geometry IS NOT NULL
        ), matching_locations AS MATERIALIZED (
            SELECT location.geometry FROM candidate_locations location
            WHERE {' AND '.join(location_checks)}
        )"""
        predicates.append('h.geometry IN (SELECT geometry FROM matching_locations)')
    if request.bounds is not None:
        values.extend([
            request.bounds.west,
            request.bounds.south,
            request.bounds.east,
            request.bounds.north,
        ])
        west_param, south_param, east_param, north_param = range(len(values) - 3, len(values) + 1)
        predicates.append(
            f"ST_Intersects(h.geometry, ST_MakeEnvelope(${west_param},${south_param},${east_param},${north_param},4326))"
        )

    place_cte = ""
    place_joins = ""
    place_distances_select = "'[]'::jsonb AS place_distances"
    if request.place_constraints:
        if user_id is None:
            raise HTTPException(status_code=401, detail={"code": "AUTH_REQUIRED", "message": "Sign in to search using saved places."})
        values.extend([
            [constraint.place_id for constraint in request.place_constraints],
            [constraint.max_distance_m for constraint in request.place_constraints],
            user_id,
        ])
        place_ids_param = len(values) - 2
        place_distances_param = len(values) - 1
        place_user_param = len(values)
        place_cte = f""", selected_place_constraints AS (
                  SELECT requested.place_id, requested.maximum_distance_m
                  FROM unnest(${place_ids_param}::uuid[], ${place_distances_param}::integer[])
                       AS requested(place_id, maximum_distance_m)
                )"""
        place_distances_select = "place_constraint_result.place_distances AS place_distances"
        place_joins = f"""
LEFT JOIN LATERAL (
  SELECT jsonb_agg(jsonb_build_object(
           'placeId', p.id::text,
           'label', p.label,
           'distanceM', CASE WHEN h.geometry IS NULL OR p.geometry IS NULL THEN NULL
                             ELSE ST_Distance(h.geometry::geography,p.geometry::geography) END,
           'maximumDistanceM', selected.maximum_distance_m,
           'method', 'straight-line'
         ) ORDER BY p.id) FILTER (WHERE p.id IS NOT NULL) AS place_distances,
         (COUNT(p.id) = COUNT(*)) AND COALESCE(
           bool_and(CASE WHEN p.id IS NULL OR h.geometry IS NULL OR p.geometry IS NULL THEN FALSE
                                ELSE ST_Distance(h.geometry::geography,p.geometry::geography) <= selected.maximum_distance_m END), FALSE)
           AS every_place_matches
  FROM selected_place_constraints selected
  LEFT JOIN personal_place p ON p.id=selected.place_id AND p.user_id=${place_user_param}
) place_constraint_result ON TRUE"""
        predicates.append("place_constraint_result.every_place_matches IS TRUE")

    where = f"WHERE {' AND '.join(predicates)}" if predicates else ""
    count_values = list(values)
    count_sql = _LATEST_RESOURCE_CTE + location_cte + place_cte + f""" SELECT count(*) AS total
             FROM candidate_home h
             {place_joins}
             {where}"""

    cursor_filter = ""
    if request.cursor is not None:
        cursor = decode_cursor(request.cursor)
        observed_on = date.fromisoformat(cursor["observed_on"]) if cursor["observed_on"] else None
        if observed_on is None:
            values.append(cursor["id"])
            cursor_filter = f"h.observed_on IS NULL AND h.id::text > ${len(values)}"
        else:
            values.extend([observed_on, cursor["id"]])
            observed_on_param = len(values) - 1
            id_param = len(values)
            cursor_filter = (
                f"(h.observed_on < ${observed_on_param} OR h.observed_on IS NULL"
                f" OR (h.observed_on = ${observed_on_param} AND h.id::text > ${id_param}))"
            )
    page_where = where
    if cursor_filter:
        page_where = f"{where} AND {cursor_filter}" if where else f"WHERE {cursor_filter}"
    values.append(request.limit + 1)
    limit_placeholder = len(values)
    sql = _LATEST_RESOURCE_CTE + location_cte + place_cte + f""", page_homes AS MATERIALIZED (
             SELECT h.* FROM candidate_home h {place_joins}
             {page_where} ORDER BY h.observed_on DESC NULLS LAST, h.id LIMIT ${limit_placeholder}
         ) SELECT h.id, h.address, h.town, h.flat_type, h.price_observation_cents, h.observed_on,
                    h.source_semantics, h.floor_area_sqm, h.storey_range, h.lease_commence_year,
                    h.geocode_status, h.geometry_source, h.geocoded_at,
                    CASE WHEN h.geometry IS NULL THEN NULL ELSE ST_Y(h.geometry) END AS latitude,
                    CASE WHEN h.geometry IS NULL THEN NULL ELSE ST_X(h.geometry) END AS longitude,
                    {place_distances_select},
                    school_access.name AS school_name, school_access.distance_m AS school_distance_m,
                    childcare_access.name AS childcare_name, childcare_access.distance_m AS childcare_distance_m,
                    care_access.name AS care_name, care_access.distance_m AS care_distance_m,
                    CASE WHEN h.geometry IS NULL THEN FALSE ELSE EXISTS (
                      SELECT 1 FROM neighbourhood_resource r JOIN latest_resource_sources latest ON latest.id=r.source_snapshot_id
                      WHERE r.resource_type='dengue_cluster' AND r.geometry IS NOT NULL AND ST_Intersects(h.geometry,r.geometry)
                    ) END AS in_dengue_cluster,
                    s.id AS source_snapshot_id, s.source_id, s.source_version, s.retrieved_at
             FROM page_homes h JOIN source_snapshot s ON s.id = h.source_snapshot_id
             {_HOME_EVIDENCE_JOINS}
             {place_joins}
             ORDER BY h.observed_on DESC NULLS LAST, h.id"""
    async with pool.acquire() as connection:
        total_row = await connection.fetchrow(count_sql, *count_values)
        rows = await connection.fetch(sql, *values)
    total = int(total_row["total"] or 0)
    has_more = len(rows) > request.limit
    rows = rows[:request.limit]
    next_cursor = None
    if has_more and rows:
        observed_on = rows[-1]["observed_on"]
        if isinstance(observed_on, datetime):
            observed_on = observed_on.date()
        next_cursor = encode_cursor({
            "observed_on": observed_on.isoformat() if observed_on is not None else None,
            "id": str(rows[-1]["id"]),
        })
    weights = request.priority_weights if priority_weights is None else priority_weights
    distance_targets = {
        "school": request.max_school_distance_m
        if request.max_school_distance_m is not None
        else _DEFAULT_DISTANCE_TARGETS["school"],
        "childcare": request.max_childcare_distance_m
        if request.max_childcare_distance_m is not None
        else _DEFAULT_DISTANCE_TARGETS["childcare"],
        "care": request.max_care_distance_m
        if request.max_care_distance_m is not None
        else _DEFAULT_DISTANCE_TARGETS["care"],
    }
    budget_cents = request.budget * 100 if request.budget is not None else None
    homes = []
    for row in rows:
        item = _home(
            row,
            _score_home(
                row,
                budget_cents=budget_cents,
                weights=weights,
                distance_targets=distance_targets,
            ),
        )
        if include_place_distances:
            try:
                place_distances = row["place_distances"]
            except (KeyError, IndexError):
                place_distances = None
            if isinstance(place_distances, str):
                place_distances = json.loads(place_distances)
            item["placeDistances"] = place_distances or []
        homes.append(item)
    return (
        homes,
        _source_summary(rows),
        total,
        next_cursor,
        has_more,
        _result_source_snapshot_ids(rows),
    )


@app.get("/health")
async def health() -> dict:
    from . import database

    return {
        "status": "ok",
        "app": APP_NAME,
        "time": datetime.now(timezone.utc).isoformat(),
        "database": "configured" if database._pool is not None else "unavailable",
        "auth": "configured" if database._pool is not None else "unconfigured",
        "ai": "configured" if gemini_configuration_ready() else "unconfigured",
        "primaryDataset": HDB_RESALE_DATASET_ID,
    }


@app.get("/ready")
async def ready() -> JSONResponse:
    snapshot = await readiness_snapshot()
    return JSONResponse(
        content=snapshot,
        status_code=200 if snapshot["ready"] else 503,
    )


@app.post("/api/v1/auth/register", status_code=201)
async def register_local_account(
    credentials: AuthCredentials,
    request: Request,
    response: Response,
) -> dict:
    email = normalize_email(credentials.email)
    try:
        password = validate_password(credentials.password)
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail={"code": "INVALID_PASSWORD", "message": str(exc)},
        ) from exc
    _check_auth_rate_limit(request, email)
    database.require_pool()
    token = new_session_token()
    password_hash = hash_password(password)
    expires_at = datetime.now(timezone.utc) + SESSION_LIFETIME
    try:
        user_id = await database.register_local_account(
            email,
            password_hash,
            hash_session_token(token),
            expires_at,
        )
    except database.DuplicateLocalEmailError as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "EMAIL_ALREADY_EXISTS",
                "message": "An account with this email already exists. Sign in instead.",
            },
        ) from exc
    except HTTPException:
        raise
    except (asyncpg.PostgresError, OSError) as exc:
        raise _storage_unavailable() from exc
    _set_session_cookie(response, token)
    return {"user": {"id": str(user_id), "email": email}}


@app.post("/api/v1/auth/login")
async def login_local_account(
    credentials: AuthCredentials,
    request: Request,
    response: Response,
) -> dict:
    email = normalize_email(credentials.email)
    _check_auth_rate_limit(request, email)
    try:
        identity = await database.get_local_auth_identity_by_email(email)
    except HTTPException:
        raise
    except (asyncpg.PostgresError, OSError) as exc:
        raise _storage_unavailable() from exc
    if identity is None or not verify_password(credentials.password, identity["password_hash"]):
        raise HTTPException(
            status_code=401,
            detail={"code": "INVALID_CREDENTIALS", "message": "Email or password is incorrect."},
        )

    token = new_session_token()
    expires_at = datetime.now(timezone.utc) + SESSION_LIFETIME
    try:
        await database.create_local_session(
            identity["user_id"],
            hash_session_token(token),
            expires_at,
        )
    except HTTPException:
        raise
    except (asyncpg.PostgresError, OSError) as exc:
        raise _storage_unavailable() from exc
    _set_session_cookie(response, token)
    return {"user": {"id": str(identity["user_id"]), "email": identity["email"]}}


@app.post("/api/v1/auth/logout", response_model=None)
async def logout_local_account(request: Request, response: Response) -> dict | JSONResponse:
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if token:
        try:
            token_hash = hash_session_token(token)
        except ValueError:
            token_hash = None
        if token_hash is not None:
            try:
                await database.revoke_local_session(token_hash)
            except HTTPException as exc:
                failure = JSONResponse(
                    status_code=exc.status_code,
                    content={"detail": exc.detail},
                )
                _clear_session_cookie(failure)
                return failure
            except (asyncpg.PostgresError, OSError):
                failure = JSONResponse(
                    status_code=503,
                    content={
                        "detail": {
                            "code": "DATABASE_UNAVAILABLE",
                            "message": "Persistent storage is unavailable. Please try again.",
                        }
                    },
                )
                _clear_session_cookie(failure)
                return failure
    _clear_session_cookie(response)
    return {"ok": True}


@app.get("/api/v1/auth/session")
async def current_local_session(request: Request, response: Response) -> dict:
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        return {"user": None}
    user = await resolve_session_token(token)
    if user is None:
        _clear_session_cookie(response)
        return {"user": None}
    try:
        email = await database.get_local_auth_email_by_user_id(user["id"])
    except HTTPException:
        raise
    except (asyncpg.PostgresError, OSError) as exc:
        raise _storage_unavailable() from exc
    if email is None:
        _clear_session_cookie(response)
        return {"user": None}
    return {"user": {"id": str(user["id"]), "email": email}}


@app.post("/api/v1/auth/password")
async def change_local_password(
    request_data: PasswordChangeRequest,
    user: dict = Depends(require_active_user),
) -> dict:
    try:
        identity = await database.get_local_auth_identity_by_user_id(user["id"])
    except HTTPException:
        raise
    except (asyncpg.PostgresError, OSError) as exc:
        raise _storage_unavailable() from exc
    if identity is None or not verify_password(
        request_data.current_password,
        identity["password_hash"],
    ):
        raise HTTPException(
            status_code=401,
            detail={
                "code": "CURRENT_PASSWORD_INVALID",
                "message": "The current password is incorrect.",
            },
        )
    try:
        new_hash = hash_password(validate_password(request_data.new_password))
        changed = await database.change_local_password(
            user["id"],
            user["session_id"],
            identity["password_hash"],
            new_hash,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail={"code": "INVALID_PASSWORD", "message": str(exc)},
        ) from exc
    except HTTPException:
        raise
    except (asyncpg.PostgresError, OSError) as exc:
        raise _storage_unavailable() from exc
    if not changed:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "PASSWORD_CHANGED",
                "message": "The password or session changed. Sign in again and retry.",
            },
        )
    return {"ok": True}


@app.get("/api/v1/sources")
async def source_status() -> dict:
    pool = require_pool()
    async with pool.acquire() as connection:
        rows = await connection.fetch(
            """SELECT DISTINCT ON (source_id) source_id, source_url, source_version, content_hash,
                      source_updated_at, retrieved_at, row_count, rejected_count, status, validation_report
               FROM source_snapshot ORDER BY source_id, retrieved_at DESC"""
        )
    snapshots = {row["source_id"]: {"sourceId": row["source_id"], "url": row["source_url"], "version": row["source_version"],
                "contentSha256": row["content_hash"], "sourceUpdatedAt": row["source_updated_at"].isoformat() if row["source_updated_at"] else None,
                "retrievedAt": row["retrieved_at"].isoformat(), "rows": row["row_count"], "rejected": row["rejected_count"],
                "state": row["status"], "validation": row["validation_report"]} for row in rows}
    registry = {HDB_RESALE_DATASET_ID: {"resourceType": "hdb_resale", "url": f"https://data.gov.sg/datasets/{HDB_RESALE_DATASET_ID}/view"}}
    registry.update({source.dataset_id: {"resourceType": source.resource_type, "url": source.url} for source in RESOURCE_SOURCES})
    sources = [{**registry.get(source_id, {}), **snapshots.get(source_id, {"sourceId": source_id, "state": "not_imported", "rows": 0, "rejected": 0}), "sourceId": source_id}
               for source_id in registry]
    onemap_snapshot = snapshots.get("onemap_geocoding")
    sources.append({**(onemap_snapshot or {}), "sourceId": "onemap", "resourceType": "geocoding_and_routing", "url": "https://www.onemap.gov.sg/apidocs/",
                    "state": onemap_snapshot["state"] if onemap_snapshot else "needs_credentials" if not os.getenv("ONEMAP_ACCESS_TOKEN") else "configured",
                    "rows": onemap_snapshot["rows"] if onemap_snapshot else 0, "rejected": onemap_snapshot["rejected"] if onemap_snapshot else 0,
                    "validation": onemap_snapshot["validation"] if onemap_snapshot else {"note": "Requires a team-owned OneMap token; this is not a data.gov.sg snapshot."}})
    imported = sum(source["state"] in {"valid", "degraded"} for source in sources)
    return {"items": sources, "primaryDataset": HDB_RESALE_DATASET_ID,
            "imported": imported, "registered": len(sources),
            "state": "available" if imported == len(sources) else "partial" if imported else "not_imported"}


@app.get("/api/v1/resources")
async def resources(
    resource_type: list[str] | None = Query(default=None),
    bounds: str | None = None,
    include_unlocated: bool = False,
    limit: int = Query(default=500, ge=1, le=2000),
    cursor: str | None = Query(default=None, min_length=1, max_length=MAX_CURSOR_LENGTH),
) -> dict:
    """Return current imported resource layers as a bounded GeoJSON FeatureCollection."""
    request = _validated_query_model(
        ResourceRequest,
        resource_type=resource_type,
        bounds=bounds,
        include_unlocated=include_unlocated,
        limit=limit,
        cursor=cursor,
    )
    pool = require_pool()
    supported = {source.resource_type for source in RESOURCE_SOURCES}
    if request.resource_type and (invalid := set(request.resource_type) - supported):
        raise HTTPException(status_code=422, detail={"code": "UNKNOWN_RESOURCE_TYPE", "types": sorted(invalid)})
    values: list[object] = [request.resource_type or []]
    resource_filter = "(cardinality($1::text[]) = 0 OR r.resource_type = ANY($1::text[]))"
    bounds_filter = ""
    if request.bounds is not None:
        values.extend([
            request.bounds.west,
            request.bounds.south,
            request.bounds.east,
            request.bounds.north,
        ])
        bounds_filter = f" AND ST_Intersects(r.geometry, ST_MakeEnvelope(${len(values)-3},${len(values)-2},${len(values)-1},${len(values)},4326))"

    cursor_filter = ""
    if request.cursor is not None:
        cursor = decode_cursor(request.cursor)
        values.extend([cursor["resource_type"], cursor["name"], cursor["id"]])
        resource_type_param, name_param, id_param = range(len(values) - 2, len(values) + 1)
        cursor_filter = (
            f" AND (r.resource_type, r.name, r.id::text) > "
            f"(${resource_type_param}::text,${name_param}::text,${id_param}::text)"
        )

    values.append(request.limit + 1)
    limit_param = len(values)
    location_filter = "TRUE" if request.include_unlocated and request.bounds is None else "r.geometry IS NOT NULL"
    sql = f"""WITH latest AS (
                  SELECT DISTINCT ON (source_id) id, source_id, source_url, source_version, retrieved_at, status
                  FROM source_snapshot WHERE status IN ('valid','degraded')
                  ORDER BY source_id, retrieved_at DESC
                )
                SELECT r.id, r.resource_type, r.name, r.status, r.attributes,
                       CASE WHEN r.geometry IS NULL THEN NULL ELSE ST_AsGeoJSON(r.geometry) END AS geometry,
                       s.source_id, s.source_url, s.source_version, s.retrieved_at,
                       location_source.source_id AS location_source_id, location_source.retrieved_at AS location_retrieved_at
                FROM neighbourhood_resource r JOIN latest s ON s.id=r.source_snapshot_id
                LEFT JOIN source_snapshot location_source ON location_source.id=r.location_source_snapshot_id
                WHERE {resource_filter} AND {location_filter}{bounds_filter}{cursor_filter}
                ORDER BY r.resource_type, r.name, r.id LIMIT ${limit_param}"""
    count_sql = """WITH latest AS (
                     SELECT DISTINCT ON (source_id) id, source_id FROM source_snapshot
                     WHERE status IN ('valid','degraded') ORDER BY source_id, retrieved_at DESC
                   )
                   SELECT r.resource_type, count(*) AS total,
                          count(*) FILTER (WHERE r.geometry IS NULL) AS unlocated
                   FROM neighbourhood_resource r JOIN latest s ON s.id=r.source_snapshot_id
                   GROUP BY r.resource_type ORDER BY r.resource_type"""
    async with pool.acquire() as connection:
        rows = await connection.fetch(sql, *values)
        counts = await connection.fetch(count_sql)
    has_more = len(rows) > request.limit
    rows = rows[:request.limit]
    next_cursor = None
    if has_more and rows:
        row = rows[-1]
        next_cursor = encode_cursor({
            "resource_type": row["resource_type"],
            "name": row["name"],
            "id": str(row["id"]),
        })
    features = []
    for row in rows:
        geometry = json.loads(row["geometry"]) if row["geometry"] else None
        features.append({"type": "Feature", "id": row["id"], "geometry": geometry,
                         "properties": {"name": row["name"], "resourceType": row["resource_type"], "status": row["status"],
                                        "attributes": row["attributes"], "sourceId": row["source_id"], "sourceUrl": row["source_url"],
                                        "sourceVersion": row["source_version"], "retrievedAt": row["retrieved_at"].isoformat(),
                                        "locationSourceId": row["location_source_id"], "locationRetrievedAt": row["location_retrieved_at"].isoformat() if row["location_retrieved_at"] else None}})
    return {"type": "FeatureCollection", "features": features, "count": len(features),
            "truncated": has_more, "nextCursor": next_cursor, "hasMore": has_more,
            "counts": [{"resourceType": row["resource_type"], "total": row["total"], "unlocated": row["unlocated"]} for row in counts],
            **live_result_metadata(_source_summary(rows))}


@app.get("/api/v1/homes")
async def homes(
    query: str = "",
    budget: int | None = None,
    town: str | None = None,
    bounds: str | None = None,
    min_storey: int | None = None,
    max_storey: int | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    cursor: str | None = Query(default=None, min_length=1, max_length=MAX_CURSOR_LENGTH),
) -> dict:
    request = _validated_query_model(
        SearchRequest,
        query=query,
        budget=budget,
        town=town,
        bounds=bounds,
        min_storey=min_storey,
        max_storey=max_storey,
        limit=limit,
        cursor=cursor,
    )
    (
        results,
        source_summary,
        total,
        next_cursor,
        has_more,
        _snapshot_ids,
    ) = await _query_homes(request)
    limitations = ["Records are historical resale transactions, not current listings.", "Some rows may not be geocoded or have linked amenity evidence."]
    return {"items": results, "count": len(results), "total": total, "nextCursor": next_cursor, "hasMore": has_more,
            "sourceStatus": {"hdb": {"state": "database-snapshot", "datasetId": HDB_RESALE_DATASET_ID}},
            "limitations": limitations, **live_result_metadata(source_summary, limitations)}


@app.post("/api/v1/search")
async def search(
    request: SearchRequest,
    user: dict | None = Depends(_optional_active_user),
) -> dict:
    if request.place_constraints and user is None:
        raise HTTPException(status_code=401, detail={"code": "AUTH_REQUIRED", "message": "Sign in to search using saved places."})
    pool = require_pool()
    async with pool.acquire() as connection:
        if request.place_constraints:
            requested_place_ids = [constraint.place_id for constraint in request.place_constraints]
            owned_places = await connection.fetch(
                "SELECT id FROM personal_place WHERE user_id=$1 AND id = ANY($2::uuid[])",
                user["id"],
                requested_place_ids,
            )
            owned_place_ids = {row["id"] for row in owned_places}
            if owned_place_ids != set(requested_place_ids):
                raise HTTPException(
                    status_code=422,
                    detail={"code": "PLACE_CONSTRAINT_UNAVAILABLE", "message": "One or more selected places are unavailable."},
                )
        home_coverage = await connection.fetchrow(
            "SELECT count(*) AS total, count(*) FILTER (WHERE geometry IS NOT NULL) AS geocoded FROM candidate_home"
        )
        source_coverage = await connection.fetchrow(
            _LATEST_RESOURCE_CTE + """ SELECT
              count(*) FILTER (WHERE r.resource_type='moe_school' AND r.geometry IS NOT NULL) AS schools,
              count(*) FILTER (WHERE r.resource_type IN ('childcare','kindergarten') AND r.geometry IS NOT NULL) AS childcare,
              count(*) FILTER (WHERE r.resource_type IN ('chas_clinic','dementia_gtp') AND r.geometry IS NOT NULL) AS care
            FROM neighbourhood_resource r JOIN latest_resource_sources latest ON latest.id=r.source_snapshot_id"""
        )
    coverage = {"max_school_distance_m": source_coverage["schools"],
                "max_childcare_distance_m": source_coverage["childcare"],
                "max_care_distance_m": source_coverage["care"]}
    updates: dict[str, object] = {}
    unsupported = []
    for key, value in coverage.items():
        if getattr(request, key) is not None and (not home_coverage["geocoded"] or not value):
            updates[key] = None
            unsupported.append(key)
    effective_request = request.model_copy(update=updates) if updates else request
    (
        results,
        source_summary,
        total,
        next_cursor,
        has_more,
        source_snapshot_ids,
    ) = await _query_homes(
        effective_request,
        effective_request.priority_weights,
        user_id=user["id"] if request.place_constraints else None,
        include_place_distances=True,
    )
    partial_geocode_coverage = 0 < home_coverage["geocoded"] < home_coverage["total"]
    coverage_note = (f"Only the geocoded subset is eligible for proximity filtering ({home_coverage['geocoded']:,} of {home_coverage['total']:,} transaction records have locations)." if partial_geocode_coverage and not unsupported else None)
    limitations = (["Amenity-distance filters were not applied because transaction locations and the requested source layer are not both available."] if unsupported else []) + \
                  ([coverage_note] if coverage_note else []) + \
                  ["HDB resale prices are historical transaction observations, not current asking prices, available homes, or valuations.",
                   "Remaining lease years are estimated as 99 minus elapsed whole calendar years from the year-only lease commencement value; the historical remaining-lease field is not used."]
    return {
        "items": results,
        "count": len(results),
        "total": total,
        "nextCursor": next_cursor,
        "hasMore": has_more,
        "criteria": request.model_dump(),
        "sourceStatus": {"hdb": {"state": "database-snapshot", "datasetId": HDB_RESALE_DATASET_ID}},
        "sourceSnapshotIds": source_snapshot_ids,
        "unappliedCriteria": unsupported,
        "scorePolicyVersion": POLICY_VERSION,
        "limitations": limitations,
        **live_result_metadata(source_summary, limitations),
    }


@app.get("/api/v1/search/options")
async def search_options() -> dict:
    pool = require_pool()
    async with pool.acquire() as connection:
        options = await database.get_current_search_options(connection)
    return {"towns": options["towns"], "flatTypes": options["flat_types"]}


def _month_start_offset(value: date, month_offset: int) -> date:
    month_index = value.year * 12 + value.month - 1 + month_offset
    return date(month_index // 12, month_index % 12 + 1, 1)


@market_router.get("/history")
async def market_history(
    town: str | None = Query(default=None, max_length=80),
    flat_type: str | None = Query(default=None, max_length=40),
    months: int = Query(default=24, ge=6, le=120),
) -> dict:
    town_filter = town.strip() if town and town.strip() else None
    flat_type_filter = flat_type.strip() if flat_type and flat_type.strip() else None
    pool = require_pool()
    async with pool.acquire() as connection:
        dataset = await connection.fetchrow(
            """SELECT max(h.observed_on) AS latest_observed_on,
                      (SELECT max(snapshot.retrieved_at)
                       FROM source_snapshot snapshot
                       WHERE snapshot.source_id = $1
                         AND snapshot.status IN ('valid', 'degraded')) AS source_updated,
                      count(*)::bigint AS dataset_record_count
               FROM candidate_home h
               JOIN source_snapshot s ON s.id = h.source_snapshot_id
               WHERE s.source_id = $1
                 AND s.status IN ('valid', 'degraded')
                 AND h.source_semantics = 'historical_transaction'
                 AND h.observed_on IS NOT NULL
                 AND h.price_observation_cents > 0""",
            HDB_RESALE_DATASET_ID,
        )
        latest_observed_on = dataset["latest_observed_on"]
        if latest_observed_on is None:
            point_rows = []
            period_start = None
            period_end = None
        else:
            period_end_month = date(latest_observed_on.year, latest_observed_on.month, 1)
            period_start = _month_start_offset(period_end_month, -(months - 1))
            end_exclusive = _month_start_offset(period_end_month, 1)
            values: list[object] = [HDB_RESALE_DATASET_ID, period_start, end_exclusive]
            predicates = [
                "s.source_id = $1",
                "s.status IN ('valid', 'degraded')",
                "h.source_semantics = 'historical_transaction'",
                "h.observed_on >= $2",
                "h.observed_on < $3",
                "h.price_observation_cents > 0",
            ]
            if town_filter is not None:
                values.append(town_filter)
                predicates.append(f"h.town ILIKE ${len(values)}")
            if flat_type_filter is not None:
                values.append(flat_type_filter)
                predicates.append(f"h.flat_type ILIKE ${len(values)}")
            point_rows = await connection.fetch(
                f"""SELECT to_char(date_trunc('month', h.observed_on), 'YYYY-MM') AS month,
                           count(*)::integer AS count,
                           percentile_cont(0.5) WITHIN GROUP (ORDER BY h.price_observation_cents) AS median_cents,
                           percentile_cont(0.25) WITHIN GROUP (ORDER BY h.price_observation_cents) AS p25_cents,
                           percentile_cont(0.75) WITHIN GROUP (ORDER BY h.price_observation_cents) AS p75_cents
                    FROM candidate_home h
                    JOIN source_snapshot s ON s.id = h.source_snapshot_id
                    WHERE {' AND '.join(predicates)}
                    GROUP BY date_trunc('month', h.observed_on)
                    ORDER BY date_trunc('month', h.observed_on)""",
                *values,
            )
            period_end = period_end_month

    points = [
        {
            "month": row["month"],
            "median": round(float(row["median_cents"]) / 100, 2),
            "count": int(row["count"]),
            "p25": round(float(row["p25_cents"]) / 100, 2),
            "p75": round(float(row["p75_cents"]) / 100, 2),
        }
        for row in point_rows
    ]
    return {
        "points": points,
        "town": town_filter,
        "flatType": flat_type_filter,
        "sourceUpdated": (
            dataset["source_updated"].isoformat()
            if dataset["source_updated"] is not None
            else None
        ),
        "latestObservedOn": (
            latest_observed_on.isoformat()
            if latest_observed_on is not None
            else None
        ),
        "semantics": "historical_transaction",
        "periodStart": period_start.strftime("%Y-%m") if period_start is not None else None,
        "periodEnd": period_end.strftime("%Y-%m") if period_end is not None else None,
        "months": months,
        "sourceRecordCount": sum(point["count"] for point in points),
        "datasetRecordCount": int(dataset["dataset_record_count"] or 0),
        "sourceDatasetId": HDB_RESALE_DATASET_ID,
        "currency": "SGD",
        "isValuation": False,
        "limitations": [
            "Historical HDB resale transactions only; these are not current listings, asking prices, valuations, or forecasts."
        ],
    }


app.include_router(market_router)


@app.get("/api/v1/homes/{home_id}")
async def home_detail(home_id: str) -> dict:
    pool = require_pool()
    async with pool.acquire() as connection:
        record = await connection.fetchrow(
            _LATEST_RESOURCE_CTE + f""" SELECT h.id, h.address, h.town, h.flat_type, h.price_observation_cents, h.observed_on,
                      h.source_semantics, h.floor_area_sqm, h.storey_range, h.lease_commence_year,
                      h.geocode_status, h.geometry_source, h.geocoded_at,
                      CASE WHEN h.geometry IS NULL THEN NULL ELSE ST_Y(h.geometry) END AS latitude,
                      CASE WHEN h.geometry IS NULL THEN NULL ELSE ST_X(h.geometry) END AS longitude,
                      school_access.name AS school_name, school_access.distance_m AS school_distance_m,
                      childcare_access.name AS childcare_name, childcare_access.distance_m AS childcare_distance_m,
                      care_access.name AS care_name, care_access.distance_m AS care_distance_m,
                      CASE WHEN h.geometry IS NULL THEN FALSE ELSE EXISTS (
                        SELECT 1 FROM neighbourhood_resource r JOIN latest_resource_sources latest ON latest.id=r.source_snapshot_id
                        WHERE r.resource_type='dengue_cluster' AND r.geometry IS NOT NULL AND ST_Intersects(h.geometry,r.geometry)
                      ) END AS in_dengue_cluster,
                      s.source_id, s.source_version, s.retrieved_at
               FROM candidate_home h JOIN source_snapshot s ON s.id=h.source_snapshot_id
               {_HOME_EVIDENCE_JOINS}
               WHERE h.id=$1""",
            home_id,
        )
    if record is None:
        raise HTTPException(status_code=404, detail={"code": "HOME_NOT_FOUND", "message": "The requested verified transaction record is unavailable."})
    return _home(record)


@app.post("/api/v1/scoring/preview")
def score_preview(request: ScoreRequest) -> dict:
    if not request.criteria:
        raise HTTPException(status_code=422, detail={"code": "CRITERIA_REQUIRED", "message": "Provide at least one criterion."})
    if any(value is not None and not 0 <= value <= 100 for value in request.criteria.values()):
        raise HTTPException(status_code=422, detail={"code": "CRITERION_RANGE", "message": "Criterion scores must be between 0 and 100."})
    if any(value < 0 for value in request.weights.values()):
        raise HTTPException(status_code=422, detail={"code": "WEIGHT_RANGE", "message": "Criterion weights cannot be negative."})
    return weighted_score(request.criteria, request.weights)


@app.post("/api/v1/ai/interpret")
async def interpret(
    request: InterpretRequest,
    http_request: Request,
    user: dict = Depends(require_active_user),
) -> dict:
    _get_ai_interpret_limiter().check(rate_limit_key(user, http_request))
    result, model = await interpret_query(request)
    return {**result.model_dump(by_alias=True), "provider": "gemini", "model": model, "storedByProvider": False,
            "grounding": "Only explicit filter values are returned. Search results must be grounded in current application records."}


@app.post("/api/v1/ai/summaries/{home_id}")
async def record_summary(home_id: str, user: dict = Depends(require_active_user)) -> dict:
    pool = require_pool()
    async with pool.acquire() as connection:
        row = await connection.fetchrow(
            """SELECT h.id, h.town, h.flat_type, h.price_observation_cents, h.observed_on,
                      h.floor_area_sqm, h.storey_range, s.source_id, s.source_version, s.source_url
               FROM candidate_home h JOIN source_snapshot s ON s.id=h.source_snapshot_id WHERE h.id=$1""",
            home_id,
        )
    if row is None:
        raise HTTPException(status_code=404, detail={"code": "HOME_NOT_FOUND", "message": "No imported transaction record was found."})
    evidence = {"town": row["town"], "flat_type": row["flat_type"],
                "transaction_month": row["observed_on"].strftime("%Y-%m") if row["observed_on"] else None,
                "resale_price": f"SGD {row['price_observation_cents'] / 100:,.2f}" if row["price_observation_cents"] is not None else None,
                "floor_area_sqm": float(row["floor_area_sqm"]) if row["floor_area_sqm"] is not None else None,
                "storey_range": row["storey_range"]}
    evidence = {key: value for key, value in evidence.items() if value is not None}
    result, model = await summarize_record(evidence)
    return {"homeId": home_id, "overview": result.overview,
            "observations": [item.model_dump() for item in result.observations],
            "source": {"datasetId": row["source_id"], "datasetVersion": row["source_version"], "url": row["source_url"]},
            "limitations": ["Historical transaction evidence only; this is not a current listing.", "No score, amenity distance, route, or suitability claim is included."],
            "provider": "gemini", "model": model, "storedByProvider": False}


@app.get("/api/v1/profile")
async def get_profile(user: dict = Depends(require_active_user)) -> dict:
    pool = require_pool()
    async with pool.acquire() as connection:
        async with connection.transaction():
            await ensure_user(connection, user)
            profile = await ensure_profile(connection, user["id"])
            priority_weights = await get_priority_weights(connection, profile["id"])
    return {"adults": profile["adults"], "children": profile["children"], "olderAdults": profile["older_adults"],
            "budgetCents": profile["budget_cents"], "locale": profile["locale"], "updatedAt": profile["updated_at"].isoformat(),
            "priorityWeights": priority_weights, "preferredTowns": profile["preferred_towns"],
            "preferredFlatType": profile["preferred_flat_type"],
            "maxSchoolDistanceM": profile["max_school_distance_m"],
            "maxChildcareDistanceM": profile["max_childcare_distance_m"],
            "maxCareDistanceM": profile["max_care_distance_m"],
            "onboardingCompleted": profile["onboarding_completed"]}


@app.put("/api/v1/profile")
async def update_profile(request: FamilyProfileUpdate, user: dict = Depends(require_active_user)) -> dict:
    pool = require_pool()
    async with pool.acquire() as connection:
        async with connection.transaction():
            await ensure_user(connection, user)
            options = await database.get_current_search_options(connection)
            town_options = {town.casefold(): town for town in options["towns"]}
            unsupported_towns = [town for town in request.preferred_towns if town.casefold() not in town_options]
            if unsupported_towns:
                raise HTTPException(
                    status_code=422,
                    detail={"code": "INVALID_PROFILE_TOWN", "message": "Choose towns from the available resale data."},
                )
            request.preferred_towns = [town_options[town.casefold()] for town in request.preferred_towns]
            if request.preferred_flat_type is not None:
                flat_type_options = {value.casefold(): value for value in options["flat_types"]}
                canonical_flat_type = flat_type_options.get(request.preferred_flat_type.casefold())
                if canonical_flat_type is None:
                    raise HTTPException(
                        status_code=422,
                        detail={"code": "INVALID_PROFILE_FLAT_TYPE", "message": "Choose a flat type from the available resale data."},
                    )
                request.preferred_flat_type = canonical_flat_type
            await connection.execute(
                """INSERT INTO family_profile (
                       id, user_id, adults, children, older_adults, budget_cents, locale,
                       preferred_towns, preferred_flat_type, max_school_distance_m,
                       max_childcare_distance_m, max_care_distance_m
                   ) VALUES ($1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                   ON CONFLICT (user_id) DO UPDATE SET
                   adults=EXCLUDED.adults, children=EXCLUDED.children, older_adults=EXCLUDED.older_adults,
                   budget_cents=EXCLUDED.budget_cents, locale=EXCLUDED.locale,
                   preferred_towns=EXCLUDED.preferred_towns, preferred_flat_type=EXCLUDED.preferred_flat_type,
                   max_school_distance_m=EXCLUDED.max_school_distance_m,
                   max_childcare_distance_m=EXCLUDED.max_childcare_distance_m,
                   max_care_distance_m=EXCLUDED.max_care_distance_m,
                   onboarding_completed=CASE WHEN $12::boolean IS TRUE THEN TRUE ELSE family_profile.onboarding_completed END,
                   updated_at=now()""",
                user["id"], request.adults, request.children, request.older_adults, request.budget_cents, request.locale,
                request.preferred_towns, request.preferred_flat_type, request.max_school_distance_m,
                request.max_childcare_distance_m, request.max_care_distance_m, request.onboarding_completed,
            )
            profile = await ensure_profile(connection, user["id"])
            await replace_priority_weights(connection, profile["id"], request.priority_weights)
            priority_weights = await get_priority_weights(connection, profile["id"])
    return {"adults": profile["adults"], "children": profile["children"], "olderAdults": profile["older_adults"],
            "budgetCents": profile["budget_cents"], "locale": profile["locale"], "updatedAt": profile["updated_at"].isoformat(),
            "priorityWeights": priority_weights, "preferredTowns": profile["preferred_towns"],
            "preferredFlatType": profile["preferred_flat_type"],
            "maxSchoolDistanceM": profile["max_school_distance_m"],
            "maxChildcareDistanceM": profile["max_childcare_distance_m"],
            "maxCareDistanceM": profile["max_care_distance_m"],
            "onboardingCompleted": profile["onboarding_completed"]}


@app.get("/api/v1/shortlists")
async def get_shortlist(user: dict = Depends(require_active_user)) -> dict:
    pool = require_pool()
    async with pool.acquire() as connection:
        rows = await connection.fetch(
            _LATEST_RESOURCE_CTE + f""" SELECT h.id, h.address, h.town, h.flat_type, h.price_observation_cents, h.observed_on,
                      h.source_semantics, h.floor_area_sqm, h.storey_range, h.lease_commence_year,
                      h.geocode_status, h.geometry_source, h.geocoded_at,
                      CASE WHEN h.geometry IS NULL THEN NULL ELSE ST_Y(h.geometry) END AS latitude,
                      CASE WHEN h.geometry IS NULL THEN NULL ELSE ST_X(h.geometry) END AS longitude,
                      school_access.name AS school_name, school_access.distance_m AS school_distance_m,
                      childcare_access.name AS childcare_name, childcare_access.distance_m AS childcare_distance_m,
                      care_access.name AS care_name, care_access.distance_m AS care_distance_m,
                      CASE WHEN h.geometry IS NULL THEN FALSE ELSE EXISTS (
                        SELECT 1 FROM neighbourhood_resource r JOIN latest_resource_sources latest ON latest.id=r.source_snapshot_id
                        WHERE r.resource_type='dengue_cluster' AND r.geometry IS NOT NULL AND ST_Intersects(h.geometry,r.geometry)
                      ) END AS in_dengue_cluster,
                      s0.source_id, s0.source_version, s0.retrieved_at
               FROM shortlist s JOIN shortlist_entry e ON e.shortlist_id=s.id
               JOIN candidate_home h ON h.id=e.candidate_home_id
               JOIN source_snapshot s0 ON s0.id=h.source_snapshot_id
               {_HOME_EVIDENCE_JOINS}
               WHERE s.user_id=$1 ORDER BY e.position""",
            user["id"],
        )
    return {"ids": [row["id"] for row in rows], "items": [_home(row) for row in rows]}


@app.post("/api/v1/shortlists")
async def save_shortlist(request: SaveRequest, user: dict = Depends(require_active_user)) -> dict:
    pool = require_pool()
    async with pool.acquire() as connection:
        async with connection.transaction():
            await ensure_user(connection, user)
            await connection.fetchval("SELECT id FROM user_account WHERE id=$1 FOR UPDATE", user["id"])
            exists = await connection.fetchval("SELECT EXISTS(SELECT 1 FROM candidate_home WHERE id=$1)", request.home_id)
            if not exists:
                raise HTTPException(status_code=404, detail={"code": "HOME_NOT_FOUND", "message": "Only an imported transaction record can be saved to an account."})
            shortlist_id = await connection.fetchval("SELECT id FROM shortlist WHERE user_id=$1 ORDER BY created_at LIMIT 1", user["id"])
            if shortlist_id is None:
                shortlist_id = uuid4()
                await connection.execute("INSERT INTO shortlist (id,user_id,name) VALUES ($1,$2,'Family shortlist')", shortlist_id, user["id"])
            position = await connection.fetchval("SELECT COALESCE(MAX(position)+1,0) FROM shortlist_entry WHERE shortlist_id=$1", shortlist_id)
            await connection.execute("""INSERT INTO shortlist_entry (shortlist_id,candidate_home_id,position) VALUES ($1,$2,$3)
                                     ON CONFLICT (shortlist_id,candidate_home_id) DO NOTHING""", shortlist_id, request.home_id, position)
    return {"status": "saved", "homeId": request.home_id}


@app.delete("/api/v1/shortlists/{home_id}")
async def remove_shortlist(home_id: str, user: dict = Depends(require_active_user)) -> dict:
    pool = require_pool()
    async with pool.acquire() as connection:
        removed = await connection.execute("""DELETE FROM shortlist_entry e USING shortlist s
                WHERE e.shortlist_id=s.id AND s.user_id=$1 AND e.candidate_home_id=$2""", user["id"], home_id)
    return {"status": "removed" if removed.endswith(" 1") else "absent", "homeId": home_id}


@app.patch("/api/v1/shortlists/order")
async def reorder_shortlist(request: ShortlistOrderRequest, user: dict = Depends(require_active_user)) -> dict:
    if len(set(request.ordered_home_ids)) != len(request.ordered_home_ids):
        raise HTTPException(status_code=422, detail={"code": "DUPLICATE_SHORTLIST_ID", "message": "A shortlist entry may appear only once in the new order."})
    pool = require_pool()
    async with pool.acquire() as connection:
        async with connection.transaction():
            await connection.fetchval("SELECT id FROM user_account WHERE id=$1 FOR UPDATE", user["id"])
            shortlist_id = await connection.fetchval("SELECT id FROM shortlist WHERE user_id=$1 ORDER BY created_at LIMIT 1 FOR UPDATE", user["id"])
            if shortlist_id is None:
                raise HTTPException(status_code=404, detail={"code": "SHORTLIST_NOT_FOUND", "message": "There is no account shortlist to reorder."})
            current = await connection.fetch("SELECT candidate_home_id FROM shortlist_entry WHERE shortlist_id=$1", shortlist_id)
            current_ids = {row["candidate_home_id"] for row in current}
            if set(request.ordered_home_ids) != current_ids:
                raise HTTPException(status_code=409, detail={"code": "SHORTLIST_ORDER_STALE", "message": "Refresh the shortlist before reordering it."})
            offset = (await connection.fetchval("SELECT COALESCE(MAX(position),0)+1 FROM shortlist_entry WHERE shortlist_id=$1", shortlist_id))
            await connection.execute("UPDATE shortlist_entry SET position=position+$2 WHERE shortlist_id=$1", shortlist_id, offset)
            for position, home_id in enumerate(request.ordered_home_ids):
                await connection.execute("UPDATE shortlist_entry SET position=$3 WHERE shortlist_id=$1 AND candidate_home_id=$2", shortlist_id, home_id, position)
            await connection.execute("UPDATE shortlist SET updated_at=now() WHERE id=$1", shortlist_id)
    return {"status": "reordered", "ids": request.ordered_home_ids}


@app.get("/api/v1/saved-searches")
async def get_saved_searches(user: dict = Depends(require_active_user)) -> dict:
    pool = require_pool()
    async with pool.acquire() as connection:
        return await saved_search_service.list_saved_searches(connection, user["id"])


@app.post("/api/v1/saved-searches", status_code=201)
async def create_saved_search(
    request: SavedSearchCreate,
    user: dict = Depends(require_active_user),
) -> dict:
    pool = require_pool()
    async with pool.acquire() as connection:
        return await saved_search_service.create_saved_search(
            connection, user["id"], request
        )


@app.patch("/api/v1/saved-searches/{saved_search_id}")
async def rename_saved_search(
    saved_search_id: UUID,
    request: saved_search_service.SavedSearchRename,
    user: dict = Depends(require_active_user),
) -> dict:
    pool = require_pool()
    async with pool.acquire() as connection:
        return await saved_search_service.rename_saved_search(
            connection, saved_search_id, user["id"], request.name
        )


@app.delete("/api/v1/saved-searches/{saved_search_id}")
async def delete_saved_search(
    saved_search_id: UUID,
    user: dict = Depends(require_active_user),
) -> dict:
    pool = require_pool()
    async with pool.acquire() as connection:
        return await saved_search_service.delete_saved_search(
            connection, saved_search_id, user["id"]
        )


@app.post("/api/v1/saved-searches/{saved_search_id}/run")
async def run_saved_search(
    saved_search_id: UUID,
    user: dict = Depends(require_active_user),
) -> dict:
    pool = require_pool()
    return await saved_search_service.run_saved_search(
        pool, saved_search_id, user, search
    )


@app.post("/api/v1/history")
async def save_history(request: SearchHistoryRequest, user: dict = Depends(require_active_user)) -> dict:
    pool = require_pool()
    history_id = uuid4()
    criteria = request.criteria.model_dump(exclude_none=True)
    async with pool.acquire() as connection:
        async with connection.transaction():
            await ensure_user(connection, user)
            snapshots = await connection.fetch("SELECT id FROM source_snapshot WHERE status IN ('valid','degraded') ORDER BY retrieved_at DESC LIMIT 20")
            snapshot_ids = [str(row["id"]) for row in snapshots]
            await connection.execute(
                """INSERT INTO search_history (id,user_id,mode,criteria,source_snapshot_ids,scoring_version)
                   VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6)""",
                history_id, user["id"], request.mode, json.dumps(criteria), json.dumps(snapshot_ids), request.scoring_version,
            )
    return {"id": str(history_id), "created": True, "sourceSnapshotIds": snapshot_ids}


@app.post("/api/v1/sync/guest")
async def sync_guest_workspace(
    request: GuestSyncRequest,
    user: dict = Depends(require_active_user),
) -> dict:
    pool = require_pool()
    async with pool.acquire() as connection:
        return await merge_guest_data(connection, user, request)


@app.get("/api/v1/history")
async def get_history(user: dict = Depends(require_active_user)) -> dict:
    pool = require_pool()
    async with pool.acquire() as connection:
        rows = await connection.fetch("SELECT id,mode,criteria,source_snapshot_ids,scoring_version,created_at FROM search_history WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100", user["id"])
    return {"items": [{"id": str(row["id"]), "mode": row["mode"], "criteria": row["criteria"], "sourceSnapshotIds": row["source_snapshot_ids"], "scoringVersion": row["scoring_version"], "createdAt": row["created_at"].isoformat()} for row in rows]}


@app.get("/api/v1/places")
async def get_places(user: dict = Depends(require_active_user)) -> dict:
    pool = require_pool()
    async with pool.acquire() as connection:
        rows = await connection.fetch("""SELECT id,label,address,ST_Y(geometry) AS latitude,ST_X(geometry) AS longitude,
                      kind,geocode_source,geocoded_at,maximum_distance_m,updated_at
               FROM personal_place WHERE user_id=$1 ORDER BY created_at""", user["id"])
    return {"items": [{
        "id": str(row["id"]),
        "label": row["label"],
        "address": row["address"],
        "latitude": row["latitude"],
        "longitude": row["longitude"],
        "kind": row["kind"] or "other",
        "geocodeSource": row["geocode_source"],
        "geocodedAt": row["geocoded_at"].isoformat() if row["geocoded_at"] else None,
        "maximumDistanceM": row["maximum_distance_m"],
        "updatedAt": row["updated_at"].isoformat(),
    } for row in rows]}


def _candidate_selection_token(candidate: dict, provider_token: str) -> str:
    signed_fields = {
        "address": candidate["address"],
        "latitude": float(candidate["latitude"]),
        "longitude": float(candidate["longitude"]),
        "provider": candidate["provider"],
    }
    payload = json.dumps(signed_fields, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hmac.new(provider_token.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()


@app.get("/api/v1/places/suggest")
async def suggest_places(
    q: str = Query(..., min_length=1, max_length=160),
    _user: dict = Depends(require_active_user),
) -> dict:
    try:
        query = PlaceSuggestionRequest(query=q).query
    except ValueError:
        raise HTTPException(status_code=422, detail={"code": "PLACE_QUERY_REQUIRED", "message": "Enter an address to search."}) from None

    provider_token = os.getenv("ONEMAP_ACCESS_TOKEN", "").strip()
    if not is_configured_value(provider_token):
        raise HTTPException(status_code=503, detail={"code": "ONEMAP_UNCONFIGURED", "message": "Address suggestions are not configured."})
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            candidates = await search_address_candidates(query, provider_token, client)
    except OneMapProviderError as exc:
        raise HTTPException(status_code=502, detail={"code": "ONEMAP_UNAVAILABLE", "message": str(exc)}) from None

    return {"items": [
        {**candidate, "selection_token": _candidate_selection_token(candidate, provider_token)}
        for candidate in candidates
    ]}


@app.post("/api/v1/places")
async def create_place(request: PersonalPlaceRequest, user: dict = Depends(require_active_user)) -> dict:
    if request.geocode_source is None:
        raise HTTPException(status_code=422, detail={"code": "PLACE_PROVENANCE_REQUIRED", "message": "Choose a verified address candidate or label the coordinates as manual."})

    geocoded_at = None
    if request.geocode_source == "OneMap":
        provider_token = os.getenv("ONEMAP_ACCESS_TOKEN", "").strip()
        if not is_configured_value(provider_token):
            raise HTTPException(status_code=503, detail={"code": "ONEMAP_UNCONFIGURED", "message": "Address suggestions are not configured."})
        if not request.address or not request.selection_token:
            raise HTTPException(status_code=422, detail={"code": "PLACE_CANDIDATE_REQUIRED", "message": "Select an address returned by OneMap before saving it."})
        candidate = {
            "address": request.address,
            "latitude": request.latitude,
            "longitude": request.longitude,
            "provider": request.geocode_source,
        }
        expected_token = _candidate_selection_token(candidate, provider_token)
        if not hmac.compare_digest(request.selection_token, expected_token):
            raise HTTPException(status_code=422, detail={"code": "PLACE_CANDIDATE_INVALID", "message": "The selected address candidate is invalid or has changed."})
        geocoded_at = datetime.now(timezone.utc)
    elif request.selection_token is not None:
        raise HTTPException(status_code=422, detail={"code": "PLACE_CANDIDATE_INVALID", "message": "Manual places cannot include a provider selection token."})

    pool = require_pool()
    place_id = uuid4()
    async with pool.acquire() as connection:
        await ensure_user(connection, user)
        await connection.execute("""INSERT INTO personal_place
             (id,user_id,label,address,geometry,maximum_distance_m,kind,geocode_source,geocoded_at)
             VALUES ($1,$2,$3,$4,ST_SetSRID(ST_MakePoint($5,$6),4326),$7,$8,$9,$10)""",
             place_id, user["id"], request.label, request.address, request.longitude, request.latitude,
             request.maximum_distance_m, request.kind.value, request.geocode_source, geocoded_at)
    response = request.model_dump(exclude={"selection_token"})
    response["geocoded_at"] = geocoded_at
    return {"id": str(place_id), **response}


@app.delete("/api/v1/places/{place_id}")
async def delete_place(place_id: str, user: dict = Depends(require_active_user)) -> dict:
    from uuid import UUID

    try:
        parsed_id = UUID(place_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail={"code": "INVALID_PLACE_ID", "message": "The place identifier is invalid."}) from exc
    pool = require_pool()
    async with pool.acquire() as connection:
        result = await connection.execute("DELETE FROM personal_place WHERE id=$1 AND user_id=$2", parsed_id, user["id"])
    return {"status": "deleted" if result.endswith(" 1") else "absent"}


@app.delete("/api/v1/account")
async def delete_account(
    response: Response,
    user: dict = Depends(require_user),
) -> dict:
    try:
        deleted = await database.delete_local_account(user["id"])
    except HTTPException:
        raise
    except (asyncpg.PostgresError, OSError) as exc:
        raise _storage_unavailable() from exc
    if not deleted:
        raise HTTPException(
            status_code=404,
            detail={"code": "ACCOUNT_NOT_FOUND", "message": "This local account no longer exists."},
        )
    _clear_session_cookie(response)
    return {"status": "deleted"}
