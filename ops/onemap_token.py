#!/usr/bin/env python3
"""Renew OneMap's REST token in production runtime.env using a Linux systemd timer."""

from __future__ import annotations

import argparse
import base64
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import getpass
import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

DEFAULT_DEPLOY_ROOT = Path("/home/ubuntu/sc2006/softwarelab/.local/deploy")
AUTH_URL = "https://www.onemap.gov.sg/api/auth/post/getToken"
READY_URL = "http://127.0.0.1:8101/ready"
SERVICE_NAME = "homecompass-onemap-refresh.service"
TIMER_NAME = "homecompass-onemap-refresh.timer"
REFRESH_MARGIN = 6 * 60 * 60
TOKEN_LINE = re.compile(r"^(?:export[ \t]+)?ONEMAP_ACCESS_TOKEN[ \t]*=([^\r\n]*)(?:\r?\n|$)", re.MULTILINE)


class RenewalError(RuntimeError):
    """An actionable message containing no credentials or provider response data."""


class LockBusy(RenewalError):
    """Defer this check while another renewal or deployment is active."""


class NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def atomic_write(path: Path, content: bytes) -> None:
    """Keep readers on either the old or complete new file; restrict secret files."""
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def read_json(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        value = json.loads(path.read_text())
        if isinstance(value, dict):
            return value
    except (ValueError, OSError):
        pass
    raise RenewalError(f"Cannot read {path.name}. Restore or remove that private state file before retrying.")


def write_json(path: Path, value: dict) -> None:
    atomic_write(path, (json.dumps(value) + "\n").encode())


def read_token(env_file: Path) -> str:
    try:
        content = env_file.read_bytes().decode("utf-8")
    except OSError:
        raise RenewalError("The private .env file does not exist or cannot be read.") from None
    matches = list(TOKEN_LINE.finditer(content))
    if not matches:
        return ""
    raw = matches[-1].group(1).strip()
    if raw.startswith(("'", '"')):
        return raw.split(raw[0], 2)[1] if len(raw.split(raw[0], 2)) == 3 else ""
    return raw.split(" #", 1)[0].strip()


def replace_token(env_file: Path, token: str) -> None:
    # Active releases symlink .env to shared runtime.env. Preserve that symlink.
    env_file = env_file.resolve()
    # OneMap returns a JWT. Reject characters with .env interpolation/comment semantics.
    if not re.fullmatch(r"[A-Za-z0-9._~+/-]+=*", token) or len(token) > 16384:
        raise RenewalError("OneMap returned an invalid token; the .env file was not changed.")
    try:
        original = env_file.read_bytes()
        text = original.decode("utf-8")
    except (OSError, UnicodeError):
        raise RenewalError("The private .env file cannot be read as UTF-8.") from None
    newline = "\r\n" if "\r\n" in text else "\n"
    replacement = f"ONEMAP_ACCESS_TOKEN={token}{newline}"
    found = False
    for match in TOKEN_LINE.finditer(text):
        value = match.group(1).strip()
        if value.startswith(("'", '"')) and value[0] not in value[1:]:
            raise RenewalError("Keep ONEMAP_ACCESS_TOKEN on one line before renewing; the .env file was not changed.")

    def substitute(_match):
        nonlocal found
        if found:
            return ""  # Remove duplicate definitions so the old token cannot win.
        found = True
        return replacement

    updated = TOKEN_LINE.sub(substitute, text)
    if not found:
        updated += (newline if updated and not updated.endswith("\n") else "") + replacement
    # An editor may have changed other settings while renewal was in progress.
    if env_file.read_bytes() != original:
        raise RenewalError("The .env file changed during renewal. Retry to preserve your edits.")
    atomic_write(env_file, updated.encode("utf-8"))


def fingerprint(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def token_expiry(token: str, state: dict) -> float:
    if state.get("token_sha256") == fingerprint(token):
        try:
            expiry = float(state["expires_at"])
            if math.isfinite(expiry) and 0 < expiry < 253402300799:
                return expiry
        except (KeyError, TypeError, ValueError):
            pass
    # Existing manually configured JWTs have no saved expiry. This is a scheduling
    # hint only; decoding an unsigned payload is not authentication or verification.
    try:
        payload = token.split(".")[1]
        decoded = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        expiry = float(decoded["exp"])
        return expiry if math.isfinite(expiry) and 0 < expiry < 253402300799 else 0
    except (ValueError, IndexError, KeyError, TypeError):
        return 0


def authenticate(email: str, password: str) -> tuple[str, int]:
    body = json.dumps({"email": email, "password": password}).encode()
    request = urllib.request.Request(AUTH_URL, data=body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        # Keep TLS certificate verification enabled and never redirect credentials.
        with urllib.request.build_opener(NoRedirects()).open(request, timeout=20) as response:
            raw = response.read(32769)
        if len(raw) > 32768:
            raise ValueError("oversized response")
        payload = json.loads(raw)
        token = payload["access_token"]
        raw_expiry = payload["expiry_timestamp"]
        if not isinstance(token, str) or isinstance(raw_expiry, bool):
            raise ValueError("invalid fields")
        expiry = int(raw_expiry)
        if not re.fullmatch(r"[A-Za-z0-9._~+/-]+=*", token) or len(token) > 16384 or not time.time() + REFRESH_MARGIN < expiry < 253402300799:
            raise ValueError("invalid token or expiry")
        return token, expiry
    except urllib.error.HTTPError as error:
        status = error.code
        error.close()
        if status in (401, 403, 404):
            raise RenewalError("OneMap rejected the account credentials. Run setup again to correct them.") from None
        raise RenewalError(f"OneMap authentication failed (HTTP {status}); the existing token was kept.") from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise RenewalError("Cannot reach OneMap securely; the existing token was kept. Retry later.") from None
    except (ValueError, KeyError, TypeError, OverflowError):
        raise RenewalError("OneMap returned an invalid authentication response; the existing token was kept.") from None


@contextmanager
def file_lock(path: Path, wait_seconds: float = 0):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a") as lock:
        os.chmod(lock.name, 0o600)
        deadline = time.monotonic() + wait_seconds
        while True:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise LockBusy("A deployment or token renewal is running; this check is deferred.") from None
                time.sleep(0.25)
        yield


@contextmanager
def renewal_lock(state_dir: Path, deployment_lock: Path | None = None):
    state_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    state_dir.chmod(0o700)
    if deployment_lock is not None:
        with file_lock(deployment_lock, wait_seconds=60), file_lock(state_dir / "refresh.lock"):
            yield
    else:
        with file_lock(state_dir / "refresh.lock"):
            yield


def systemd_environment() -> dict:
    environment = dict(os.environ)
    environment.setdefault("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}")
    environment.setdefault("DBUS_SESSION_BUS_ADDRESS", f"unix:path={environment['XDG_RUNTIME_DIR']}/bus")
    return environment


def run_systemctl(arguments: list[str], timeout: int = 60) -> None:
    try:
        result = subprocess.run(
            ["systemctl", "--user", *arguments], env=systemd_environment(),
            capture_output=True, timeout=timeout, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise RenewalError("The production user service operation failed. Run as the deployment user and inspect its journal.") from None
    if result.returncode:
        raise RenewalError("The production user service operation failed. Inspect journalctl --user; stored tokens were kept.")


def wait_for_api(timeout: float = 60) -> None:
    deadline = time.monotonic() + timeout
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirects())
    while True:
        try:
            with opener.open(READY_URL, timeout=3) as response:
                payload = json.loads(response.read(65536))
                if isinstance(payload, dict) and payload.get("ready") is True:
                    return
        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as error:
            if isinstance(error, urllib.error.HTTPError):
                error.close()
        if time.monotonic() >= deadline:
            raise RenewalError("Token saved, but the production API did not become ready. A later run will retry the restart.")
        time.sleep(2)


def reload_api(_env_file: Path) -> None:
    run_systemctl(["restart", "homecompass-api.service"])
    wait_for_api()


def refresh(env_file: Path, state_dir: Path, *, force: bool = False, restart_api: bool = False, deployment_lock: Path | None = None) -> bool:
    with renewal_lock(state_dir, deployment_lock):
        state_file = state_dir / "state.json"
        state = read_json(state_file)
        token = read_token(env_file)
        expiry = token_expiry(token, state) if token else 0
        changed = force or expiry <= time.time() + REFRESH_MARGIN
        if changed:
            credentials = read_json(state_dir / "credentials.json")
            email, password = credentials.get("email"), credentials.get("password")
            if not isinstance(email, str) or not email or not isinstance(password, str) or not password:
                raise RenewalError("OneMap credentials are missing. Run the setup command in your terminal first.")
            token, expiry = authenticate(email, password)
            replace_token(env_file, token)
            state.update(token_sha256=fingerprint(token), expires_at=expiry)
            write_json(state_file, state)
            print("OneMap token renewed and saved to the private runtime environment.")
        else:
            print("OneMap token is still valid; no authentication request was made.")
        if restart_api and state.get("applied_token_sha256") != fingerprint(token):
            reload_api(env_file)
            state.update(applied_token_sha256=fingerprint(token), token_sha256=fingerprint(token), expires_at=expiry)
            write_json(state_file, state)
            print("Production API restarted and ready with the saved token.")
        state["last_success_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        write_json(state_file, state)
        print("Token expires:", datetime.fromtimestamp(expiry, timezone.utc).isoformat(timespec="minutes"))
        return changed


def unit_quote(value: str) -> str:
    if any(character in value for character in "\r\n\x00"):
        raise RenewalError("Deployment paths cannot contain control characters.")
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"').replace("%", "%%") + '"'


def production_units(deploy_root: Path) -> tuple[str, str]:
    arguments = ["/usr/bin/python3", str(deploy_root / "bin" / "onemap_token.py"), "refresh",
                 "--deploy-root", str(deploy_root), "--restart-api"]
    service = (
        "[Unit]\nDescription=Renew OneMap token for HomeCompass\n\n"
        "[Service]\nType=oneshot\nUMask=0077\nNoNewPrivileges=true\n"
        "TimeoutStartSec=240\nSuccessExitStatus=75\n"
        f"WorkingDirectory={unit_quote(str(deploy_root))}\n"
        f"ExecStart={' '.join(unit_quote(value) for value in arguments)}\n"
    )
    timer = (
        "[Unit]\nDescription=Check HomeCompass OneMap token expiry hourly\n\n"
        "[Timer]\nOnCalendar=hourly\nOnStartupSec=2min\nPersistent=true\n"
        "RandomizedDelaySec=2min\nAccuracySec=1min\n"
        f"Unit={SERVICE_NAME}\n\n[Install]\nWantedBy=timers.target\n"
    )
    return service, timer


def setup_credentials(env_file: Path, state_dir: Path, deployment_lock: Path | None) -> None:
    read_token(env_file)
    if not sys.stdin.isatty():
        raise RenewalError("Run setup in an interactive server terminal so the password can be entered privately.")
    email = input("Registered OneMap email: ").strip()
    password = getpass.getpass("OneMap password (hidden): ")
    if not email or not password:
        raise RenewalError("Both OneMap email and password are required.")
    # Prompt before taking the deployment lock, so typing does not block releases.
    with renewal_lock(state_dir, deployment_lock):
        state = read_json(state_dir / "state.json")
        token, expiry = authenticate(email, password)
        replace_token(env_file, token)
        write_json(state_dir / "credentials.json", {"email": email, "password": password})
        state.update(token_sha256=fingerprint(token), expires_at=expiry)
        write_json(state_dir / "state.json", state)
        print("OneMap token saved. Account credentials are stored in the private server state directory.")


def install_production(deploy_root: Path) -> None:
    if not sys.platform.startswith("linux"):
        raise RenewalError("Run install-production on the Linux production server as the deployment user.")
    if os.geteuid() == 0:
        raise RenewalError("Run as the deployment user (ubuntu), without sudo; the production API uses a user service.")
    env_file = deploy_root / "runtime.env"
    state_dir = deploy_root / "onemap-refresh"
    if not env_file.is_file() or not (deploy_root / "current").is_dir():
        raise RenewalError("The production runtime.env and current release must exist before installing renewal.")
    script = deploy_root / "bin" / "onemap_token.py"
    atomic_write(script, Path(__file__).resolve().read_bytes())
    state_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    state_dir.chmod(0o700)
    if not (state_dir / "credentials.json").exists():
        setup_credentials(env_file, state_dir, deploy_root / "update.lock")
    else:
        (state_dir / "credentials.json").chmod(0o600)
    service, timer = production_units(deploy_root)
    units = Path.home() / ".config" / "systemd" / "user"
    atomic_write(units / SERVICE_NAME, service.encode())
    atomic_write(units / TIMER_NAME, timer.encode())
    run_systemctl(["daemon-reload"])
    run_systemctl(["enable", "--now", TIMER_NAME])
    run_systemctl(["start", SERVICE_NAME], timeout=240)
    print("Production renewal timer enabled. It checks hourly and after server startup.")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("setup", "refresh", "install-production", "status", "uninstall-production"))
    parser.add_argument("--deploy-root", type=Path, default=Path(os.getenv("HOMECOMPASS_DEPLOY_ROOT", str(DEFAULT_DEPLOY_ROOT))))
    parser.add_argument("--env-file", type=Path, help="Default: DEPLOY_ROOT/runtime.env")
    parser.add_argument("--state-dir", type=Path, help="Default: DEPLOY_ROOT/onemap-refresh")
    parser.add_argument("--restart-api", action="store_true", help="Restart homecompass-api.service and verify readiness when the token changes")
    parser.add_argument("--force", action="store_true", help="Renew even if the current token is not near expiry")
    args = parser.parse_args(argv)
    deploy_root = args.deploy_root.expanduser().resolve()
    env_file = (args.env_file or deploy_root / "runtime.env").expanduser().resolve()
    state_dir = (args.state_dir or deploy_root / "onemap-refresh").expanduser().resolve()
    try:
        if args.command == "setup":
            setup_credentials(env_file, state_dir, deploy_root / "update.lock")
            if args.restart_api:
                refresh(env_file, state_dir, restart_api=True, deployment_lock=deploy_root / "update.lock")
        elif args.command == "refresh":
            refresh(env_file, state_dir, force=args.force, restart_api=args.restart_api, deployment_lock=deploy_root / "update.lock")
        elif args.command == "install-production":
            install_production(deploy_root)
        elif args.command == "uninstall-production":
            if not sys.platform.startswith("linux"):
                raise RenewalError("Run uninstall-production on the production Linux server.")
            run_systemctl(["disable", "--now", TIMER_NAME])
            run_systemctl(["stop", SERVICE_NAME])
            units = Path.home() / ".config" / "systemd" / "user"
            (units / SERVICE_NAME).unlink(missing_ok=True)
            (units / TIMER_NAME).unlink(missing_ok=True)
            run_systemctl(["daemon-reload"])
            print("Production timer removed. The token and private credentials were kept.")
        else:
            token = read_token(env_file)
            state = read_json(state_dir / "state.json")
            expiry = token_expiry(token, state) if token else 0
            print("Credentials configured:", (state_dir / "credentials.json").exists())
            print("Token expires:", datetime.fromtimestamp(expiry, timezone.utc).isoformat(timespec="minutes") if expiry else "unknown")
            print("Renewal due:", expiry <= time.time() + REFRESH_MARGIN)
            print("API restart pending:", bool(token) and state.get("applied_token_sha256") != fingerprint(token))
            print("Last successful check:", state.get("last_success_at", "not recorded"))
            print("Timer unit installed:", (Path.home() / ".config" / "systemd" / "user" / TIMER_NAME).exists())
        return 0
    except LockBusy as error:
        print(str(error))
        return 75
    except (RenewalError, OSError) as error:
        # OSError filenames are safe but exception details from network/auth are not.
        print(str(error) if isinstance(error, RenewalError) else "A local file or scheduler operation failed. Check private file permissions.", file=sys.stderr)
        return 1
    except (KeyboardInterrupt, EOFError):
        print("Setup cancelled.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
