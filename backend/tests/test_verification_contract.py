import json
from pathlib import Path

from app.migrations import checked_in_migrations


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


def test_npm_verification_scripts_cover_only_private_application_checks():
    with (REPOSITORY_ROOT / "package.json").open(encoding="utf-8") as package_file:
        root_scripts = json.load(package_file)["scripts"]
    with (REPOSITORY_ROOT / "frontend" / "package.json").open(
        encoding="utf-8"
    ) as package_file:
        frontend_scripts = json.load(package_file)["scripts"]

    assert root_scripts.get("verify:frontend") == (
        "npm --workspace frontend run test && "
        "NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000 "
        "npm --workspace frontend run build"
    )
    assert root_scripts.get("verify:backend") == "cd backend && python -m pytest -q"
    assert root_scripts.get("verify") == (
        "npm run verify:backend && npm run verify:frontend"
    )
    assert frontend_scripts.get("test:e2e") == "playwright test"
    assert "test:e2e" not in root_scripts["verify:frontend"]

    all_scripts = {**root_scripts, **frontend_scripts}
    forbidden_script_fragments = (
        "lab3/",
        "lab4/",
        "lab5/",
        "export-docs",
        "render-diagrams",
    )
    for script_name, command in all_scripts.items():
        normalized_command = command.lower().replace("\\", "/")
        assert not any(
            fragment in normalized_command
            for fragment in forbidden_script_fragments
        ), f"{script_name} invokes an out-of-scope course path: {command}"


def test_verification_contract_counts_only_the_seven_application_migrations():
    migrations = checked_in_migrations()

    assert len(migrations) == 7
    assert [version for version, _ in migrations] == list(range(1, 8))
    assert all(
        (REPOSITORY_ROOT / "database" / "migrations" / filename).is_file()
        for _, filename in migrations
    )
