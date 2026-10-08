-- Provenance for OneMap coordinates; coordinates are never treated as source
-- facts from a CSV that does not contain geometry.
ALTER TABLE candidate_home
  ADD COLUMN IF NOT EXISTS geometry_source text,
  ADD COLUMN IF NOT EXISTS geometry_source_snapshot_id uuid REFERENCES source_snapshot(id),
  ADD COLUMN IF NOT EXISTS geocoded_at timestamptz;

ALTER TABLE neighbourhood_resource
  ADD COLUMN IF NOT EXISTS location_source_snapshot_id uuid REFERENCES source_snapshot(id);

CREATE INDEX IF NOT EXISTS candidate_home_geocode_status_idx ON candidate_home (geocode_status);
