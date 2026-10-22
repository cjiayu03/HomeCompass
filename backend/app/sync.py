from __future__ import annotations

import json
from uuid import uuid4

from fastapi import HTTPException

from .scoring import DEFAULT_WEIGHTS
from .schemas import GuestSyncRequest


_PROFILE_COLUMNS = {
    "adults": "adults",
    "children": "children",
    "older_adults": "older_adults",
    "budget_cents": "budget_cents",
    "locale": "locale",
}


def _canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _decode_stored_result(value: object) -> dict:
    if isinstance(value, str):
        value = json.loads(value)
    return dict(value)


def _unavailable_input(code: str, message: str) -> HTTPException:
    return HTTPException(status_code=422, detail={"code": code, "message": message})


async def _validate_referenced_data(connection, request: GuestSyncRequest) -> None:
    home_ids = list(
        dict.fromkeys(request.shortlist_home_ids + request.compare_home_ids)
    )
    if home_ids:
        rows = await connection.fetch(
            "SELECT id FROM candidate_home WHERE id = ANY($1::text[])", home_ids
        )
        found = {row["id"] for row in rows}
        if found != set(home_ids):
            raise _unavailable_input(
                "GUEST_HOME_UNAVAILABLE",
                "One or more selected homes are no longer available.",
            )

    source_ids = sorted(
        {source_id for entry in request.history for source_id in entry.source_snapshot_ids}
    )
    if source_ids:
        rows = await connection.fetch(
            "SELECT id FROM source_snapshot WHERE id = ANY($1::uuid[])", source_ids
        )
        found = {str(row["id"]) for row in rows}
        if found != {str(source_id) for source_id in source_ids}:
            raise _unavailable_input(
                "GUEST_SOURCE_UNAVAILABLE",
                "One or more saved search sources are no longer available.",
            )


async def _merge_brief(connection, user_id, brief, confirm_brief: bool) -> tuple[list, list, list]:
    if brief is None:
        return [], [], []

    brief_values = {
        "adults": brief.adults,
        "children": brief.children,
        "older_adults": brief.older_adults,
        "budget_cents": brief.budget_cents,
        "locale": brief.locale,
    }
    if all(value is None for value in brief_values.values()) and brief.priority_weights is None:
        return [], [], []

    profile = await connection.fetchrow(
        """SELECT id, adults, children, older_adults, budget_cents, locale
           FROM family_profile WHERE user_id=$1 FOR UPDATE""",
        user_id,
    )
    profile_created = profile is None
    if profile_created:
        profile_id = uuid4()
        await connection.execute(
            """INSERT INTO family_profile (id, user_id, adults, children, older_adults)
               VALUES ($1, $2, 1, 0, 0) ON CONFLICT (user_id) DO NOTHING""",
            profile_id,
            user_id,
        )
        profile = {
            "id": profile_id,
            "adults": 1,
            "children": 0,
            "older_adults": 0,
            "budget_cents": None,
            "locale": "en-SG",
        }

    accepted_fields: list[str] = []
    skipped_fields: list[str] = []
    conflicts: list[dict[str, str]] = []
    for field, value in brief_values.items():
        if value is None:
            continue
        column = _PROFILE_COLUMNS[field]
        current_value = profile[column]
        has_account_value = not profile_created and current_value is not None
        if has_account_value and current_value != value and not confirm_brief:
            conflicts.append(
                {"field": f"brief.{field}", "resolution": "account_preserved"}
            )
            skipped_fields.append(field)
            continue
        if current_value != value:
            await connection.execute(
                f"UPDATE family_profile SET {column}=$2, updated_at=now() WHERE id=$1",
                profile["id"],
                value,
            )
        accepted_fields.append(field)
        if has_account_value and current_value != value:
            conflicts.append(
                {
                    "field": f"brief.{field}",
                    "resolution": "replaced_after_confirmation",
                }
            )

    if brief.priority_weights is not None:
        weight_rows = await connection.fetch(
            "SELECT criterion, weight FROM criterion_weight WHERE profile_id=$1",
            profile["id"],
        )
        existing_weights = dict(DEFAULT_WEIGHTS)
        existing_weights.update(
            {row["criterion"]: float(row["weight"]) for row in weight_rows}
        )
        for criterion, value in brief.priority_weights.items():
            current_value = existing_weights.get(criterion)
            field = f"priority_weights.{criterion}"
            if current_value is not None and current_value != value and not confirm_brief:
                conflicts.append(
                    {
                        "field": f"brief.{field}",
                        "resolution": "account_preserved",
                    }
                )
                skipped_fields.append(field)
                continue
            if current_value is None or current_value != value:
                await connection.execute(
                    """INSERT INTO criterion_weight (profile_id, criterion, weight)
                       VALUES ($1, $2, $3)
                       ON CONFLICT (profile_id, criterion)
                       DO UPDATE SET weight=EXCLUDED.weight""",
                    profile["id"],
                    criterion,
                    value,
                )
            accepted_fields.append(field)
            if current_value is not None and current_value != value:
                conflicts.append(
                    {
                        "field": f"brief.{field}",
                        "resolution": "replaced_after_confirmation",
                    }
                )

    return accepted_fields, skipped_fields, conflicts


async def _merge_shortlist(connection, user_id, home_ids: list[str]) -> tuple[int, int]:
    if not home_ids:
        return 0, 0

    shortlist = await connection.fetchrow(
        """SELECT id FROM shortlist WHERE user_id=$1
           ORDER BY created_at LIMIT 1 FOR UPDATE""",
        user_id,
    )
    if shortlist is None:
        shortlist_id = uuid4()
        await connection.execute(
            "INSERT INTO shortlist (id, user_id, name) VALUES ($1, $2, 'Family shortlist')",
            shortlist_id,
            user_id,
        )
        entries = []
    else:
        shortlist_id = shortlist["id"]
        entries = await connection.fetch(
            "SELECT candidate_home_id, position FROM shortlist_entry WHERE shortlist_id=$1",
            shortlist_id,
        )

    existing_ids = {row["candidate_home_id"] for row in entries}
    next_position = max((row["position"] for row in entries), default=-1) + 1
    accepted_count = 0
    skipped_count = 0
    for home_id in home_ids:
        if home_id in existing_ids:
            skipped_count += 1
            continue
        await connection.execute(
            """INSERT INTO shortlist_entry (shortlist_id, candidate_home_id, position)
               VALUES ($1, $2, $3)
               ON CONFLICT (shortlist_id, candidate_home_id) DO NOTHING""",
            shortlist_id,
            home_id,
            next_position,
        )
        existing_ids.add(home_id)
        next_position += 1
        accepted_count += 1

    if accepted_count:
        await connection.execute(
            "UPDATE shortlist SET updated_at=now() WHERE id=$1", shortlist_id
        )
    return accepted_count, skipped_count


async def _merge_history(connection, user_id, history) -> tuple[int, int, list[int]]:
    accepted_count = 0
    skipped_count = 0
    retryable_indexes: list[int] = []
    seen: set[tuple[str, str, tuple[str, ...]]] = set()
    referenced_place_ids = sorted(
        {
            constraint.place_id
            for entry in history
            for constraint in entry.criteria.place_constraints
        },
        key=str,
    )
    owned_place_ids = set()
    if referenced_place_ids:
        place_rows = await connection.fetch(
            """SELECT id FROM personal_place
               WHERE user_id=$1 AND id=ANY($2::uuid[])
               FOR KEY SHARE""",
            user_id,
            referenced_place_ids,
        )
        owned_place_ids = {row["id"] for row in place_rows}

    for index, entry in enumerate(history):
        entry_place_ids = {
            constraint.place_id for constraint in entry.criteria.place_constraints
        }
        if not entry_place_ids.issubset(owned_place_ids):
            skipped_count += 1
            retryable_indexes.append(index)
            continue

        criteria_json = _canonical_json(
            entry.criteria.model_dump(mode="json", exclude_none=True)
        )
        source_ids = sorted(str(source_id) for source_id in entry.source_snapshot_ids)
        signature = (entry.mode, criteria_json, tuple(source_ids))
        if signature in seen:
            skipped_count += 1
            continue
        seen.add(signature)

        exists = await connection.fetchval(
            """SELECT EXISTS (
                 SELECT 1 FROM search_history AS history
                 WHERE history.user_id=$1 AND history.mode=$2
                   AND history.criteria=$3::jsonb
                   AND ARRAY(
                     SELECT snapshot_id
                     FROM jsonb_array_elements_text(history.source_snapshot_ids)
                          AS snapshots(snapshot_id)
                     ORDER BY snapshot_id
                   ) = $4::text[]
               )""",
            user_id,
            entry.mode,
            criteria_json,
            source_ids,
        )
        if exists:
            skipped_count += 1
            continue

        await connection.execute(
            """INSERT INTO search_history
                 (id, user_id, mode, criteria, source_snapshot_ids, scoring_version)
               VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)""",
            uuid4(),
            user_id,
            entry.mode,
            criteria_json,
            _canonical_json(source_ids),
            entry.scoring_version,
        )
        accepted_count += 1

    return accepted_count, skipped_count, retryable_indexes


def _deduplicated_places(places) -> list:
    unique = []
    seen: set[tuple] = set()
    for place in places or []:
        fingerprint = (
            place.label.casefold(),
            (place.address or "").casefold(),
            round(place.longitude, 6),
            round(place.latitude, 6),
            place.maximum_distance_m,
            place.kind.value,
        )
        if fingerprint not in seen:
            seen.add(fingerprint)
            unique.append(place)
    return unique


async def _merge_places(connection, user_id, places, confirm_places: bool) -> tuple[int, int]:
    unique_places = _deduplicated_places(places)
    if not confirm_places:
        return 0, len(unique_places)

    accepted_count = 0
    skipped_count = 0
    for place in unique_places:
        exists = await connection.fetchval(
            """SELECT EXISTS (
                 SELECT 1 FROM personal_place
                 WHERE user_id=$1
                   AND lower(btrim(label))=lower(btrim($2))
                   AND COALESCE(lower(btrim(address)), '')
                       = COALESCE(lower(btrim($3)), '')
                   AND round(ST_X(geometry)::numeric, 6)=round($4::numeric, 6)
                   AND round(ST_Y(geometry)::numeric, 6)=round($5::numeric, 6)
                   AND maximum_distance_m IS NOT DISTINCT FROM $6
                   AND kind=$7
               )""",
            user_id,
            place.label,
            place.address,
            place.longitude,
            place.latitude,
            place.maximum_distance_m,
            place.kind.value,
        )
        if exists:
            skipped_count += 1
            continue

        await connection.execute(
            """INSERT INTO personal_place
                 (id, user_id, label, address, geometry, maximum_distance_m, kind)
               VALUES ($1, $2, $3, $4,
                       ST_SetSRID(ST_MakePoint($5, $6), 4326), $7, $8)""",
            uuid4(),
            user_id,
            place.label,
            place.address,
            place.longitude,
            place.latitude,
            place.maximum_distance_m,
            place.kind.value,
        )
        accepted_count += 1

    return accepted_count, skipped_count


async def merge_guest_data(connection, user: dict, request: GuestSyncRequest) -> dict:
    """Atomically merge validated guest state into the authenticated account."""
    user_id = user["id"]
    async with connection.transaction():
        status = await connection.fetchval(
            "SELECT status FROM user_account WHERE id=$1 FOR UPDATE", user_id
        )
        if status != "active":
            raise HTTPException(
                status_code=403,
                detail={"code": "ACCOUNT_INACTIVE", "message": "This account is not active."},
            )

        stored = await connection.fetchrow(
            """SELECT result FROM account_sync_event
               WHERE user_id=$1 AND sync_key=$2""",
            user_id,
            request.sync_key,
        )
        if stored is not None:
            return _decode_stored_result(stored["result"])

        await _validate_referenced_data(connection, request)

        accepted_fields, skipped_fields, conflicts = await _merge_brief(
            connection, user_id, request.brief, request.confirm_brief
        )
        accepted_shortlist, skipped_shortlist = await _merge_shortlist(
            connection, user_id, request.shortlist_home_ids
        )
        (
            accepted_history,
            skipped_history,
            retryable_history_indexes,
        ) = await _merge_history(connection, user_id, request.history)
        accepted_places, skipped_places = await _merge_places(
            connection, user_id, request.places, request.confirm_places
        )

        result = {
            "accepted": {
                "briefFields": accepted_fields,
                "shortlistHomeIds": accepted_shortlist,
                "compareHomeIds": request.compare_home_ids,
                "history": accepted_history,
                "places": accepted_places,
            },
            "skipped": {
                "briefFields": skipped_fields,
                "shortlistHomeIds": skipped_shortlist,
                "history": skipped_history,
                "retryableHistoryIndexes": retryable_history_indexes,
                "places": skipped_places,
            },
            "conflicts": conflicts,
            "syncKey": request.sync_key,
        }
        await connection.execute(
            """INSERT INTO account_sync_event (user_id, sync_key, result)
               VALUES ($1, $2, $3::jsonb)""",
            user_id,
            request.sync_key,
            _canonical_json(result),
        )
        return result
