# YT to MP3 Downloader

Simple YouTube MP3 downloader with a frontend link input.

## GitHub libraries used
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — YouTube info + audio stream (standalone `bin/yt-dlp.exe`, no Python needed)
- [ffmpeg](https://github.com/ffmpeg/ffmpeg) via `ffmpeg-static` npm — converts to 192kbps MP3 (no manual ffmpeg install needed on Windows)

## Deploy for free on Vercel (serverless version)
`api/` uses pure-`fetch` InnerTube calls (no binaries), so it fits Vercel's free tier.
Note: serverless has no ffmpeg, so downloads come as original YouTube audio
(`.m4a`, plays on iPhone/Android/Windows) instead of converted MP3.
The VPS/local `server.js` path still gives real 192kbps MP3.
```bash
git push  # push this folder to GitHub
# vercel.com -> Add New Project -> import repo -> Deploy (zero config)
```
Open `https://YOUR-APP.vercel.app`, paste a link → Fetch → Download.

## Local / VPS (real MP3)
```powershell
npm install
# download yt-dlp.exe into bin/ (already done, ~18MB, git-ignored):
# https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe
npm start
```
Open http://localhost:3000, paste a YouTube link → Fetch → Download MP3.

## API
- `POST /api/info { url }` → `{ title, author, lengthSeconds, thumbnail }`
- `GET /api/download?url=...` → streams `*.mp3`

> For personal / fair-use only. Respect YouTube ToS and copyright.
