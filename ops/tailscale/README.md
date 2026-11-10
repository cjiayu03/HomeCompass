# HomeCompass on Tailscale Funnel

The deployment tracks `https://github.com/softwarelab3/2006-SCSL-S1.git`, branch `main`.
Tailscale Funnel provides public HTTPS; visitors do not need Tailscale.

Live address: https://homecompass.tail79db12.ts.net/

The installation on this host uses:

- State and immutable app releases: `/home/ubuntu/sc2006/softwarelab/.local/deploy`.
- Private runtime settings: `.local/deploy/runtime.env` (0600, ignored by Git).
- Existing softwarelab PostGIS data: `.local/postgres`, port 55434. Public housing and neighbourhood records have already been copied here.
- User services: `homecompass-db`, `homecompass-api` (127.0.0.1:8101), `homecompass-web` (127.0.0.1:3101).
- Persistent Tailscale Funnel: HTTPS 443 → 127.0.0.1:3101.
- Cron: every minute, run `.local/deploy/bin/deploy.sh`; lock prevents overlapping builds.
- Public Funnel certificates are managed by Tailscale itself.
- Logs: `.local/deploy/logs/update.log` and `journalctl --user -u homecompass-web -u homecompass-api`.

The updater fetches `origin/main` without changing or resetting the working checkout.
Unchanged commits do not rebuild. A new commit is archived into a new release, gets its own
Python environment and locked npm dependencies, and is built before switching the current
release. A full database backup precedes transactional migrations. Applied migration files
cannot be edited; append migrations instead. Health checks gate the deployed-revision marker.
Failed application health checks restore the previous application symlink and restart its
services. Database backups are retained; schema rollback is not automatic. Use backward-compatible
migrations because switching app releases cannot undo committed schema changes.

Push/merge changes to softwarelab `main` to trigger an update on the next cron poll. Builds
take additional time after the poll. Failed builds leave the running release in place.
Only push trusted code: the running app and deployment necessarily access their own app database.
Other private-project API keys and databases are not part of this deployment.

Manual update: `bash .local/deploy/bin/deploy.sh` (add `--force` to rebuild the same commit).
Read deployed revision: `cat .local/deploy/deployed-revision`.
Services persist after logout and reboot through user lingering and systemd enablement.
Backups and failed releases accumulate; monitor disk space and retain backups according to
your recovery needs. Install script changes in `.local/deploy/bin` explicitly; cron uses the
installed updater, not an unreviewed updater taken from each fetched app commit.

Secure cookies are enabled for HTTPS. The public origin and local API-proxy origin are allowed
explicitly. The backend and deployment frontend bind loopback; only the website is exposed
through Funnel. Existing development ports 3000/8000 are separate from these managed services.

Public Funnel only was selected. Existing nginx sites and certificate automation were not
changed. Devices resolving this hostname through private Tailscale DNS currently reach the
pre-existing nginx listener on IPv4 port 443; use the public route from a device without
Tailscale for this address. Public users reach the correct website over valid HTTPS.

Deployment verification on 28 October 2026: public landing and Explore pages returned 200
with certificate verification enabled; the public housing endpoint reported 241,148 records;
a temporary account registered successfully, retained a Secure/HttpOnly cookie and authenticated
session, then was deleted. All three user services were active. A second updater run skipped
the unchanged commit. No unrelated nginx changes were installed.

## Automatic OneMap token renewal

After deploying the renewal code, run this once **on the production Linux server as `ubuntu`, without sudo**:

```bash
python3 /home/ubuntu/sc2006/softwarelab/.local/deploy/current/ops/onemap_token.py install-production
```

Enter the registered OneMap email and password at the terminal prompts. The password is hidden. The installer requests a token, updates `ONEMAP_ACCESS_TOKEN` in `.local/deploy/runtime.env`, copies the standard-library-only helper into the stable `.local/deploy/bin/onemap_token.py`, and enables `homecompass-onemap-refresh.timer`. The first run applies the token immediately. Later runs check hourly and shortly after startup; missed calendar checks are caught up after downtime. Existing user lingering keeps the timer running after SSH logout and across reboots.

The job renews when the provider's returned expiry is within six hours. It never logs the token or credentials. Account credentials are kept in `.local/deploy/onemap-refresh/credentials.json` with mode `0600` inside a `0700` directory; that server state is ignored by Git. Failed authentication preserves the old token. Runtime settings are replaced atomically, preserving unrelated values and release `.env` symlinks. The job takes the same `.local/deploy/update.lock` as deployment, so rotation and API restarts cannot overlap a release switch. Busy deployment locks defer the check to a later timer run.

After rotation, only `homecompass-api.service` restarts. The helper waits for `http://127.0.0.1:8101/ready` before marking the token applied. A failed restart or readiness check stays pending, and the next timer run retries it without another login. A restart briefly interrupts API requests; selected OneMap address candidates may need to be selected again because their existing signatures depend on the provider token. Existing saved places and imported coordinates are retained.

Verify or troubleshoot on the server:

```bash
systemctl --user list-timers homecompass-onemap-refresh.timer
systemctl --user start homecompass-onemap-refresh.service
journalctl --user -u homecompass-onemap-refresh.service -n 30 --no-pager
python3 /home/ubuntu/sc2006/softwarelab/.local/deploy/bin/onemap_token.py status
```

To update the OneMap account credentials, run the installed helper with `setup --restart-api`. To replace an invalidated token before expiry, use `refresh --force --restart-api`. To remove the timer, use `uninstall-production`; the private credentials and last token are retained. Script updates require rerunning `install-production`, just like the installed deployment updater. For a different installation path, pass `--deploy-root /absolute/path/to/deploy` or set `HOMECOMPASS_DEPLOY_ROOT`.
