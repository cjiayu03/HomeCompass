"""Check that the Lab 4 tests detect deliberately seeded faults.

Supports section 4.2 of Lab4/Test_Cases_and_Results.md. Each fault is applied
to a temporary copy of the backend, so the repository is never changed. Run
from the repository root with the backend's Python environment:

    .venv/bin/python Lab4/evidence/seeded_faults.py
"""

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2] / "backend"
TEST_FILES = [
    "tests/test_lab4_scoring_blackbox.py",
    "tests/test_lab4_rate_limiter_basis_path.py",
    "tests/test_lab4_map_address_basis_path.py",
]
FAULTS = [
    ("Coverage threshold >= changed to >", "app/scoring.py",
     "coverage >= _MINIMUM_COVERAGE", "coverage > _MINIMUM_COVERAGE"),
    ("Rate-limit check >= changed to >", "app/rate_limit.py",
     "if len(requests) >= self.max_requests:", "if len(requests) > self.max_requests:"),
    ("Result cap == 10 changed to == 11", "app/main.py",
     "if len(items) == 10:", "if len(items) == 11:"),
    ("Affordability midpoint 50 changed to 40", "app/scoring.py",
     "fit = 50.0 + 50.0", "fit = 40.0 + 50.0"),
]


def run_with_fault(path: str, original: str, faulty: str) -> list[str]:
    """Return the IDs of the tests that fail with one fault applied."""
    with tempfile.TemporaryDirectory() as workdir:
        copy = Path(workdir)
        ignore = shutil.ignore_patterns("__pycache__")
        shutil.copytree(BACKEND / "app", copy / "app", ignore=ignore)
        shutil.copytree(BACKEND / "tests", copy / "tests", ignore=ignore)
        shutil.copy(BACKEND / "pytest.ini", copy / "pytest.ini")
        target = copy / path
        source = target.read_text()
        if source.count(original) != 1:
            raise SystemExit(f"Expected exactly one {original!r} in {path}; update FAULTS.")
        target.write_text(source.replace(original, faulty))
        result = subprocess.run(
            [sys.executable, "-m", "pytest", "-q", "-rf", "-p", "no:cacheprovider", *TEST_FILES],
            cwd=copy, capture_output=True, text=True,
        )
    return [
        line.split("::", 1)[1].split(" - ")[0]
        for line in result.stdout.splitlines()
        if line.startswith("FAILED ")
    ]


undetected = 0
for name, path, original, faulty in FAULTS:
    failures = run_with_fault(path, original, faulty)
    undetected += not failures
    print(f"{name}: {len(failures)} failed")
    for failure in failures:
        print(f"  {failure}")

sys.exit(1 if undetected else 0)
