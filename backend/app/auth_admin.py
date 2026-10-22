from __future__ import annotations

import argparse
import asyncio
import getpass
import hmac
import sys

from . import database
from .local_auth import hash_password, normalize_email
from .local_env import load_local_project_env


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Manage local HomeCompass authentication.")
    commands = parser.add_subparsers(dest="command", required=True)
    reset = commands.add_parser(
        "set-password",
        help="set a local account password and revoke its active sessions",
    )
    reset.add_argument("email")
    return parser.parse_args()


async def _set_password(email: str, password_hash: str) -> bool:
    load_local_project_env()
    await database.open_pool()
    try:
        return await database.set_local_password_by_email(email, password_hash)
    finally:
        await database.close_pool()


def main() -> int:
    arguments = _arguments()
    try:
        email = normalize_email(arguments.email)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    password = getpass.getpass("New password: ")
    confirmation = getpass.getpass("Confirm new password: ")
    if not hmac.compare_digest(password.encode("utf-8"), confirmation.encode("utf-8")):
        print("Passwords do not match.", file=sys.stderr)
        return 2
    try:
        password_hash = hash_password(password)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    try:
        updated = asyncio.run(_set_password(email, password_hash))
    except Exception as exc:
        print(f"Could not update local account: {exc}", file=sys.stderr)
        return 1
    if not updated:
        print("No local account exists for that email.", file=sys.stderr)
        return 1
    print(f"Password updated for {email}; existing sessions were revoked.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
