import pytest

from app.migrations import (
    LATEST_MIGRATION_VERSION,
    SCHEMA_VERIFIED_MIGRATION_VERSION,
    MigrationSetError,
    checked_in_migrations,
    validate_migration_set,
)


EXPECTED_MIGRATIONS = [
    (1, "001_initial.sql"),
    (2, "002_persistence_sources.sql"),
    (3, "003_spatial_source_layers.sql"),
    (4, "004_location_provenance.sql"),
    (5, "005_family_places.sql"),
    (6, "006_account_sync.sql"),
    (7, "007_saved_searches.sql"),
    (8, "008_local_auth.sql"),
    (9, "009_onboarding_profile.sql"),
    (10, "010_planning_workspace.sql"),
]


def test_checked_in_migrations_are_ordered_and_contiguous():
    assert checked_in_migrations() == EXPECTED_MIGRATIONS
    latest_version = EXPECTED_MIGRATIONS[-1][0]
    assert LATEST_MIGRATION_VERSION == latest_version
    assert SCHEMA_VERIFIED_MIGRATION_VERSION == latest_version


def test_validate_migration_set_rejects_duplicate_versions():
    with pytest.raises(MigrationSetError, match="(?i)duplicate migration version 001"):
        validate_migration_set(["001_initial.sql", "001_repeated.sql"])


def test_validate_migration_set_rejects_missing_versions():
    with pytest.raises(MigrationSetError, match="(?i)missing migration version 002"):
        validate_migration_set(["001_initial.sql", "003_spatial_source_layers.sql"])


def test_validate_migration_set_rejects_out_of_order_application():
    with pytest.raises(MigrationSetError, match="application order"):
        validate_migration_set(["002_persistence_sources.sql", "001_initial.sql"])


def test_validate_migration_set_rejects_unexpected_sql_filenames():
    with pytest.raises(MigrationSetError, match="unexpected.sql"):
        validate_migration_set(["001_initial.sql", "unexpected.sql"])


def test_migration_errors_name_versions_without_disclosing_database_secrets(monkeypatch):
    monkeypatch.setenv(
        "DATABASE_URL",
        "postgresql://migration-user:migration-password@db.internal/homecompass",
    )

    with pytest.raises(MigrationSetError) as error:
        validate_migration_set(["001_initial.sql", "003_spatial_source_layers.sql"])

    message = str(error.value)
    assert "003_spatial_source_layers.sql" in message
    assert "002" in message
    for private_value in (
        "DATABASE_URL",
        "migration-user",
        "migration-password",
        "db.internal",
    ):
        assert private_value not in message
