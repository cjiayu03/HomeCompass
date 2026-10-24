import asyncio
from datetime import datetime, timedelta, timezone
from typing import get_args
from uuid import UUID

import httpx
from starlette.requests import Request

from app.ai import gemini_configuration_ready
from app.contracts import DataMode, live_result_metadata
from app import main
from app.local_env import load_local_project_env
from app.main import app, score_preview
from app.rate_limit import RateLimiter
from app.schemas import FamilyProfileUpdate, QueryInterpretation, ScoreRequest
from app.security import is_configured_value, rate_limit_key, require_active_user
from app.sources.data_gov_sg import HDB_RESALE_DATASET_ID


def test_data_mode_contract_admits_all_binding_result_states():
    assert set(get_args(DataMode)) == {"live", "fixture", "mixed", "error"}


def test_live_result_metadata_preserves_snapshot_evidence_and_owns_its_lists():
    source_summary = [{"sourceId": "hdb-resale", "sourceVersion": "2026-09"}]
    warnings = ["Historical transactions only."]
    retrieved_at = datetime(2026, 10, 20, 9, 30, tzinfo=timezone(timedelta(hours=8)))

    metadata = live_result_metadata(source_summary, warnings, retrieved_at)

    assert metadata == {
        "dataMode": "live",
        "retrievedAt": "2026-10-20T01:30:00+00:00",
        "sourceSummary": [{"sourceId": "hdb-resale", "sourceVersion": "2026-09"}],
        "warnings": ["Historical transactions only."],
    }
    metadata["sourceSummary"][0]["sourceVersion"] = "changed"
    metadata["warnings"].append("changed")
    assert source_summary == [{"sourceId": "hdb-resale", "sourceVersion": "2026-09"}]
    assert warnings == ["Historical transactions only."]


def test_live_result_metadata_defaults_to_current_utc_time_and_empty_warnings():
    before = datetime.now(timezone.utc)
    metadata = live_result_metadata([])
    after = datetime.now(timezone.utc)

    assert metadata["dataMode"] == "live"
    assert before <= datetime.fromisoformat(metadata["retrievedAt"]) <= after
    assert metadata["sourceSummary"] == []
    assert metadata["warnings"] == []


class _Connection:
    def __init__(self, home_rows=None, resource_rows=None, resource_counts=None):
        self.home_rows = home_rows or []
        self.resource_rows = resource_rows or []
        self.resource_counts = resource_counts or []

    async def fetch(self, sql, *values):
        if "FROM page_homes h JOIN source_snapshot" in sql:
            return self.home_rows
        if "SELECT r.resource_type, count(*)" in sql:
            return self.resource_counts
        if "FROM neighbourhood_resource r JOIN latest s" in sql:
            return self.resource_rows
        raise AssertionError(f"Unexpected query: {sql}")

    async def fetchrow(self, sql, *values):
        if "FROM candidate_home" in sql:
            return {"total": 1, "geocoded": 1}
        if "FROM neighbourhood_resource" in sql:
            return {"schools": 1, "childcare": 1, "care": 1}
        raise AssertionError(f"Unexpected query: {sql}")


class _Pool:
    def __init__(self, connection):
        self.connection = connection

    def acquire(self):
        return self

    async def __aenter__(self):
        return self.connection

    async def __aexit__(self, *_args):
        return None


def test_result_endpoints_expose_snapshot_metadata_and_keep_legacy_contract(monkeypatch):
    snapshot_time = datetime(2026, 10, 18, 12, tzinfo=timezone.utc)
    home = {
        "id": "home-1", "address": "Example Street", "town": "BISHAN", "flat_type": "4 ROOM",
        "price_observation_cents": 45000000, "latitude": None, "longitude": None,
        "source_id": "hdb-resale", "source_version": "2026-09", "retrieved_at": snapshot_time,
        "source_semantics": "historical_transaction", "geometry_source": None, "geocoded_at": None,
        "school_name": None, "school_distance_m": None, "childcare_name": None,
        "childcare_distance_m": None, "care_name": None, "care_distance_m": None,
        "in_dengue_cluster": False, "floor_area_sqm": None, "observed_on": None,
        "geocode_status": "pending",
    }
    resource = {
        "id": "resource-1", "resource_type": "moe_school", "name": "Example School",
        "status": "open", "attributes": {}, "geometry": None, "source_id": "school-source",
        "source_url": "https://example.test/school", "source_version": "2026-10",
        "retrieved_at": snapshot_time, "location_source_id": None, "location_retrieved_at": None,
    }
    monkeypatch.setattr(main, "require_pool", lambda: _Pool(_Connection([home], [resource])))

    async def request_results():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            return await asyncio.gather(
                client.get("/health"), client.get("/api/v1/homes"),
                client.post("/api/v1/search", json={}), client.get("/api/v1/resources"),
            )

    health_response, homes_response, search_response, resources_response = asyncio.run(request_results())
    assert set(health_response.json()) == {"status", "app", "time", "database", "auth", "ai", "primaryDataset"}
    for response, source_id in ((homes_response, "hdb-resale"), (search_response, "hdb-resale"),
                                (resources_response, "school-source")):
        assert response.status_code == 200
        payload = response.json()
        assert payload["dataMode"] == "live"
        assert datetime.fromisoformat(payload["retrievedAt"]).tzinfo == timezone.utc
        assert payload["sourceSummary"] == [{"sourceId": source_id, "sourceVersion":
                                             "2026-09" if source_id == "hdb-resale" else "2026-10",
                                             "retrievedAt": "2026-10-18T12:00:00+00:00"}]
        assert isinstance(payload["warnings"], list)
    assert homes_response.json()["warnings"] == homes_response.json()["limitations"]
    assert search_response.json()["warnings"] == search_response.json()["limitations"]
    assert homes_response.json()["count"] == 1
    assert homes_response.json()["total"] == 1
    assert homes_response.json()["nextCursor"] is None
    assert homes_response.json()["hasMore"] is False
    assert homes_response.json()["sourceStatus"]["hdb"]["datasetId"] == HDB_RESALE_DATASET_ID
    assert search_response.json()["total"] == 1
    assert search_response.json()["nextCursor"] is None
    assert search_response.json()["hasMore"] is False
    assert search_response.json()["unappliedCriteria"] == []
    assert search_response.json()["scorePolicyVersion"] == "home-fit-v1"
    home_item = homes_response.json()["items"][0]
    assert home_item["score"] is None
    assert home_item["scoreDetails"]["coverage"] == 0
    assert set(home_item["scoreDetails"]) == {
        "coverage", "components", "missingEvidence", "policyVersion", "scoredAt"
    }
    assert home_item["scoreDetails"]["policyVersion"] == "home-fit-v1"
    assert home_item["scoreDetails"]["missingEvidence"] == [
        "school", "childcare", "care", "affordability"
    ]
    assert home_item["sourceSemantics"] == "historical_transaction"
    assert home_item["geocodeSource"] is None
    assert home_item["geocodedAt"] is None
    assert resources_response.json()["type"] == "FeatureCollection"
    assert resources_response.json()["count"] == 1
    assert resources_response.json()["hasMore"] is False
    assert resources_response.json()["nextCursor"] is None
    assert resources_response.json()["features"][0]["properties"]["sourceId"] == "school-source"


def test_health_is_explicit_about_unconfigured_providers(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_MONTHLY_BUDGET_USD", raising=False)
    async def request_health():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            return await client.get("/health")

    response = asyncio.run(request_health())
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["database"] == "unavailable"
    assert response.json()["auth"] == "unconfigured"
    assert response.json()["ai"] == "unconfigured"


def test_private_and_search_routes_fail_closed_without_configuration(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("NEXT_PUBLIC_SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_PUBLISHABLE_KEY", raising=False)
    monkeypatch.delenv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", raising=False)
    monkeypatch.delenv("NEXT_PUBLIC_SUPABASE_ANON_KEY", raising=False)
    calls = []

    async def interpret_query(request):
        calls.append(request)
        return QueryInterpretation(filters={"query": request.text}), "test-model"

    monkeypatch.setattr(main, "interpret_query", interpret_query)

    async def request_private_routes():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            return (await client.get("/api/v1/profile"),
                    await client.post("/api/v1/search", json={"budget": 450000}),
                    await client.post("/api/v1/ai/interpret", json={"text": "near a school"}))

    profile_response, search_response, ai_response = asyncio.run(request_private_routes())
    assert profile_response.status_code == 401
    assert search_response.status_code == 503
    assert ai_response.status_code == 401
    assert ai_response.json()["detail"]["code"] == "AUTH_REQUIRED"
    assert calls == []


def test_ai_interpret_rejects_bearer_without_local_session_cookie(monkeypatch):
    for name in (
        "SUPABASE_URL",
        "NEXT_PUBLIC_SUPABASE_URL",
        "SUPABASE_PUBLISHABLE_KEY",
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    ):
        monkeypatch.delenv(name, raising=False)
    calls = []

    async def interpret_query(request):
        calls.append(request)
        return QueryInterpretation(filters={"query": request.text}), "test-model"

    monkeypatch.setattr(main, "interpret_query", interpret_query)

    async def request_ai():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            return await client.post(
                "/api/v1/ai/interpret",
                json={"text": "near a school"},
                headers={"Authorization": "Bearer placeholder-token"},
            )

    response = asyncio.run(request_ai())

    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "AUTH_REQUIRED"
    assert calls == []


def test_ai_interpret_uses_active_user_dependency_and_limits_before_ai(monkeypatch):
    limiter = RateLimiter(max_requests=1, window_seconds=60)
    monkeypatch.setattr(main, "ai_interpret_limiter", limiter, raising=False)

    user = {"id": UUID("29e8a098-2552-4a1a-9cb2-4beae219ec3f")}
    auth_calls = []
    ai_calls = []

    async def active_user():
        auth_calls.append(True)
        return user

    async def interpret_query(request):
        ai_calls.append(request.text)
        return QueryInterpretation(filters={"query": request.text}), "test-model"

    monkeypatch.setitem(app.dependency_overrides, require_active_user, active_user)
    monkeypatch.setattr(main, "interpret_query", interpret_query)

    async def request_from(client_address):
        transport = httpx.ASGITransport(app=app, client=(client_address, 4321))
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.post("/api/v1/ai/interpret", json={"text": "near a school"})

    async def request_ai_twice():
        return await request_from("198.51.100.10"), await request_from("198.51.100.11")

    first, second = asyncio.run(request_ai_twice())

    assert first.status_code == 200
    assert second.status_code == 429
    assert second.headers["Retry-After"]
    assert len(auth_calls) == 2
    assert ai_calls == ["near a school"]


def test_ai_interpret_limiter_uses_settings_loaded_from_local_env(monkeypatch, tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text("AI_RATE_LIMIT_REQUESTS=1\nAI_RATE_LIMIT_WINDOW_SECONDS=7\n")
    monkeypatch.delenv("AI_RATE_LIMIT_REQUESTS", raising=False)
    monkeypatch.delenv("AI_RATE_LIMIT_WINDOW_SECONDS", raising=False)
    monkeypatch.setattr(main, "load_local_project_env", lambda: load_local_project_env(env_file))
    monkeypatch.setattr(main, "ai_interpret_limiter", None)

    async def open_pool():
        return None

    async def close_pool():
        return None

    monkeypatch.setattr(main, "open_pool", open_pool)
    monkeypatch.setattr(main, "close_pool", close_pool)

    async def start_application():
        async with main.lifespan(app):
            assert main.ai_interpret_limiter is not None
            assert main.ai_interpret_limiter.max_requests == 1
            assert main.ai_interpret_limiter.window_seconds == 7

    asyncio.run(start_application())


def test_rate_limit_key_uses_user_id_or_sanitized_client_ip():
    request = Request({"type": "http", "client": ("2001:0db8:0:0:0:0:0:1", 4321)})

    assert rate_limit_key({"id": UUID("29e8a098-2552-4a1a-9cb2-4beae219ec3f")}, request) == (
        "user:29e8a098-2552-4a1a-9cb2-4beae219ec3f"
    )
    assert rate_limit_key(None, request) == "client:2001:db8::1"
    invalid_request = Request({"type": "http", "client": ("not-an-ip\r\nforged", 4321)})
    assert rate_limit_key(None, invalid_request) == "client:unknown"


def test_example_configuration_placeholders_are_treated_as_unconfigured():
    assert not is_configured_value("https://your-project.example")
    assert not is_configured_value("replace-me")
    assert not is_configured_value("replace-me-server-only")
    assert is_configured_value("configured-value")


def test_gemini_example_key_is_not_treated_as_ready(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "replace-me")
    monkeypatch.setenv("GEMINI_MONTHLY_BUDGET_USD", "5")
    monkeypatch.setenv("GEMINI_INPUT_USD_PER_MILLION", "0.75")
    monkeypatch.setenv("GEMINI_OUTPUT_USD_PER_MILLION", "3.75")
    assert not gemini_configuration_ready()


def test_score_preview_validates_ranges_and_keeps_missing_data_unavailable():
    zero = score_preview(ScoreRequest(criteria={"school": 0}))
    assert zero["score"] == 0
    assert zero["coverage"] == 1
    result = score_preview(ScoreRequest(criteria={"school": 100, "care": 50}, weights={"school": 3, "care": 1}))
    assert result["score"] == 87.5
    assert result["coverage"] == 1
    missing = score_preview(ScoreRequest(criteria={"school": 90, "care": None}, weights={"school": 1, "care": 1}))
    assert missing["score"] == 90
    assert missing["coverage"] == 0.5
    try:
        score_preview(ScoreRequest(criteria={"school": 101}))
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 422
    else:
        raise AssertionError("out-of-range score should be rejected")


class _Transaction:
    def __init__(self, connection):
        self.connection = connection

    async def __aenter__(self):
        self.connection.in_transaction = True

    async def __aexit__(self, *_args):
        self.connection.in_transaction = False


class _ProfileConnection:
    def __init__(self, weights=None):
        self.weights = dict(weights or {})
        self.operations = []
        self.in_transaction = False

    def transaction(self):
        return _Transaction(self)

    async def fetch(self, sql, *values):
        if "WITH current_hdb_snapshot AS" in sql:
            return [
                {"kind": "town", "value": "BISHAN"},
                {"kind": "flat_type", "value": "4 ROOM"},
            ]
        assert "FROM criterion_weight" in sql
        profile_id = values[0]
        assert profile_id == "profile-1"
        return [{"criterion": criterion, "weight": weight} for criterion, weight in self.weights.items()]

    async def execute(self, sql, *values):
        self.operations.append((sql, values, self.in_transaction))
        if "DELETE FROM criterion_weight" in sql:
            profile_id, allowed_criteria = values
            assert profile_id == "profile-1"
            self.weights = {
                criterion: weight
                for criterion, weight in self.weights.items()
                if criterion in allowed_criteria
            }
        return "OK"

    async def executemany(self, sql, rows):
        rows = list(rows)
        self.operations.append((sql, rows, self.in_transaction))
        for profile_id, criterion, weight in rows:
            assert profile_id == "profile-1"
            self.weights[criterion] = weight


def _profile_row():
    return {
        "id": "profile-1",
        "adults": 2,
        "children": 1,
        "older_adults": 0,
        "budget_cents": 50_000_000,
        "locale": "en-SG",
        "updated_at": datetime(2026, 10, 20, tzinfo=timezone.utc),
        "preferred_towns": [],
        "preferred_flat_type": None,
        "max_school_distance_m": None,
        "max_childcare_distance_m": None,
        "max_care_distance_m": None,
        "onboarding_completed": False,
    }


def _profile_pool(monkeypatch, connection):
    async def ensure_user(_connection, _user):
        return None

    async def ensure_profile(_connection, _user_id):
        return _profile_row()

    monkeypatch.setattr(main, "ensure_user", ensure_user)
    monkeypatch.setattr(main, "ensure_profile", ensure_profile)
    monkeypatch.setattr(main, "require_pool", lambda: _Pool(connection))


def test_get_profile_returns_effective_priority_weights_with_defaults(monkeypatch):
    connection = _ProfileConnection({"school": 1.5, "legacy_criterion": 2})
    _profile_pool(monkeypatch, connection)

    payload = asyncio.run(main.get_profile({"id": "user-1"}))

    assert payload["priorityWeights"] == {
        "school": 1.5,
        "childcare": 2,
        "care": 2,
        "affordability": 1,
    }
    assert "priority_weights" not in payload


def test_put_profile_replaces_allowed_weights_and_removes_stale_rows_atomically(monkeypatch):
    connection = _ProfileConnection({"school": 0.25, "legacy_criterion": 2})
    _profile_pool(monkeypatch, connection)
    request = FamilyProfileUpdate(
        adults=2,
        children=1,
        older_adults=0,
        priority_weights={"school": 0.5, "affordability": 3},
    )

    payload = asyncio.run(main.update_profile(request, {"id": "user-1"}))

    expected = {"school": 0.5, "childcare": 2, "care": 2, "affordability": 3}
    assert connection.weights == expected
    assert payload["priorityWeights"] == expected
    assert all(in_transaction for _sql, _values, in_transaction in connection.operations)
    upsert_rows = next(values for sql, values, _tx in connection.operations if "INSERT INTO criterion_weight" in sql)
    assert {criterion for _profile_id, criterion, _weight in upsert_rows} == set(expected)
