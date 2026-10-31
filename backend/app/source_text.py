"""Readable labels for public source strings with lost encoding characters."""


def source_label(value: str | None) -> str | None:
    """Replace unrecoverable encoding markers without guessing lost letters."""
    if value is None or '\ufffd' not in value:
        return value
    return ' '.join(value.replace('\ufffd', ' ').split())
