"""Readable labels for public source strings."""

import re


def source_label(value: str | None) -> str | None:
    """Hide generated identifiers and clean unrecoverable encoding markers."""
    if value is not None and re.fullmatch(r"kml_\d+", value.strip(), re.IGNORECASE):
        return "Name unavailable"
    if value is None or '\ufffd' not in value:
        return value
    return ' '.join(value.replace('\ufffd', ' ').split())
