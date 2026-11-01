import asyncio
import json
from datetime import datetime, timedelta, timezone

import httpx
import pytest

from app.dengue import (
    DENGUE_MAX_AGE,
    dengue_freshness,
    dengue_home_status,
    evaluate_dengue_snapshot,
    parse_dengue_timestamp,
)
from app.sources.data_gov_resources import (
    SOURCES,
    _discard_invalid_dengue_geometries,
    get_dataset_metadata,
    parse_resource_payload,
    verified_dataset_publication_time,
)


DENGUE_SOURCE = next(source for source in SOURCES if source.resource_type == "dengue_cluster")
NOW = datetime(2026, 10, 30, 9, 0, tzinfo=timezone.utc)
VERIFIED_SNAPSHOT = {
    "id": "snapshot-1",
    "source_id": DENGUE_SOURCE.dataset_id,
    "source_url": DENGUE_SOURCE.url,
    "source_updated_at": NOW - timedelta(hours=1),
    "retrieved_at": NOW,
    "row_count": 1,
    "rejected_count": 0,
    "status": "valid",
    "validation_report": {
        "sourceTimestampProvenance": "data_gov_sg_metadata_bracketed_export_v1",
        "snapshotCompleteness": "complete_export",
    },
}
POLYGON = {"type": "Polygon", "coordinates": [[[103.8, 1.3], [103.81, 1.3], [103.81, 1.31], [103.8, 1.3]]]}


def _feature(properties=None, geometry=POLYGON):
    return {"type": "Feature", "geometry": geometry, "properties": properties or {
        "LOCALITY": "Example locality", "CASE_SIZE": 9, "FMEL_UPD_D": "20261027175046",
    }}


def _payload(features):
    return json.dumps({"type": "FeatureCollection", "features": features}).encode()


def test_nea_feature_timestamp_is_parsed_as_singapore_time():
    assert parse_dengue_timestamp("20261027175046", feature_timestamp=True) == datetime(
        2026, 10, 27, 9, 50, 46, tzinfo=timezone.utc
    )


@pytest.mark.parametrize("value", [None, "", "2026-10-30", "20261032120000", "202610301200", "2026-10-30T09:00:00"])
def test_missing_or_untrustworthy_dengue_dates_are_unknown(value):
    assert parse_dengue_timestamp(value) is None
    assert dengue_freshness(value, now=NOW)["state"] == "unknown_date"


def test_dataset_metadata_dates_normalize_explicit_timezones_to_utc():
    assert parse_dengue_timestamp("2026-10-30T17:00:00+08:00") == NOW
    assert parse_dengue_timestamp("2026-10-30T09:00:00Z") == NOW


def test_dengue_freshness_uses_injected_utc_clock_and_48_hour_boundary():
    exactly_old_enough = NOW - DENGUE_MAX_AGE
    one_second_too_old = exactly_old_enough - timedelta(seconds=1)
    assert dengue_freshness(exactly_old_enough, now=NOW)["state"] == "fresh"
    assert dengue_freshness(one_second_too_old, now=NOW)["state"] == "stale"
    assert dengue_freshness(NOW + timedelta(seconds=1), now=NOW)["state"] == "future_date"


def test_dengue_freshness_reports_valid_until_from_provider_time_only():
    source_time = NOW - timedelta(hours=2)
    status = dengue_freshness(source_time, now=NOW)
    assert status["sourceUpdatedAt"] == source_time.isoformat()
    assert status["validUntil"] == (source_time + DENGUE_MAX_AGE).isoformat()
    assert status["checkedAt"] == NOW.isoformat()


def test_snapshot_requires_verified_metadata_provenance_and_complete_validation():
    assert evaluate_dengue_snapshot(VERIFIED_SNAPSHOT, now=NOW)["state"] == "fresh"
    legacy = evaluate_dengue_snapshot({**VERIFIED_SNAPSHOT, "validation_report": {}}, now=NOW)
    assert legacy["state"] == "unknown_date"
    assert legacy["sourceUpdatedAt"] is None
    assert legacy["validUntil"] is None
    partial = {**VERIFIED_SNAPSHOT, "status": "degraded", "rejected_count": 1,
               "validation_report": {**VERIFIED_SNAPSHOT["validation_report"], "snapshotCompleteness": "partial_export"}}
    assert evaluate_dengue_snapshot(partial, now=NOW)["state"] == "partial_coverage"
    assert evaluate_dengue_snapshot({**VERIFIED_SNAPSHOT, "status": "failed"}, now=NOW)["state"] == "source_unavailable"


@pytest.mark.parametrize(("count", "severity", "label_part"), [
    (9, "yellow", "fewer than 10 cases"),
    (10, "red", "10 or more cases"),
])
def test_verified_fresh_cluster_match_uses_official_case_bands(count, severity, label_part):
    status = dengue_home_status(
        VERIFIED_SNAPSHOT,
        location_verified=True,
        match={"locality": "Example locality", "case_count": count, "feature_updated_at": "20261027175046"},
        now=NOW,
    )
    assert status["state"] == "active_cluster"
    assert status["severity"] == severity
    assert status["caseCount"] == count
    assert label_part in status["label"]
    assert status["featureUpdatedAt"] == "2026-10-27T09:50:46+00:00"
    assert "not an individual infection probability" in status["reason"]


def test_negative_and_positive_claims_require_verified_location_and_complete_coverage():
    assert dengue_home_status(VERIFIED_SNAPSHOT, location_verified=False, match=None, now=NOW)["state"] == "location_unavailable"
    assert dengue_home_status(VERIFIED_SNAPSHOT, location_verified=False,
                              match={"case_count": 10}, now=NOW)["state"] == "location_unavailable"
    partial = {**VERIFIED_SNAPSHOT, "status": "degraded", "rejected_count": 1,
               "validation_report": {**VERIFIED_SNAPSHOT["validation_report"], "snapshotCompleteness": "partial_export"}}
    no_match = dengue_home_status(partial, location_verified=True, match=None, now=NOW)
    assert no_match["state"] == "partial_coverage"
    assert "no-overlap cannot be confirmed" in no_match["reason"]
    match = dengue_home_status(partial, location_verified=True, match={"case_count": 10}, now=NOW)
    assert match["state"] == "active_cluster"
    assert match["coverage"] == "partial"


def test_old_publication_timestamp_stays_stale_even_when_recently_retrieved():
    old = {**VERIFIED_SNAPSHOT, "source_updated_at": NOW - timedelta(days=365), "retrieved_at": NOW}
    assert evaluate_dengue_snapshot(old, now=NOW)["state"] == "stale"


@pytest.mark.parametrize("count", [2, 9, 10, "9.0", 10.0])
def test_dengue_case_counts_accept_integer_values(count):
    feature = _feature({"LOCALITY": "Example locality", "CASE_SIZE": count, "FMEL_UPD_D": "20261027175046"})
    rows, rejected = parse_resource_payload(DENGUE_SOURCE, _payload([feature]))
    assert rejected == 0
    assert len(rows) == 1
    assert rows[0][2]["CASE_SIZE"] == int(float(count))


@pytest.mark.parametrize("count", [None, True, False, -1, 1, 1.5, "9.5", "NaN", "Infinity", "not-a-count"])
def test_dengue_case_counts_reject_malformed_or_non_cluster_values(count):
    feature = _feature({"LOCALITY": "Example locality", "CASE_SIZE": count, "FMEL_UPD_D": "20261027175046"})
    with pytest.raises(ValueError, match="No valid source records"):
        parse_resource_payload(DENGUE_SOURCE, _payload([feature]))


def test_dengue_multipolygon_is_accepted_and_feature_record_time_is_optional():
    multi = {"type": "MultiPolygon", "coordinates": [[POLYGON["coordinates"][0]]]}
    rows, rejected = parse_resource_payload(DENGUE_SOURCE, _payload([_feature(geometry=multi)]))
    assert rejected == 0
    assert json.loads(rows[0][1])["type"] == "MultiPolygon"

    for stamp in (None, "2026-10-27", "20261301112233"):
        feature = _feature({"LOCALITY": "Example locality", "CASE_SIZE": 3, "FMEL_UPD_D": stamp})
        rows, rejected = parse_resource_payload(DENGUE_SOURCE, _payload([feature]))
        assert rejected == 0
        assert len(rows) == 1


def test_only_a_structurally_valid_empty_dengue_collection_is_accepted():
    rows, rejected = parse_resource_payload(DENGUE_SOURCE, _payload([]))
    assert rows == []
    assert rejected == 0
    with pytest.raises(ValueError, match="FeatureCollection"):
        parse_resource_payload(DENGUE_SOURCE, b'{"type":"FeatureCollection"}')
    with pytest.raises(ValueError, match="No valid source records"):
        parse_resource_payload(DENGUE_SOURCE, _payload([{"type": "NotAFeature"}]))


def test_mixed_valid_and_rejected_dengue_rows_mark_snapshot_degraded():
    features = [
        _feature(),
        _feature({"LOCALITY": "Bad count", "CASE_SIZE": 2.1, "FMEL_UPD_D": "20261027175046"}),
    ]
    rows, rejected = parse_resource_payload(DENGUE_SOURCE, _payload(features))
    assert len(rows) == 1
    assert rejected == 1


def test_postgis_topology_failures_are_removed_from_validated_export():
    class FakeConnection:
        async def fetch(self, query, geometries):
            assert "ST_IsValid" in query
            assert len(geometries) == 3
            return [{"ord": 2}]

    rows = [(f"id-{index}", json.dumps(POLYGON), {"CASE_SIZE": index + 2}, None) for index in range(3)]
    accepted, rejected = asyncio.run(_discard_invalid_dengue_geometries(FakeConnection(), rows))
    assert [row[0] for row in accepted] == ["id-0", "id-2"]
    assert rejected == 1


def test_catalog_metadata_timestamp_uses_official_last_updated_field():
    async def handler(request):
        assert request.url == f"https://api-production.data.gov.sg/v2/public/api/datasets/{DENGUE_SOURCE.dataset_id}/metadata"
        assert request.headers["user-agent"] == "HomeCompass/1.0"
        return httpx.Response(200, json={"code": 0, "data": {
            "datasetId": DENGUE_SOURCE.dataset_id,
            "format": "GEOJSON",
            "lastUpdatedAt": "2026-10-30T17:00:00+08:00",
            "contactEmails": ["must-not-be-exposed@example.gov.sg"],
        }})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await get_dataset_metadata(client, DENGUE_SOURCE)

    metadata = asyncio.run(run())
    assert metadata == {"datasetId": DENGUE_SOURCE.dataset_id, "format": "GEOJSON", "lastUpdatedAt": NOW}
    assert verified_dataset_publication_time(DENGUE_SOURCE, metadata, metadata) == NOW


def test_export_metadata_race_and_wrong_dataset_or_format_fail_closed():
    metadata = {"datasetId": DENGUE_SOURCE.dataset_id, "format": "GEOJSON", "lastUpdatedAt": NOW}
    changed = {**metadata, "lastUpdatedAt": NOW + timedelta(minutes=1)}
    wrong_dataset = {**metadata, "datasetId": "d_wrong"}
    wrong_format = {**metadata, "format": "CSV"}
    assert verified_dataset_publication_time(DENGUE_SOURCE, metadata, changed) is None
    assert verified_dataset_publication_time(DENGUE_SOURCE, wrong_dataset, metadata) is None
    assert verified_dataset_publication_time(DENGUE_SOURCE, metadata, wrong_format) is None
    assert verified_dataset_publication_time(DENGUE_SOURCE, metadata, None) is None
