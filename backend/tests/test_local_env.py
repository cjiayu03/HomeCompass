import os

from app.local_env import load_local_project_env


def test_native_run_loads_env_and_maps_compose_db_host_to_loopback(monkeypatch, tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text("DATABASE_URL=postgresql://user:pass@db:5432/app\nAPP_NAME=Local\n")
    monkeypatch.delenv("POSTGRES_PORT", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("APP_NAME", raising=False)

    load_local_project_env(env_file)

    assert os.getenv("DATABASE_URL") == "postgresql://user:pass@127.0.0.1:5432/app"
    assert os.getenv("APP_NAME") == "Local"


def test_explicit_database_url_is_not_rewritten(monkeypatch, tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text("DATABASE_URL=postgresql://file:file@db:5432/app\n")
    monkeypatch.setenv("DATABASE_URL", "postgresql://container:container@db:5432/app")

    load_local_project_env(env_file)

    assert os.getenv("DATABASE_URL") == "postgresql://container:container@db:5432/app"
