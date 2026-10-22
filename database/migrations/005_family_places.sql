-- Extend owned personal places with typed, provider-backed geocoding metadata.
-- Existing rows remain in place and receive the backward-compatible kind "other".

ALTER TABLE personal_place
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS geocode_source text,
  ADD COLUMN IF NOT EXISTS geocoded_at timestamptz;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'personal_place_kind_check'
      AND conrelid = 'personal_place'::regclass
  ) THEN
    ALTER TABLE personal_place
      ADD CONSTRAINT personal_place_kind_check
      CHECK (kind IN ('workplace', 'school', 'childcare', 'elder-care', 'other'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'personal_place_geocode_source_check'
      AND conrelid = 'personal_place'::regclass
  ) THEN
    ALTER TABLE personal_place
      ADD CONSTRAINT personal_place_geocode_source_check
      CHECK (geocode_source IS NULL OR geocode_source IN ('OneMap', 'manual'));
  END IF;
END;
$migration$;

CREATE INDEX IF NOT EXISTS personal_place_user_kind_idx
  ON personal_place (user_id, kind);
