from __future__ import annotations

import re
from pathlib import Path
from typing import Iterable


MIGRATIONS_DIRECTORY = Path(__file__).resolve().parents[2] / "database" / "migrations"

# The backend image does not copy database/migrations. Keep its schema probe
# version explicit and checked against the discovered files in the source tree.
SCHEMA_VERIFIED_MIGRATION_VERSION = 12
LATEST_MIGRATION_VERSION = 12

# The backend image does not contain database/migrations and the migrations do
# not maintain a version table. These signatures inspect the effects of the
# checked-in migrations 001 through 012 without depending on deployment paths.
_MIGRATION_INSPECTION_QUERY = """
WITH required_tables(table_name) AS (
    VALUES
        ('user_account'),
        ('family_profile'),
        ('household_member'),
        ('source_snapshot'),
        ('candidate_home'),
        ('neighbourhood_resource'),
        ('personal_place'),
        ('search_history'),
        ('shortlist'),
        ('shortlist_entry'),
        ('criterion_weight'),
        ('account_deletion'),
        ('ai_monthly_usage'),
        ('account_sync_event'),
        ('saved_search'),
        ('local_auth_identity'),
        ('local_auth_session'),
        ('planning_workspace'),
        ('password_recovery')
), required_columns(table_name, column_name) AS (
    VALUES
        ('candidate_home', 'geometry'),
        ('candidate_home', 'floor_area_sqm'),
        ('candidate_home', 'storey_range'),
        ('candidate_home', 'lease_commence_year'),
        ('candidate_home', 'flat_model'),
        ('candidate_home', 'remaining_lease'),
        ('candidate_home', 'geocode_status'),
        ('candidate_home', 'geometry_source'),
        ('candidate_home', 'geometry_source_snapshot_id'),
        ('candidate_home', 'geocoded_at'),
        ('neighbourhood_resource', 'geometry'),
        ('neighbourhood_resource', 'location_source_snapshot_id'),
        ('personal_place', 'kind'),
        ('personal_place', 'geocode_source'),
        ('personal_place', 'geocoded_at'),
        ('account_sync_event', 'user_id'),
        ('account_sync_event', 'sync_key'),
        ('account_sync_event', 'result'),
        ('account_sync_event', 'created_at'),
        ('saved_search', 'id'),
        ('saved_search', 'user_id'),
        ('saved_search', 'name'),
        ('saved_search', 'mode'),
        ('saved_search', 'criteria'),
        ('saved_search', 'place_constraints'),
        ('saved_search', 'priority_weights'),
        ('saved_search', 'scoring_version'),
        ('saved_search', 'created_at'),
        ('saved_search', 'updated_at'),
        ('saved_search', 'last_run_at'),
        ('saved_search', 'last_source_snapshot_ids'),
        ('saved_search', 'last_result_meta'),
        ('local_auth_identity', 'user_id'),
        ('local_auth_identity', 'email'),
        ('local_auth_identity', 'password_hash'),
        ('local_auth_identity', 'created_at'),
        ('local_auth_identity', 'updated_at'),
        ('local_auth_session', 'id'),
        ('local_auth_session', 'user_id'),
        ('local_auth_session', 'token_hash'),
        ('local_auth_session', 'created_at'),
        ('local_auth_session', 'expires_at'),
        ('local_auth_session', 'revoked_at'),
        ('family_profile', 'preferred_towns'),
        ('family_profile', 'preferred_flat_type'),
        ('family_profile', 'max_school_distance_m'),
        ('family_profile', 'max_childcare_distance_m'),
        ('family_profile', 'max_care_distance_m'),
        ('family_profile', 'onboarding_completed'),
        ('planning_workspace', 'user_id'),
        ('planning_workspace', 'scenarios'),
        ('planning_workspace', 'decisions'),
        ('planning_workspace', 'revision'),
        ('planning_workspace', 'updated_at'),
        ('password_recovery', 'created_at'),
        ('password_recovery', 'user_id'),
        ('password_recovery', 'token_hash'),
        ('password_recovery', 'expires_at')
), required_family_profile_columns(
    column_name, data_type, is_nullable
) AS (
    VALUES
        ('preferred_towns', 'ARRAY', 'NO'),
        ('preferred_flat_type', 'text', 'YES'),
        ('max_school_distance_m', 'integer', 'YES'),
        ('max_childcare_distance_m', 'integer', 'YES'),
        ('max_care_distance_m', 'integer', 'YES'),
        ('onboarding_completed', 'boolean', 'NO')
), required_planning_workspace_columns(
    column_name, data_type, is_nullable
) AS (
    VALUES
        ('user_id', 'uuid', 'NO'),
        ('scenarios', 'jsonb', 'NO'),
        ('decisions', 'jsonb', 'NO'),
        ('revision', 'integer', 'NO'),
        ('updated_at', 'timestamp with time zone', 'NO')
), required_sync_event_columns(
    column_name, data_type, is_nullable, expected_default
) AS (
    VALUES
        ('user_id', 'uuid', 'NO', NULL),
        ('sync_key', 'text', 'NO', NULL),
        ('result', 'jsonb', 'NO', NULL),
        ('created_at', 'timestamp with time zone', 'NO', 'now()')
), required_constraints(
    constraint_name, table_name, column_name, expected_definition
) AS (
    VALUES
        (
            'personal_place_kind_check',
            'personal_place',
            'kind',
            'CHECK ((kind = ANY (ARRAY[''workplace''::text, ''school''::text, ''childcare''::text, ''elder-care''::text, ''other''::text])))'
        ),
        (
            'personal_place_geocode_source_check',
            'personal_place',
            'geocode_source',
            'CHECK (((geocode_source IS NULL) OR (geocode_source = ANY (ARRAY[''OneMap''::text, ''manual''::text]))))'
        ),
        (
            'family_profile_preferred_towns_count_check',
            'family_profile',
            'preferred_towns',
            'CHECK ((cardinality(preferred_towns) <= 30))'
        ),
        (
            'family_profile_preferred_flat_type_check',
            'family_profile',
            'preferred_flat_type',
            'CHECK (((preferred_flat_type IS NULL) OR (char_length(preferred_flat_type) <= 40)))'
        ),
        (
            'family_profile_max_school_distance_check',
            'family_profile',
            'max_school_distance_m',
            'CHECK (((max_school_distance_m IS NULL) OR ((max_school_distance_m >= 0) AND (max_school_distance_m <= 100000))))'
        ),
        (
            'family_profile_max_childcare_distance_check',
            'family_profile',
            'max_childcare_distance_m',
            'CHECK (((max_childcare_distance_m IS NULL) OR ((max_childcare_distance_m >= 0) AND (max_childcare_distance_m <= 100000))))'
        ),
        (
            'family_profile_max_care_distance_check',
            'family_profile',
            'max_care_distance_m',
            'CHECK (((max_care_distance_m IS NULL) OR ((max_care_distance_m >= 0) AND (max_care_distance_m <= 100000))))'
        )
), required_personal_place_columns(column_name, data_type, is_nullable, expected_default) AS (
    VALUES
        ('kind', 'text', 'NO', '''other''::text'),
        ('geocode_source', 'text', 'YES', NULL),
        ('geocoded_at', 'timestamp with time zone', 'YES', NULL)
), required_auth_constraints(constraint_name, table_name, constraint_type, column_name) AS (
    VALUES
        ('password_recovery_user_id_fkey', 'password_recovery', 'f', 'user_id'),
        ('password_recovery_pkey', 'password_recovery', 'p', 'user_id'),
        ('password_recovery_token_hash_key', 'password_recovery', 'u', 'token_hash'),
        ('password_recovery_token_hash_check', 'password_recovery', 'c', 'token_hash'),
        ('local_auth_identity_user_id_fkey', 'local_auth_identity', 'f', 'user_id'),
        ('local_auth_identity_email_unique', 'local_auth_identity', 'u', 'email'),
        ('local_auth_identity_email_normalized_check', 'local_auth_identity', 'c', 'email'),
        ('local_auth_identity_password_hash_check', 'local_auth_identity', 'c', 'password_hash'),
        ('local_auth_session_user_id_fkey', 'local_auth_session', 'f', 'user_id'),
        ('local_auth_session_token_hash_unique', 'local_auth_session', 'u', 'token_hash'),
        ('local_auth_session_token_hash_check', 'local_auth_session', 'c', 'token_hash'),
        ('planning_workspace_user_id_fkey', 'planning_workspace', 'f', 'user_id'),
        ('planning_workspace_pkey', 'planning_workspace', 'p', 'user_id'),
        ('planning_workspace_scenarios_array_check', 'planning_workspace', 'c', 'scenarios'),
        ('planning_workspace_decisions_object_check', 'planning_workspace', 'c', 'decisions'),
        ('planning_workspace_revision_check', 'planning_workspace', 'c', 'revision'),
        ('planning_workspace_payload_size_check', 'planning_workspace', 'c', 'scenarios')
)
SELECT
    NOT EXISTS (
        SELECT 1
        FROM required_tables required
        WHERE NOT EXISTS (
            SELECT 1
            FROM information_schema.tables actual
            WHERE actual.table_schema = 'public'
              AND actual.table_type = 'BASE TABLE'
              AND actual.table_name = required.table_name
        )
    )
    AND NOT EXISTS (
        SELECT 1
        FROM required_columns required
        WHERE NOT EXISTS (
            SELECT 1
            FROM information_schema.columns actual
            WHERE actual.table_schema = 'public'
              AND actual.table_name = required.table_name
              AND actual.column_name = required.column_name
        )
    )
    AND NOT EXISTS (
        SELECT 1
        FROM required_family_profile_columns required
        WHERE NOT EXISTS (
            SELECT 1
            FROM information_schema.columns actual
            WHERE actual.table_schema = 'public'
              AND actual.table_name = 'family_profile'
              AND actual.column_name = required.column_name
              AND actual.data_type = required.data_type
              AND actual.is_nullable = required.is_nullable
        )
    )
    AND NOT EXISTS (
        SELECT 1
        FROM required_planning_workspace_columns required
        WHERE NOT EXISTS (
            SELECT 1
            FROM information_schema.columns actual
            WHERE actual.table_schema = 'public'
              AND actual.table_name = 'planning_workspace'
              AND actual.column_name = required.column_name
              AND actual.data_type = required.data_type
              AND actual.is_nullable = required.is_nullable
        )
    )
    AND NOT EXISTS (
        SELECT 1
        FROM required_sync_event_columns required
        WHERE NOT EXISTS (
            SELECT 1
            FROM information_schema.columns actual
            WHERE actual.table_schema = 'public'
              AND actual.table_name = 'account_sync_event'
              AND actual.column_name = required.column_name
              AND actual.data_type = required.data_type
              AND actual.is_nullable = required.is_nullable
              AND actual.column_default IS NOT DISTINCT FROM required.expected_default
        )
    )
    AND NOT EXISTS (
        SELECT 1
        FROM required_constraints required
        WHERE NOT EXISTS (
            SELECT 1
            FROM pg_constraint actual
            JOIN pg_class AS table_class
              ON table_class.oid = actual.conrelid
            JOIN pg_namespace AS table_namespace
              ON table_namespace.oid = table_class.relnamespace
            JOIN pg_attribute AS constraint_column
              ON constraint_column.attrelid = table_class.oid
             AND constraint_column.attname = required.column_name
             AND constraint_column.attnum > 0
             AND NOT constraint_column.attisdropped
            WHERE table_namespace.nspname = 'public'
              AND table_class.relname = required.table_name
              AND actual.conname = required.constraint_name
              AND actual.contype = 'c'
              AND actual.convalidated
              AND actual.conkey = ARRAY[constraint_column.attnum]::smallint[]
              AND ARRAY(
                  SELECT token[1] FROM regexp_matches(
                      pg_get_constraintdef(actual.oid), $literal$'([^']*)'$literal$, 'g'
                  ) AS token
              ) = ARRAY(
                  SELECT token[1] FROM regexp_matches(
                      required.expected_definition, $literal$'([^']*)'$literal$, 'g'
                  ) AS token
              )
              AND regexp_replace(
                  pg_get_constraintdef(actual.oid),
                  '[[:space:]]+',
                  '',
                  'g'
              ) = regexp_replace(
                  required.expected_definition,
                  '[[:space:]]+',
                  '',
                  'g'
              )
        )
    )
    AND EXISTS (
        SELECT 1
        FROM pg_index AS actual_index
        JOIN pg_class AS index_class
          ON index_class.oid = actual_index.indexrelid
        JOIN pg_namespace AS index_namespace
          ON index_namespace.oid = index_class.relnamespace
        JOIN pg_am AS index_method
          ON index_method.oid = index_class.relam
        JOIN pg_class AS table_class
          ON table_class.oid = actual_index.indrelid
        JOIN pg_namespace AS table_namespace
          ON table_namespace.oid = table_class.relnamespace
        WHERE index_namespace.nspname = 'public'
          AND index_class.relname = 'personal_place_user_kind_idx'
          AND index_method.amname = 'btree'
          AND table_namespace.nspname = 'public'
          AND table_class.relname = 'personal_place'
          AND actual_index.indisvalid
          AND actual_index.indisready
          AND NOT actual_index.indisunique
          AND actual_index.indnatts = 2
          AND actual_index.indnkeyatts = 2
          AND actual_index.indpred IS NULL
          AND actual_index.indexprs IS NULL
          AND ARRAY(
              SELECT index_column.attname::text
              FROM unnest(actual_index.indkey) WITH ORDINALITY
                   AS index_key(attnum, position)
              JOIN pg_attribute AS index_column
                ON index_column.attrelid = table_class.oid
               AND index_column.attnum = index_key.attnum
              ORDER BY index_key.position
          ) = ARRAY['user_id', 'kind']::text[]
    )
    AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'candidate_home'
          AND column_name = 'geometry'
          AND is_nullable = 'YES'
    )
    AND NOT EXISTS (
        SELECT 1
        FROM required_personal_place_columns required
        WHERE NOT EXISTS (
            SELECT 1
            FROM information_schema.columns actual
            WHERE actual.table_schema = 'public'
              AND actual.table_name = 'personal_place'
              AND actual.column_name = required.column_name
              AND actual.data_type = required.data_type
              AND actual.is_nullable = required.is_nullable
              AND actual.column_default IS NOT DISTINCT FROM required.expected_default
        )
    )
    AND NOT EXISTS (
        SELECT 1
        FROM required_auth_constraints required
        WHERE NOT EXISTS (
            SELECT 1
            FROM pg_constraint AS actual
            JOIN pg_class AS table_class
              ON table_class.oid = actual.conrelid
            JOIN pg_namespace AS table_namespace
              ON table_namespace.oid = table_class.relnamespace
            JOIN pg_attribute AS constraint_column
              ON constraint_column.attrelid = table_class.oid
             AND constraint_column.attname = required.column_name
             AND constraint_column.attnum > 0
             AND NOT constraint_column.attisdropped
            LEFT JOIN pg_class AS referenced_class
              ON referenced_class.oid = actual.confrelid
            LEFT JOIN pg_namespace AS referenced_namespace
              ON referenced_namespace.oid = referenced_class.relnamespace
            LEFT JOIN pg_attribute AS referenced_column
              ON referenced_column.attrelid = referenced_class.oid
             AND referenced_column.attname = 'id'
             AND referenced_column.attnum > 0
             AND NOT referenced_column.attisdropped
            WHERE table_namespace.nspname = 'public'
              AND table_class.relname = required.table_name
              AND actual.conname = required.constraint_name
              AND actual.contype = required.constraint_type
              AND actual.convalidated
              AND (
                  (actual.contype = 'c' AND constraint_column.attnum = ANY(actual.conkey))
                  OR (actual.contype <> 'c' AND actual.conkey = ARRAY[constraint_column.attnum]::smallint[])
              )
              AND (
                  required.constraint_type <> 'f'
                  OR (
                      actual.confdeltype = 'c'
                      AND referenced_namespace.nspname = 'public'
                      AND referenced_class.relname = 'user_account'
                      AND actual.confkey = ARRAY[referenced_column.attnum]::smallint[]
                  )
              )
        )
    )
    AND EXISTS (
        SELECT 1
        FROM pg_attribute AS a
        JOIN pg_class AS c ON c.oid = a.attrelid
        JOIN pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'neighbourhood_resource'
          AND a.attname = 'geometry'
          AND NOT a.attisdropped
          AND format_type(a.atttypid, a.atttypmod) = 'geometry(Geometry,4326)'
    )
    AND EXISTS (
        SELECT 1
        FROM pg_constraint AS actual
        JOIN pg_class AS table_class
          ON table_class.oid = actual.conrelid
        JOIN pg_namespace AS table_namespace
          ON table_namespace.oid = table_class.relnamespace
        WHERE table_namespace.nspname = 'public'
          AND table_class.relname = 'account_sync_event'
          AND actual.conname = 'account_sync_event_user_sync_key_unique'
          AND actual.contype = 'u'
          AND actual.convalidated
          AND NOT actual.condeferrable
          AND ARRAY(
              SELECT constraint_column.attname::text
              FROM unnest(actual.conkey) WITH ORDINALITY
                   AS constraint_key(attnum, position)
              JOIN pg_attribute AS constraint_column
                ON constraint_column.attrelid = table_class.oid
               AND constraint_column.attnum = constraint_key.attnum
               AND NOT constraint_column.attisdropped
              ORDER BY constraint_key.position
          ) = ARRAY['user_id', 'sync_key']::text[]
    )
    AND EXISTS (
        SELECT 1
        FROM pg_constraint AS actual
        JOIN pg_class AS table_class
          ON table_class.oid = actual.conrelid
        JOIN pg_namespace AS table_namespace
          ON table_namespace.oid = table_class.relnamespace
        JOIN pg_attribute AS referencing_column
          ON referencing_column.attrelid = table_class.oid
         AND referencing_column.attname = 'user_id'
         AND referencing_column.attnum > 0
         AND NOT referencing_column.attisdropped
        JOIN pg_class AS referenced_class
          ON referenced_class.oid = actual.confrelid
        JOIN pg_namespace AS referenced_namespace
          ON referenced_namespace.oid = referenced_class.relnamespace
        JOIN pg_attribute AS referenced_column
          ON referenced_column.attrelid = referenced_class.oid
         AND referenced_column.attname = 'id'
         AND referenced_column.attnum > 0
         AND NOT referenced_column.attisdropped
        WHERE table_namespace.nspname = 'public'
          AND table_class.relname = 'account_sync_event'
          AND actual.conname = 'account_sync_event_user_id_fkey'
          AND actual.contype = 'f'
          AND actual.convalidated
          AND actual.confdeltype = 'c'
          AND actual.conkey = ARRAY[referencing_column.attnum]::smallint[]
          AND actual.confkey = ARRAY[referenced_column.attnum]::smallint[]
          AND referenced_namespace.nspname = 'public'
          AND referenced_class.relname = 'user_account'
    )
    AND EXISTS (
        SELECT 1
        FROM pg_index AS actual_index
        JOIN pg_class AS index_class
          ON index_class.oid = actual_index.indexrelid
        JOIN pg_namespace AS index_namespace
          ON index_namespace.oid = index_class.relnamespace
        JOIN pg_am AS index_method
          ON index_method.oid = index_class.relam
        JOIN pg_class AS table_class
          ON table_class.oid = actual_index.indrelid
        JOIN pg_namespace AS table_namespace
          ON table_namespace.oid = table_class.relnamespace
        WHERE index_namespace.nspname = 'public'
          AND index_class.relname = 'saved_search_user_updated_idx'
          AND index_method.amname = 'btree'
          AND table_namespace.nspname = 'public'
          AND table_class.relname = 'saved_search'
          AND actual_index.indisvalid
          AND actual_index.indisready
          AND NOT actual_index.indisunique
          AND actual_index.indnatts = 2
          AND actual_index.indnkeyatts = 2
          AND actual_index.indpred IS NULL
          AND actual_index.indexprs IS NULL
          AND ARRAY(
              SELECT index_column.attname::text
              FROM unnest(actual_index.indkey) WITH ORDINALITY
                   AS index_key(attnum, position)
              JOIN pg_attribute AS index_column
                ON index_column.attrelid = table_class.oid
               AND index_column.attnum = index_key.attnum
              ORDER BY index_key.position
          ) = ARRAY['user_id', 'updated_at']::text[]
    )
"""

_MIGRATION_FILENAME = re.compile(
    r"(?P<version>[0-9]{3})_[A-Za-z0-9][A-Za-z0-9_-]*\.sql"
)
_SAFE_FILENAME = re.compile(r"[^A-Za-z0-9_.-]")


class MigrationSetError(ValueError):
    """A migration filename set is malformed or cannot be applied in order."""


class MigrationDirectoryUnavailable(MigrationSetError):
    """The source migration directory is not packaged in this environment."""


def _display_filename(value: str | Path) -> str:
    filename = Path(value).name
    return _SAFE_FILENAME.sub("?", filename)[:128] or "<empty>"


def validate_migration_set(names: Iterable[str | Path]) -> list[tuple[int, str]]:
    """Validate migration names and return their numeric versions in input order."""
    parsed: list[tuple[int, str]] = []
    versions: dict[int, str] = {}

    for value in names:
        if not isinstance(value, (str, Path)):
            raise MigrationSetError("Unexpected migration filename: <unsupported>")

        filename = Path(value).name
        match = _MIGRATION_FILENAME.fullmatch(filename)
        if match is None:
            raise MigrationSetError(
                f"Unexpected migration filename: {_display_filename(value)}"
            )

        version = int(match.group("version"))
        if version == 0:
            raise MigrationSetError(
                f"Unexpected migration version 000 in {_display_filename(value)}"
            )
        if version in versions:
            raise MigrationSetError(
                f"Duplicate migration version {version:03d}: "
                f"{versions[version]} and {_display_filename(value)}"
            )

        safe_filename = _display_filename(value)
        versions[version] = safe_filename
        parsed.append((version, safe_filename))

    sorted_versions = sorted(versions)
    for expected, actual in enumerate(sorted_versions, start=1):
        if actual != expected:
            filename = versions[actual]
            raise MigrationSetError(
                f"Missing migration version {expected:03d} before {filename}"
            )
    if not sorted_versions:
        raise MigrationSetError("Missing migration version 001")

    if [version for version, _ in parsed] != sorted_versions:
        raise MigrationSetError("Migration application order must be ascending by version")

    return parsed


def checked_in_migrations() -> list[tuple[int, str]]:
    """Read and validate only the checked-in database/migrations/*.sql files."""
    if not MIGRATIONS_DIRECTORY.is_dir():
        raise MigrationDirectoryUnavailable("Checked-in migration directory is unavailable")

    try:
        names = sorted(
            path.name
            for path in MIGRATIONS_DIRECTORY.glob("*.sql")
            if path.is_file()
        )
    except OSError:
        raise MigrationDirectoryUnavailable(
            "Checked-in migration directory is unavailable"
        ) from None

    return validate_migration_set(names)


def latest_migration_version() -> int:
    """Return the checked-in latest version, with the packaged schema version as fallback."""
    try:
        migrations = checked_in_migrations()
    except MigrationDirectoryUnavailable:
        return LATEST_MIGRATION_VERSION
    return migrations[-1][0]


async def inspect_applied_migration_version(connection) -> int | None:
    """Deployment hook for a migration marker or the schema contract probe.

    No checked-in migration creates a version ledger. The default probe reports
    the schema-verified version only when every checked-in migration contract
    is present. A deployment runner with a ledger can bind a reader here to
    report a known contiguous version even when the database is behind.
    """
    current_schema = await connection.fetchval(_MIGRATION_INSPECTION_QUERY)
    if current_schema:
        return SCHEMA_VERIFIED_MIGRATION_VERSION
    return None


async def migration_status(connection) -> dict[str, int | None | bool]:
    """Return safe applied/latest/ready migration status for readiness checks."""
    latest = latest_migration_version()
    applied = await inspect_applied_migration_version(connection)
    if applied is not None and (
        type(applied) is not int or applied < 0 or applied > latest
    ):
        raise MigrationSetError("Applied migration version is outside the checked-in range")
    return {"applied": applied, "latest": latest, "ready": applied == latest}
