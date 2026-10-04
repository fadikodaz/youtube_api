FROM node:20-slim

# yt-dlp standalone needs ca-certificates + python is NOT needed, ffmpeg via npm
RUN apt-get update && apt-get install -y ca-certificates curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev

# fetch yt-dlp binary for linux
RUN mkdir -p bin && \
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o bin/yt-dlp && \
    chmod +x bin/yt-dlp

COPY . .

ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
