"""Small, opaque pagination cursors shared by home and resource queries."""

from __future__ import annotations

from base64 import b64decode, urlsafe_b64encode
from collections.abc import Mapping
from datetime import date
import json
import re


MAX_CURSOR_LENGTH = 512
_INVALID_CURSOR = "Invalid pagination cursor."
_HOME_CURSOR_KEYS = frozenset({"score", "observed_on", "id"})
_LEGACY_HOME_CURSOR_KEYS = frozenset({"observed_on", "id"})
_RESOURCE_CURSOR_KEYS = frozenset({"resource_type", "name", "id"})
_URLSAFE_BASE64 = re.compile(r"[A-Za-z0-9_-]+\Z")


def _validate_values(values: object) -> dict[str, str | None]:
    if not isinstance(values, Mapping):
        raise ValueError(_INVALID_CURSOR)

    payload = dict(values)
    keys = frozenset(payload)
    if keys == _LEGACY_HOME_CURSOR_KEYS:
        observed_on = payload["observed_on"]
        identifier = payload["id"]
        if not isinstance(identifier, str) or not identifier:
            raise ValueError(_INVALID_CURSOR)
        if observed_on is not None:
            if not isinstance(observed_on, str):
                raise ValueError(_INVALID_CURSOR)
            try:
                parsed_date = date.fromisoformat(observed_on)
            except ValueError:
                raise ValueError(_INVALID_CURSOR) from None
            if parsed_date.isoformat() != observed_on:
                raise ValueError(_INVALID_CURSOR)
        return {"observed_on": observed_on, "id": identifier}
    if keys == _HOME_CURSOR_KEYS:
        score = payload["score"]
        observed_on = payload["observed_on"]
        identifier = payload["id"]
        if score is not None:
            if not isinstance(score, str):
                raise ValueError(_INVALID_CURSOR)
            try:
                parsed_score = float(score)
            except ValueError:
                raise ValueError(_INVALID_CURSOR) from None
            if not 0 <= parsed_score <= 100:
                raise ValueError(_INVALID_CURSOR)
            score = f"{parsed_score:.1f}"
        if not isinstance(identifier, str) or not identifier:
            raise ValueError(_INVALID_CURSOR)
        if observed_on is not None:
            if not isinstance(observed_on, str):
                raise ValueError(_INVALID_CURSOR)
            try:
                parsed_date = date.fromisoformat(observed_on)
            except ValueError:
                raise ValueError(_INVALID_CURSOR) from None
            if parsed_date.isoformat() != observed_on:
                raise ValueError(_INVALID_CURSOR)
        return {"score": score, "observed_on": observed_on, "id": identifier}

    if keys == _RESOURCE_CURSOR_KEYS:
        resource_type = payload["resource_type"]
        name = payload["name"]
        identifier = payload["id"]
        if not all(isinstance(value, str) for value in (resource_type, name, identifier)):
            raise ValueError(_INVALID_CURSOR)
        if not identifier:
            raise ValueError(_INVALID_CURSOR)
        return {"resource_type": resource_type, "name": name, "id": identifier}

    raise ValueError(_INVALID_CURSOR)


def encode_cursor(values: Mapping[str, object]) -> str:
    """Encode a supported keyset payload as a bounded URL-safe token."""
    payload = _validate_values(values)
    try:
        encoded_json = json.dumps(
            payload,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
            allow_nan=False,
        ).encode("utf-8")
        cursor = urlsafe_b64encode(encoded_json).rstrip(b"=").decode("ascii")
    except (TypeError, ValueError, UnicodeError, RecursionError):
        raise ValueError(_INVALID_CURSOR) from None
    if len(cursor) > MAX_CURSOR_LENGTH:
        raise ValueError(_INVALID_CURSOR)
    return cursor


def _unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    payload: dict[str, object] = {}
    for key, value in pairs:
        if key in payload:
            raise ValueError(_INVALID_CURSOR)
        payload[key] = value
    return payload


def decode_cursor(cursor: str) -> dict[str, str | None]:
    """Decode a cursor, rejecting malformed, oversized, or unknown payloads."""
    if (
        not isinstance(cursor, str)
        or not cursor
        or len(cursor) > MAX_CURSOR_LENGTH
        or _URLSAFE_BASE64.fullmatch(cursor) is None
    ):
        raise ValueError(_INVALID_CURSOR)

    try:
        cursor_bytes = cursor.encode("ascii")
        raw = b64decode(
            cursor_bytes + b"=" * (-len(cursor_bytes) % 4),
            altchars=b"-_",
            validate=True,
        )
        payload = json.loads(raw.decode("utf-8"), object_pairs_hook=_unique_object)
    except (UnicodeError, ValueError, TypeError, RecursionError):
        raise ValueError(_INVALID_CURSOR) from None

    return _validate_values(payload)
