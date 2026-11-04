"""Production token rotation preserves runtime settings and retries service failures."""

import base64
from contextlib import redirect_stdout
import importlib.util
import io
import json
from pathlib import Path
import stat
import tempfile
import time
import unittest
from unittest.mock import patch
import urllib.error

SPEC = importlib.util.spec_from_file_location("onemap_token", Path(__file__).parents[1] / "onemap_token.py")
renewal = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(renewal)


class TokenRenewalTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name).resolve()
        self.env = self.root / ".env"
        self.private = self.root / "private"
        self.env.write_text("# Private settings\nDATABASE_URL=keep-this\nONEMAP_ACCESS_TOKEN=expired.token\nGEMINI_API_KEY=keep-that\n")
        self.private.mkdir()
        renewal.write_json(self.private / "credentials.json", {"email": "account@example.test", "password": "private-password"})
        self.expiry = int(time.time()) + 72 * 3600

    def invoke_refresh(self, **kwargs):
        with redirect_stdout(io.StringIO()):
            return renewal.refresh(self.env, self.private, **kwargs)

    def test_replacement_preserves_other_settings_and_permissions(self):
        renewal.replace_token(self.env, "new.valid.token")
        self.assertEqual(self.env.read_text(), "# Private settings\nDATABASE_URL=keep-this\nONEMAP_ACCESS_TOKEN=new.valid.token\nGEMINI_API_KEY=keep-that\n")
        self.assertEqual(stat.S_IMODE(self.env.stat().st_mode), 0o600)

    def test_crlf_duplicates_and_missing_key(self):
        self.env.write_bytes(b"OTHER=keep\r\nexport ONEMAP_ACCESS_TOKEN='old'\r\nONEMAP_ACCESS_TOKEN=older\r\n")
        self.assertEqual(renewal.read_token(self.env), "older")
        renewal.replace_token(self.env, "new.token")
        self.assertEqual(self.env.read_bytes(), b"OTHER=keep\r\nONEMAP_ACCESS_TOKEN=new.token\r\n")
        self.env.write_bytes(b"OTHER=keep")
        renewal.replace_token(self.env, "new.token")
        self.assertEqual(self.env.read_text(), "OTHER=keep\nONEMAP_ACCESS_TOKEN=new.token\n")

    def test_unsafe_or_multiline_values_do_not_change_env(self):
        before = self.env.read_bytes()
        with self.assertRaises(renewal.RenewalError):
            renewal.replace_token(self.env, "token\nINJECTED=value")
        self.assertEqual(self.env.read_bytes(), before)
        self.env.write_text("ONEMAP_ACCESS_TOKEN='first\nsecond'\nOTHER=keep\n")
        before = self.env.read_bytes()
        with self.assertRaises(renewal.RenewalError):
            renewal.replace_token(self.env, "new.token")
        self.assertEqual(self.env.read_bytes(), before)

    def test_auth_failure_keeps_existing_env_and_suppresses_provider_details(self):
        before = self.env.read_bytes()
        failure = urllib.error.HTTPError(renewal.AUTH_URL, 401, "private-password", {}, None)
        with patch.object(renewal.urllib.request, "build_opener") as opener:
            opener.return_value.open.side_effect = failure
            with self.assertRaises(renewal.RenewalError) as captured:
                self.invoke_refresh()
        self.assertNotIn("private-password", str(captured.exception))
        self.assertEqual(self.env.read_bytes(), before)

    def test_valid_token_does_not_authenticate_or_restart_again(self):
        token = "current.token"
        renewal.replace_token(self.env, token)
        renewal.write_json(self.private / "state.json", {"token_sha256": renewal.fingerprint(token), "expires_at": self.expiry, "applied_token_sha256": renewal.fingerprint(token)})
        with patch.object(renewal, "authenticate") as login, patch.object(renewal, "reload_api") as reload_api:
            self.assertFalse(self.invoke_refresh(restart_api=True))
        login.assert_not_called()
        reload_api.assert_not_called()

    def test_renewed_token_is_written_and_applied_once(self):
        with patch.object(renewal, "authenticate", return_value=("renewed.token", self.expiry)) as login, patch.object(renewal, "reload_api") as reload_api:
            self.assertTrue(self.invoke_refresh(restart_api=True))
            self.assertFalse(self.invoke_refresh(restart_api=True))
        login.assert_called_once_with("account@example.test", "private-password")
        reload_api.assert_called_once_with(self.env)
        self.assertEqual(renewal.read_token(self.env), "renewed.token")
        state = renewal.read_json(self.private / "state.json")
        self.assertEqual(state["applied_token_sha256"], renewal.fingerprint("renewed.token"))
        self.assertNotIn("renewed.token", (self.private / "state.json").read_text())

    def test_failed_api_restart_retries_without_another_authentication(self):
        with patch.object(renewal, "authenticate", return_value=("renewed.token", self.expiry)) as login:
            with patch.object(renewal, "reload_api", side_effect=renewal.RenewalError("Service restart failed")):
                with self.assertRaises(renewal.RenewalError):
                    self.invoke_refresh(restart_api=True)
            self.assertEqual(renewal.read_token(self.env), "renewed.token")
            with patch.object(renewal, "reload_api") as retry:
                self.assertFalse(self.invoke_refresh(restart_api=True))
            retry.assert_called_once_with(self.env)
        login.assert_called_once()

    def test_existing_jwt_expiry_is_only_a_scheduling_hint(self):
        payload = base64.urlsafe_b64encode(json.dumps({"exp": self.expiry}).encode()).decode().rstrip("=")
        self.assertEqual(renewal.token_expiry(f"header.{payload}.signature", {}), self.expiry)
        self.assertEqual(renewal.token_expiry("not-a-jwt", {}), 0)
        self.assertEqual(renewal.token_expiry("token", {"token_sha256": renewal.fingerprint("token"), "expires_at": "NaN"}), 0)

    def test_concurrent_renewal_is_blocked(self):
        with renewal.renewal_lock(self.private):
            with self.assertRaises(renewal.RenewalError):
                self.invoke_refresh()

    def test_auth_response_requires_future_expiry_and_does_not_redirect(self):
        with patch.object(renewal.urllib.request, "build_opener") as opener:
            response = opener.return_value.open.return_value.__enter__.return_value
            response.read.return_value = json.dumps({"access_token": "new.token", "expiry_timestamp": str(self.expiry)}).encode()
            self.assertEqual(renewal.authenticate("account@example.test", "private-password"), ("new.token", self.expiry))
            self.assertIsInstance(opener.call_args.args[0], renewal.NoRedirects)
            request = opener.return_value.open.call_args.args[0]
            self.assertEqual(request.full_url, renewal.AUTH_URL)
            self.assertEqual(request.get_method(), "POST")
            response.read.return_value = b'{"access_token":"new.token","expiry_timestamp":1}'
            with self.assertRaises(renewal.RenewalError):
                renewal.authenticate("account@example.test", "private-password")

    def test_timer_survives_reboots_and_uses_shared_paths_without_secrets(self):
        service, timer = renewal.production_units(self.root / "deploy space%")
        self.assertIn("OnCalendar=hourly", timer)
        self.assertIn("Persistent=true", timer)
        self.assertIn("OnStartupSec=2min", timer)
        self.assertIn("--restart-api", service)
        self.assertIn("bin/onemap_token.py", service)
        self.assertIn("deploy space%%", service)
        self.assertNotIn("current/", service)
        self.assertNotIn("private-password", service + timer)
        self.assertNotIn("account@example.test", service + timer)

    def test_installer_enables_timer_before_first_run_and_preserves_release_symlink(self):
        deploy = self.root / "deployment"
        deploy.mkdir()
        runtime = deploy / "runtime.env"
        runtime.write_bytes(self.env.read_bytes())
        release = self.root / "release"
        release.mkdir()
        (deploy / "current").symlink_to(release, target_is_directory=True)
        (release / ".env").symlink_to(runtime)
        home = self.root / "fake-home"
        with patch.object(renewal.sys, "platform", "linux"), patch.object(renewal.os, "geteuid", return_value=1000), patch.object(renewal.Path, "home", return_value=home), patch.object(renewal.sys.stdin, "isatty", return_value=True), patch("builtins.input", return_value="account@example.test"), patch.object(renewal.getpass, "getpass", return_value="private-password"), patch.object(renewal, "authenticate", return_value=("new.token", self.expiry)), patch.object(renewal, "run_systemctl", side_effect=[None, None, renewal.RenewalError("Service not ready")]) as systemctl, redirect_stdout(io.StringIO()):
            with self.assertRaises(renewal.RenewalError):
                renewal.install_production(deploy)
        self.assertEqual(systemctl.call_args_list[1].args[0], ["enable", "--now", renewal.TIMER_NAME])
        self.assertEqual(systemctl.call_args_list[2].args[0], ["start", renewal.SERVICE_NAME])
        self.assertTrue((deploy / "bin" / "onemap_token.py").is_file())
        self.assertTrue((release / ".env").is_symlink())
        self.assertEqual(renewal.read_token(runtime), "new.token")
        unit = home / ".config" / "systemd" / "user" / renewal.SERVICE_NAME
        self.assertIn(str(deploy / "bin" / "onemap_token.py"), unit.read_text())
        self.assertNotIn("current/", unit.read_text())
        self.assertEqual(stat.S_IMODE((deploy / "onemap-refresh" / "credentials.json").stat().st_mode), 0o600)

    def test_install_production_refuses_mac_before_creating_files(self):
        with patch.object(renewal.sys, "platform", "darwin"):
            with self.assertRaises(renewal.RenewalError):
                renewal.install_production(self.root / "nonexistent")
        self.assertFalse((self.root / "nonexistent").exists())

    def test_noninteractive_setup_never_reads_password(self):
        with patch.object(renewal.sys.stdin, "isatty", return_value=False), patch.object(renewal.getpass, "getpass") as password:
            with self.assertRaises(renewal.RenewalError):
                renewal.setup_credentials(self.env, self.private, None)
        password.assert_not_called()

    def test_symlink_token_update_changes_shared_target(self):
        release_env = self.root / "release.env"
        release_env.symlink_to(self.env)
        renewal.replace_token(release_env, "new.token")
        self.assertTrue(release_env.is_symlink())
        self.assertEqual(renewal.read_token(self.env), "new.token")

    def test_active_deployment_defers_renewal_without_authentication(self):
        deployment_lock = self.root / "update.lock"
        before = self.env.read_bytes()
        with renewal.file_lock(deployment_lock):
            with patch.object(renewal.time, "monotonic", side_effect=[0, 61]), patch.object(renewal, "authenticate") as login:
                with self.assertRaises(renewal.LockBusy):
                    self.invoke_refresh(deployment_lock=deployment_lock)
        login.assert_not_called()
        self.assertEqual(self.env.read_bytes(), before)

    def test_restart_targets_only_production_api_and_waits_for_readiness(self):
        with patch.object(renewal, "run_systemctl") as systemctl, patch.object(renewal, "wait_for_api") as ready:
            renewal.reload_api(self.env)
        systemctl.assert_called_once_with(["restart", "homecompass-api.service"])
        ready.assert_called_once()

    def test_readiness_requires_ready_true(self):
        with patch.object(renewal.urllib.request, "build_opener") as opener:
            response = opener.return_value.open.return_value.__enter__.return_value
            response.read.return_value = b'{"ready": true}'
            renewal.wait_for_api(timeout=0)
            response.read.return_value = b'{"ready": false}'
            with self.assertRaises(renewal.RenewalError):
                renewal.wait_for_api(timeout=0)

    def test_failed_readiness_keeps_restart_pending(self):
        with patch.object(renewal, "authenticate", return_value=("renewed.token", self.expiry)), patch.object(renewal, "run_systemctl"), patch.object(renewal, "wait_for_api", side_effect=renewal.RenewalError("API not ready")):
            with self.assertRaises(renewal.RenewalError):
                self.invoke_refresh(restart_api=True)
        state = renewal.read_json(self.private / "state.json")
        self.assertNotEqual(state.get("applied_token_sha256"), renewal.fingerprint("renewed.token"))


if __name__ == "__main__":
    unittest.main()
