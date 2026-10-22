-- Store onboarding state and the search preferences shared with Explore.
-- Existing accounts stay complete; registration explicitly marks new profiles incomplete.

ALTER TABLE family_profile
  ADD COLUMN IF NOT EXISTS preferred_towns text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS preferred_flat_type text,
  ADD COLUMN IF NOT EXISTS max_school_distance_m integer,
  ADD COLUMN IF NOT EXISTS max_childcare_distance_m integer,
  ADD COLUMN IF NOT EXISTS max_care_distance_m integer,
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'family_profile_preferred_towns_count_check'
      AND conrelid = 'family_profile'::regclass
  ) THEN
    ALTER TABLE family_profile
      ADD CONSTRAINT family_profile_preferred_towns_count_check
      CHECK (cardinality(preferred_towns) <= 3);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'family_profile_preferred_flat_type_check'
      AND conrelid = 'family_profile'::regclass
  ) THEN
    ALTER TABLE family_profile
      ADD CONSTRAINT family_profile_preferred_flat_type_check
      CHECK (preferred_flat_type IS NULL OR char_length(preferred_flat_type) <= 40);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'family_profile_max_school_distance_check'
      AND conrelid = 'family_profile'::regclass
  ) THEN
    ALTER TABLE family_profile
      ADD CONSTRAINT family_profile_max_school_distance_check
      CHECK (max_school_distance_m IS NULL OR max_school_distance_m BETWEEN 0 AND 100000);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'family_profile_max_childcare_distance_check'
      AND conrelid = 'family_profile'::regclass
  ) THEN
    ALTER TABLE family_profile
      ADD CONSTRAINT family_profile_max_childcare_distance_check
      CHECK (max_childcare_distance_m IS NULL OR max_childcare_distance_m BETWEEN 0 AND 100000);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'family_profile_max_care_distance_check'
      AND conrelid = 'family_profile'::regclass
  ) THEN
    ALTER TABLE family_profile
      ADD CONSTRAINT family_profile_max_care_distance_check
      CHECK (max_care_distance_m IS NULL OR max_care_distance_m BETWEEN 0 AND 100000);
  END IF;
END
$$;
