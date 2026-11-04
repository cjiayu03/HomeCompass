"""Lab 4 basis-path tests for _public_map_address_items (app/main.py).

This filter decides which OneMap results the map's address search may show.
The flow graph has 15 nodes and 25 edges, so V(G) = 25 - 15 + 2 = 12. Each
test exercises one independent path (BP2-1 to BP2-12) from
Lab4/Test_Cases_and_Results.md.
"""

import pytest

from app.main import _public_map_address_items
from app.onemap import OneMapProviderError

TOKEN = "tok123"
VALID = {"address": "10 Example Road", "latitude": 1.3, "longitude": 103.85}
VALID_ITEM = {"address": "10 Example Road", "latitude": 1.3, "longitude": 103.85, "provider": "OneMap"}


def test_bp2_1_baseline_valid_candidate_is_returned():
    assert _public_map_address_items([VALID], TOKEN) == [VALID_ITEM]


def test_bp2_2_non_list_response_is_rejected():
    with pytest.raises(OneMapProviderError):
        _public_map_address_items({"results": [VALID]}, TOKEN)


@pytest.mark.parametrize(
    "candidates",
    [
        pytest.param([], id="BP2-3 no candidates"),
        pytest.param(["10 Example Road"], id="BP2-4 candidate is not an object"),
        pytest.param([{**VALID, "address": 10}], id="BP2-5 address is not text"),
        pytest.param([{**VALID, "address": "   "}], id="BP2-6 address is blank"),
        pytest.param([{**VALID, "address": "10 TOK123 Road"}], id="BP2-7 address contains the provider token"),
        pytest.param([{**VALID, "latitude": True}], id="BP2-8 latitude is a boolean"),
        pytest.param([{**VALID, "longitude": False}], id="BP2-9 longitude is a boolean"),
        pytest.param([{**VALID, "latitude": 1.6}], id="BP2-10 point is outside Singapore"),
    ],
)
def test_bp2_rejected_candidates_are_skipped(candidates):
    assert _public_map_address_items(candidates, TOKEN) == []


def test_bp2_11_duplicate_candidate_is_returned_once():
    duplicate = {**VALID, "address": "  10   Example Road "}

    assert _public_map_address_items([VALID, duplicate], TOKEN) == [VALID_ITEM]


def test_bp2_12_results_stop_at_ten():
    candidates = [{**VALID, "address": f"{block} Example Road"} for block in range(1, 12)]

    items = _public_map_address_items(candidates, TOKEN)

    assert [item["address"] for item in items] == [f"{block} Example Road" for block in range(1, 11)]
