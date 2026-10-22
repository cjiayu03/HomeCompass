# PostgreSQL/PostGIS persistence target

The current demo uses immutable local fixtures so it can run without a database. This directory is the production persistence contract approved for the project stack.

- [`migrations/001_initial.sql`](migrations/001_initial.sql) creates the core ownership, candidate, source, search, scoring and shortlist tables.
- [`migrations/005_family_places.sql`](migrations/005_family_places.sql) additively extends existing personal places with a typed `kind` (defaulting to `other`), nullable geocoding provenance, validated allowed-value checks and a `(user_id, kind)` index. Existing personal-place rows are retained.
- [`migrations/006_account_sync.sql`](migrations/006_account_sync.sql) additively creates account-owned guest-sync idempotency records, with a cascading user foreign key and uniqueness on `(user_id, sync_key)`. Apply migrations `001` through `006` in order; `/ready` remains pending until the complete schema is present.
- Run migrations through a reviewed migration tool in the chosen deployment; do not paste credentials into scripts.
- Use the source-import pipeline to stage and atomically promote snapshots. Keep private user rows separated from public source rows.

The migration is a starting schema, not evidence that a production database has been provisioned or that the open scoring/identity policies are resolved.
