"""Load the repository .env for native local runs without overriding containers."""

from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import load_dotenv


def load_local_project_env(env_file: Path | None = None) -> None:
    """Load repo settings and map the Compose database hostname to local Postgres.

    Explicit environment variables take precedence (as they do in containers).
    The host rewrite applies only when DATABASE_URL came from the project .env.
    """
    database_url_was_explicit = "DATABASE_URL" in os.environ
    project_env = env_file or Path(__file__).resolve().parents[2] / ".env"
    load_dotenv(project_env, override=False)

    if database_url_was_explicit:
        return
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        return
    try:
        parts = urlsplit(database_url)
        if parts.hostname not in {"db", "database"}:
            return
        port = parts.port
    except ValueError:
        return

    user_info = parts.netloc.rsplit("@", 1)[0] if "@" in parts.netloc else ""
    local_host = "127.0.0.1" + (f":{port}" if port else "")
    local_netloc = f"{user_info}@{local_host}" if user_info else local_host
    os.environ["DATABASE_URL"] = parts._replace(netloc=local_netloc).geturl()
