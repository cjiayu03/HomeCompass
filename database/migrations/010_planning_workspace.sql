-- One bounded JSON workspace per active local account. Photos remain browser-local.
CREATE TABLE IF NOT EXISTS planning_workspace (
  user_id uuid PRIMARY KEY,
  scenarios jsonb NOT NULL DEFAULT '[]'::jsonb,
  decisions jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT planning_workspace_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES user_account(id) ON DELETE CASCADE,
  CONSTRAINT planning_workspace_scenarios_array_check
    CHECK (jsonb_typeof(scenarios) = 'array'),
  CONSTRAINT planning_workspace_decisions_object_check
    CHECK (jsonb_typeof(decisions) = 'object'),
  CONSTRAINT planning_workspace_revision_check
    CHECK (revision BETWEEN 1 AND 2147483647),
  CONSTRAINT planning_workspace_payload_size_check
    CHECK (octet_length(scenarios::text) + octet_length(decisions::text) <= 196608)
);

-- Nearest services and exact distance filters operate on geography in metres.
CREATE INDEX IF NOT EXISTS candidate_home_geography_idx
  ON candidate_home USING gist ((geometry::geography)) WHERE geometry IS NOT NULL;
CREATE INDEX IF NOT EXISTS neighbourhood_resource_geography_idx
  ON neighbourhood_resource USING gist ((geometry::geography)) WHERE geometry IS NOT NULL;
