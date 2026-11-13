#!/usr/bin/env bash
# One-shot VPS setup for the YouTube downloader (Ubuntu 22.04 / 24.04, Debian 12).
#
# Usage (as root, from a copy of this repository on the server):
#   sudo bash deploy/vps-setup.sh your-domain.com
#
# Result: Node 22, a dedicated "ytdl" user, the app in /opt/ytdl running under
# systemd on 127.0.0.1:3000, nginx in front on port 80, firewall allowing only
# SSH + HTTP(S). Afterwards run certbot (printed at the end) for HTTPS.
# Safe to run again to deploy an update.
set -euo pipefail

DOMAIN="${1:-}"
APP_DIR=/opt/ytdl
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [[ $EUID -ne 0 ]]; then echo "Run as root (sudo)." >&2; exit 1; fi
if [[ -z "$DOMAIN" ]]; then echo "Usage: sudo bash deploy/vps-setup.sh your-domain.com" >&2; exit 1; fi

echo "==> Packages"
apt-get update
apt-get install -y curl ca-certificates gnupg nginx ufw rsync

if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]]; then
  echo "==> Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "==> User and files"
id ytdl >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin ytdl
mkdir -p "$APP_DIR/.cache"
if [[ "$SRC_DIR" != "$APP_DIR" ]]; then
  rsync -a --delete \
    --exclude node_modules --exclude bin --exclude .git \
    --exclude .env --exclude cookies.txt --exclude .cache --exclude .npm \
    "$SRC_DIR/" "$APP_DIR/"
fi

if [[ ! -f "$APP_DIR/.env" ]]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  # Production defaults: private port behind nginx, random admin token.
  sed -i "s/^#\?\s*HOST=.*/HOST=127.0.0.1/" "$APP_DIR/.env"
  sed -i "s/^#\?\s*ADMIN_TOKEN=.*/ADMIN_TOKEN=$(openssl rand -hex 24)/" "$APP_DIR/.env"
  echo "    created $APP_DIR/.env (edit it to change settings)"
fi
chmod 600 "$APP_DIR/.env"
[[ -f "$APP_DIR/cookies.txt" ]] && chmod 600 "$APP_DIR/cookies.txt"
chown -R ytdl:ytdl "$APP_DIR"

echo "==> Dependencies + yt-dlp (verified)"
sudo -u ytdl -H bash -c "cd '$APP_DIR' && npm ci --omit=dev --no-audit --no-fund && YTDLP_STRICT=1 node scripts/fetch-ytdlp.js"

echo "==> systemd service"
install -m 644 "$APP_DIR/deploy/ytdl.service" /etc/systemd/system/ytdl.service
systemctl daemon-reload
systemctl enable ytdl
systemctl restart ytdl

echo "==> nginx"
sed "s/YOUR_DOMAIN/$DOMAIN/g" "$APP_DIR/deploy/nginx.conf" > /etc/nginx/sites-available/ytdl
ln -sf /etc/nginx/sites-available/ytdl /etc/nginx/sites-enabled/ytdl
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "==> Firewall (SSH + HTTP/HTTPS only; the app port stays private)"
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

sleep 2
if curl -fsS http://127.0.0.1:3000/api/health >/dev/null; then
  echo "App is running."
else
  echo "App did not answer yet. Check: journalctl -u ytdl -n 50" >&2
fi

cat <<EOF

Done.
  1. Point $DOMAIN's DNS A record to this server's IP.
  2. HTTPS:   apt-get install -y certbot python3-certbot-nginx && certbot --nginx -d $DOMAIN
  3. Logs:    journalctl -u ytdl -f
  4. Settings: $APP_DIR/.env  (then: systemctl restart ytdl)
  5. Optional cookies: copy cookies.txt to $APP_DIR/, chown ytdl:ytdl it, chmod 600, restart.
EOF
