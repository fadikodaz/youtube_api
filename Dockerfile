FROM node:20-slim

# ca-certificates for HTTPS, curl to fetch yt-dlp, ffmpeg from npm (ffmpeg-static)
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first (postinstall download is skipped here; we fetch the Linux binary explicitly)
COPY package*.json ./
COPY scripts ./scripts
RUN SKIP_YTDLP_DOWNLOAD=1 npm install --omit=dev --no-audit --no-fund

# Official yt-dlp Linux binary
RUN mkdir -p bin \
    && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o bin/yt-dlp \
    && chmod +x bin/yt-dlp \
    && ./bin/yt-dlp --version

COPY . .

ENV PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
