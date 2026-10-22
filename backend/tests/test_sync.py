import asyncio
import copy
import importlib
import importlib.util
import json
import re
from uuid import UUID

import httpx
import pytest
from fastapi import HTTPException

from app import main
from app.schemas import GuestSyncRequest
from app.security import require_active_user


USER_A = UUID("11111111-1111-4111-8111-111111111111")
USER_B = UUID("22222222-2222-4222-8222-222222222222")
SOURCE_ID = UUID("33333333-3333-4333-8333-333333333333")
SHORTLIST_A = UUID("44444444-4444-4444-8444-444444444444")
SHORTLIST_B = UUID("55555555-5555-4555-8555-555555555555")
PROFILE_A = UUID("66666666-6666-4666-8666-666666666666")
PROFILE_B = UUID("77777777-7777-4777-8777-777777777777")
OWNED_PLACE_ID = UUID("88888888-8888-4888-8888-888888888888")
OTHER_USER_PLACE_ID = UUID("99999999-9999-4999-8999-999999999999")
GUEST_PLACE_ID = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")


class _Transaction:
    def __init__(self, connection):
        self.connection = connection

    async def __aenter__(self):
        self.snapshot = self.connection._snapshot()

    async def __aexit__(self, exception_type, *_args):
        if exception_type is not None:
            self.connection._restore(self.snapshot)
        return False


class _MemoryConnection:
    """Owner-scoped database double for the merge service's SQL boundary."""

    def __init__(self):
        self.users = {USER_A: "active", USER_B: "active"}
        self.candidate_ids = {"home-1", "home-2", "home-existing"}
        self.source_snapshot_ids = {SOURCE_ID}
        self.profiles = {}
        self.weights = {USER_A: {}, USER_B: {}}
        self.shortlists = {
            USER_A: {
                "id": SHORTLIST_A,
                "entries": [{"candidate_home_id": "home-existing", "position": 0}],
            },
            USER_B: {
                "id": SHORTLIST_B,
                "entries": [{"candidate_home_id": "home-2", "position": 0}],
            },
        }
        self.history = {USER_A: [], USER_B: []}
        self.places = {USER_A: [], USER_B: []}
        self.personal_place_ids = {USER_A: set(), USER_B: set()}
        self.events = {}
        self.read_owners = []
        self.write_owners = []
        self.writes = []

    def transaction(self):
        return _Transaction(self)

    def _snapshot(self):
        return copy.deepcopy(
            (
                self.profiles,
                self.weights,
                self.shortlists,
                self.history,
                self.places,
                self.personal_place_ids,
                self.events,
                self.read_owners,
                self.write_owners,
                self.writes,
            )
        )

    def _restore(self, snapshot):
        (
            self.profiles,
            self.weights,
            self.shortlists,
            self.history,
            self.places,
            self.personal_place_ids,
            self.events,
            self.read_owners,
            self.write_owners,
            self.writes,
        ) = snapshot

    def _user_for_profile(self, profile_id):
        return next(
            user_id
            for user_id, profile in self.profiles.items()
            if profile["id"] == profile_id
        )

    def _user_for_shortlist(self, shortlist_id):
        return next(
            user_id
            for user_id, shortlist in self.shortlists.items()
            if shortlist["id"] == shortlist_id
        )

    async def fetchval(self, query, *values):
        normalized = " ".join(query.split()).lower()
        if "from user_account" in normalized:
            self.read_owners.append(values[0])
            return self.users.get(values[0])
        if "from search_history" in normalized:
            user_id, mode, criteria_json, snapshot_ids = values
            self.read_owners.append(user_id)
            criteria = json.loads(criteria_json)
            wanted_sources = sorted(set(snapshot_ids))
            return any(
                entry["mode"] == mode
                and entry["criteria"] == criteria
                and sorted(set(entry["source_snapshot_ids"])) == wanted_sources
                for entry in self.history[user_id]
            )
        if "from personal_place" in normalized:
            user_id, label, address, longitude, latitude, maximum_distance_m, kind = values
            self.read_owners.append(user_id)
            return any(
                row["label"].strip().casefold() == label.strip().casefold()
                and (row["address"] or "").strip().casefold()
                == (address or "").strip().casefold()
                and round(row["longitude"], 6) == round(longitude, 6)
                and round(row["latitude"], 6) == round(latitude, 6)
                and row["maximum_distance_m"] == maximum_distance_m
                and row["kind"] == kind
                for row in self.places[user_id]
            )
        raise AssertionError(f"Unexpected fetchval query: {query}")

    async def fetchrow(self, query, *values):
        normalized = " ".join(query.split()).lower()
        if "from account_sync_event" in normalized:
            user_id, sync_key = values
            self.read_owners.append(user_id)
            result = self.events.get((user_id, sync_key))
            return {"result": copy.deepcopy(result)} if result is not None else None
        if "from family_profile" in normalized:
            user_id = values[0]
            self.read_owners.append(user_id)
            row = self.profiles.get(user_id)
            return copy.deepcopy(row) if row is not None else None
        if "from shortlist" in normalized:
            user_id = values[0]
            self.read_owners.append(user_id)
            shortlist = self.shortlists.get(user_id)
            return {"id": shortlist["id"]} if shortlist is not None else None
        raise AssertionError(f"Unexpected fetchrow query: {query}")

    async def fetch(self, query, *values):
        normalized = " ".join(query.split()).lower()
        if "from candidate_home" in normalized:
            return [{"id": home_id} for home_id in values[0] if home_id in self.candidate_ids]
        if "from source_snapshot" in normalized:
            return [{"id": snapshot_id} for snapshot_id in values[0] if snapshot_id in self.source_snapshot_ids]
        if "from personal_place" in normalized and "select id" in normalized:
            user_id, place_ids = values
            self.read_owners.append(user_id)
            return [
                {"id": place_id}
                for place_id in place_ids
                if place_id in self.personal_place_ids[user_id]
            ]
        if "from criterion_weight" in normalized:
            profile_id = values[0]
            user_id = self._user_for_profile(profile_id)
            self.read_owners.append(user_id)
            return [
                {"criterion": criterion, "weight": weight}
                for criterion, weight in self.weights[user_id].items()
            ]
        if "from shortlist_entry" in normalized:
            shortlist_id = values[0]
            user_id = self._user_for_shortlist(shortlist_id)
            self.read_owners.append(user_id)
            return copy.deepcopy(self.shortlists[user_id]["entries"])
        raise AssertionError(f"Unexpected fetch query: {query}")

    async def execute(self, query, *values):
        normalized = " ".join(query.split()).lower()
        if "insert into family_profile" in normalized:
            profile_id, user_id = values
            self.profiles[user_id] = {
                "id": profile_id,
                "adults": 1,
                "children": 0,
                "older_adults": 0,
                "budget_cents": None,
                "locale": "en-SG",
            }
            self.weights[user_id] = {}
            self._write("profile-created", user_id)
            return "INSERT 0 1"
        if "update family_profile set" in normalized:
            column = re.search(r"set ([a-z_]+)=\$2", normalized).group(1)
            profile_id, value = values
            user_id = self._user_for_profile(profile_id)
            self.profiles[user_id][column] = value
            self._write("profile-updated", user_id)
            return "UPDATE 1"
        if "insert into criterion_weight" in normalized:
            profile_id, criterion, weight = values
            user_id = self._user_for_profile(profile_id)
            self.weights[user_id][criterion] = float(weight)
            self._write("weight-upserted", user_id)
            return "INSERT 0 1"
        if "insert into shortlist_entry" in normalized:
            shortlist_id, home_id, position = values
            user_id = self._user_for_shortlist(shortlist_id)
            if all(
                row["candidate_home_id"] != home_id
                for row in self.shortlists[user_id]["entries"]
            ):
                self.shortlists[user_id]["entries"].append(
                    {"candidate_home_id": home_id, "position": position}
                )
            self._write("shortlist-entry-inserted", user_id)
            return "INSERT 0 1"
        if "insert into shortlist (" in normalized:
            shortlist_id, user_id = values[:2]
            self.shortlists[user_id] = {"id": shortlist_id, "entries": []}
            self._write("shortlist-created", user_id)
            return "INSERT 0 1"
        if "update shortlist set updated_at" in normalized:
            shortlist_id = values[0]
            self._write("shortlist-updated", self._user_for_shortlist(shortlist_id))
            return "UPDATE 1"
        if "insert into search_history" in normalized:
            _, user_id, mode, criteria, source_ids, scoring_version = values
            self.history[user_id].append(
                {
                    "mode": mode,
                    "criteria": json.loads(criteria),
                    "source_snapshot_ids": json.loads(source_ids),
                    "scoring_version": scoring_version,
                }
            )
            self._write("history-inserted", user_id)
            return "INSERT 0 1"
        if "insert into personal_place" in normalized:
            (
                place_id,
                user_id,
                label,
                address,
                longitude,
                latitude,
                maximum_distance_m,
                kind,
            ) = values
            self.places[user_id].append(
                {
                    "label": label,
                    "address": address,
                    "longitude": longitude,
                    "latitude": latitude,
                    "maximum_distance_m": maximum_distance_m,
                    "kind": kind,
                }
            )
            self.personal_place_ids[user_id].add(place_id)
            self._write("place-inserted", user_id)
            return "INSERT 0 1"
        if "insert into account_sync_event" in normalized:
            user_id, sync_key, result_json = values
            self.events[(user_id, sync_key)] = json.loads(result_json)
            self._write("sync-event-inserted", user_id)
            return "INSERT 0 1"
        raise AssertionError(f"Unexpected execute query: {query}")

    def _write(self, operation, user_id):
        self.write_owners.append(user_id)
        self.writes.append(operation)


def _request(**values):
    return GuestSyncRequest.model_validate({"sync_key": "guest-1", **values})


def _load_merge_guest_data():
    module_spec = importlib.util.find_spec("app.sync")
    assert module_spec is not None, "guest merge service has not been implemented"
    module = importlib.import_module("app.sync")
    merge = getattr(module, "merge_guest_data", None)
    assert callable(merge), "merge_guest_data has not been implemented"
    return merge


def _merge(connection, request, user_id=USER_A):
    merge_guest_data = _load_merge_guest_data()
    return asyncio.run(merge_guest_data(connection, {"id": user_id}, request))


def test_guest_sync_endpoint_requires_an_active_user():
    async def send_request():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app), base_url="http://test"
        ) as client:
            return await client.post(
                "/api/v1/sync/guest", json={"sync_key": "guest-1"}
            )

    response = asyncio.run(send_request())

    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "AUTH_REQUIRED"


def test_guest_merge_unions_owned_shortlist_and_imports_deduplicated_history():
    connection = _MemoryConnection()
    connection.history[USER_B].append(
        {
            "mode": "structured",
            "criteria": {"query": "Bishan", "limit": 20},
            "source_snapshot_ids": [str(SOURCE_ID)],
            "scoring_version": "home-fit-v1",
        }
    )
    request = _request(
        shortlistHomeIds=["home-1", "home-existing", "home-1"],
        compareHomeIds=["home-1", "home-2", "home-1"],
        history=[
            {
                "mode": "structured",
                "criteria": {"query": "Bishan", "limit": 20},
                "sourceSnapshotIds": [str(SOURCE_ID), str(SOURCE_ID)],
                "scoringVersion": "home-fit-v1",
            }
        ],
    )

    result = _merge(connection, request)

    assert result["accepted"]["shortlistHomeIds"] == 1
    assert result["skipped"]["shortlistHomeIds"] == 1
    assert result["accepted"]["compareHomeIds"] == ["home-1", "home-2"]
    assert result["accepted"]["history"] == 1
    assert [row["candidate_home_id"] for row in connection.shortlists[USER_A]["entries"]] == [
        "home-existing",
        "home-1",
    ]
    assert len(connection.history[USER_A]) == 1
    assert len(connection.history[USER_B]) == 1
    assert set(connection.read_owners) == {USER_A}
    assert set(connection.write_owners) == {USER_A}


def test_guest_merge_rejects_nonexistent_candidate_homes_without_writes():
    connection = _MemoryConnection()
    request = _request(shortlistHomeIds=["missing-home"])

    with pytest.raises(HTTPException) as error:
        _merge(connection, request)

    assert error.value.status_code == 422
    assert error.value.detail["code"] == "GUEST_HOME_UNAVAILABLE"
    assert connection.writes == []
    assert connection.events == {}


def test_guest_merge_rejects_unavailable_history_sources_without_writes():
    connection = _MemoryConnection()
    request = _request(
        history=[
            {
                "mode": "structured",
                "criteria": {"query": "Bishan"},
                "sourceSnapshotIds": ["88888888-8888-4888-8888-888888888888"],
            }
        ]
    )

    with pytest.raises(HTTPException) as error:
        _merge(connection, request)

    assert error.value.status_code == 422
    assert error.value.detail["code"] == "GUEST_SOURCE_UNAVAILABLE"
    assert connection.writes == []
    assert connection.events == {}


def test_guest_history_skips_constraints_for_unowned_or_unmapped_places():
    connection = _MemoryConnection()
    connection.personal_place_ids[USER_A].add(OWNED_PLACE_ID)
    connection.personal_place_ids[USER_B].add(OTHER_USER_PLACE_ID)

    def history_entry(query, place_id):
        return {
            "mode": "structured",
            "criteria": {
                "query": query,
                "place_constraints": [
                    {"place_id": str(place_id), "max_distance_m": 1_000}
                ],
            },
        }

    request = _request(
        history=[
            history_entry("owned-place", OWNED_PLACE_ID),
            history_entry("other-account-place", OTHER_USER_PLACE_ID),
            history_entry(
                "missing-place",
                UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
            ),
            history_entry("guest-place-id", GUEST_PLACE_ID),
            history_entry("owned-place", OWNED_PLACE_ID),
        ],
        places=[
            {
                "label": "Guest workplace",
                "latitude": 1.3,
                "longitude": 103.8,
            }
        ],
        confirmPlaces=True,
    )

    result = _merge(connection, request)

    assert result["accepted"]["history"] == 1
    assert result["skipped"]["history"] == 4
    assert result["skipped"]["retryableHistoryIndexes"] == [1, 2, 3]
    assert [entry["criteria"]["query"] for entry in connection.history[USER_A]] == [
        "owned-place"
    ]
    saved_place_id = connection.history[USER_A][0]["criteria"][
        "place_constraints"
    ][0]["place_id"]
    assert saved_place_id == str(OWNED_PLACE_ID)
    assert result["accepted"]["places"] == 1
    assert GUEST_PLACE_ID not in connection.personal_place_ids[USER_A]
    assert set(connection.read_owners) == {USER_A}


def test_guest_profile_conflicts_preserve_account_values_until_confirmed():
    connection = _MemoryConnection()
    connection.profiles[USER_A] = {
        "id": PROFILE_A,
        "adults": 3,
        "children": 1,
        "older_adults": 0,
        "budget_cents": 500_000_00,
        "locale": "en-SG",
    }
    connection.weights[USER_A] = {
        "school": 2.0,
        "childcare": 2.0,
        "care": 2.0,
        "affordability": 1.0,
    }
    local_brief = {
        "adults": 2,
        "children": 1,
        "budgetCents": 900_000_00,
        "priorityWeights": {"school": 3.0},
    }

    preserved = _merge(connection, _request(brief=local_brief))

    assert connection.profiles[USER_A]["adults"] == 3
    assert connection.profiles[USER_A]["budget_cents"] == 500_000_00
    assert connection.weights[USER_A]["school"] == 2.0
    assert {item["field"] for item in preserved["conflicts"]} == {
        "brief.adults",
        "brief.budget_cents",
        "brief.priority_weights.school",
    }
    assert all(item["resolution"] == "account_preserved" for item in preserved["conflicts"])

    replaced = _merge(
        connection,
        _request(sync_key="guest-2", brief=local_brief, confirmBrief=True),
    )

    assert connection.profiles[USER_A]["adults"] == 2
    assert connection.profiles[USER_A]["budget_cents"] == 900_000_00
    assert connection.weights[USER_A]["school"] == 3.0
    assert all(
        item["resolution"] == "replaced_after_confirmation"
        for item in replaced["conflicts"]
    )


def test_guest_weight_conflicts_with_an_absent_row_default_until_confirmed():
    connection = _MemoryConnection()
    connection.profiles[USER_A] = {
        "id": PROFILE_A,
        "adults": 2,
        "children": 0,
        "older_adults": 0,
        "budget_cents": None,
        "locale": "en-SG",
    }
    connection.weights[USER_A] = {}
    brief = {"priorityWeights": {"school": 3}}

    preserved = _merge(connection, _request(brief=brief))

    assert connection.weights[USER_A] == {}
    assert "priority_weights.school" in preserved["skipped"]["briefFields"]
    assert preserved["conflicts"] == [
        {
            "field": "brief.priority_weights.school",
            "resolution": "account_preserved",
        }
    ]

    replaced = _merge(
        connection,
        _request(sync_key="guest-2", brief=brief, confirmBrief=True),
    )

    assert connection.weights[USER_A] == {"school": 3.0}
    assert "priority_weights.school" in replaced["accepted"]["briefFields"]
    assert replaced["conflicts"] == [
        {
            "field": "brief.priority_weights.school",
            "resolution": "replaced_after_confirmation",
        }
    ]


def test_guest_brief_populates_a_profile_that_did_not_previously_exist():
    connection = _MemoryConnection()

    result = _merge(
        connection,
        _request(brief={"adults": 4, "children": 2, "locale": "zh-SG"}),
    )

    assert connection.profiles[USER_A]["adults"] == 4
    assert connection.profiles[USER_A]["children"] == 2
    assert connection.profiles[USER_A]["locale"] == "zh-SG"
    assert result["conflicts"] == []


def test_empty_guest_brief_does_not_create_an_account_profile():
    connection = _MemoryConnection()

    result = _merge(connection, _request(brief={}))

    assert USER_A not in connection.profiles
    assert result["accepted"]["briefFields"] == []
    assert result["conflicts"] == []


def test_guest_places_require_confirmation_and_results_omit_personal_values():
    connection = _MemoryConnection()
    connection.places[USER_B].append(
        {
            "label": "Work",
            "address": "1 Harbour Road",
            "latitude": 1.3,
            "longitude": 103.8,
            "maximum_distance_m": 5_000,
            "kind": "workplace",
        }
    )
    place = {
        "label": "Work",
        "address": "1 Harbour Road",
        "latitude": 1.3,
        "longitude": 103.8,
        "maximumDistanceM": 5_000,
        "kind": "workplace",
    }

    unconfirmed = _merge(connection, _request(places=[place]))

    assert unconfirmed["accepted"]["places"] == 0
    assert unconfirmed["skipped"]["places"] == 1
    assert connection.places[USER_A] == []

    confirmed = _merge(
        connection,
        _request(sync_key="guest-2", places=[place], confirmPlaces=True),
    )

    assert confirmed["accepted"]["places"] == 1
    assert len(connection.places[USER_A]) == 1
    assert "Work" not in json.dumps(confirmed)
    assert "Harbour Road" not in json.dumps(confirmed)
    assert set(connection.read_owners) == {USER_A}
    assert set(connection.write_owners) == {USER_A}


def test_same_user_sync_key_replays_stored_result_without_writes():
    connection = _MemoryConnection()
    first_request = _request(
        shortlistHomeIds=["home-1"],
        places=[
            {
                "label": "Work",
                "address": "1 Harbour Road",
                "latitude": 1.3,
                "longitude": 103.8,
            }
        ],
    )
    first_result = _merge(connection, first_request)
    write_count = len(connection.writes)

    changed_retry = _request(
        shortlistHomeIds=["home-2"],
        places=[
            {
                "label": "Work",
                "address": "1 Harbour Road",
                "latitude": 1.3,
                "longitude": 103.8,
            }
        ],
        confirmPlaces=True,
    )
    retried_result = _merge(connection, changed_retry)

    assert retried_result == first_result
    assert len(connection.writes) == write_count
    assert [row["candidate_home_id"] for row in connection.shortlists[USER_A]["entries"]] == [
        "home-existing",
        "home-1",
    ]
    assert connection.places[USER_A] == []


def test_guest_merge_deduplicates_against_owned_history_and_within_the_request():
    connection = _MemoryConnection()
    existing = {
        "mode": "structured",
        "criteria": {"query": "Bishan", "limit": 20, "place_constraints": []},
        "source_snapshot_ids": [str(SOURCE_ID)],
        "scoring_version": "old-version",
    }
    connection.history[USER_A].append(existing)
    entry = {
        "mode": "structured",
        "criteria": {"query": "Bishan", "limit": 20},
        "sourceSnapshotIds": [str(SOURCE_ID)],
        "scoringVersion": "home-fit-v1",
    }

    result = _merge(connection, _request(history=[entry, entry]))

    assert result["accepted"]["history"] == 0
    assert result["skipped"]["history"] == 2
    assert connection.history[USER_A] == [existing]
    assert connection.writes == ["sync-event-inserted"]


def test_same_sync_key_is_scoped_to_the_authenticated_user():
    connection = _MemoryConnection()
    connection.events[(USER_B, "guest-1")] = {
        "accepted": {"shortlistHomeIds": 0},
        "skipped": {},
        "conflicts": [],
        "syncKey": "guest-1",
    }

    result = _merge(connection, _request(shortlistHomeIds=["home-1"]))

    assert result["accepted"]["shortlistHomeIds"] == 1
    assert (USER_A, "guest-1") in connection.events
    assert set(connection.read_owners) == {USER_A}


def test_guest_merge_rolls_back_data_if_idempotency_record_cannot_be_written():
    connection = _MemoryConnection()
    execute = connection.execute

    async def fail_event_insert(query, *values):
        if "insert into account_sync_event" in " ".join(query.split()).lower():
            raise RuntimeError("simulated event insert failure")
        return await execute(query, *values)

    connection.execute = fail_event_insert

    with pytest.raises(RuntimeError, match="simulated event insert failure"):
        _merge(connection, _request(shortlistHomeIds=["home-1"]))

    assert [row["candidate_home_id"] for row in connection.shortlists[USER_A]["entries"]] == [
        "home-existing"
    ]
    assert connection.events == {}
    assert connection.writes == []


class _Pool:
    def __init__(self, connection):
        self.connection = connection

    def acquire(self):
        return self

    async def __aenter__(self):
        return self.connection

    async def __aexit__(self, *_args):
        return None


def test_authenticated_guest_sync_endpoint_uses_active_user_scope(monkeypatch):
    connection = _MemoryConnection()

    async def active_user():
        return {"id": USER_A}

    monkeypatch.setitem(main.app.dependency_overrides, require_active_user, active_user)
    monkeypatch.setattr(main, "require_pool", lambda: _Pool(connection))

    async def send_request():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app), base_url="http://test"
        ) as client:
            return await client.post(
                "/api/v1/sync/guest",
                json={"sync_key": "endpoint-1", "shortlistHomeIds": ["home-1"]},
            )

    try:
        response = asyncio.run(send_request())
    finally:
        main.app.dependency_overrides.pop(require_active_user, None)

    assert response.status_code == 200
    assert response.json()["accepted"]["shortlistHomeIds"] == 1
    assert set(connection.write_owners) == {USER_A}
