# YouTube downloader: Node 22 + official yt-dlp (standalone, sha256-verified)
# + ffmpeg (from npm ffmpeg-static).
#
#   docker build -t ytdl .
#   docker run -d --name ytdl --restart unless-stopped -p 127.0.0.1:3000:3000 \
#     --env-file .env -v "$PWD/cookies.txt:/app/cookies.txt:ro" ytdl
FROM node:22-slim

# ca-certificates: HTTPS to YouTube. tini: forwards signals and reaps the
# yt-dlp/ffmpeg child processes so none are left as zombies.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies + yt-dlp first (cached unless package*.json or the pin changes).
# YTDLP_STRICT=1 makes the build fail if the binary can't be downloaded/verified.
COPY package*.json ./
COPY scripts ./scripts
RUN SKIP_YTDLP_DOWNLOAD=1 npm ci --omit=dev --no-audit --no-fund \
    && YTDLP_STRICT=1 node scripts/fetch-ytdlp.js \
    && ./bin/yt-dlp --version

COPY . .

# Run as the unprivileged "node" user. bin/ stays writable so yt-dlp can
# update itself; downloads go to /tmp inside the container.
RUN chown -R node:node /app/bin
USER node

ENV NODE_ENV=production \
    PORT=3000 \
    JOBS_DIR=/tmp/ytdl-jobs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
