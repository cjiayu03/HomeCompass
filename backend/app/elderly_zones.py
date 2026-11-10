"""Per-home elderly-friendly evidence; flags describe geography, never safety."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import math
import os

from .dengue import parse_dengue_timestamp

SOURCES = {
    'silverZone': ('silver_zone', 'd_dc343c021aa470fc71da90d31e552a9a'),
    'dementiaGtp': ('dementia_gtp', 'd_e2d10e591bc8560b8946a0da24790fa5'),
}


def _positive_setting(name: str, default: float) -> float:
    value = float(os.getenv(name, str(default)))
    if not math.isfinite(value) or value <= 0:
        raise ValueError(f'{name} must be a positive finite number.')
    return value


def elderly_zone_status(evidence, *, kind: str, location_verified: bool, now=None) -> dict:
    """Withhold flags when source, geometry or dates cannot support the check."""
    checked = now or datetime.now(timezone.utc)
    raw = evidence or {}
    is_silver = kind == 'silverZone'
    threshold = None if is_silver else _positive_setting('DEMENTIA_GTP_NEARBY_METRES', 500)
    max_age = timedelta(days=_positive_setting('ELDERLY_ZONE_MAX_AGE_DAYS', 365))
    updated = parse_dengue_timestamp(raw.get('sourceUpdatedAt')) if raw.get('dateVerified') is True else None
    rule = ('Inside or on the published Silver Zone polygon boundary; no proximity buffer.' if is_silver else
            f'Within {threshold:g} m straight-line of a published Go-To-Point, including the limit. App setting; not an official catchment.')
    result = {
        'state': 'source_unavailable', 'flag': None, 'label': 'Data unavailable',
        'sourceId': raw.get('sourceId') or SOURCES[kind][1],
        'snapshotId': raw.get('snapshotId'),
        'sourceUrl': raw.get('sourceUrl') or f'https://data.gov.sg/datasets/{SOURCES[kind][1]}/view',
        'sourceUpdatedAt': updated.isoformat() if updated else None,
        'retrievedAt': raw.get('retrievedAt'), 'checkedAt': checked.isoformat(),
        'validUntil': (updated + max_age).isoformat() if updated else None,
        'rule': rule, 'thresholdM': threshold, 'distanceM': None,
    }
    if not location_verified:
        result.update(state='location_unverified', label='Home location not verified')
    elif not raw.get('snapshotId') or raw.get('status') not in {'valid', 'degraded'} or not raw.get('rows'):
        result['label'] = 'Source data unavailable'
    elif raw.get('dateVerified') is not True or updated is None or updated > checked:
        result.update(state='unknown_date', label='Source update date unverified')
    elif checked - updated > max_age:
        result.update(state='stale', label='Source data is stale')
    elif (raw.get('status') != 'valid' or raw.get('rejected', 0) or
          raw.get('locatedRows') != raw.get('rows')):
        result.update(state='partial_coverage', label='Incomplete source geometry; status unavailable')
    elif is_silver:
        inside = raw.get('contains')
        if isinstance(inside, bool):
            result.update(state='inside' if inside else 'outside', flag=inside,
                          label='Inside a Silver Zone' if inside else 'Outside published Silver Zones')
    else:
        distance = raw.get('distanceM')
        if isinstance(distance, (int, float)) and not isinstance(distance, bool) and math.isfinite(distance) and distance >= 0:
            nearby = distance <= threshold
            result.update(state='nearby' if nearby else 'not_nearby', flag=nearby,
                          label='Go-To-Point nearby' if nearby else f'No Go-To-Point within {threshold:g} m',
                          distanceM=float(distance))
    return result


ELDERLY_SNAPSHOT_CTE = """, latest_elderly_snapshots AS MATERIALIZED (
    SELECT DISTINCT ON (source_id) * FROM source_snapshot
    WHERE source_id IN ('d_dc343c021aa470fc71da90d31e552a9a', 'd_e2d10e591bc8560b8946a0da24790fa5')
    ORDER BY source_id, retrieved_at DESC, id DESC
)"""


def _spatial_join(kind, resource_type, dataset_id):
    geometry_types = "'ST_Polygon','ST_MultiPolygon'" if kind == 'silverZone' else "'ST_Point'"
    # Invalid and unsupported geometries are counted as missing, never cast to
    # geography or used in containment. No fallback to an older successful import.
    return f"""
LEFT JOIN LATERAL (
  SELECT jsonb_build_object(
    'snapshotId', s.id, 'sourceId', s.source_id, 'sourceUrl', s.source_url,
    'sourceUpdatedAt', s.source_updated_at, 'retrievedAt', s.retrieved_at,
    'dateVerified', s.validation_report->>'sourceTimestampProvenance'='data_gov_sg_metadata_bracketed_export_v1',
    'status', s.status, 'rows', s.row_count, 'rejected', s.rejected_count,
    'locatedRows', spatial.located_rows, 'contains', spatial.contains,
    'distanceM', spatial.distance_m
  ) AS evidence
  FROM latest_elderly_snapshots s
  LEFT JOIN LATERAL (
    WITH shapes AS MATERIALIZED (
      SELECT CASE WHEN ST_IsValid(r.geometry) AND NOT ST_IsEmpty(r.geometry)
                       AND ST_GeometryType(r.geometry) IN ({geometry_types})
                  THEN r.geometry END AS geometry
      FROM neighbourhood_resource r
      WHERE r.source_snapshot_id=s.id AND r.resource_type='{resource_type}'
    )
    SELECT count(geometry) AS located_rows,
           bool_or(ST_Covers(geometry, h.geometry)) AS contains,
           min(ST_Distance(geometry::geography, h.geometry::geography)) AS distance_m
    FROM shapes
  ) spatial ON h.geometry IS NOT NULL AND h.geocode_status='resolved' AND h.geometry_source='onemap'
  WHERE s.source_id='{dataset_id}'
) elderly_{kind} ON TRUE
"""


ELDERLY_HOME_JOINS = ''.join(_spatial_join(kind, *source) for kind, source in SOURCES.items())
ELDERLY_HOME_SELECT = ', '.join(f'elderly_{kind}.evidence AS {kind.lower()}_evidence' for kind in SOURCES)
