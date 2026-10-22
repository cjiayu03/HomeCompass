"""Owner-scoped saved-search persistence and rerun helpers."""

from __future__ import annotations

import json
from collections.abc import Mapping
from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from .schemas import (
    SavedSearchCreate,
    SavedSearchCriteria,
    SavedSearchPlaceConstraint,
    SavedSearchRecord,
    SavedSearchResultMeta,
    SearchRequest,
    serialize_saved_search_record,
)
from .scoring import POLICY_VERSION


class SavedSearchRename(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=80)

    @field_validator("name", mode="before")
    @classmethod
    def trim_name(cls, value):
        return value.strip() if isinstance(value, str) else value


_CURRENT_RECORD_COLUMNS = """id,user_id,name,mode,criteria,place_constraints,
    priority_weights,scoring_version,created_at,updated_at,last_run_at,
    last_source_snapshot_ids,last_result_meta"""


def _decode_json(value, default):
    if value is None:
        return default
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "SAVED_SEARCH_INVALID",
                    "message": "The saved search is invalid. Update or delete it before continuing.",
                },
            ) from None
    return value


def _as_uuid_strings(values) -> list[str]:
    try:
        return list(dict.fromkeys(str(UUID(str(value))) for value in values))[:20]
    except (TypeError, ValueError, AttributeError):
        raise HTTPException(
            status_code=409,
            detail={
                "code": "SAVED_SEARCH_INVALID",
                "message": "The saved search is invalid. Update or delete it before continuing.",
            },
        ) from None


def _record_from_row(raw_row: Mapping) -> SavedSearchRecord:
    row = dict(raw_row)
    try:
        criteria = SavedSearchCriteria.model_validate(
            _decode_json(row.get("criteria"), {})
        )
        places = _decode_json(row.get("place_constraints"), [])
        weights = _decode_json(row.get("priority_weights"), {})
        source_ids = _decode_json(row.get("last_source_snapshot_ids"), [])
        result_meta = _decode_json(row.get("last_result_meta"), None)
        return SavedSearchRecord.model_validate(
            {
                "id": row["id"],
                "name": row["name"],
                "mode": row["mode"],
                "criteria": criteria.model_dump(exclude_none=True),
                "places": places,
                "score_policy": {
                    "priority_weights": weights,
                    "scoring_version": row.get("scoring_version"),
                },
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
                "last_run_at": row.get("last_run_at"),
                "last_source_snapshot_ids": source_ids,
                "last_result_meta": result_meta,
            }
        )
    except (KeyError, TypeError, ValueError, ValidationError):
        raise HTTPException(
            status_code=409,
            detail={
                "code": "SAVED_SEARCH_INVALID",
                "message": "The saved search is invalid. Update or delete it before continuing.",
            },
        ) from None


def _serialize_record(record: SavedSearchRecord) -> dict[str, object]:
    wire = serialize_saved_search_record(record)
    wire["criteria"].pop("cursor", None)
    return wire


async def _current_source_snapshot_ids(connection) -> list[str]:
    rows = await connection.fetch(
        """SELECT id FROM (
               SELECT DISTINCT ON (source_id) id,source_id,retrieved_at
               FROM source_snapshot
               WHERE status IN ('valid','degraded')
               ORDER BY source_id,retrieved_at DESC,id DESC
           ) latest ORDER BY retrieved_at DESC,id DESC LIMIT 20"""
    )
    return _as_uuid_strings(row["id"] for row in rows)


async def list_saved_searches(connection, user_id: UUID) -> dict:
    rows = await connection.fetch(
        f"""SELECT {_CURRENT_RECORD_COLUMNS} FROM saved_search
            WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 100""",
        user_id,
    )
    return {
        "items": [_serialize_record(_record_from_row(row)) for row in rows]
    }


async def create_saved_search(
    connection, user_id: UUID, request: SavedSearchCreate
) -> dict:
    criteria = SearchRequest.model_validate(request.criteria.model_dump())
    criteria.cursor = None
    criteria_json = criteria.model_dump(mode="json", exclude_none=True)
    places = [
        place.model_dump(mode="json") for place in request.place_constraints or []
    ]
    if places:
        requested_ids = [UUID(place["place_id"]) for place in places]
        owned_rows = await connection.fetch(
            "SELECT id FROM personal_place WHERE user_id=$1 AND id = ANY($2::uuid[])",
            user_id,
            requested_ids,
        )
        owned_ids = {str(UUID(str(row["id"]))) for row in owned_rows}
        if any(str(place_id) not in owned_ids for place_id in requested_ids):
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "PLACE_CONSTRAINT_UNAVAILABLE",
                    "message": "One or more selected places are unavailable.",
                },
            )
    weights = dict(request.priority_weights or {})
    scoring_version = request.scoring_version or POLICY_VERSION
    source_snapshot_ids = (
        [str(snapshot_id) for snapshot_id in request.last_source_snapshot_ids]
        if request.last_source_snapshot_ids is not None
        else await _current_source_snapshot_ids(connection)
    )
    result_meta = (
        request.last_result_meta.model_dump(mode="json", by_alias=True)
        if request.last_result_meta is not None
        else None
    )

    row = await connection.fetchrow(
        f"""INSERT INTO saved_search
               (id,user_id,name,mode,criteria,place_constraints,priority_weights,
                scoring_version,last_run_at,last_source_snapshot_ids,last_result_meta)
             VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10::jsonb,$11::jsonb)
             RETURNING {_CURRENT_RECORD_COLUMNS}""",
        uuid4(),
        user_id,
        request.name,
        request.mode,
        json.dumps(criteria_json),
        json.dumps(places),
        json.dumps(weights),
        scoring_version,
        request.last_run_at,
        json.dumps(source_snapshot_ids),
        json.dumps(result_meta),
    )
    return {"item": _serialize_record(_record_from_row(row))}


async def rename_saved_search(
    connection, search_id: UUID, user_id: UUID, name: str
) -> dict:
    row = await connection.fetchrow(
        f"""UPDATE saved_search SET name=$3,updated_at=now()
             WHERE id=$1 AND user_id=$2 RETURNING {_CURRENT_RECORD_COLUMNS}""",
        search_id,
        user_id,
        name,
    )
    if row is None:
        raise HTTPException(
            status_code=404,
            detail={
                "code": "SAVED_SEARCH_NOT_FOUND",
                "message": "The saved search was not found.",
            },
        )
    return {"item": _serialize_record(_record_from_row(row))}


async def delete_saved_search(connection, search_id: UUID, user_id: UUID) -> dict:
    result = await connection.execute(
        "DELETE FROM saved_search WHERE id=$1 AND user_id=$2",
        search_id,
        user_id,
    )
    return {"status": "deleted" if result.endswith(" 1") else "absent"}


def _safe_current_metadata(search_result: Mapping) -> SavedSearchResultMeta:
    source_summary = []
    for source in search_result.get("sourceSummary", [])[:20]:
        if not isinstance(source, Mapping):
            continue
        source_id = source.get("sourceId")
        retrieved_at = source.get("retrievedAt")
        if not isinstance(source_id, str) or not retrieved_at:
            continue
        source_summary.append(
            {
                "sourceId": source_id[:80],
                "sourceVersion": (
                    source.get("sourceVersion")[:120]
                    if isinstance(source.get("sourceVersion"), str)
                    else None
                ),
                "retrievedAt": retrieved_at,
            }
        )
    warnings = [
        warning[:240]
        for warning in search_result.get("warnings", [])[:20]
        if isinstance(warning, str)
    ]
    return SavedSearchResultMeta.model_validate(
        {
            "dataMode": search_result.get("dataMode", "live"),
            "retrievedAt": search_result.get("retrievedAt")
            or datetime.now(timezone.utc),
            "sourceSummary": source_summary,
            "warnings": warnings,
            "count": search_result["count"],
            "total": search_result["total"],
            "scorePolicyVersion": search_result.get("scorePolicyVersion")
            or POLICY_VERSION,
        }
    )


def _saved_place_constraints(row: Mapping) -> tuple[list[dict], SearchRequest]:
    raw_constraints = _decode_json(row.get("place_constraints"), [])
    try:
        saved_criteria = SavedSearchCriteria.model_validate(
            _decode_json(row.get("criteria"), {})
        )
        criteria = SearchRequest.model_validate(saved_criteria.model_dump())
        criteria.cursor = None
        constraints = [
            SavedSearchPlaceConstraint.model_validate(item).model_dump(mode="json")
            for item in raw_constraints
        ]
    except (TypeError, ValueError, ValidationError):
        raise HTTPException(
            status_code=409,
            detail={
                "code": "SAVED_SEARCH_INVALID",
                "message": "The saved search is invalid. Update or delete it before continuing.",
            },
        ) from None

    criteria_constraints = [
        item.model_dump(mode="json") for item in criteria.place_constraints
    ]
    if constraints != criteria_constraints:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "SAVED_SEARCH_INVALID",
                "message": "The saved place constraints do not match this search.",
            },
        )
    return constraints, criteria


def _meta_from_row(row: Mapping) -> SavedSearchResultMeta | None:
    raw_meta = _decode_json(row.get("last_result_meta"), None)
    if raw_meta is None:
        return None
    try:
        return SavedSearchResultMeta.model_validate(raw_meta)
    except (TypeError, ValueError, ValidationError):
        raise HTTPException(
            status_code=409,
            detail={
                "code": "SAVED_SEARCH_INVALID",
                "message": "The saved search is invalid. Update or delete it before continuing.",
            },
        ) from None


async def run_saved_search(pool, search_id: UUID, user: dict, search_runner) -> dict:
    user_id = user["id"]
    async with pool.acquire() as connection:
        row = await connection.fetchrow(
            f"""SELECT {_CURRENT_RECORD_COLUMNS} FROM saved_search
                WHERE id=$1 AND user_id=$2""",
            search_id,
            user_id,
        )
        if row is None:
            raise HTTPException(
                status_code=404,
                detail={
                    "code": "SAVED_SEARCH_NOT_FOUND",
                    "message": "The saved search was not found.",
                },
            )
        row = dict(row)

        constraints, criteria = _saved_place_constraints(row)
        previous_source_ids = _as_uuid_strings(
            _decode_json(row.get("last_source_snapshot_ids"), [])
        )
        previous_meta = _meta_from_row(row)
        saved_policy_version = row.get("scoring_version")
        previous_policy_version = (
            previous_meta.score_policy_version
            if previous_meta and previous_meta.score_policy_version
            else saved_policy_version
        )

        if constraints:
            requested_ids = [UUID(item["place_id"]) for item in constraints]
            owned_rows = await connection.fetch(
                "SELECT id FROM personal_place WHERE user_id=$1 AND id = ANY($2::uuid[])",
                user_id,
                requested_ids,
            )
            owned_ids = {str(UUID(str(item["id"]))) for item in owned_rows}
            missing_ids = [
                str(place_id)
                for place_id in requested_ids
                if str(place_id) not in owned_ids
            ]
            if missing_ids:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "SAVED_SEARCH_PLACE_UNAVAILABLE",
                        "message": "One or more saved places are unavailable. Update the saved search before rerunning it.",
                        "missingPlaceIds": missing_ids,
                    },
                )

    search_result = await search_runner(criteria, user=user)
    current_meta = _safe_current_metadata(search_result)
    current_source_ids = _as_uuid_strings(
        search_result.get("sourceSnapshotIds", [])
    )
    run_at = datetime.now(timezone.utc)
    current_policy_version = current_meta.score_policy_version
    previous_count = previous_meta.count if previous_meta is not None else None
    previous_total = previous_meta.total if previous_meta is not None else None

    prior_metadata = {
        "lastRunAt": row.get("last_run_at").isoformat()
        if row.get("last_run_at") is not None
        else None,
        "sourceSnapshotIds": previous_source_ids,
        "result": previous_meta.model_dump(mode="json", by_alias=True)
        if previous_meta is not None
        else None,
        "scorePolicyVersion": previous_policy_version,
    }

    async with pool.acquire() as connection:
        updated = await connection.fetchrow(
            """UPDATE saved_search SET last_run_at=$3,updated_at=$3,
                   last_source_snapshot_ids=$4::jsonb,last_result_meta=$5::jsonb
                 WHERE id=$1 AND user_id=$2
                 RETURNING id""",
            search_id,
            user_id,
            run_at,
            json.dumps(current_source_ids),
            json.dumps(current_meta.model_dump(mode="json", by_alias=True)),
        )
        if updated is None:
            raise HTTPException(
                status_code=404,
                detail={
                    "code": "SAVED_SEARCH_NOT_FOUND",
                    "message": "The saved search was not found.",
                },
            )

    page_count_difference = {
        "previous": previous_count,
        "current": current_meta.count,
        "delta": current_meta.count - previous_count
        if previous_count is not None
        else None,
    }
    difference = {
        # Keep `count` for existing clients; `pageCount` makes its scope explicit.
        "count": page_count_difference,
        "pageCount": dict(page_count_difference),
        "total": {
            "previous": previous_total,
            "current": current_meta.total,
            "delta": current_meta.total - previous_total
            if previous_total is not None
            else None,
        },
        "sourceSnapshots": {
            "previous": previous_source_ids,
            "current": current_source_ids,
            "added": [item for item in current_source_ids if item not in previous_source_ids],
            "removed": [item for item in previous_source_ids if item not in current_source_ids],
        },
        "scorePolicyVersion": {
            "previous": previous_policy_version,
            "current": current_policy_version,
            "changed": previous_policy_version != current_policy_version,
        },
    }

    return {
        "items": search_result.get("items", []),
        "hasMore": search_result["hasMore"],
        "nextCursor": search_result["nextCursor"],
        "metadata": current_meta.model_dump(mode="json", by_alias=True),
        "sourceSnapshotIds": current_source_ids,
        "priorMetadata": prior_metadata,
        "difference": difference,
    }
