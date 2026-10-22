"""Shared metadata contract for live result responses."""

from copy import deepcopy
from datetime import datetime, timezone
from typing import Literal

DataMode = Literal["live", "fixture", "mixed", "error"]


def live_result_metadata(
    source_summary: list[dict],
    warnings: list[str] | None = None,
    retrieved_at: datetime | None = None,
) -> dict:
    """Return fresh response metadata without retaining caller-owned lists."""
    timestamp = retrieved_at if retrieved_at is not None else datetime.now(timezone.utc)
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=timezone.utc)
    timestamp = timestamp.astimezone(timezone.utc)
    mode: DataMode = "live"
    return {
        "dataMode": mode,
        "retrievedAt": timestamp.isoformat(),
        "sourceSummary": deepcopy(source_summary),
        "warnings": list(warnings) if warnings is not None else [],
    }
