"""Lab 4 basis-path tests for RateLimiter.check (app/rate_limit.py).

The flow graph has 18 nodes and 25 edges, so V(G) = 25 - 18 + 2 = 9. Each
test exercises one independent path (BP1-1 to BP1-9) from
Lab4/Test_Cases_and_Results.md.
"""

import math

import pytest
from fastapi import HTTPException

from app.rate_limit import RateLimiter


def limiter(max_requests=2, max_entries=4_096):
    return RateLimiter(max_requests=max_requests, window_seconds=10, max_entries=max_entries)


def test_bp1_1_baseline_new_key_is_recorded():
    rate_limiter = limiter()

    rate_limiter.check("a", now=0)

    assert list(rate_limiter._requests["a"]) == [0.0]


@pytest.mark.parametrize(
    "key",
    [
        pytest.param(42, id="BP1-2 key is not a string"),
        pytest.param("", id="BP1-3 key is empty"),
    ],
)
def test_bp1_invalid_key_is_rejected(key):
    with pytest.raises(ValueError, match="key must be a non-empty string"):
        limiter().check(key, now=0)


def test_bp1_4_missing_time_uses_the_monotonic_clock():
    rate_limiter = limiter()

    rate_limiter.check("a")

    assert len(rate_limiter._requests["a"]) == 1


def test_bp1_5_non_finite_time_is_rejected():
    with pytest.raises(ValueError, match="now must be a finite monotonic time"):
        limiter().check("a", now=math.inf)


def test_bp1_6_existing_key_under_the_limit_is_recorded():
    rate_limiter = limiter()
    rate_limiter.check("a", now=0)

    rate_limiter.check("a", now=1)

    assert list(rate_limiter._requests["a"]) == [0.0, 1.0]


def test_bp1_7_full_table_frees_space_by_removing_expired_keys():
    rate_limiter = limiter(max_entries=1)
    rate_limiter.check("a", now=0)

    rate_limiter.check("b", now=11)

    assert set(rate_limiter._requests) == {"b"}


def test_bp1_8_full_table_with_no_expired_keys_is_limited():
    rate_limiter = limiter(max_entries=1)
    rate_limiter.check("a", now=0)

    with pytest.raises(HTTPException) as error:
        rate_limiter.check("b", now=5)

    assert error.value.status_code == 429
    assert error.value.headers["Retry-After"] == "5"
    assert set(rate_limiter._requests) == {"a"}


def test_bp1_9_existing_key_at_the_limit_is_limited():
    rate_limiter = limiter(max_requests=2)
    rate_limiter.check("a", now=0)
    rate_limiter.check("a", now=1)

    with pytest.raises(HTTPException) as error:
        rate_limiter.check("a", now=2)

    assert error.value.status_code == 429
    assert error.value.detail["code"] == "RATE_LIMITED"
    assert error.value.headers["Retry-After"] == "8"
    assert list(rate_limiter._requests["a"]) == [0.0, 1.0]
