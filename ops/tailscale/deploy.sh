#!/usr/bin/env bash
# Poll softwarelab main; build an immutable release before replacing the running app.
set -Eeuo pipefail
umask 077
export PATH=/home/ubuntu/.nvm/versions/node/v24.13.0/bin:/usr/local/bin:/usr/bin:/bin
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"
repo="${HOMECOMPASS_REPO:-/home/ubuntu/sc2006/softwarelab}"
state="${HOMECOMPASS_DEPLOY_ROOT:-$repo/.local/deploy}"
mkdir -p "$state/releases" "$state/backups" "$state/logs"
exec 9>"$state/update.lock"
flock -n 9 || exit 0
git -C "$repo" fetch --quiet origin main
revision=$(git -C "$repo" rev-parse refs/remotes/origin/main)
if [[ -f "$state/deployed-revision" ]] && [[ $(cat "$state/deployed-revision") == "$revision" ]] && [[ ${1:-} != --force ]]; then
  exit 0
fi
printf '%s Building softwarelab %s\n' "$(date -Is)" "$revision"
release=$(mktemp -d "$state/releases/${revision:0:12}.XXXXXX")
git -C "$repo" archive "$revision" | tar -x -C "$release"
cd "$release"
python3 -m venv .venv
.venv/bin/python -m pip install --quiet --disable-pip-version-check -r backend/requirements.txt
npm ci --no-audit --no-fund
BACKEND_URL=http://127.0.0.1:8101 NEXT_PUBLIC_API_BASE_URL= NEXT_TELEMETRY_DISABLED=1 npm run build
ln -s "$state/runtime.env" "$release/.env"
printf '%s Backing up and applying migrations\n' "$(date -Is)"
"$release/.venv/bin/python" "$state/bin/database.py" "$release" "$state"
previous=$(readlink -f "$state/current" || true)
ln -s "$release" "$state/current.new"
mv -Tf "$state/current.new" "$state/current"
rollback() {
  trap - ERR
  printf '%s Release failed; restoring previous app release. Database backup retained.\n' "$(date -Is)" >&2
  if [[ -n "$previous" && -d "$previous" ]]; then
    ln -s "$previous" "$state/current.rollback"
    mv -Tf "$state/current.rollback" "$state/current"
    systemctl --user restart homecompass-api.service homecompass-web.service || true
  fi
  exit 1
}
trap rollback ERR
systemctl --user restart homecompass-api.service homecompass-web.service
healthy=0
for attempt in $(seq 1 30); do
  if curl --fail --silent --max-time 3 http://127.0.0.1:8101/ready >/dev/null && curl --fail --silent --max-time 3 http://127.0.0.1:3101/ >/dev/null; then
    healthy=1
    break
  fi
  sleep 2
done
[[ "$healthy" == 1 ]]
printf '%s\n' "$revision" >"$state/deployed-revision.new"
mv "$state/deployed-revision.new" "$state/deployed-revision"
trap - ERR
printf '%s Deployed softwarelab %s\n' "$(date -Is)" "$revision"
