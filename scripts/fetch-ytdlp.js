#!/usr/bin/env node
// Downloads the official yt-dlp binary into ./bin if it is not there yet.
// Runs automatically after `npm install` (see package.json "postinstall").
// Skip with SKIP_YTDLP_DOWNLOAD=1.
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const IS_WIN = process.platform === 'win32';
const BIN_DIR = path.join(ROOT, 'bin');
const BIN = path.join(BIN_DIR, IS_WIN ? 'yt-dlp.exe' : 'yt-dlp');
const URL = IS_WIN
  ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
  : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

if (process.env.SKIP_YTDLP_DOWNLOAD === '1') {
  console.log('[yt-dlp] download skipped (SKIP_YTDLP_DOWNLOAD=1)');
  process.exit(0);
}

if (fs.existsSync(BIN)) {
  const mb = (fs.statSync(BIN).size / 1024 / 1024).toFixed(1);
  console.log(`[yt-dlp] already present (${mb} MB): ${BIN}`);
  process.exit(0);
}

function get(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 10) return reject(new Error('Too many redirects'));
    const mod = url.startsWith('http:') ? http : https;
    const req = mod.get(
      url,
      {
        headers: {
          'User-Agent': 'yt-mp3-setup/1.0',
          Accept: 'application/octet-stream',
        },
        timeout: 120000,
      },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, url).toString();
          return resolve(get(next, redirects + 1));
        }
        if (status !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${status} for ${url}`));
        }
        resolve(res);
      }
    );
    req.on('timeout', () => req.destroy(new Error('Download timed out')));
    req.on('error', reject);
  });
}

(async () => {
  try {
    fs.mkdirSync(BIN_DIR, { recursive: true });
    console.log('[yt-dlp] downloading official binary…');
    const res = await get(URL);
    const tmp = BIN + '.tmp';
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(tmp);
      res.pipe(out);
      out.on('finish', () => out.close(resolve));
      out.on('error', reject);
      res.on('error', reject);
    });
    const size = fs.statSync(tmp).size;
    if (size < 1024 * 1024) throw new Error(`Downloaded file is too small (${size} bytes)`);
    fs.renameSync(tmp, BIN);
    if (!IS_WIN) fs.chmodSync(BIN, 0o755);
    console.log(`[yt-dlp] installed (${(size / 1024 / 1024).toFixed(1)} MB): ${BIN}`);
  } catch (e) {
    console.warn('[yt-dlp] could not download the binary:', e.message);
    console.warn('[yt-dlp] the server will still start; run `npm run setup` later or install it manually:');
    console.warn('        https://github.com/yt-dlp/yt-dlp/releases/latest');
    process.exitCode = 0;
  }
})();
