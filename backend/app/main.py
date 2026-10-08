from __future__ import annotations

import json
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from uuid import uuid4

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .ai import gemini_configuration_ready, interpret_query, summarize_record
from .database import close_pool, ensure_profile, ensure_user, open_pool, require_pool
from .domain import weighted_score
from .schemas import FamilyProfileUpdate, InterpretRequest, PersonalPlaceRequest, SaveRequest, ScoreRequest, SearchHistoryRequest, SearchRequest, ShortlistOrderRequest
from .security import is_configured_value, require_active_user, require_user, supabase_auth_config, supabase_auth_configured
from .sources.data_gov_sg import HDB_RESALE_DATASET_ID
from .sources.data_gov_resources import SOURCES as RESOURCE_SOURCES
from .local_env import load_local_project_env

APP_NAME = os.getenv("APP_NAME", "HomeCompass")

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


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global APP_NAME
    load_local_project_env()
    APP_NAME = os.getenv("APP_NAME", APP_NAME)
    _app.title = APP_NAME
    await open_pool()
    try:
        yield
    finally:
        await close_pool()


app = FastAPI(title=APP_NAME, version="1.0.0", description="Evidence-led family home search API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if origin.strip()],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


def _home(record) -> dict:
    price_cents = record["price_observation_cents"]
    source_version = record["source_version"]
    return {
        "id": record["id"],
        "address": record["address"],
        "town": record["town"],
        "type": record["flat_type"],
        "price": float(price_cents / 100) if price_cents is not None else None,
        "score": None,
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
        "risk": "Location needed for cluster check" if record["latitude"] is None else "Inside a published active dengue-cluster polygon" if record["in_dengue_cluster"] else "No published cluster overlap",
        "highlights": [],
        "risks": ["Historical resale transaction; not a current listing"],
        "floorAreaSqm": float(record["floor_area_sqm"]) if record["floor_area_sqm"] is not None else None,
        "observedOn": record["observed_on"].isoformat() if record["observed_on"] else None,
        "geocodeStatus": record["geocode_status"],
    }


async def _query_homes(request: SearchRequest):
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
    if request.town:
        add("h.town", "ILIKE", request.town)
    if request.flat_type:
        add("h.flat_type", "ILIKE", request.flat_type)
    if request.max_school_distance_m is not None:
        add("school_access.distance_m", "<=", request.max_school_distance_m)
    if request.max_childcare_distance_m is not None:
        add("childcare_access.distance_m", "<=", request.max_childcare_distance_m)
    if request.max_care_distance_m is not None:
        add("care_access.distance_m", "<=", request.max_care_distance_m)

    where = f"WHERE {' AND '.join(predicates)}" if predicates else ""
    values.append(200)
    limit_placeholder = len(values)
    sql = _LATEST_RESOURCE_CTE + f""" SELECT h.id, h.address, h.town, h.flat_type, h.price_observation_cents, h.observed_on,
                    h.source_semantics, h.floor_area_sqm, h.geocode_status, h.geometry_source, h.geocoded_at,
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
             FROM candidate_home h JOIN source_snapshot s ON s.id = h.source_snapshot_id
             {_HOME_EVIDENCE_JOINS}
             {where} ORDER BY h.observed_on DESC NULLS LAST, h.id LIMIT ${limit_placeholder}"""
    async with pool.acquire() as connection:
        rows = await connection.fetch(sql, *values)
    return [_home(row) for row in rows]


@app.get("/health")
async def health() -> dict:
    from . import database

    return {
        "status": "ok",
        "app": APP_NAME,
        "time": datetime.now(timezone.utc).isoformat(),
        "database": "configured" if database._pool is not None else "unavailable",
        "auth": "configured" if supabase_auth_configured() else "unconfigured",
        "ai": "configured" if gemini_configuration_ready() else "unconfigured",
        "primaryDataset": HDB_RESALE_DATASET_ID,
    }


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
    limit: int = Query(default=5000, ge=1, le=10000),
) -> dict:
    """Return current imported resource layers as a bounded GeoJSON FeatureCollection."""
    pool = require_pool()
    supported = {source.resource_type for source in RESOURCE_SOURCES}
    if resource_type and (invalid := set(resource_type) - supported):
        raise HTTPException(status_code=422, detail={"code": "UNKNOWN_RESOURCE_TYPE", "types": sorted(invalid)})
    values: list[object] = [resource_type or []]
    resource_filter = "(cardinality($1::text[]) = 0 OR r.resource_type = ANY($1::text[]))"
    bounds_filter = ""
    if bounds:
        try:
            west, south, east, north = (float(item.strip()) for item in bounds.split(","))
        except (ValueError, TypeError):
            raise HTTPException(status_code=422, detail={"code": "INVALID_BOUNDS", "message": "Use west,south,east,north coordinates."}) from None
        if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
            raise HTTPException(status_code=422, detail={"code": "INVALID_BOUNDS", "message": "Bounds are outside valid longitude/latitude ranges."})
        values.extend([west, south, east, north])
        bounds_filter = f" AND ST_Intersects(r.geometry, ST_MakeEnvelope(${len(values)-3},${len(values)-2},${len(values)-1},${len(values)},4326))"
    values.append(limit)
    limit_param = len(values)
    location_filter = "TRUE" if include_unlocated and not bounds else "r.geometry IS NOT NULL"
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
                WHERE {resource_filter} AND {location_filter}{bounds_filter}
                ORDER BY r.resource_type, r.name LIMIT ${limit_param}"""
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
    features = []
    for row in rows:
        geometry = json.loads(row["geometry"]) if row["geometry"] else None
        features.append({"type": "Feature", "id": row["id"], "geometry": geometry,
                         "properties": {"name": row["name"], "resourceType": row["resource_type"], "status": row["status"],
                                        "attributes": row["attributes"], "sourceId": row["source_id"], "sourceUrl": row["source_url"],
                                        "sourceVersion": row["source_version"], "retrievedAt": row["retrieved_at"].isoformat(),
                                        "locationSourceId": row["location_source_id"], "locationRetrievedAt": row["location_retrieved_at"].isoformat() if row["location_retrieved_at"] else None}})
    return {"type": "FeatureCollection", "features": features, "count": len(features),
            "truncated": len(features) == limit,
            "counts": [{"resourceType": row["resource_type"], "total": row["total"], "unlocated": row["unlocated"]} for row in counts]}


@app.get("/api/v1/homes")
async def homes(query: str = "", budget: int | None = None, town: str | None = None) -> dict:
    request = SearchRequest(query=query, budget=budget, town=town)
    results = await _query_homes(request)
    return {"items": results, "count": len(results), "sourceStatus": {"hdb": {"state": "database-snapshot", "datasetId": HDB_RESALE_DATASET_ID}},
            "limitations": ["Records are historical resale transactions, not current listings.", "Some rows may not be geocoded or have linked amenity evidence."]}


@app.post("/api/v1/search")
async def search(request: SearchRequest) -> dict:
    pool = require_pool()
    async with pool.acquire() as connection:
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
    results = await _query_homes(effective_request)
    partial_geocode_coverage = 0 < home_coverage["geocoded"] < home_coverage["total"]
    coverage_note = (f"Only the geocoded subset is eligible for proximity filtering ({home_coverage['geocoded']:,} of {home_coverage['total']:,} transaction records have locations)." if partial_geocode_coverage and not unsupported else None)
    return {
        "items": results,
        "count": len(results),
        "criteria": request.model_dump(),
        "sourceStatus": {"hdb": {"state": "database-snapshot", "datasetId": HDB_RESALE_DATASET_ID}},
        "unappliedCriteria": unsupported,
        "limitations": (["Amenity-distance filters were not applied because transaction locations and the requested source layer are not both available."] if unsupported else []) +
                       ([coverage_note] if coverage_note else []) +
                       ["HDB resale prices are historical transaction observations, not current asking prices or available homes."],
    }


@app.get("/api/v1/homes/{home_id}")
async def home_detail(home_id: str) -> dict:
    pool = require_pool()
    async with pool.acquire() as connection:
        record = await connection.fetchrow(
            _LATEST_RESOURCE_CTE + f""" SELECT h.id, h.address, h.town, h.flat_type, h.price_observation_cents, h.observed_on,
                      h.source_semantics, h.floor_area_sqm, h.geocode_status, h.geometry_source, h.geocoded_at,
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
async def interpret(request: InterpretRequest) -> dict:
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
    return {"adults": profile["adults"], "children": profile["children"], "olderAdults": profile["older_adults"],
            "budgetCents": profile["budget_cents"], "locale": profile["locale"], "updatedAt": profile["updated_at"].isoformat()}


@app.put("/api/v1/profile")
async def update_profile(request: FamilyProfileUpdate, user: dict = Depends(require_active_user)) -> dict:
    pool = require_pool()
    async with pool.acquire() as connection:
        async with connection.transaction():
            await ensure_user(connection, user)
            await connection.execute(
                """INSERT INTO family_profile (id, user_id, adults, children, older_adults, budget_cents, locale)
                   VALUES ($1,$1,$2,$3,$4,$5,$6) ON CONFLICT (user_id) DO UPDATE SET
                   adults=EXCLUDED.adults, children=EXCLUDED.children, older_adults=EXCLUDED.older_adults,
                   budget_cents=EXCLUDED.budget_cents, locale=EXCLUDED.locale, updated_at=now()""",
                user["id"], request.adults, request.children, request.older_adults, request.budget_cents, request.locale,
            )
            profile = await ensure_profile(connection, user["id"])
    return {"adults": profile["adults"], "children": profile["children"], "olderAdults": profile["older_adults"],
            "budgetCents": profile["budget_cents"], "locale": profile["locale"], "updatedAt": profile["updated_at"].isoformat()}


@app.get("/api/v1/shortlists")
async def get_shortlist(user: dict = Depends(require_active_user)) -> dict:
    pool = require_pool()
    async with pool.acquire() as connection:
        rows = await connection.fetch(
            _LATEST_RESOURCE_CTE + f""" SELECT h.id, h.address, h.town, h.flat_type, h.price_observation_cents, h.observed_on,
                      h.source_semantics, h.floor_area_sqm, h.geocode_status, h.geometry_source, h.geocoded_at,
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
        rows = await connection.fetch("""SELECT id,label,address,ST_Y(geometry) AS latitude,ST_X(geometry) AS longitude,maximum_distance_m,updated_at
               FROM personal_place WHERE user_id=$1 ORDER BY created_at""", user["id"])
    return {"items": [{"id": str(row["id"]), "label": row["label"], "address": row["address"], "latitude": row["latitude"], "longitude": row["longitude"], "maximumDistanceM": row["maximum_distance_m"], "updatedAt": row["updated_at"].isoformat()} for row in rows]}


@app.post("/api/v1/places")
async def create_place(request: PersonalPlaceRequest, user: dict = Depends(require_active_user)) -> dict:
    pool = require_pool()
    place_id = uuid4()
    async with pool.acquire() as connection:
        await ensure_user(connection, user)
        await connection.execute("""INSERT INTO personal_place (id,user_id,label,address,geometry,maximum_distance_m)
             VALUES ($1,$2,$3,$4,ST_SetSRID(ST_MakePoint($5,$6),4326),$7)""", place_id, user["id"], request.label, request.address, request.longitude, request.latitude, request.maximum_distance_m)
    return {"id": str(place_id), **request.model_dump()}


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
async def delete_account(user: dict = Depends(require_user)) -> dict:
    project_url, _api_key = supabase_auth_config()
    service_role = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not project_url or not is_configured_value(service_role):
        raise HTTPException(status_code=503, detail={"code": "ACCOUNT_DELETE_UNCONFIGURED", "message": "Account deletion requires a server-side Supabase service-role key; no account data was changed."})
    pool = require_pool()
    async with pool.acquire() as connection:
        async with connection.transaction():
            state = await connection.fetchval("SELECT status FROM account_deletion WHERE user_id=$1 FOR UPDATE", user["id"])
            if state == "complete":
                return {"status": "complete"}
            if state is None:
                await ensure_user(connection, user)
                await connection.execute("INSERT INTO account_deletion (user_id,status) VALUES ($1,'pending_auth_delete')", user["id"])
                await connection.execute("DELETE FROM user_account WHERE id=$1", user["id"])
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.delete(
                f"{project_url.rstrip('/')}/auth/v1/admin/users/{user['id']}",
                headers={"apikey": service_role, "Authorization": f"Bearer {service_role}"},
            )
    except httpx.HTTPError as exc:
        async with pool.acquire() as connection:
            await connection.execute("UPDATE account_deletion SET last_error_code='auth_provider_unavailable' WHERE user_id=$1", user["id"])
        raise HTTPException(status_code=503, detail={"code": "ACCOUNT_DELETE_RETRYABLE", "message": "Private application data has been removed, but the identity provider is unavailable. Retry account deletion to finish."}) from exc
    if response.status_code not in {200, 204, 404}:
        async with pool.acquire() as connection:
            await connection.execute("UPDATE account_deletion SET last_error_code='auth_provider_rejected' WHERE user_id=$1", user["id"])
        raise HTTPException(status_code=503, detail={"code": "ACCOUNT_DELETE_RETRYABLE", "message": "Private application data has been removed, but Supabase could not complete account deletion. Retry or contact the administrator."})
    async with pool.acquire() as connection:
        await connection.execute("UPDATE account_deletion SET status='complete',completed_at=now(),last_error_code=NULL WHERE user_id=$1", user["id"])
    return {"status": "complete"}
