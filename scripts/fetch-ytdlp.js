#!/usr/bin/env node
// Downloads the official yt-dlp binary into ./bin and verifies its SHA-256.
// Runs automatically after `npm install` (see package.json "postinstall").
//
//   npm run setup                 install the pinned version (scripts/ytdlp.lock.json)
//   npm run setup -- --force      re-download even if bin/ already has a binary
//   YTDLP_VERSION=2026.11.01      install another release; its checksum is taken
//                                 from that release's official SHA2-256SUMS file
//   SKIP_YTDLP_DOWNLOAD=1         skip entirely
//
// Standalone builds are used (yt-dlp.exe / yt-dlp_linux / yt-dlp_macos): they
// bundle Python and the YouTube challenge solver, so nothing else is needed.
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const IS_WIN = process.platform === 'win32';
const BIN_DIR = path.join(ROOT, 'bin');
const BIN = path.join(BIN_DIR, IS_WIN ? 'yt-dlp.exe' : 'yt-dlp');
const LOCK = require('./ytdlp.lock.json');
const FORCE = process.argv.includes('--force');

function assetName() {
  if (IS_WIN) return 'yt-dlp.exe';
  if (process.platform === 'darwin') return 'yt-dlp_macos';
  if (process.platform === 'linux') return process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
  throw new Error(`Unsupported platform ${process.platform}/${process.arch}`);
}

function get(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 10) return reject(new Error('Too many redirects'));
    if (!url.startsWith('https:')) return reject(new Error(`Refusing non-HTTPS URL ${url}`));
    const req = https.get(
      url,
      { headers: { 'User-Agent': 'ytdl-setup/2.0', Accept: 'application/octet-stream' }, timeout: 120000 },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return resolve(get(new URL(res.headers.location, url).toString(), redirects + 1));
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

async function getText(url) {
  const res = await get(url);
  const chunks = [];
  for await (const c of res) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

async function expectedHash(version, asset) {
  if (version === LOCK.version && LOCK.sha256[asset]) return LOCK.sha256[asset];
  const sums = await getText(`https://github.com/yt-dlp/yt-dlp/releases/download/${version}/SHA2-256SUMS`);
  const line = sums.split(/\r?\n/).find((l) => l.trim().endsWith(` ${asset}`));
  if (!line) throw new Error(`No checksum for ${asset} in release ${version}`);
  return line.trim().split(/\s+/)[0].toLowerCase();
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });
}

async function main() {
  if (process.env.SKIP_YTDLP_DOWNLOAD === '1') {
    console.log('[yt-dlp] download skipped (SKIP_YTDLP_DOWNLOAD=1)');
    return;
  }
  if (fs.existsSync(BIN) && !FORCE) {
    const mb = (fs.statSync(BIN).size / 1024 / 1024).toFixed(1);
    console.log(`[yt-dlp] already present (${mb} MB): ${BIN}  (use --force to reinstall)`);
    return;
  }

  const version = (process.env.YTDLP_VERSION || LOCK.version).trim();
  if (!/^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/.test(version)) throw new Error(`Bad YTDLP_VERSION "${version}"`);
  const asset = assetName();
  const want = await expectedHash(version, asset);

  fs.mkdirSync(BIN_DIR, { recursive: true });
  console.log(`[yt-dlp] downloading ${asset} ${version}…`);
  const res = await get(`https://github.com/yt-dlp/yt-dlp/releases/download/${version}/${asset}`);
  const tmp = BIN + '.tmp';
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(tmp);
    res.pipe(out);
    out.on('finish', () => out.close(resolve));
    out.on('error', reject);
    res.on('error', reject);
  });

  const got = await sha256File(tmp);
  if (got !== want) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`Checksum mismatch for ${asset} ${version}: expected ${want}, got ${got}`);
  }
  fs.renameSync(tmp, BIN);
  if (!IS_WIN) fs.chmodSync(BIN, 0o755);
  const mb = (fs.statSync(BIN).size / 1024 / 1024).toFixed(1);
  console.log(`[yt-dlp] installed ${version} (${mb} MB, sha256 verified): ${BIN}`);
}

main().catch((e) => {
  console.warn('[yt-dlp] could not install the binary:', e.message);
  console.warn('[yt-dlp] the server will still start; run `npm run setup` later.');
  // Strict mode (Docker builds) must fail loudly instead of shipping without yt-dlp.
  process.exitCode = process.env.YTDLP_STRICT === '1' ? 1 : 0;
});
