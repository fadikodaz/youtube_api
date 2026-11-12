# YT → MP3 (fast downloader UI)

A self-hosted YouTube audio downloader built on the official
[yt-dlp](https://github.com/yt-dlp/yt-dlp) binary + [ffmpeg](https://ffmpeg.org/)
(`ffmpeg-static`). No uploads, no third-party API keys.

## Features

- **Instant fetch** — auto-detects a pasted link and loads metadata in one request.
- **Video preview** — click the thumbnail to play the video inline (private embed).
- **Audio preview** — stream the audio before downloading (seekable via HTTP Range).
- **Audio:** MP3 128 / 192 / 256 / 320 kbps or original audio (`.m4a`).
- **Video:** MP4 at every available resolution (144p up to 4K, incl. 60fps).
  Progressive streams are proxied directly; adaptive ones are merged with ffmpeg.
- **Clean UI** — Audio/Video toggle, one format picker, real download progress.
- **Resilient backend** — automatic yt-dlp install, extractor-client fallbacks,
  retries, stale-URL refresh, friendly errors, caching, rate limiting.
- **Cookies & proxy support** for age-restricted / bot-checked videos.
- **Download history** (localStorage), paste button, drag & drop, keyboard shortcuts.

## Quick start

```powershell
npm install        # also downloads bin/yt-dlp(.exe) automatically
npm start
```

Open **http://localhost:3000** (do **not** open `public/index.html` with Live
Server — there is no backend on port 5500).

If `npm install` could not download the binary:

```powershell
npm run setup
# or manually:
# https://github.com/yt-dlp/yt-dlp/releases/latest
```

## API

| Method | Route | Description |
| --- | --- | --- |
| `GET` | `/api/health` | yt-dlp version, ffmpeg, cookies, uptime |
| `POST` | `/api/info` | body `{ "url": "..." }` → metadata |
| `GET` | `/api/stream?url=...` | inline audio (supports `Range`) |
| `GET` | `/api/download?url=...&format=mp3&quality=192` | MP3 stream |
| `GET` | `/api/download?url=...&format=original` | original audio stream |
| `GET` | `/api/download?url=...&format=video&height=720&fps=25` | MP4 video stream |
| `POST` | `/api/admin/update-ytdlp` | self-update (requires `ALLOW_UPDATE=1`) |

## Fixing "Sign in to confirm you're not a bot"

YouTube blocks datacenter IPs (Vercel, most cloud hosts). Two options:

1. **Cookies (easiest)** — export cookies from a logged-in YouTube session to
   `cookies.txt` in the project root (Netscape format, e.g. the “Get cookies.txt
   LOCALLY” extension). The file is auto-detected. You can also set
   `COOKIES_FILE=/path/to/cookies.txt`.
2. **Residential IP / VPS** — run the Docker image or `server.js` on a home
   server or a VPS whose IP YouTube does not flag.

For region-locked videos set a proxy:

```bash
YTDLP_PROXY=socks5://127.0.0.1:1080 npm start
```

## Configuration (environment)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `COOKIES_FILE` | `./cookies.txt` | Netscape cookie file |
| `YTDLP_PATH` | `./bin/yt-dlp[.exe]` | custom binary |
| `YTDLP_PROXY` | — | proxy URL passed to yt-dlp |
| `YTDLP_EXTRACTOR_ARGS` | — | override `youtube:` extractor args |
| `YTDLP_FORCE_IPV4` | — | set `1` to force IPv4 |
| `INFO_CACHE_MS` | `600000` | metadata cache TTL |
| `VIDEO_TIMEOUT_MS` | `900000` | max time to download/merge a video |
| `ALLOW_UPDATE` | — | set `1` to enable the update endpoint |
| `SKIP_YTDLP_DOWNLOAD` | — | set `1` to skip the postinstall download |

Keep yt-dlp fresh — YouTube changes often:

```powershell
.\bin\yt-dlp.exe -U     # or: npm run setup after deleting bin/
```

## Deploy

**Docker / VPS (recommended — full MP3 support):**

```bash
docker build -t ytmp3 .
docker run -d --name ytmp3 -p 3000:3000 -v "$PWD/cookies.txt:/app/cookies.txt:ro" ytmp3
```

Or use `deploy/vps-setup.sh` + the systemd unit in `deploy/`.

**Vercel (limited):** its serverless runtime cannot run the yt-dlp/ffmpeg
binaries, and its datacenter IPs hit YouTube's bot check. The `api/` folder is a
best-effort fallback only; use Docker/VPS for reliability.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Unexpected end of JSON input` | You opened the HTML via Live Server. Use `npm start` → `http://localhost:3000`. |
| `yt-dlp: MISSING` | `npm run setup` |
| `Sign in to confirm you're not a bot` | Add `cookies.txt` or move to a residential IP/VPS. |
| `HTTP Error 403` / stale stream | server retries automatically; otherwise update yt-dlp. |
| `ffmpeg is not installed` | `npm install` (installs `ffmpeg-static`), or use `format=original`. |
| Audio preview won't seek | upstream/CDN ignored Range; download instead. |

## Legal

For personal / fair-use only. Respect YouTube's Terms of Service and copyright.
