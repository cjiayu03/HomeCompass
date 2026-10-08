-- Allow government resource layers to retain their published geometry type:
-- point services, route/school-zone polygons, and active dengue polygons.
-- Address-only source rows remain in the registry with NULL geometry until
-- an authorized geocoder is configured.
ALTER TABLE neighbourhood_resource
  ALTER COLUMN geometry TYPE geometry(Geometry, 4326)
  USING geometry::geometry(Geometry, 4326);

ALTER TABLE neighbourhood_resource
  ALTER COLUMN geometry DROP NOT NULL;

CREATE INDEX IF NOT EXISTS neighbourhood_resource_source_snapshot_idx
  ON neighbourhood_resource (source_snapshot_id);

CREATE INDEX IF NOT EXISTS neighbourhood_resource_type_idx
  ON neighbourhood_resource (resource_type);
