#!/usr/bin/env bash
# DocTurn — routine update on the instance (docs/AWS_DEPLOYMENT_RUNBOOK.md §16).
#
#   sudo bash /opt/docturn/deploy/aws/update.sh [branch]
#
# Pulls the branch (as root, which holds the read-only deploy key), rebuilds as
# the unprivileged `docturn` user, restarts the service and checks health. The
# schema is applied automatically on start (SCHEMA_SQL is idempotent/additive).
#
# NOTE: until the session store is moved to Postgres (runbook §15.1) a restart
# signs every user out. Do updates at a quiet hour.
set -euo pipefail

APP_DIR=/opt/docturn
SVC_USER=docturn

die() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }
log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
[[ $EUID -eq 0 ]] || die "run as root"
[[ -d "$APP_DIR/.git" ]] || die "$APP_DIR is not a git checkout (run bootstrap.sh first)"

BRANCH="${1:-$(git -C "$APP_DIR" rev-parse --abbrev-ref HEAD)}"
BEFORE=$(git -C "$APP_DIR" rev-parse --short HEAD)

log "fetching $BRANCH"
git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
git -C "$APP_DIR" checkout --quiet "$BRANCH"
git -C "$APP_DIR" reset --quiet --hard "origin/$BRANCH"
AFTER=$(git -C "$APP_DIR" rev-parse --short HEAD)
chown -R "$SVC_USER:$SVC_USER" "$APP_DIR"

if [[ "$BEFORE" == "$AFTER" ]]; then
  echo "already at $AFTER — nothing to update"
  exit 0
fi
echo "$BEFORE → $AFTER"
git -C "$APP_DIR" --no-pager log --oneline "$BEFORE..$AFTER" | sed 's/^/    /'

log "building as $SVC_USER"
sudo -u "$SVC_USER" -H env PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 PUPPETEER_SKIP_DOWNLOAD=1 \
  bash -c "cd '$APP_DIR' && \
    if [[ -f package-lock.json ]]; then npm ci --include=dev --no-audit --no-fund; \
    else npm install --include=dev --no-audit --no-fund; fi && \
    npm run build"
[[ -f "$APP_DIR/dist/server/index.js" ]] || die "build failed — service NOT restarted, still running $BEFORE"

# Re-install the unit/Caddyfile in case the release changed them.
install -m 0644 "$APP_DIR/deploy/aws/docturn.service" /etc/systemd/system/docturn.service
chmod +x "$APP_DIR/deploy/aws/"*.sh
systemctl daemon-reload

log "restarting docturn"
systemctl restart docturn
for _ in $(seq 1 20); do
  sleep 1
  if HEALTH=$(curl -fsS http://127.0.0.1:3000/api/health 2>/dev/null); then
    echo "health: $HEALTH"
    grep -q '"persistent":true' <<<"$HEALTH" || echo "WARNING: persistent:false — the app is NOT on RDS. Check DATABASE_URL." >&2
    log "updated to $AFTER"
    exit 0
  fi
done
journalctl -u docturn -n 30 --no-pager >&2
die "service did not become healthy within 20s (see log above)"
