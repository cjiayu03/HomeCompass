"""Freshness and source-date rules for NEA dengue cluster evidence."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
from typing import Any, Mapping


DENGUE_MAX_AGE = timedelta(hours=48)
SINGAPORE_TZ = timezone(timedelta(hours=8), name="SGT")
NEA_DENGUE_URL = "https://www.nea.gov.sg/dengue-zika/dengue/dengue-clusters"
DENGUE_DATASET_URL = "https://data.gov.sg/datasets/d_dbfabf16158d1b0e1c420627c0819168/view"
_VERIFIED_PROVENANCE = "data_gov_sg_metadata_bracketed_export_v1"


def parse_dengue_timestamp(value: Any, *, feature_timestamp: bool = False) -> datetime | None:
    """Parse a trustworthy dengue timestamp into UTC.

    The NEA feature field ``FMEL_UPD_D`` is an SGT calendar timestamp with
    second precision. Dataset metadata uses an ISO timestamp and must carry an
    explicit timezone. A date-only or timezone-naive value is not precise
    enough to establish freshness.
    """
    if isinstance(value, datetime):
        parsed = value
    elif feature_timestamp and isinstance(value, int) and not isinstance(value, bool):
        value = str(value)
        if len(value) != 14 or not value.isdigit():
            return None
        try:
            parsed = datetime.strptime(value, "%Y%m%d%H%M%S").replace(tzinfo=SINGAPORE_TZ)
        except ValueError:
            return None
    elif isinstance(value, str):
        text = value.strip()
        if feature_timestamp and len(text) == 14 and text.isdigit():
            try:
                parsed = datetime.strptime(text, "%Y%m%d%H%M%S").replace(tzinfo=SINGAPORE_TZ)
            except ValueError:
                return None
        else:
            try:
                parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
            except ValueError:
                return None
    else:
        return None
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        return None
    return parsed.astimezone(timezone.utc)


def dengue_freshness(source_updated_at: Any, *, now: datetime | None = None) -> dict[str, Any]:
    """Apply the app's 48-hour freshness window to a provider source time."""
    checked = now or datetime.now(timezone.utc)
    if checked.tzinfo is None or checked.utcoffset() is None:
        raise ValueError("The dengue freshness clock must be timezone-aware.")
    checked = checked.astimezone(timezone.utc)
    updated = parse_dengue_timestamp(source_updated_at)
    result = {
        "state": "unknown_date",
        "sourceUpdatedAt": updated.isoformat() if updated else None,
        "checkedAt": checked.isoformat(),
        "validUntil": updated + DENGUE_MAX_AGE if updated else None,
        "ageSeconds": None,
    }
    if updated is None:
        return result
    age = checked - updated
    result["ageSeconds"] = age.total_seconds()
    if age.total_seconds() < 0:
        result["state"] = "future_date"
    elif age > DENGUE_MAX_AGE:
        result["state"] = "stale"
    else:
        result["state"] = "fresh"
    if result["validUntil"] is not None:
        result["validUntil"] = result["validUntil"].isoformat()
    return result


def _validation_object(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except (TypeError, ValueError):
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def evaluate_dengue_snapshot(snapshot: Mapping[str, Any] | None, *, now: datetime | None = None) -> dict[str, Any]:
    """Evaluate publication freshness and whether the national export is complete."""
    checked = now or datetime.now(timezone.utc)
    if snapshot is None:
        freshness = dengue_freshness(None, now=checked)
        return {
            **freshness,
            "state": "source_unavailable",
            "fresh": False,
            "complete": False,
            "usable": False,
            "coverage": "unavailable",
            "retrievedAt": None,
            "rows": 0,
            "rejected": 0,
            "sourceUrl": NEA_DENGUE_URL,
            "datasetUrl": DENGUE_DATASET_URL,
            "reason": "No NEA active-cluster snapshot is available.",
        }

    snapshot_status = str(snapshot.get("status") or snapshot.get("state") or "")
    validation = _validation_object(snapshot.get("validation_report", snapshot.get("validation")))
    retrieved = snapshot.get("retrieved_at", snapshot.get("retrievedAt"))
    retrieved_at = retrieved.isoformat() if isinstance(retrieved, datetime) else retrieved
    source_updated_at = snapshot.get("source_updated_at", snapshot.get("sourceUpdatedAt"))
    verified_timestamp = validation.get("sourceTimestampProvenance") == _VERIFIED_PROVENANCE
    freshness = dengue_freshness(source_updated_at, now=checked)
    rows = int(snapshot.get("row_count", snapshot.get("rows", 0)) or 0)
    rejected = int(snapshot.get("rejected_count", snapshot.get("rejected", 0)) or 0)
    if snapshot_status not in {"valid", "degraded"}:
        state = "source_unavailable"
        reason = "The latest NEA cluster snapshot is unavailable or failed validation."
    elif not verified_timestamp:
        state = "unknown_date"
        reason = "The snapshot does not have a verified data.gov.sg publication timestamp."
    elif freshness["state"] != "fresh":
        state = freshness["state"]
        reason = {
            "unknown_date": "The snapshot publication date is missing or invalid.",
            "future_date": "The snapshot publication date is ahead of the current time.",
            "stale": "The NEA active-cluster snapshot is older than the app's 48-hour display window.",
        }.get(state, "The NEA active-cluster snapshot is not current.")
    else:
        complete = (
            snapshot_status == "valid"
            and rejected == 0
            and validation.get("snapshotCompleteness") == "complete_export"
        )
        state = "fresh" if complete else "partial_coverage"
        reason = (
            "The complete national NEA active-cluster export is within the app's 48-hour display window."
            if complete
            else "The snapshot is recent, but validation was partial; absence cannot confirm no overlap."
        )

    complete = (
        snapshot_status == "valid"
        and rejected == 0
        and validation.get("sourceTimestampProvenance") == _VERIFIED_PROVENANCE
        and validation.get("snapshotCompleteness") == "complete_export"
    )
    fresh = freshness["state"] == "fresh" and snapshot_status in {"valid", "degraded"} and validation.get("sourceTimestampProvenance") == _VERIFIED_PROVENANCE
    source_url = snapshot.get("source_url", snapshot.get("url")) or DENGUE_DATASET_URL
    return {
        **freshness,
        "sourceUpdatedAt": freshness["sourceUpdatedAt"] if verified_timestamp else None,
        "validUntil": freshness["validUntil"] if verified_timestamp else None,
        "ageSeconds": freshness["ageSeconds"] if verified_timestamp else None,
        "state": state,
        "fresh": fresh,
        "complete": complete,
        "usable": fresh,
        "coverage": "complete" if complete else "partial" if fresh else "unavailable",
        "retrievedAt": retrieved_at,
        "rows": rows,
        "rejected": rejected,
        "sourceUrl": NEA_DENGUE_URL,
        "datasetUrl": source_url,
        "reason": reason,
    }


def dengue_home_status(
    snapshot: Mapping[str, Any] | None,
    *,
    location_verified: bool,
    match: Mapping[str, Any] | None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Produce a conservative status for one verified home geometry."""
    source = evaluate_dengue_snapshot(snapshot, now=now)
    checked = source["checkedAt"]
    state = source["state"]
    severity = None
    case_count = None
    locality = None
    feature_updated_at = None

    if not source["usable"]:
        label = {
            "source_unavailable": "NEA dengue cluster data unavailable",
            "unknown_date": "NEA dengue update date unknown",
            "future_date": "NEA dengue update date is invalid",
            "stale": "NEA dengue cluster snapshot is stale",
        }.get(state, "NEA dengue cluster status unavailable")
    elif not location_verified:
        state = "location_unavailable"
        label = "Home location unavailable for cluster check"
    elif match is not None:
        try:
            raw_count = match.get("caseCount", match.get("case_count"))
            if isinstance(raw_count, bool):
                raise ValueError
            parsed_count = int(raw_count)
            if parsed_count < 2 or str(parsed_count) != str(raw_count):
                raise ValueError
            case_count = parsed_count
        except (TypeError, ValueError, OverflowError):
            case_count = None
        if case_count is None:
            state = "partial_coverage"
            label = "NEA cluster overlap found; case count unavailable"
            source["coverage"] = "partial"
        else:
            severity = "red" if case_count >= 10 else "yellow"
            state = "active_cluster"
            level = "Red" if severity == "red" else "Yellow"
            band = "10 or more cases" if severity == "red" else "fewer than 10 cases"
            label = f"{level} alert · high-risk cluster ({band})"
            locality = match.get("locality") or match.get("name")
            feature_value = match.get("featureUpdatedAt", match.get("feature_updated_at"))
            feature_updated = parse_dengue_timestamp(feature_value, feature_timestamp=True)
            checked_time = parse_dengue_timestamp(checked)
            if feature_updated is not None and checked_time is not None and feature_updated <= checked_time:
                feature_updated_at = feature_updated.isoformat()
    elif source["complete"]:
        state = "no_active_cluster"
        label = "No active NEA cluster polygon overlap in the latest complete snapshot"
    else:
        state = "partial_coverage"
        label = "NEA cluster data is incomplete; overlap is unknown"

    reason = source["reason"]
    if state == "active_cluster":
        reason = (
            "This verified home point intersects an NEA active cluster intervention-area polygon. "
            "The boundary shows NEA vector-control extent, not an individual infection probability."
        )
    elif state == "no_active_cluster":
        reason = (
            "No active cluster polygon overlaps this verified home point in the complete current snapshot. "
            "This does not mean there is no dengue risk."
        )
    elif state == "location_unavailable":
        reason = "A verified home coordinate is unavailable, so cluster overlap cannot be checked."
    elif state == "partial_coverage":
        reason = "The current snapshot contains incomplete validation, so no-overlap cannot be confirmed."

    return {
        "state": state,
        "label": label,
        "severity": severity,
        "caseCount": case_count,
        "locality": locality,
        "featureUpdatedAt": feature_updated_at,
        "sourceUpdatedAt": source["sourceUpdatedAt"],
        "retrievedAt": source["retrievedAt"],
        "checkedAt": checked,
        "validUntil": source["validUntil"],
        "sourceUrl": source["sourceUrl"],
        "datasetUrl": source["datasetUrl"],
        "coverage": source["coverage"],
        "reason": reason,
    }
