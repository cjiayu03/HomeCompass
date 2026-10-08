-- HomeCompass persistence baseline. Apply with a reviewed migration tool.
-- Provider, retention, scoring and exact source policies must be confirmed before production.

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS user_account (
  id uuid PRIMARY KEY,
  email text UNIQUE,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS family_profile (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE REFERENCES user_account(id) ON DELETE CASCADE,
  adults integer NOT NULL CHECK (adults >= 1),
  children integer NOT NULL CHECK (children >= 0),
  older_adults integer NOT NULL CHECK (older_adults >= 0),
  budget_cents bigint CHECK (budget_cents >= 0),
  locale text NOT NULL DEFAULT 'en-SG',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS household_member (
  id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES family_profile(id) ON DELETE CASCADE,
  member_type text NOT NULL,
  support_need text
);

CREATE TABLE IF NOT EXISTS source_snapshot (
  id uuid PRIMARY KEY,
  source_id text NOT NULL,
  source_url text,
  source_version text,
  content_hash text,
  source_updated_at timestamptz,
  retrieved_at timestamptz NOT NULL DEFAULT now(),
  geometry_srid integer,
  row_count integer NOT NULL DEFAULT 0,
  rejected_count integer NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('staged', 'valid', 'degraded', 'failed')),
  validation_report jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS candidate_home (
  id text PRIMARY KEY,
  source_snapshot_id uuid NOT NULL REFERENCES source_snapshot(id),
  address text NOT NULL,
  town text,
  flat_type text,
  price_observation_cents bigint CHECK (price_observation_cents >= 0),
  observed_on date,
  geometry geometry(Point, 4326) NOT NULL,
  source_semantics text NOT NULL DEFAULT 'historical_transaction',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS candidate_home_geometry_idx ON candidate_home USING gist (geometry);

CREATE TABLE IF NOT EXISTS neighbourhood_resource (
  id text PRIMARY KEY,
  source_snapshot_id uuid NOT NULL REFERENCES source_snapshot(id),
  resource_type text NOT NULL,
  name text NOT NULL,
  geometry geometry(Geometry, 4326),
  status text,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS neighbourhood_resource_geometry_idx ON neighbourhood_resource USING gist (geometry);
CREATE INDEX IF NOT EXISTS neighbourhood_resource_source_snapshot_idx ON neighbourhood_resource (source_snapshot_id);
CREATE INDEX IF NOT EXISTS neighbourhood_resource_type_idx ON neighbourhood_resource (resource_type);

CREATE TABLE IF NOT EXISTS personal_place (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
  label text NOT NULL,
  address text,
  geometry geometry(Point, 4326) NOT NULL,
  maximum_distance_m integer CHECK (maximum_distance_m > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS personal_place_geometry_idx ON personal_place USING gist (geometry);

CREATE TABLE IF NOT EXISTS search_history (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('structured', 'natural_language')),
  criteria jsonb NOT NULL,
  source_snapshot_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  scoring_version text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shortlist (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Family shortlist',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shortlist_entry (
  shortlist_id uuid NOT NULL REFERENCES shortlist(id) ON DELETE CASCADE,
  candidate_home_id text NOT NULL REFERENCES candidate_home(id),
  position integer NOT NULL CHECK (position >= 0),
  saved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (shortlist_id, candidate_home_id),
  UNIQUE (shortlist_id, position)
);

CREATE TABLE IF NOT EXISTS criterion_weight (
  profile_id uuid NOT NULL REFERENCES family_profile(id) ON DELETE CASCADE,
  criterion text NOT NULL,
  weight numeric(6,3) NOT NULL CHECK (weight >= 0),
  PRIMARY KEY (profile_id, criterion)
);
