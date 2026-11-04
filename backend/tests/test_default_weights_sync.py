"""Guests and signed-in users must start from the same scoring weights.

The frontend keeps its own copy of the default priority weights for guests,
so this test fails if it drifts from the backend's DEFAULT_WEIGHTS.
"""

import re
from pathlib import Path

from app.scoring import DEFAULT_WEIGHTS

FRONTEND_DEFAULTS = Path(__file__).resolve().parents[2] / "frontend" / "lib" / "data.js"


def test_frontend_default_weights_match_backend():
    source = FRONTEND_DEFAULTS.read_text()
    match = re.search(r"priorityWeights:\s*\{([^}]*)\}", source)
    assert match, "defaultBrief.priorityWeights not found in frontend/lib/data.js"
    frontend_weights = {
        name: float(value)
        for name, value in re.findall(r"(\w+):\s*([\d.]+)", match.group(1))
    }

    assert frontend_weights == {name: float(weight) for name, weight in DEFAULT_WEIGHTS.items()}
