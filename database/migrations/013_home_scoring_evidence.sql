-- Cache expensive nearest-resource evidence outside the request path. Scores
-- remain request-specific because budgets, weights, and distance targets vary.
CREATE TABLE IF NOT EXISTS home_scoring_evidence (
  generation_id uuid NOT NULL,
  home_id text NOT NULL REFERENCES candidate_home(id) ON DELETE CASCADE,
  school_name text,
  school_distance_m double precision CHECK (school_distance_m IS NULL OR school_distance_m >= 0),
  childcare_name text,
  childcare_distance_m double precision CHECK (childcare_distance_m IS NULL OR childcare_distance_m >= 0),
  care_name text,
  care_distance_m double precision CHECK (care_distance_m IS NULL OR care_distance_m >= 0),
  PRIMARY KEY (generation_id, home_id)
);

CREATE TABLE IF NOT EXISTS home_scoring_evidence_state (
  singleton boolean PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  generation_id uuid NOT NULL,
  home_snapshot_ids uuid[] NOT NULL,
  resource_snapshot_ids uuid[] NOT NULL,
  row_count bigint NOT NULL CHECK (row_count >= 0),
  refreshed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS home_scoring_evidence_home_idx
  ON home_scoring_evidence (home_id, generation_id);
