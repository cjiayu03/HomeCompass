BEGIN;
ALTER TABLE family_profile DROP CONSTRAINT IF EXISTS family_profile_preferred_towns_count_check;
ALTER TABLE family_profile ADD CONSTRAINT family_profile_preferred_towns_count_check CHECK (cardinality(preferred_towns) <= 30);
COMMIT;
