-- Store account-owned saved search definitions and bounded run metadata.
-- This migration is additive; existing history and place rows remain unchanged.

CREATE TABLE IF NOT EXISTS saved_search (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  mode text NOT NULL CHECK (mode IN ('structured', 'natural_language')),
  criteria jsonb NOT NULL CHECK (
    jsonb_typeof(criteria) = 'object'
    AND char_length(coalesce(criteria->>'query', '')) <= 160
  ),
  place_constraints jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(place_constraints) = 'array'
    AND jsonb_array_length(place_constraints) <= 10
  ),
  priority_weights jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(priority_weights) = 'object'
  ),
  scoring_version text CHECK (
    scoring_version IS NULL OR char_length(scoring_version) <= 60
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_run_at timestamptz,
  last_source_snapshot_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(last_source_snapshot_ids) = 'array'
    AND jsonb_array_length(last_source_snapshot_ids) <= 20
  ),
  last_result_meta jsonb CHECK (
    last_result_meta IS NULL OR (
      jsonb_typeof(last_result_meta) = 'object'
      AND CASE
        WHEN NOT (last_result_meta ? 'sourceSummary') THEN TRUE
        WHEN jsonb_typeof(last_result_meta->'sourceSummary') = 'array' THEN
          jsonb_array_length(last_result_meta->'sourceSummary') <= 20
        ELSE FALSE
      END
      AND CASE
        WHEN NOT (last_result_meta ? 'warnings') THEN TRUE
        WHEN jsonb_typeof(last_result_meta->'warnings') = 'array' THEN
          jsonb_array_length(last_result_meta->'warnings') <= 20
        ELSE FALSE
      END
    )
  )
);

CREATE INDEX IF NOT EXISTS saved_search_user_updated_idx
  ON saved_search (user_id, updated_at DESC);
