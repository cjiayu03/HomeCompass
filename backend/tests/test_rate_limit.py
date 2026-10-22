import pytest
from fastapi import HTTPException

from app.rate_limit import RateLimiter


def test_rate_limiter_allows_configured_calls_then_returns_safe_retry_after():
    limiter = RateLimiter(max_requests=2, window_seconds=10)

    limiter.check("user:account-1", now=100)
    limiter.check("user:account-1", now=101)

    with pytest.raises(HTTPException) as raised:
        limiter.check("user:account-1", now=102)

    assert raised.value.status_code == 429
    assert raised.value.headers["Retry-After"] == "8"
    assert raised.value.detail["code"] == "RATE_LIMITED"
    assert "account-1" not in str(raised.value.detail)


def test_rate_limiter_expires_requests_at_the_window_boundary():
    limiter = RateLimiter(max_requests=1, window_seconds=10)
    limiter.check("user:account-1", now=100)

    with pytest.raises(HTTPException) as raised:
        limiter.check("user:account-1", now=109)
    assert raised.value.headers["Retry-After"] == "1"

    limiter.check("user:account-1", now=110)


def test_rate_limiter_does_not_grow_past_its_key_capacity():
    limiter = RateLimiter(max_requests=1, window_seconds=10, max_entries=1)
    limiter.check("user:account-1", now=100)

    with pytest.raises(HTTPException) as raised:
        limiter.check("user:account-2", now=101)
    assert raised.value.status_code == 429
    assert raised.value.headers["Retry-After"] == "9"

    limiter.check("user:account-2", now=110)


def test_rate_limiter_reads_nonsecret_window_settings_from_environment(monkeypatch):
    monkeypatch.setenv("AI_RATE_LIMIT_REQUESTS", "1")
    monkeypatch.setenv("AI_RATE_LIMIT_WINDOW_SECONDS", "7")
    limiter = RateLimiter()
    limiter.check("user:account-1", now=100)

    with pytest.raises(HTTPException) as raised:
        limiter.check("user:account-1", now=101)

    assert raised.value.status_code == 429
    assert raised.value.headers["Retry-After"] == "6"
