"""Show which source lines of the two basis-path methods each Lab 4 test executes.

Supports section 4.1 of Lab4/Test_Cases_and_Results.md. Run from the
repository root with the backend's Python environment:

    .venv/bin/python Lab4/evidence/trace_basis_paths.py
"""

import inspect
import os
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[2] / "backend"
os.chdir(BACKEND)
sys.path.insert(0, str(BACKEND))

from app.main import _public_map_address_items  # noqa: E402
from app.rate_limit import RateLimiter  # noqa: E402

METHODS = {
    RateLimiter.check.__code__: "RateLimiter.check",
    _public_map_address_items.__code__: "_public_map_address_items",
}
executed: dict[str, dict[str, set[int]]] = {}


class LineTracer:
    """Pytest plugin that records the traced methods' executed lines per test."""

    def pytest_runtest_call(self, item):
        lines = {name: set() for name in METHODS.values()}
        executed[item.nodeid.split("::", 1)[1]] = lines

        def trace_lines(frame, event, _arg):
            if event == "line":
                lines[METHODS[frame.f_code]].add(frame.f_lineno)
            return trace_lines

        sys.settrace(lambda frame, _event, _arg: trace_lines if frame.f_code in METHODS else None)

    def pytest_runtest_teardown(self, item):
        sys.settrace(None)


exit_code = pytest.main(
    [
        "-q",
        "-p", "no:cacheprovider",
        "tests/test_lab4_rate_limiter_basis_path.py",
        "tests/test_lab4_map_address_basis_path.py",
    ],
    plugins=[LineTracer()],
)

for code, name in METHODS.items():
    source, first_line = inspect.getsourcelines(code)
    print(f"\n{name} (lines {first_line}-{first_line + len(source) - 1})")
    covered = set()
    for test, lines in executed.items():
        if lines[name]:
            covered |= lines[name]
            print(f"  {test}: {sorted(lines[name])}")
    statement_lines = [
        first_line + offset
        for offset, text in enumerate(source)
        if text.strip() and not text.strip().startswith(("def ", "#", ")", "]", "}", "else:"))
    ]
    print("  statement lines never executed:", [line for line in statement_lines if line not in covered])

sys.exit(exit_code)
