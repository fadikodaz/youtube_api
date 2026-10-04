#!/bin/bash
# VPS setup for YT MP3 Downloader (Ubuntu 22.04 / 24.04)
# Run as root on fresh Hostinger VPS
set -e

apt-get update
apt-get install -y curl git ca-certificates ufw

# Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# App lives in /opt/ytmp3 (copy repo there or git clone)
APP_DIR=/opt/ytmp3
mkdir -p $APP_DIR/bin
cd $APP_DIR

# after copying project files here, run:
# npm install --omit=dev
# curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o bin/yt-dlp
# chmod +x bin/yt-dlp

# pm2 to keep it alive + autostart
npm install -g pm2
pm2 startup systemd -u root --hp /root || true

# firewall: app + ssh only (use nginx for 80/443, see below)
ufw allow OpenSSH
ufw allow 3000/tcp
ufw --force enable

echo "Done. Now: cd $APP_DIR && npm install --omit=dev && pm2 start server.js --name ytmp3 && pm2 save"
