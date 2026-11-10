"""UC 4.8 must not infer absence from missing or incomplete spatial evidence."""
from datetime import datetime, timedelta, timezone

import pytest

from app.elderly_zones import elderly_zone_status


NOW = datetime(2026, 11, 10, tzinfo=timezone.utc)


def evidence(**changes):
    return {
        'snapshotId': 'snapshot', 'sourceId': 'source', 'sourceUrl': 'https://data.gov.sg/', 'dateVerified': True,
        'sourceUpdatedAt': (NOW - timedelta(days=1)).isoformat(),
        'retrievedAt': NOW.isoformat(), 'status': 'valid', 'rows': 2, 'rejected': 0,
        'locatedRows': 2, 'contains': False, 'distanceM': 501,
        **changes,
    }


def status(kind='dementiaGtp', **changes):
    return elderly_zone_status(evidence(**changes), kind=kind, location_verified=True, now=NOW)


@pytest.mark.parametrize('distance, expected', [(499.9, 'nearby'), (500, 'nearby'), (500.01, 'not_nearby')])
def test_gtp_uses_inclusive_unrounded_straight_line_threshold(distance, expected):
    assert status(distanceM=distance)['state'] == expected


def test_gtp_threshold_is_configurable(monkeypatch):
    monkeypatch.setenv('DEMENTIA_GTP_NEARBY_METRES', '300')
    result = status(distanceM=301)
    assert result['state'] == 'not_nearby'
    assert result['thresholdM'] == 300


def test_silver_zone_uses_containment_instead_of_a_distance_buffer():
    assert status('silverZone', contains=True, distanceM=0)['state'] == 'inside'
    assert status('silverZone', contains=False, distanceM=0.01)['state'] == 'outside'


@pytest.mark.parametrize('changes, expected', [
    ({'sourceUpdatedAt': None}, 'unknown_date'),
    ({'dateVerified': False}, 'unknown_date'),
    ({'sourceUpdatedAt': NOW.isoformat().replace('+00:00', '')}, 'unknown_date'),
    ({'sourceUpdatedAt': (NOW + timedelta(seconds=1)).isoformat()}, 'unknown_date'),
    ({'sourceUpdatedAt': (NOW - timedelta(days=366)).isoformat()}, 'stale'),
    ({'status': 'failed'}, 'source_unavailable'),
    ({'status': 'degraded'}, 'partial_coverage'),
    ({'rejected': 1}, 'partial_coverage'),
    ({'locatedRows': 1}, 'partial_coverage'),
    ({'rows': 0, 'locatedRows': 0, 'distanceM': None}, 'source_unavailable'),
])
def test_unusable_sources_withhold_flags(changes, expected):
    result = status(contains=True, **changes)
    assert result['state'] == expected
    assert result['flag'] is None


def test_freshness_boundary_and_configurable_expiry(monkeypatch):
    result = status(sourceUpdatedAt=(NOW - timedelta(days=365)).isoformat())
    assert result['state'] == 'not_nearby'
    monkeypatch.setenv('ELDERLY_ZONE_MAX_AGE_DAYS', '30')
    assert status(sourceUpdatedAt=(NOW - timedelta(days=31)).isoformat())['state'] == 'stale'


def test_missing_source_and_unverified_home_are_not_negative_flags():
    assert elderly_zone_status(None, kind='silverZone', location_verified=True, now=NOW)['state'] == 'source_unavailable'
    result = elderly_zone_status(evidence(contains=True), kind='silverZone', location_verified=False, now=NOW)
    assert result['state'] == 'location_unverified'
    assert result['flag'] is None


def test_source_dates_and_explicit_rule_accompany_result():
    result = status(distanceM=125.5)
    assert result['sourceUpdatedAt'] == (NOW - timedelta(days=1)).isoformat()
    assert result['retrievedAt'] == NOW.isoformat()
    assert result['distanceM'] == 125.5
    assert result['flag'] is True
    assert 'straight-line' in result['rule']
    assert result['sourceUrl'] == 'https://data.gov.sg/'
