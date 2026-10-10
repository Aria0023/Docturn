#!/usr/bin/env bash
# DocTurn — first-boot installer for a single Ubuntu 24.04 (arm64 or x86_64)
# EC2 instance. Idempotent: safe to re-run.
#
#   sudo bash bootstrap.sh <domain> <git-repo-url> [branch]
#   e.g. sudo bash bootstrap.sh app.example.com git@github.com:Aria0023/Docturn.git main
#
# What it does (docs/AWS_DEPLOYMENT_RUNBOOK.md §8):
#   1. apt packages, a 1 GB swap file (the client build needs headroom on 2 GB)
#   2. Node 20 (NodeSource) + Caddy (official repo) + AWS CLI + jq
#   3. `docturn` system user; /opt/docturn (code), /var/lib/docturn/attachments
#      (encrypted attachment files), /etc/docturn (env, root:docturn 0750)
#   4. clone/pull the repo (as root, using root's deploy key), chown to docturn,
#      build as docturn
#   5. install the systemd unit + Caddyfile (with your domain), enable both
#
# It does NOT create /etc/docturn/docturn.env — run fetch-env-from-ssm.sh next.
# The docturn service is enabled but only started once that file exists, so a
# half-configured box never boots in demo mode.
set -euo pipefail

DOMAIN="${1:-}"
REPO_URL="${2:-}"
BRANCH="${3:-main}"

APP_DIR=/opt/docturn
DATA_DIR=/var/lib/docturn
ATTACH_DIR="$DATA_DIR/attachments"
ETC_DIR=/etc/docturn
SVC_USER=docturn

log()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run as root (sudo bash bootstrap.sh ...)"
[[ -n "$DOMAIN" && -n "$REPO_URL" ]] || die "usage: bootstrap.sh <domain> <git-repo-url> [branch]"
[[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || die "domain looks wrong: $DOMAIN"

export DEBIAN_FRONTEND=noninteractive

# ── 1. base packages + swap ───────────────────────────────────────────────────
log "apt packages"
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg git jq awscli \
  debian-keyring debian-archive-keyring apt-transport-https >/dev/null

if ! swapon --show | grep -q '^/swapfile'; then
  log "1 GB swap file (build headroom on small instances)"
  fallocate -l 1G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# ── 2. Node 20 + Caddy ────────────────────────────────────────────────────────
if ! command -v node >/dev/null || [[ "$(node -v | cut -c2-3)" -lt 20 ]]; then
  log "Node.js 20 (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
log "node $(node -v), npm $(npm -v)"

if ! command -v caddy >/dev/null; then
  log "Caddy (official apt repo)"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy >/dev/null
fi
log "caddy $(caddy version | head -1)"

# ── 3. service user + directories ────────────────────────────────────────────
if ! id -u "$SVC_USER" >/dev/null 2>&1; then
  log "system user $SVC_USER"
  useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$SVC_USER"
fi
install -d -m 0750 -o "$SVC_USER" -g "$SVC_USER" "$DATA_DIR" "$ATTACH_DIR"
install -d -m 0750 -o root -g "$SVC_USER" "$ETC_DIR"
install -d -m 0755 -o root -g root "$APP_DIR"

# ── 4. code: clone or pull (as root — root holds the deploy key), then build ──
if [[ -d "$APP_DIR/.git" ]]; then
  log "updating $APP_DIR ($BRANCH)"
  git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
  git -C "$APP_DIR" checkout --quiet "$BRANCH"
  git -C "$APP_DIR" reset --quiet --hard "origin/$BRANCH"
else
  log "cloning $REPO_URL ($BRANCH) → $APP_DIR"
  git clone --quiet --branch "$BRANCH" --depth 1 "$REPO_URL" "$APP_DIR"
fi
chown -R "$SVC_USER:$SVC_USER" "$APP_DIR"

log "building as $SVC_USER (this is the slow step — a few minutes)"
# Skip headless-browser downloads that some dev dependencies attempt on install;
# they are test-only and useless on the server.
sudo -u "$SVC_USER" -H env \
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 PUPPETEER_SKIP_DOWNLOAD=1 \
  bash -c "cd '$APP_DIR' && \
    if [[ -f package-lock.json ]]; then npm ci --include=dev --no-audit --no-fund; \
    else npm install --include=dev --no-audit --no-fund; fi && \
    npm run build"

[[ -f "$APP_DIR/dist/server/index.js" ]] || die "build did not produce dist/server/index.js"

# ── 5. systemd unit + Caddyfile ──────────────────────────────────────────────
log "installing systemd unit"
install -m 0644 "$APP_DIR/deploy/aws/docturn.service" /etc/systemd/system/docturn.service
chmod +x "$APP_DIR/deploy/aws/"*.sh

log "installing Caddyfile for $DOMAIN"
install -d -m 0755 /var/log/caddy
chown caddy:caddy /var/log/caddy
sed "s/__DOMAIN__/$DOMAIN/g" "$APP_DIR/deploy/aws/Caddyfile" > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile >/dev/null

systemctl daemon-reload
systemctl enable --now caddy >/dev/null
systemctl enable docturn >/dev/null

if [[ -f "$ETC_DIR/docturn.env" ]]; then
  log "environment present — starting docturn"
  systemctl restart docturn
  sleep 3
  systemctl --no-pager --lines=5 status docturn || true
else
  cat <<EOF

$(printf '\033[1;33m')docturn is installed and ENABLED but NOT STARTED:$(printf '\033[0m')
$ETC_DIR/docturn.env does not exist yet. Render it from SSM Parameter Store:

    REGION=<your-region> bash $APP_DIR/deploy/aws/fetch-env-from-ssm.sh
    systemctl start docturn
    curl -s https://$DOMAIN/api/health      # expect "ok":true, "persistent":true, "storage":"postgres", "secure":true

EOF
fi

log "done. Caddy will fetch the Let's Encrypt certificate for $DOMAIN on first request"
echo "    (DNS must already point at this instance's Elastic IP: dig +short $DOMAIN)"
