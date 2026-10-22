from __future__ import annotations

from collections import deque
from math import ceil, isfinite
from os import getenv
from threading import Lock
from time import monotonic

from fastapi import HTTPException


_DEFAULT_REQUESTS = 10
_DEFAULT_WINDOW_SECONDS = 60
_MAX_REQUESTS = 1_000
_MAX_WINDOW_SECONDS = 86_400
_MAX_ENTRIES = 4_096


def _environment_integer(name: str, default: int, maximum: int) -> int:
    try:
        value = int(getenv(name, str(default)))
    except (TypeError, ValueError):
        return default
    return min(max(value, 1), maximum)


def _positive_integer(value: int, name: str, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} must be a positive integer") from exc
    if parsed < 1:
        raise ValueError(f"{name} must be a positive integer")
    return min(parsed, maximum)


def _positive_window(value: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("window_seconds must be a positive finite number") from exc
    if not isfinite(parsed) or parsed <= 0:
        raise ValueError("window_seconds must be a positive finite number")
    return min(parsed, _MAX_WINDOW_SECONDS)


class RateLimiter:
    """Process-local sliding-window limiter with bounded per-key state."""

    def __init__(
        self,
        max_requests: int | None = None,
        window_seconds: float | None = None,
        max_entries: int = _MAX_ENTRIES,
    ) -> None:
        self.max_requests = _positive_integer(
            _environment_integer("AI_RATE_LIMIT_REQUESTS", _DEFAULT_REQUESTS, _MAX_REQUESTS)
            if max_requests is None
            else max_requests,
            "max_requests",
            _MAX_REQUESTS,
        )
        self.window_seconds = _positive_window(
            _environment_integer(
                "AI_RATE_LIMIT_WINDOW_SECONDS",
                _DEFAULT_WINDOW_SECONDS,
                _MAX_WINDOW_SECONDS,
            )
            if window_seconds is None
            else window_seconds
        )
        self.max_entries = _positive_integer(max_entries, "max_entries", _MAX_ENTRIES)
        self._requests: dict[str, deque[float]] = {}
        self._lock = Lock()

    def check(self, key: str, now: float | None = None) -> None:
        if not isinstance(key, str) or not key:
            raise ValueError("key must be a non-empty string")
        current = monotonic() if now is None else float(now)
        if not isfinite(current):
            raise ValueError("now must be a finite monotonic time")

        cutoff = current - self.window_seconds
        with self._lock:
            requests = self._requests.get(key)
            if requests is None:
                if len(self._requests) >= self.max_entries:
                    self._remove_expired(cutoff)
                    if len(self._requests) >= self.max_entries:
                        retry_after = min(
                            timestamps[0] + self.window_seconds - current
                            for timestamps in self._requests.values()
                        )
                        self._raise_limited(retry_after)
                requests = deque()
                self._requests[key] = requests
            else:
                self._remove_expired_from(requests, cutoff)

            if len(requests) >= self.max_requests:
                self._raise_limited(requests[0] + self.window_seconds - current)
            requests.append(current)

    def _remove_expired(self, cutoff: float) -> None:
        expired_keys = []
        for key, timestamps in self._requests.items():
            self._remove_expired_from(timestamps, cutoff)
            if not timestamps:
                expired_keys.append(key)
        for key in expired_keys:
            del self._requests[key]

    @staticmethod
    def _remove_expired_from(timestamps: deque[float], cutoff: float) -> None:
        while timestamps and timestamps[0] <= cutoff:
            timestamps.popleft()

    @staticmethod
    def _raise_limited(retry_after: float) -> None:
        raise HTTPException(
            status_code=429,
            detail={"code": "RATE_LIMITED", "message": "Too many requests. Please retry shortly."},
            headers={"Retry-After": str(max(1, ceil(retry_after)))},
        )
