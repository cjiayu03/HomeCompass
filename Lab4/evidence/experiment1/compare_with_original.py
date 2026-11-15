"""Compare the AI-rebuilt scoring module with the original on random inputs.

Supports the experiment 1 reflection in Lab4/Coding_Agent_Reflections.md. The
tests only check chosen cases, so this script looks for behaviour the tests
did not pin down. Run from the repository root:

    .venv/bin/python Lab4/evidence/experiment1/compare_with_original.py
"""

import importlib.util
import random
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
CASES = 20_000
CRITERIA = ("school", "childcare", "care", "affordability")


def load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


original = load("original_scoring", ROOT / "backend/app/scoring.py")
rebuilt = load("rebuilt_scoring", Path(__file__).with_name("scoring_rebuilt.py"))
rng = random.Random(2006)


def distance():
    return rng.choice([None, -5, 0, rng.randint(0, 3000), round(rng.uniform(0, 3000), 3), 1500, 2000])


def contributions(result):
    return [component["contribution"] for component in result["components"]]


def values(result):
    return [component["normalizedValue"] for component in result["components"]]


distance_differences = 0
for _ in range(CASES):
    d, t = distance(), rng.choice([1500, 2000, rng.randint(1, 3000)])
    distance_differences += original.score_distance(d, t) != rebuilt.score_distance(d, t)

differences = Counter()
examples = {}
for _ in range(CASES):
    evidence = {name: distance() for name in CRITERIA[:3] if rng.random() < 0.8}
    if rng.random() < 0.8:
        evidence["affordability"] = rng.randint(0, 120_000_000)
    targets = {"school": 1500, "childcare": 2000, "care": 2000,
               "affordability": rng.choice([None, 50_000_000, rng.randint(1, 100_000_000)])}
    weights = rng.choice([
        None,
        {"school": 2, "childcare": 2, "care": 2, "affordability": 1},
        {name: rng.choice([0, 1, 2, 3]) for name in CRITERIA},
        {"school": 3, "care": 1},
    ])
    a = original.score_home_evidence(evidence, weights, targets)
    b = rebuilt.score_home_evidence(evidence, weights, targets)
    reasons = []
    if isinstance(weights, dict) and len(weights) < len(CRITERIA) and (a["score"], a["coverage"]) != (b["score"], b["coverage"]):
        reasons.append("partial weights: missing criteria get weight 0 instead of the default")
    elif values(a) != values(b):
        reasons.append("component score rounding at .x5 (round-half-up vs Python round)")
    elif a["score"] != b["score"]:
        reasons.append("overall score rounding at .x5 (round-half-up vs Python round)")
    elif a["coverage"] != b["coverage"]:
        reasons.append("coverage rounding at .xx5")
    if contributions(a) != contributions(b) and a["score"] is None:
        reasons.append("contributions shown when there is no overall score")
    for reason in reasons:
        differences[reason] += 1
        examples.setdefault(reason, (evidence, weights, targets["affordability"], a["score"], b["score"]))

print(f"score_distance: {distance_differences} of {CASES} random cases differ")
print(f"score_home_evidence: {CASES} random cases")
for reason, count in differences.most_common():
    print(f"  {count:6}  {reason}")
    print(f"          example (evidence, weights, budget, original score, rebuilt score): {examples[reason]}")
