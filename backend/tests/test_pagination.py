import base64
import json

import pytest

from app.pagination import MAX_CURSOR_LENGTH, decode_cursor, encode_cursor


HOME_CURSOR = {"score": "72.5", "observed_on": "2026-09-01", "id": "home-1"}
RESOURCE_CURSOR = {
    "resource_type": "moe_school",
    "name": "Example School",
    "id": "school-1",
}


def _raw_cursor(payload):
    encoded = base64.urlsafe_b64encode(json.dumps(payload).encode("utf-8"))
    return encoded.rstrip(b"=").decode("ascii")


@pytest.mark.parametrize("payload", [HOME_CURSOR, RESOURCE_CURSOR])
def test_cursor_round_trip_is_compact_and_url_safe(payload):
    cursor = encode_cursor(payload)

    assert decode_cursor(cursor) == payload
    assert len(cursor) <= MAX_CURSOR_LENGTH
    assert "=" not in cursor
    assert all(character.isalnum() or character in "-_" for character in cursor)


@pytest.mark.parametrize("cursor", ["%%%", "not base64!"])
def test_decode_cursor_rejects_malformed_base64(cursor):
    with pytest.raises(ValueError, match="Invalid pagination cursor"):
        decode_cursor(cursor)


def test_decode_cursor_rejects_malformed_json():
    cursor = base64.urlsafe_b64encode(b"{").decode("ascii").rstrip("=")

    with pytest.raises(ValueError, match="Invalid pagination cursor"):
        decode_cursor(cursor)


def test_decode_cursor_rejects_oversized_input_before_decoding():
    with pytest.raises(ValueError, match="Invalid pagination cursor"):
        decode_cursor("a" * (MAX_CURSOR_LENGTH + 1))


def test_encode_cursor_rejects_payload_that_exceeds_encoded_size_limit():
    payload = {"resource_type": "school", "name": "x" * 500, "id": "school-1"}

    with pytest.raises(ValueError, match="Invalid pagination cursor"):
        encode_cursor(payload)


@pytest.mark.parametrize(
    "payload",
    [
        {"id": "home-1"},
        {"observed_on": "2026-09-01", "id": "home-1", "extra": "value"},
        {"id": "school-1", "resource_type": "moe_school"},
        {
            "resource_type": "moe_school",
            "name": "Example School",
            "id": "school-1",
            "extra": "value",
        },
    ],
)
def test_cursor_requires_one_exact_supported_key_set(payload):
    with pytest.raises(ValueError, match="Invalid pagination cursor"):
        encode_cursor(payload)
    with pytest.raises(ValueError, match="Invalid pagination cursor"):
        decode_cursor(_raw_cursor(payload))


@pytest.mark.parametrize(
    "payload",
    [
        {"observed_on": "not-a-date", "id": "home-1"},
        {"observed_on": None, "id": ""},
        {"resource_type": "moe_school", "name": "School", "id": 1},
    ],
)
def test_cursor_rejects_values_that_do_not_match_supported_key_types(payload):
    with pytest.raises(ValueError, match="Invalid pagination cursor"):
        encode_cursor(payload)
    with pytest.raises(ValueError, match="Invalid pagination cursor"):
        decode_cursor(_raw_cursor(payload))
