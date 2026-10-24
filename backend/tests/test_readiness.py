import asyncio

import httpx

from app import database, migrations, readiness
from app.main import app
from app.migrations import _MIGRATION_INSPECTION_QUERY


class _Connection:
    def __init__(self, *, migrations_ready=True, homes=0, resources=0):
        self.migrations_ready = migrations_ready
        self.homes = homes
        self.resources = resources
        self.migration_query = None

    async def fetchval(self, query):
        self.migration_query = query
        return self.migrations_ready

    async def fetchrow(self, _query):
        return {"homes": self.homes, "resources": self.resources}


class _Pool:
    def __init__(self, connection):
        self.connection = connection

    def acquire(self):
        return self

    async def __aenter__(self):
        return self.connection

    async def __aexit__(self, *_args):
        return None


def _set_configured_environment(monkeypatch):
    monkeypatch.setenv(
        "DATABASE_URL",
        "postgresql://readiness-user:db-password-731@db.internal:5432/homecompass",
    )
    monkeypatch.setenv("SUPABASE_URL", "https://homecompass-test.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_readiness-secret")
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-readiness-secret")
    monkeypatch.setenv("GEMINI_MONTHLY_BUDGET_USD", "5")
    monkeypatch.setenv("GEMINI_INPUT_USD_PER_MILLION", "0.75")
    monkeypatch.setenv("GEMINI_OUTPUT_USD_PER_MILLION", "3.75")
    monkeypatch.setenv("ONEMAP_ACCESS_TOKEN", "onemap-readiness-token")


def _get_ready():
    async def request():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            return await client.get("/ready")

    return asyncio.run(request())


def test_ready_reports_configured_components_and_safe_source_counts(monkeypatch):
    _set_configured_environment(monkeypatch)
    monkeypatch.setattr(
        database,
        "_pool",
        _Pool(_Connection(migrations_ready=True, homes=128, resources=43)),
    )

    response = _get_ready()

    assert response.status_code == 200
    assert response.json() == {
        "application": "ready",
        "database": "ready",
        "migrations": "ready",
        "migrationStatus": {
            "applied": migrations.SCHEMA_VERIFIED_MIGRATION_VERSION,
            "latest": migrations.latest_migration_version(),
            "ready": True,
        },
        "sourceData": {"state": "available", "homes": 128, "resources": 43},
        "auth": "ready",
        "ai": "configured",
        "ready": True,
    }


def test_ready_is_unavailable_when_database_is_not_configured(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setattr(database, "_pool", None)

    response = _get_ready()

    assert response.status_code == 503
    assert response.json()["database"] == "unconfigured"
    assert response.json()["migrations"] == "unavailable"
    assert response.json()["migrationStatus"] == {
        "applied": None,
        "latest": migrations.latest_migration_version(),
        "ready": False,
    }
    assert response.json()["sourceData"]["state"] == "unavailable"
    assert response.json()["ready"] is False


def test_ready_is_unavailable_when_configured_database_pool_is_missing(monkeypatch):
    monkeypatch.setenv(
        "DATABASE_URL", "postgresql://readiness-user:secret@db.internal:5432/app"
    )
    monkeypatch.setattr(database, "_pool", None)

    response = _get_ready()

    assert response.status_code == 503
    assert response.json()["database"] == "unavailable"
    assert response.json()["migrations"] == "unavailable"
    assert response.json()["migrationStatus"] == {
        "applied": None,
        "latest": migrations.latest_migration_version(),
        "ready": False,
    }
    assert response.json()["ready"] is False


def test_ready_reports_pending_migrations_without_requiring_optional_providers(monkeypatch):
    _set_configured_environment(monkeypatch)
    for name in (
        "SUPABASE_URL",
        "NEXT_PUBLIC_SUPABASE_URL",
        "SUPABASE_PUBLISHABLE_KEY",
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        "GEMINI_API_KEY",
        "GEMINI_MONTHLY_BUDGET_USD",
        "GEMINI_INPUT_USD_PER_MILLION",
        "GEMINI_OUTPUT_USD_PER_MILLION",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(
        database, "_pool", _Pool(_Connection(migrations_ready=False))
    )

    response = _get_ready()

    assert response.status_code == 503
    assert response.json()["database"] == "ready"
    assert response.json()["migrations"] == "pending"
    assert response.json()["migrationStatus"] == {
        "applied": None,
        "latest": migrations.latest_migration_version(),
        "ready": False,
    }
    assert response.json()["auth"] == "pending"
    assert response.json()["ai"] == "unconfigured"
    assert response.json()["ready"] is False


def test_ready_reports_known_applied_version_when_behind_latest(monkeypatch):
    _set_configured_environment(monkeypatch)

    async def applied_version(_connection):
        return 6

    monkeypatch.setattr(migrations, "inspect_applied_migration_version", applied_version)
    monkeypatch.setattr(database, "_pool", _Pool(_Connection()))

    response = _get_ready()

    assert response.status_code == 503
    assert response.json()["database"] == "ready"
    assert response.json()["migrations"] == "pending"
    assert response.json()["migrationStatus"] == {
        "applied": 6,
        "latest": migrations.latest_migration_version(),
        "ready": False,
    }
    assert response.json()["ready"] is False


def test_ready_does_not_expose_credentials_tokens_or_connection_strings(monkeypatch):
    _set_configured_environment(monkeypatch)
    monkeypatch.setattr(database, "_pool", _Pool(_Connection(migrations_ready=True)))

    response = _get_ready()
    body = response.text

    assert response.status_code == 200
    for secret in (
        "DATABASE_URL",
        "readiness-user",
        "db-password-731",
        "db.internal",
        "homecompass-test.supabase.co",
        "sb_publishable_readiness-secret",
        "gemini-readiness-secret",
        "onemap-readiness-token",
    ):
        assert secret not in body


def test_ready_checks_migration_005_constraints_and_index_without_disclosing_schema(
    monkeypatch,
):
    _set_configured_environment(monkeypatch)
    connection = _Connection(migrations_ready=True)
    monkeypatch.setattr(database, "_pool", _Pool(connection))

    response = _get_ready()
    query = connection.migration_query
    body = response.text

    assert response.status_code == 200
    assert "pg_constraint" in query
    assert "personal_place_kind_check" in query
    assert "personal_place_geocode_source_check" in query
    assert "pg_index" in query
    assert "personal_place_user_kind_idx" in query
    assert "indisvalid" in query
    assert "ARRAY['user_id', 'kind']" in query
    for schema_detail in (
        "personal_place_kind_check",
        "personal_place_geocode_source_check",
        "personal_place_user_kind_idx",
        "workplace",
        "OneMap",
    ):
        assert schema_detail not in body


# The route tests use a fixed fetchval result; this guards the SQL contract
# without claiming to exercise PostgreSQL's live catalog.
def test_migration_inspection_query_encodes_personal_place_005_contract():
    query = " ".join(_MIGRATION_INSPECTION_QUERY.split())

    compact_query = "".join(query.split())
    assert (
        "required_personal_place_columns(column_name,data_type,is_nullable,expected_default)AS("
        in compact_query
    )
    assert "('kind','text','NO','''other''::text')" in compact_query
    assert "('geocode_source','text','YES',NULL)" in compact_query
    assert "('geocoded_at', 'timestamp with time zone', 'YES', NULL)" in query
    assert "actual.data_type=required.data_type" in compact_query
    assert "actual.is_nullable = required.is_nullable" in query
    assert (
        "actual.column_defaultISNOTDISTINCTFROMrequired.expected_default"
        in compact_query
    )
    assert "default_contains" not in query
    assert "strpos(" not in query

    assert (
        "required_constraints(constraint_name,table_name,column_name,expected_definition)AS("
        in compact_query
    )
    assert (
        "('personal_place_kind_check','personal_place','kind','CHECK((kind=ANY(ARRAY[''workplace''::text,''school''::text,''childcare''::text,''elder-care''::text,''other''::text])))')"
        in compact_query
    )
    assert (
        "('personal_place_geocode_source_check','personal_place','geocode_source','CHECK(((geocode_sourceISNULL)OR(geocode_source=ANY(ARRAY[''OneMap''::text,''manual''::text]))))')"
        in compact_query
    )
    assert (
        "regexp_replace(pg_get_constraintdef(actual.oid),'[[:space:]]+','','g')="
        "regexp_replace(required.expected_definition,'[[:space:]]+','','g')"
        in compact_query
    )
    assert "actual.conname = required.constraint_name" in query
    assert "table_namespace.nspname = 'public'" in query
    assert "table_class.relname = 'personal_place'" in query
    assert "actual.contype = 'c'" in query
    assert "actual.convalidated" in query
    assert "regexp_matches(" in query
    assert "pg_get_constraintdef(actual.oid)" in query
    assert "required.expected_definition" in query
    assert "constraint_column.attname = required.column_name" in query
    assert "constraint_column.attnum > 0" in query
    assert "NOT constraint_column.attisdropped" in query
    assert "actual.conkey = ARRAY[constraint_column.attnum]::smallint[]" in query


def test_migration_inspection_query_requires_guest_sync_006_contract():
    query = " ".join(_MIGRATION_INSPECTION_QUERY.split())

    assert "('account_sync_event')" in query
    assert "('account_sync_event', 'user_id')" in query
    assert "('account_sync_event', 'sync_key')" in query
    assert "('account_sync_event', 'result')" in query
    assert "account_sync_event_user_sync_key_unique" in query
    assert "actual.confdeltype = 'c'" in query
    assert "account_sync_event_user_id_fkey" in query
    assert "actual.column_default IS NOT DISTINCT FROM required.expected_default" in query


def test_migration_inspection_query_requires_saved_search_007_contract():
    query = " ".join(_MIGRATION_INSPECTION_QUERY.split())

    assert "('saved_search')" in query
    assert "('saved_search', 'user_id')" in query
    assert "('saved_search', 'criteria')" in query
    assert "('saved_search', 'last_result_meta')" in query
    assert "saved_search_user_updated_idx" in query
    assert "ARRAY['user_id', 'updated_at']" in query
