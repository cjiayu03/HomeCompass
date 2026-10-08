-- Additive migration for owned account data, bounded AI usage and source provenance.
-- Apply only after backing up the database; this migration does not drop user data.

ALTER TABLE candidate_home ALTER COLUMN geometry DROP NOT NULL;
ALTER TABLE candidate_home ADD COLUMN IF NOT EXISTS floor_area_sqm numeric(8,2) CHECK (floor_area_sqm IS NULL OR floor_area_sqm > 0);
ALTER TABLE candidate_home ADD COLUMN IF NOT EXISTS storey_range text;
ALTER TABLE candidate_home ADD COLUMN IF NOT EXISTS lease_commence_year integer;
ALTER TABLE candidate_home ADD COLUMN IF NOT EXISTS flat_model text;
ALTER TABLE candidate_home ADD COLUMN IF NOT EXISTS remaining_lease text;
ALTER TABLE candidate_home ADD COLUMN IF NOT EXISTS geocode_status text NOT NULL DEFAULT 'pending' CHECK (geocode_status IN ('pending', 'resolved', 'failed', 'not_required'));
CREATE INDEX IF NOT EXISTS candidate_home_source_snapshot_idx ON candidate_home (source_snapshot_id);
CREATE INDEX IF NOT EXISTS candidate_home_search_idx ON candidate_home (town, flat_type, observed_on DESC);

CREATE TABLE IF NOT EXISTS account_deletion (
  user_id uuid PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('pending_auth_delete', 'complete')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  last_error_code text
);

CREATE TABLE IF NOT EXISTS ai_monthly_usage (
  month_start date PRIMARY KEY,
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  reserved_usd numeric(12,6) NOT NULL DEFAULT 0 CHECK (reserved_usd >= 0),
  spent_usd numeric(12,6) NOT NULL DEFAULT 0 CHECK (spent_usd >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
