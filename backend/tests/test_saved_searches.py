import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

import httpx
import pytest
from pydantic import ValidationError

from app import main
import app.schemas as schemas
from app.security import require_active_user


def test_saved_search_migration_has_owned_jsonb_record_and_user_updated_index():
    migration = (
        Path(__file__).resolve().parents[2]
        / "database"
        / "migrations"
        / "007_saved_searches.sql"
    )
    assert migration.exists(), "saved-search migration 007 has not been created"
    sql = " ".join(migration.read_text().split())

    assert "CREATE TABLE IF NOT EXISTS saved_search" in sql
    assert "user_id uuid NOT NULL REFERENCES user_account(id) ON DELETE CASCADE" in sql
    assert "criteria jsonb NOT NULL" in sql
    assert "created_at timestamptz NOT NULL" in sql
    assert "updated_at timestamptz NOT NULL" in sql
    assert "last_run_at timestamptz" in sql
    assert "last_source_snapshot_ids jsonb NOT NULL" in sql
    assert "last_result_meta jsonb" in sql
    assert (
        "CASE WHEN NOT (last_result_meta ? 'sourceSummary') THEN TRUE "
        "WHEN jsonb_typeof(last_result_meta->'sourceSummary') = 'array' THEN "
        "jsonb_array_length(last_result_meta->'sourceSummary') <= 20 ELSE FALSE END"
    ) in sql
    assert (
        "CASE WHEN NOT (last_result_meta ? 'warnings') THEN TRUE "
        "WHEN jsonb_typeof(last_result_meta->'warnings') = 'array' THEN "
        "jsonb_array_length(last_result_meta->'warnings') <= 20 ELSE FALSE END"
    ) in sql
    assert "ON saved_search (user_id, updated_at" in sql


def test_saved_search_record_serializes_bounded_history_with_wire_aliases():
    record_model = getattr(schemas, "SavedSearchRecord", None)
    serializer = getattr(schemas, "serialize_saved_search_record", None)
    assert record_model is not None, "saved-search response schema has not been implemented"
    assert callable(serializer), "saved-search response serializer has not been implemented"

    now = datetime(2026, 10, 20, tzinfo=timezone.utc)
    record = record_model.model_validate(
        {
            "id": "17a5dcbb-a2ce-4bc9-9236-511a563a0d58",
            "name": "Bishan family search",
            "mode": "structured",
            "criteria": {"query": "Bishan", "limit": 20},
            "places": [
                {
                    "place_id": "c4c0f6aa-6dcb-44a0-9000-bc0caaad08f0",
                    "max_distance_m": 5_000,
                }
            ],
            "score_policy": {
                "priority_weights": {"school": 1.5},
                "scoring_version": "home-fit-v1",
            },
            "created_at": now,
            "updated_at": now,
            "last_run_at": now,
            "last_source_snapshot_ids": [
                "c4c0f6aa-6dcb-44a0-9000-bc0caaad08f0"
            ],
            "last_result_meta": {
                "data_mode": "live",
                "retrieved_at": now,
                "source_summary": [],
                "warnings": [],
                "count": 1,
                "total": 1,
                "score_policy_version": "home-fit-v1",
            },
        }
    )

    wire = serializer(record)

    assert wire["id"] == "17a5dcbb-a2ce-4bc9-9236-511a563a0d58"
    assert wire["places"] == [
        {
            "placeId": "c4c0f6aa-6dcb-44a0-9000-bc0caaad08f0",
            "maxDistanceM": 5_000,
        }
    ]
    assert wire["scorePolicy"]["scoringVersion"] == "home-fit-v1"
    assert wire["createdAt"] == "2026-10-20T00:00:00Z"
    assert wire["lastRunAt"] == "2026-10-20T00:00:00Z"
    assert wire["lastSourceSnapshotIds"] == [
        "c4c0f6aa-6dcb-44a0-9000-bc0caaad08f0"
    ]
    assert wire["lastResultMeta"]["dataMode"] == "live"
    assert wire["lastResultMeta"]["scorePolicyVersion"] == "home-fit-v1"

    with pytest.raises(ValidationError):
        record_model.model_validate(
            {
                "id": UUID("17a5dcbb-a2ce-4bc9-9236-511a563a0d58"),
                "name": "Bishan family search",
                "mode": "structured",
                "criteria": {"query": "Bishan"},
                "score_policy": {},
                "created_at": now,
                "updated_at": now,
                "last_source_snapshot_ids": [
                    "c4c0f6aa-6dcb-44a0-9000-bc0caaad08f0"
                ]
                * 21,
            }
        )


USER_A = UUID("29e8a098-2552-4a1a-9cb2-4beae219ec3f")
USER_B = UUID("d994835b-b4a8-43f5-8110-63e9d941c69c")
SEARCH_ID = UUID("17a5dcbb-a2ce-4bc9-9236-511a563a0d58")
PLACE_ID = UUID("c4c0f6aa-6dcb-44a0-9000-bc0caaad08f0")
SNAPSHOT_OLD = UUID("1480fbdc-0ce0-4a9b-af99-c1ac09a5818c")
SNAPSHOT_NEW = UUID("e14f00c4-4d8c-4e70-807e-49c70cd3ba53")
SNAPSHOT_LATEST = UUID("f0c32c43-bcf9-40e2-bca8-c66f5dca67f5")
NOW = datetime(2026, 10, 20, 9, 30, tzinfo=timezone.utc)
INITIAL_RUN_AT = "2026-10-20T09:15:00+00:00"
INITIAL_RESULT_META = {
    "dataMode": "live",
    "retrievedAt": "2026-10-20T09:15:00+00:00",
    "sourceSummary": [
        {
            "sourceId": "hdb-resale",
            "sourceVersion": "2026-10",
            "retrievedAt": "2026-10-20T09:00:00+00:00",
        }
    ],
    "warnings": ["Historical transactions only."],
    "count": 2,
    "total": 7,
    "scorePolicyVersion": "home-fit-v1",
}


def _saved_row(
    *,
    search_id=SEARCH_ID,
    user_id=USER_A,
    place_constraints=(),
    source_snapshot_ids=(SNAPSHOT_OLD,),
    last_result_meta=None,
    scoring_version="home-fit-v1",
):
    criteria = {
        "query": "Bishan",
        "limit": 20,
        "priority_weights": {"school": 1.5},
        "place_constraints": [
            {"place_id": str(place_id), "max_distance_m": 5_000}
            for place_id, _distance in place_constraints
        ],
    }
    return {
        "id": search_id,
        "user_id": user_id,
        "name": "Bishan family search",
        "mode": "structured",
        "criteria": criteria,
        "place_constraints": [
            {"place_id": str(place_id), "max_distance_m": distance}
            for place_id, distance in place_constraints
        ],
        "priority_weights": {"school": 1.5},
        "scoring_version": scoring_version,
        "created_at": NOW,
        "updated_at": NOW,
        "last_run_at": NOW if last_result_meta is not None else None,
        "last_source_snapshot_ids": list(source_snapshot_ids),
        "last_result_meta": last_result_meta,
    }


def _decode_json(value):
    return json.loads(value) if isinstance(value, str) else value


class _SavedSearchConnection:
    def __init__(self, rows=(), source_rows=(), place_owners=None, histories=()):
        self.records = [dict(row) for row in rows]
        self.source_rows = [dict(row) for row in source_rows]
        self.place_owners = dict(place_owners or {})
        self.histories = [dict(row) for row in histories]
        self.operations = []

    async def fetch(self, sql, *values):
        self.operations.append((sql, values))
        normalized = " ".join(sql.split()).lower()
        if "from saved_search" in normalized:
            assert "where user_id=$1" in normalized
            return [row for row in self.records if row["user_id"] == values[0]]
        if "from source_snapshot" in normalized:
            return list(self.source_rows)
        if "from personal_place" in normalized:
            assert "where user_id=$1" in normalized
            user_id, requested_ids = values
            return [
                {"id": place_id}
                for place_id in requested_ids
                if self.place_owners.get(place_id) == user_id
            ]
        if "from search_history" in normalized:
            assert "where user_id=$1" in normalized
            return [row for row in self.histories if row["user_id"] == values[0]]
        raise AssertionError(f"Unexpected fetch query: {sql}")

    async def fetchrow(self, sql, *values):
        self.operations.append((sql, values))
        normalized = " ".join(sql.split()).lower()
        if normalized.startswith("select") and "from saved_search" in normalized:
            assert "where id=$1 and user_id=$2" in normalized
            search_id, user_id = values
            return next(
                (
                    dict(row)
                    for row in self.records
                    if row["id"] == search_id and row["user_id"] == user_id
                ),
                None,
            )
        if normalized.startswith("insert into saved_search"):
            (
                search_id,
                user_id,
                name,
                mode,
                criteria,
                places,
                weights,
                scoring_version,
                last_run_at,
                source_snapshot_ids,
                result_meta,
            ) = values
            row = {
                "id": search_id,
                "user_id": user_id,
                "name": name,
                "mode": mode,
                "criteria": _decode_json(criteria),
                "place_constraints": _decode_json(places),
                "priority_weights": _decode_json(weights),
                "scoring_version": scoring_version,
                "created_at": NOW,
                "updated_at": NOW,
                "last_run_at": last_run_at,
                "last_source_snapshot_ids": _decode_json(source_snapshot_ids),
                "last_result_meta": _decode_json(result_meta),
            }
            self.records.append(row)
            return dict(row)
        if normalized.startswith("update saved_search set name="):
            search_id, user_id, name = values
            for row in self.records:
                if row["id"] == search_id and row["user_id"] == user_id:
                    row["name"] = name
                    row["updated_at"] = NOW
                    return dict(row)
            return None
        if normalized.startswith("update saved_search set last_run_at="):
            search_id, user_id, last_run_at, source_ids, result_meta = values
            for row in self.records:
                if row["id"] == search_id and row["user_id"] == user_id:
                    row["last_run_at"] = last_run_at
                    row["last_source_snapshot_ids"] = _decode_json(source_ids)
                    row["last_result_meta"] = _decode_json(result_meta)
                    row["updated_at"] = last_run_at
                    return dict(row)
            return None
        raise AssertionError(f"Unexpected fetchrow query: {sql}")

    async def execute(self, sql, *values):
        self.operations.append((sql, values))
        normalized = " ".join(sql.split()).lower()
        if normalized.startswith("delete from saved_search"):
            search_id, user_id = values
            old_count = len(self.records)
            self.records = [
                row
                for row in self.records
                if not (row["id"] == search_id and row["user_id"] == user_id)
            ]
            return f"DELETE {old_count - len(self.records)}"
        raise AssertionError(f"Unexpected execute query: {sql}")


class _SavedSearchPool:
    def __init__(self, connection):
        self.connection = connection
        self.active_connections = 0

    def acquire(self):
        return self

    async def __aenter__(self):
        self.active_connections += 1
        return self.connection

    async def __aexit__(self, *_args):
        self.active_connections -= 1
        return None


def _set_active_user(monkeypatch, user_id=USER_A):
    async def active_user():
        return {"id": user_id}

    monkeypatch.setitem(main.app.dependency_overrides, require_active_user, active_user)


def _api(method, path, *, payload=None):
    async def send():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app), base_url="http://test"
        ) as client:
            return await client.request(method, path, json=payload)

    return asyncio.run(send())


def test_snapshot_ids_are_derived_from_rows_used_for_result_source_summary():
    result_rows = [
        {
            "source_snapshot_id": SNAPSHOT_NEW,
            "source_id": "hdb-resale",
            "source_version": "2026-10",
            "retrieved_at": datetime(2026, 10, 20, 9, 0, tzinfo=timezone.utc),
        },
        {
            "source_snapshot_id": SNAPSHOT_NEW,
            "source_id": "hdb-resale",
            "source_version": "2026-10",
            "retrieved_at": datetime(2026, 10, 20, 9, 0, tzinfo=timezone.utc),
        },
    ]

    assert main._source_summary(result_rows) == [
        {
            "sourceId": "hdb-resale",
            "sourceVersion": "2026-10",
            "retrievedAt": "2026-10-20T09:00:00+00:00",
        }
    ]
    assert main._result_source_snapshot_ids(result_rows) == [str(SNAPSHOT_NEW)]


def test_saved_search_list_is_scoped_to_the_active_owner(monkeypatch):
    connection = _SavedSearchConnection(
        rows=[
            _saved_row(search_id=SEARCH_ID, user_id=USER_A),
            _saved_row(search_id=UUID(int=18), user_id=USER_B),
        ]
    )
    pool = _SavedSearchPool(connection)
    monkeypatch.setattr(main, "require_pool", lambda: pool)
    _set_active_user(monkeypatch)

    response = _api("GET", "/api/v1/saved-searches")

    assert response.status_code == 200
    assert [item["id"] for item in response.json()["items"]] == [str(SEARCH_ID)]
    sql, values = connection.operations[0]
    assert "WHERE user_id=$1" in sql
    assert values == (USER_A,)


def test_saved_search_create_normalizes_cursor_and_captures_source_and_policy(monkeypatch):
    connection = _SavedSearchConnection(
        source_rows=[{"id": SNAPSHOT_OLD, "source_id": "hdb-resale"}],
        place_owners={PLACE_ID: USER_A},
    )
    monkeypatch.setattr(main, "require_pool", lambda: _SavedSearchPool(connection))
    _set_active_user(monkeypatch)

    response = _api(
        "POST",
        "/api/v1/saved-searches",
        payload={
            "name": "  Bishan family search  ",
            "mode": "structured",
            "criteria": {
                "query": "Bishan",
                "limit": 20,
                "cursor": "must-not-be-saved",
                "place_constraints": [
                    {"place_id": str(PLACE_ID), "max_distance_m": 5_000}
                ],
            },
            "scoring_version": "home-fit-v1",
        },
    )

    assert response.status_code == 201
    item = response.json()["item"]
    assert item["name"] == "Bishan family search"
    assert "cursor" not in item["criteria"]
    assert item["criteria"]["limit"] == 20
    assert item["criteria"]["place_constraints"] == [
        {"place_id": str(PLACE_ID), "max_distance_m": 5_000}
    ]
    assert item["scorePolicy"]["scoringVersion"] == "home-fit-v1"
    assert item["lastSourceSnapshotIds"] == [str(SNAPSHOT_OLD)]
    assert item["lastResultMeta"] is None
    insert_sql, insert_values = next(
        (sql, values)
        for sql, values in connection.operations
        if sql.lstrip().startswith("INSERT INTO saved_search")
    )
    assert "$1" in insert_sql and "$11::jsonb" in insert_sql
    assert insert_values[1] == USER_A
    assert _decode_json(insert_values[4])["query"] == "Bishan"
    assert "cursor" not in _decode_json(insert_values[4])
    assert _decode_json(insert_values[9]) == [str(SNAPSHOT_OLD)]


def test_saved_search_create_persists_initial_run_baseline(monkeypatch):
    connection = _SavedSearchConnection(
        source_rows=[{"id": SNAPSHOT_OLD, "source_id": "hdb-resale"}]
    )
    monkeypatch.setattr(main, "require_pool", lambda: _SavedSearchPool(connection))
    _set_active_user(monkeypatch)

    response = _api(
        "POST",
        "/api/v1/saved-searches",
        payload={
            "name": "Bishan family search",
            "mode": "structured",
            "criteria": {"query": "Bishan", "limit": 20},
            "scoring_version": "home-fit-v1",
            "last_result_meta": INITIAL_RESULT_META,
            "last_source_snapshot_ids": [str(SNAPSHOT_NEW)],
            "last_run_at": INITIAL_RUN_AT,
        },
    )

    assert response.status_code == 201
    item = response.json()["item"]
    assert item["lastResultMeta"]["dataMode"] == "live"
    assert item["lastResultMeta"]["count"] == 2
    assert item["lastResultMeta"]["total"] == 7
    assert item["lastResultMeta"]["scorePolicyVersion"] == "home-fit-v1"
    assert item["lastSourceSnapshotIds"] == [str(SNAPSHOT_NEW)]
    assert datetime.fromisoformat(item["lastRunAt"].replace("Z", "+00:00")) == (
        datetime.fromisoformat(INITIAL_RUN_AT)
    )

    insert_sql, insert_values = next(
        (sql, values)
        for sql, values in connection.operations
        if sql.lstrip().startswith("INSERT INTO saved_search")
    )
    normalized_sql = " ".join(insert_sql.lower().split())
    assert "last_run_at,last_source_snapshot_ids,last_result_meta" in normalized_sql
    assert insert_values[8] == datetime.fromisoformat(INITIAL_RUN_AT)
    assert _decode_json(insert_values[9]) == [str(SNAPSHOT_NEW)]
    stored_meta = _decode_json(insert_values[10])
    stored_meta["retrievedAt"] = stored_meta["retrievedAt"].replace("Z", "+00:00")
    stored_meta["sourceSummary"][0]["retrievedAt"] = stored_meta["sourceSummary"][0][
        "retrievedAt"
    ].replace("Z", "+00:00")
    assert stored_meta == INITIAL_RESULT_META
    assert connection.records[0]["last_source_snapshot_ids"] == [str(SNAPSHOT_NEW)]
    assert connection.records[0]["last_result_meta"]["count"] == 2


def test_saved_search_create_rejects_provider_secret_in_initial_metadata(monkeypatch):
    connection = _SavedSearchConnection()
    monkeypatch.setattr(main, "require_pool", lambda: _SavedSearchPool(connection))
    _set_active_user(monkeypatch)

    response = _api(
        "POST",
        "/api/v1/saved-searches",
        payload={
            "name": "Bishan family search",
            "mode": "structured",
            "criteria": {"query": "Bishan"},
            "last_result_meta": {
                **INITIAL_RESULT_META,
                "providerSecret": "must-not-be-accepted",
            },
            "last_source_snapshot_ids": [str(SNAPSHOT_NEW)],
            "last_run_at": INITIAL_RUN_AT,
        },
    )

    assert response.status_code == 422
    assert connection.operations == []


def test_saved_search_create_rejects_malformed_nested_criteria_before_database_access(
    monkeypatch,
):
    connection = _SavedSearchConnection()
    monkeypatch.setattr(main, "require_pool", lambda: _SavedSearchPool(connection))
    _set_active_user(monkeypatch)

    response = _api(
        "POST",
        "/api/v1/saved-searches",
        payload={
            "name": "Malformed search",
            "mode": "structured",
            "criteria": {"query": "Bishan", "untrusted": "field"},
        },
    )

    assert response.status_code == 422
    assert connection.operations == []


def test_saved_search_create_rejects_a_place_owned_by_another_account(monkeypatch):
    connection = _SavedSearchConnection(place_owners={PLACE_ID: USER_B})
    monkeypatch.setattr(main, "require_pool", lambda: _SavedSearchPool(connection))
    _set_active_user(monkeypatch)

    response = _api(
        "POST",
        "/api/v1/saved-searches",
        payload={
            "name": "Foreign place search",
            "mode": "structured",
            "criteria": {
                "query": "Bishan",
                "place_constraints": [
                    {"place_id": str(PLACE_ID), "max_distance_m": 5_000}
                ],
            },
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "PLACE_CONSTRAINT_UNAVAILABLE"
    assert not any(
        sql.lstrip().startswith("INSERT INTO saved_search")
        for sql, _ in connection.operations
    )


def test_saved_search_rename_and_delete_do_not_mutate_a_foreign_record(monkeypatch):
    connection = _SavedSearchConnection(
        rows=[_saved_row(search_id=SEARCH_ID, user_id=USER_B)]
    )
    monkeypatch.setattr(main, "require_pool", lambda: _SavedSearchPool(connection))
    _set_active_user(monkeypatch)

    rename_response = _api(
        "PATCH",
        f"/api/v1/saved-searches/{SEARCH_ID}",
        payload={"name": "My renamed search"},
    )
    delete_response = _api("DELETE", f"/api/v1/saved-searches/{SEARCH_ID}")

    assert rename_response.status_code == 404
    assert rename_response.json()["detail"]["code"] == "SAVED_SEARCH_NOT_FOUND"
    assert delete_response.status_code == 200
    assert delete_response.json() == {"status": "absent"}
    assert len(connection.records) == 1
    assert connection.records[0]["name"] == "Bishan family search"
    for sql, values in connection.operations:
        assert "$1" in sql and "$2" in sql
        assert USER_A in values


def test_saved_search_owner_can_rename_and_delete_its_record(monkeypatch):
    connection = _SavedSearchConnection(rows=[_saved_row(user_id=USER_A)])
    monkeypatch.setattr(main, "require_pool", lambda: _SavedSearchPool(connection))
    _set_active_user(monkeypatch)

    rename_response = _api(
        "PATCH",
        f"/api/v1/saved-searches/{SEARCH_ID}",
        payload={"name": "  Updated family search  "},
    )
    delete_response = _api("DELETE", f"/api/v1/saved-searches/{SEARCH_ID}")

    assert rename_response.status_code == 200
    assert rename_response.json()["item"]["name"] == "Updated family search"
    assert delete_response.status_code == 200
    assert delete_response.json() == {"status": "deleted"}
    assert connection.records == []


def test_saved_search_run_returns_fresh_metadata_and_safe_structured_differences(
    monkeypatch,
):
    previous_meta = {
        "data_mode": "live",
        "retrieved_at": "2026-10-19T09:30:00+00:00",
        "source_summary": [],
        "warnings": [],
        "count": 3,
        "total": 5,
        "score_policy_version": "home-fit-v1",
    }
    connection = _SavedSearchConnection(
        rows=[
            _saved_row(
                place_constraints=[(PLACE_ID, 5_000)],
                source_snapshot_ids=[SNAPSHOT_OLD],
                last_result_meta=previous_meta,
            )
        ],
        source_rows=[
            {
                "id": SNAPSHOT_NEW,
                "source_id": "hdb-resale",
                "source_version": "2026-10",
                "retrieved_at": datetime(2026, 10, 20, 9, 0, tzinfo=timezone.utc),
            },
            {
                "id": SNAPSHOT_LATEST,
                "source_id": "hdb-resale",
                "source_version": "2026-11",
                "retrieved_at": datetime(2026, 10, 20, 10, 0, tzinfo=timezone.utc),
            },
        ],
        place_owners={PLACE_ID: USER_A},
    )
    pool = _SavedSearchPool(connection)
    monkeypatch.setattr(main, "require_pool", lambda: pool)
    _set_active_user(monkeypatch)
    calls = []

    async def current_search(criteria, user):
        assert pool.active_connections == 0
        calls.append((criteria, user))
        return {
            "items": [
                {"id": "home-2", "source": "data.gov.sg"},
                {"id": "home-3", "source": "data.gov.sg"},
            ],
            "count": 2,
            "total": 7,
            "dataMode": "live",
            "retrievedAt": "2026-10-20T09:30:00+00:00",
            "sourceSummary": [
                {
                    "sourceId": "hdb-resale",
                    "sourceVersion": "2026-10",
                    "retrievedAt": "2026-10-20T09:00:00+00:00",
                }
            ],
            "sourceSnapshotIds": [str(SNAPSHOT_NEW)],
            "hasMore": True,
            "nextCursor": "next-page-cursor",
            "warnings": ["Historical transactions only."],
            "scorePolicyVersion": "home-fit-v2",
            "providerSecret": "must-not-escape",
        }

    monkeypatch.setattr(main, "search", current_search)

    response = _api("POST", f"/api/v1/saved-searches/{SEARCH_ID}/run")

    assert response.status_code == 200
    payload = response.json()
    assert payload["items"] == [
        {"id": "home-2", "source": "data.gov.sg"},
        {"id": "home-3", "source": "data.gov.sg"},
    ]
    assert payload["hasMore"] is True
    assert payload["nextCursor"] == "next-page-cursor"
    assert payload["metadata"]["scorePolicyVersion"] == "home-fit-v2"
    assert payload["metadata"]["sourceSummary"][0]["sourceVersion"] == "2026-10"
    assert "providerSecret" not in payload["metadata"]
    assert payload["priorMetadata"]["scorePolicyVersion"] == "home-fit-v1"
    assert payload["priorMetadata"]["sourceSnapshotIds"] == [str(SNAPSHOT_OLD)]
    assert payload["difference"] == {
        "count": {"previous": 3, "current": 2, "delta": -1},
        "pageCount": {"previous": 3, "current": 2, "delta": -1},
        "total": {"previous": 5, "current": 7, "delta": 2},
        "sourceSnapshots": {
            "previous": [str(SNAPSHOT_OLD)],
            "current": [str(SNAPSHOT_NEW)],
            "added": [str(SNAPSHOT_NEW)],
            "removed": [str(SNAPSHOT_OLD)],
        },
        "scorePolicyVersion": {
            "previous": "home-fit-v1",
            "current": "home-fit-v2",
            "changed": True,
        },
    }
    assert payload["sourceSnapshotIds"] == [str(SNAPSHOT_NEW)]
    assert not any(
        "from source_snapshot" in sql.lower() for sql, _ in connection.operations
    )
    assert calls[0][0].cursor is None
    assert calls[0][0].place_constraints[0].place_id == PLACE_ID
    assert calls[0][1] == {"id": USER_A}
    assert connection.records[0]["last_result_meta"]["count"] == 2
    assert connection.records[0]["last_result_meta"]["total"] == 7
    assert connection.records[0]["last_source_snapshot_ids"] == [str(SNAPSHOT_NEW)]


def test_saved_search_run_fails_closed_for_missing_or_foreign_places(monkeypatch):
    connection = _SavedSearchConnection(
        rows=[_saved_row(place_constraints=[(PLACE_ID, 5_000)])],
        place_owners={PLACE_ID: USER_B},
    )
    monkeypatch.setattr(main, "require_pool", lambda: _SavedSearchPool(connection))
    _set_active_user(monkeypatch)
    calls = []

    async def current_search(criteria, user):
        calls.append((criteria, user))
        raise AssertionError("a missing place must not reach search")

    monkeypatch.setattr(main, "search", current_search)

    response = _api("POST", f"/api/v1/saved-searches/{SEARCH_ID}/run")

    assert response.status_code == 409
    assert response.json()["detail"] == {
        "code": "SAVED_SEARCH_PLACE_UNAVAILABLE",
        "message": "One or more saved places are unavailable. Update the saved search before rerunning it.",
        "missingPlaceIds": [str(PLACE_ID)],
    }
    assert calls == []
    assert connection.records[0]["last_result_meta"] is None
    assert not any("UPDATE saved_search SET last_run_at" in sql for sql, _ in connection.operations)


@pytest.mark.parametrize(
    ("method", "path", "payload"),
    [
        ("GET", "/api/v1/saved-searches", None),
        (
            "POST",
            "/api/v1/saved-searches",
            {"name": "Search", "mode": "structured", "criteria": {"query": "Bishan"}},
        ),
        (
            "PATCH",
            f"/api/v1/saved-searches/{SEARCH_ID}",
            {"name": "Renamed search"},
        ),
        ("DELETE", f"/api/v1/saved-searches/{SEARCH_ID}", None),
        ("POST", f"/api/v1/saved-searches/{SEARCH_ID}/run", None),
    ],
)
def test_saved_search_routes_require_an_active_user(method, path, payload):
    response = _api(method, path, payload=payload)

    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "AUTH_REQUIRED"


def test_saved_search_rerun_does_not_disclose_or_run_a_foreign_record(monkeypatch):
    connection = _SavedSearchConnection(rows=[_saved_row(user_id=USER_B)])
    monkeypatch.setattr(main, "require_pool", lambda: _SavedSearchPool(connection))
    _set_active_user(monkeypatch, USER_A)
    calls = []

    async def current_search(criteria, user):
        calls.append((criteria, user))
        raise AssertionError("a foreign saved search must not be rerun")

    monkeypatch.setattr(main, "search", current_search)

    response = _api("POST", f"/api/v1/saved-searches/{SEARCH_ID}/run")

    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "SAVED_SEARCH_NOT_FOUND"
    assert calls == []
    assert len(connection.operations) == 1
    sql, values = connection.operations[0]
    assert "WHERE id=$1 AND user_id=$2" in " ".join(sql.split())
    assert values == (SEARCH_ID, USER_A)


def test_existing_history_endpoint_remains_owner_scoped(monkeypatch):
    history_row = {
        "id": UUID(int=22),
        "user_id": USER_A,
        "mode": "structured",
        "criteria": {"query": "Bishan"},
        "source_snapshot_ids": [SNAPSHOT_OLD],
        "scoring_version": "home-fit-v1",
        "created_at": NOW,
    }
    foreign_row = {**history_row, "id": UUID(int=23), "user_id": USER_B}
    connection = _SavedSearchConnection(histories=[history_row, foreign_row])
    monkeypatch.setattr(main, "require_pool", lambda: _SavedSearchPool(connection))
    _set_active_user(monkeypatch)

    response = _api("GET", "/api/v1/history")

    assert response.status_code == 200
    assert [item["id"] for item in response.json()["items"]] == [str(UUID(int=22))]
    assert connection.operations[0][1] == (USER_A,)
