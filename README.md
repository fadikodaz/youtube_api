# YTPocket

A self-hosted YouTube video and MP3 downloader with a web UI, built on the
official [yt-dlp](https://github.com/yt-dlp/yt-dlp) and
[ffmpeg](https://ffmpeg.org/) (via `ffmpeg-static`). No third-party APIs, no
accounts, files never leave your server except to the user who asked for them.

## Features

- **Audio:** MP3 128 / 192 / 256 / 320 kbps (with title, artist and square
  cover art), or the original audio track without re-encoding (`.m4a`/`.webm`).
- **Video:** MP4 at every available resolution, 144p up to 4K / 60 fps, with
  codec and compatibility notes (H.264 plays everywhere).
- **Simple flow:** paste a link, tap **Get video**, pick MP4 or MP3 and a
  quality. That row becomes its own progress bar (percent, speed, time left)
  while the server prepares the file, then the file saves automatically. Tap
  again to cancel, retry or download again. A reload keeps the current video
  and any download in progress; nothing is kept as history.
- **Job queue:** identical requests share one job; finished files are kept 15
  minutes for re-download.
- **Installable app (PWA):** add it to your home screen; on Android, share a
  video from the YouTube app straight to YTPocket. Links like `/?url=...` or
  `/?v=VIDEO_ID` open a video directly.
- **Phone first:** big "tap to paste" area, bottom-sheet format list, inline
  preview, drag & drop, light (yellow) and dark themes following your device,
  keyboard and screen-reader friendly.
- **Resilient:** fallback YouTube clients, retries, friendly error messages,
  metadata caching, automatic yt-dlp updates.
- **Safe to expose:** strict input validation (only YouTube links), per-user
  and global limits, disk-space guard, CSP and security headers, admin token.

## Quick start (local)

Requires **Node.js 22.12+**.

```powershell
npm install        # also downloads + verifies bin/yt-dlp(.exe)
npm start          # http://localhost:3000
```

Port 3000 busy? `$env:PORT=3001; npm start` (PowerShell) or `PORT=3001 npm start`
(macOS/Linux), or put `PORT=3001` in a `.env` file.

Open the app through the server URL, not by opening `public/index.html` directly.

| Script                | What it does                                     |
| --------------------- | ------------------------------------------------ |
| `npm start`           | Run the server (loads `.env` if present)         |
| `npm run dev`         | Same, restarting automatically when files change |
| `npm run setup`       | Install the pinned yt-dlp if it is missing       |
| `npm run setup:force` | Re-download and re-verify yt-dlp                 |
| `npm run lint`        | ESLint                                           |
| `npm run format`      | Prettier                                         |
| `npm run check`       | Lint + formatting check (run before committing)  |

## Configuration

Copy `.env.example` to `.env` and uncomment what you need. Every setting is
documented there. The most important ones:

| Variable            | Default         | Purpose                                               |
| ------------------- | --------------- | ----------------------------------------------------- |
| `PORT` / `HOST`     | `3000` / all    | Where to listen. Use `HOST=127.0.0.1` behind nginx.   |
| `ADMIN_TOKEN`       | none            | Unlocks detailed health + manual yt-dlp update        |
| `AUTO_UPDATE_HOURS` | `24`            | Auto-update yt-dlp when idle (`0` = off)              |
| `COOKIES_FILE`      | `./cookies.txt` | Cookies from a spare YouTube account (bot checks)     |
| `YTDLP_PROXY`       | none            | Proxy for YouTube traffic (blocked IPs, region locks) |
| `TRUST_PROXY`       | `loopback`      | Which reverse proxy may report the real client IP     |
| `CORS_ORIGIN`       | none            | Other sites allowed to call the API                   |
| `JOBS_PER_IP`       | `3`             | Active downloads per user                             |
| `MAX_DURATION_SEC`  | `10800`         | Longest video allowed                                 |
| `MAX_FILE_MB`       | `2048`          | Largest file allowed                                  |

## API

All errors are JSON: `{ "error": "...", "code": "BOT_CHECK", "hint": "..." }`.

| Method   | Route                     | Description                                                         |
| -------- | ------------------------- | ------------------------------------------------------------------- |
| `GET`    | `/api/health`             | `{ ok }`; with admin token also versions, jobs, disk, memory        |
| `POST`   | `/api/info`               | `{ url }` → title, duration, thumbnail, audio + video options       |
| `POST`   | `/api/jobs`               | `{ url, format: "mp3"\|"audio"\|"video", quality?, height? }` → job |
| `GET`    | `/api/jobs/:id`           | Job progress: `status`, `percent`, `speed`, `eta`, `position`...    |
| `DELETE` | `/api/jobs/:id`           | Cancel                                                              |
| `GET`    | `/api/jobs/:id/file`      | The finished file (supports Range / resume)                         |
| `POST`   | `/api/admin/update-ytdlp` | Update yt-dlp now (`ALLOW_UPDATE=1` + `Authorization: Bearer ...`)  |

Job `status` goes `queued → downloading → processing → ready` (or `error` /
`cancelled`). Unpolled jobs are cancelled after 3 minutes.

## yt-dlp version and updates

- `npm install` downloads the version pinned in `scripts/ytdlp.lock.json` and
  checks its SHA-256 against the official release checksums. Another version:
  `YTDLP_VERSION=2026.11.01 npm run setup:force`.
- YouTube changes often and old versions stop working within weeks, so the
  running server updates yt-dlp every `AUTO_UPDATE_HOURS` (default 24) when no
  downloads are running. yt-dlp's own updater verifies what it downloads.

## "Sign in to confirm you're not a bot"

YouTube blocks many datacenter IPs (cloud servers, VPS). Options, cheapest first:

1. **Server on a residential connection** (home server, Raspberry Pi) usually
   just works.
2. **Cookies:** export cookies from a logged-in **spare** account to
   `cookies.txt` (Netscape format, e.g. the "Get cookies.txt LOCALLY" browser
   extension). Each yt-dlp run uses a private copy, so the file is never
   rewritten. The account may be banned if the server is abused.
3. **Proxy:** `YTDLP_PROXY=http://user:pass@host:port`, ideally a residential
   proxy. Also fixes region-locked videos.

## Deploy

### VPS (recommended)

On a fresh Ubuntu 22.04/24.04 or Debian 12 server with a domain pointing at it:

```bash
git clone <your-repo-url> ytdl && cd ytdl
sudo bash deploy/vps-setup.sh your-domain.com
sudo apt-get install -y certbot python3-certbot-nginx && sudo certbot --nginx -d your-domain.com
```

This installs Node 22, creates a dedicated `ytdl` user, puts the app in
`/opt/ytdl`, runs it with systemd on `127.0.0.1:3000` (restarts on crash, starts
on boot, hardened sandbox), puts nginx in front, and opens only SSH/HTTP/HTTPS.
A random `ADMIN_TOKEN` is written to `/opt/ytdl/.env`. Run the same script
again to deploy updates.

Logs: `journalctl -u ytdl -f`. Settings: `/opt/ytdl/.env`, then
`sudo systemctl restart ytdl`.

### Docker

```bash
docker build -t ytdl .
docker run -d --name ytdl --restart unless-stopped \
  -p 127.0.0.1:3000:3000 --env-file .env \
  -v "$PWD/cookies.txt:/app/cookies.txt:ro" ytdl
```

The image runs as a non-root user, uses the standalone yt-dlp build (verified
at build time), and has a health check. Behind nginx on the host, set
`TRUST_PROXY=uniquelocal` so users are told apart correctly.

### Serverless (Vercel, Netlify...)

Not supported: these platforms can't run long yt-dlp/ffmpeg processes and their
IPs are blocked by YouTube.

## Troubleshooting

| Symptom                               | Fix                                                                     |
| ------------------------------------- | ----------------------------------------------------------------------- |
| `Port 3000 is already in use`         | Another app uses it. Start with another `PORT`.                         |
| "Server offline" in the page          | The server isn't running, or yt-dlp/ffmpeg is missing (`npm run setup`) |
| `Sign in to confirm you're not a bot` | See the section above (cookies, proxy, residential IP).                 |
| Many videos suddenly fail             | yt-dlp is outdated: wait for the auto-update or `npm run setup:force`.  |
| `HTTP Error 403`                      | Retried automatically; if persistent, update yt-dlp or use a proxy.     |
| Everyone hits "too many downloads"    | `TRUST_PROXY` is wrong, so all users look like one IP.                  |

## Legal

For personal use with content you have the right to download. Respect
YouTube's Terms of Service and copyright law in your country.
