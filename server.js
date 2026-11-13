// YouTube downloader backend (local / VPS / Docker).
// Built on the official yt-dlp binary + ffmpeg-static.
//   yt-dlp : https://github.com/yt-dlp/yt-dlp
//   ffmpeg : https://github.com/ffmpeg/ffmpeg (via npm ffmpeg-static)
//
// Endpoints:
//   GET    /api/health
//   POST   /api/info               { url }                 -> metadata + formats
//   POST   /api/jobs               { url, format, quality, height }
//   GET    /api/jobs/:id                                   -> progress
//   DELETE /api/jobs/:id                                   -> cancel
//   GET    /api/jobs/:id/file                              -> finished file (Range ok)
//   POST   /api/admin/update-ytdlp                         (ALLOW_UPDATE=1 + Bearer ADMIN_TOKEN)
const express = require('express');
const cors = require('cors');
const contentDisposition = require('content-disposition');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const ffmpegPath = require('ffmpeg-static');
const ytdlp = require('./lib/ytdlp');
const { TTLMap } = require('./lib/cache');
const { JobManager } = require('./lib/jobs');

const env = (name, def) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : def;
};

const PORT = env('PORT', 3000);
const QUALITIES = [128, 192, 256, 320];
const MAX_DURATION = env('MAX_DURATION_SEC', 3 * 60 * 60);
const INFO_TTL = env('INFO_CACHE_MS', 10 * 60 * 1000);
const infoCache = new TTLMap(INFO_TTL, env('INFO_CACHE_MAX', 150));
setInterval(() => {
  infoCache.prune();
  failCache.prune();
}, 60 * 1000).unref();
const inflightInfo = new Map();

const jobs = new JobManager({
  // Port in the default name so two instances on one machine never share
  // (and clean up) each other's files.
  dir: process.env.JOBS_DIR || path.join(os.tmpdir(), `ytdl-jobs-${PORT}`),
  ffmpeg: ffmpegPath && fs.existsSync(ffmpegPath) ? ffmpegPath : null,
  concurrency: env('JOB_CONCURRENCY', 2),
  maxQueue: env('JOB_MAX_QUEUE', 30),
  perIp: env('JOBS_PER_IP', 3),
  readyTtl: env('JOB_TTL_MS', 15 * 60 * 1000),
  timeoutMs: env('JOB_TIMEOUT_MS', 30 * 60 * 1000),
  maxFileBytes: env('MAX_FILE_MB', 2048) * 1024 * 1024,
  maxDiskBytes: env('MAX_DISK_MB', 5120) * 1024 * 1024,
  minFreeBytes: env('MIN_FREE_DISK_MB', 1024) * 1024 * 1024,
});
jobs.init();

// Limit concurrent metadata extractions (each one is a 50-150 MB yt-dlp
// process). Extra requests wait in a short queue; beyond that we answer BUSY.
const extractLimit = semaphore(env('EXTRACT_CONCURRENCY', 4), env('EXTRACT_QUEUE', 40));

// Short-lived cache of permanent failures (private/removed video...) so a dead
// link does not trigger a fresh extraction on every click.
const failCache = new TTLMap(60 * 1000, 500);

function semaphore(max, maxWaiting) {
  let active = 0;
  const waiting = [];
  const release = () => {
    active -= 1;
    const next = waiting.shift();
    if (next) {
      active += 1;
      next();
    }
  };
  return async (fn) => {
    if (active >= max) {
      if (waiting.length >= maxWaiting) throw ytdlp.err('BUSY');
      await new Promise((resolve) => waiting.push(resolve));
    } else {
      active += 1;
    }
    try {
      return await fn();
    } finally {
      release();
    }
  };
}

const app = express();
app.disable('x-powered-by');

// Only trust X-Forwarded-For from a proxy on this machine (Nginx, Cloudflare
// Tunnel). Anything else could fake its IP to dodge the limits.
// Override with TRUST_PROXY (e.g. "1" for one hop, or a subnet list).
const trust = process.env.TRUST_PROXY;
app.set('trust proxy', trust === undefined ? 'loopback' : /^\d+$/.test(trust) ? Number(trust) : trust);

// The bundled UI is same-origin and needs no CORS. Only allow other sites
// (e.g. a separate frontend or mobile app) that are listed in CORS_ORIGIN,
// comma-separated. "*" allows everyone (not recommended: anyone could use
// this server's bandwidth from their own site).
const corsOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (corsOrigins.length) {
  const corsMw = cors({
    origin: corsOrigins.includes('*') ? '*' : corsOrigins,
    exposedHeaders: ['Content-Disposition', 'Content-Length'],
  });
  app.use((req, res, next) =>
    req.path.startsWith('/api/') && !req.path.startsWith('/api/admin/') ? corsMw(req, res, next) : next()
  );
}
app.use(express.json({ limit: '16kb' }));

// Access log (skips static files and progress polling). LOG_REQUESTS=0 to disable.
if (process.env.LOG_REQUESTS !== '0') {
  app.use((req, res, next) => {
    if (!req.path.startsWith('/api/') || (req.method === 'GET' && /^\/api\/jobs\/[\w-]+$/.test(req.path))) {
      return next();
    }
    const t = Date.now();
    res.on('finish', () => {
      console.log(
        `${new Date().toISOString()} ${req.ip} ${req.method} ${req.path} ${res.statusCode} ${Date.now() - t}ms`
      );
    });
    next();
  });
}
// Security headers. 'unsafe-inline' is needed while the UI keeps its script
// and styles inline in index.html.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://i.ytimg.com https://*.ytimg.com https://*.ggpht.com https://*.googleusercontent.com",
  'frame-src https://www.youtube-nocookie.com https://www.youtube.com',
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// ---------------------------------------------------------------- helpers ---

const clientIp = (req) => req.ip || req.socket?.remoteAddress || 'anon';

function asciiFallback(name) {
  const ext = path.extname(name);
  const stem = name
    .slice(0, name.length - ext.length)
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/["\\%]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[\s\-|.]+$/, '')
    .trim();
  return (stem || 'download') + ext;
}

function rateLimit({ windowMs = 60000, max = 60 } = {}) {
  const hits = new Map();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
  }, windowMs);
  sweep.unref?.();
  return (req, res, next) => {
    const key = clientIp(req);
    const now = Date.now();
    let e = hits.get(key);
    if (!e || now > e.reset) {
      e = { count: 0, reset: now + windowMs };
      hits.set(key, e);
    }
    e.count += 1;
    if (e.count > max) {
      res.setHeader('Retry-After', Math.ceil((e.reset - now) / 1000));
      return res.status(429).json({
        error: 'Too many requests. Please wait a moment and try again.',
        code: 'RATE_LIMIT',
        hint: 'Slow down a little.',
      });
    }
    next();
  };
}

function statusForCode(code) {
  switch (code) {
    case 'BAD_URL':
    case 'LIVE':
      return 400;
    case 'NOT_FOUND':
      return 404;
    case 'TOO_LARGE':
      return 413;
    case 'RATE_LIMIT':
    case 'LIMIT':
      return 429;
    case 'NO_BINARY':
    case 'BUSY':
      return 503;
    case 'PRIVATE':
    case 'MEMBERS_ONLY':
    case 'AGE_RESTRICTED':
    case 'GEO_BLOCKED':
    case 'UNAVAILABLE':
    case 'REMOVED':
    case 'FORMAT':
    case 'TOO_LONG':
      return 422;
    case 'BOT_CHECK':
    case 'FORBIDDEN':
    case 'NETWORK':
    case 'PARSE':
      return 502;
    case 'TIMEOUT':
      return 504;
    case 'CANCELLED':
      return 409;
    case 'UNAUTHORIZED':
      return 401;
    default:
      return 500;
  }
}

function sendError(res, err) {
  if (res.headersSent) {
    try {
      res.end();
    } catch {
      /* ignore */
    }
    return;
  }
  const code = err?.code || 'UNKNOWN';
  const meta = ytdlp.ERRORS[code] || ytdlp.ERRORS.UNKNOWN;
  if (code === 'BUSY' || code === 'LIMIT') res.setHeader('Retry-After', '30');
  res.status(statusForCode(code)).json({
    error: err?.message || meta.msg,
    code,
    hint: err?.hint ?? meta.hint,
  });
}

// Metadata with caching + request coalescing (10 users pasting the same link
// trigger one extraction).
async function getInfo(url) {
  const cached = infoCache.get(url);
  if (cached) return cached;
  const failed = failCache.get(url);
  if (failed) throw failed;
  if (inflightInfo.has(url)) return inflightInfo.get(url);
  const p = (async () => {
    try {
      const data = await extractLimit(() => ytdlp.dumpJson(url));
      if (!data || data._type === 'playlist') {
        throw new ytdlp.YtdlpError(
          'Playlists are not supported. Paste a single video link.',
          'BAD_URL',
          'Paste one video URL.'
        );
      }
      infoCache.set(url, data);
      return data;
    } catch (e) {
      if (PERMANENT.has(e.code)) failCache.set(url, e);
      throw e;
    }
  })();
  inflightInfo.set(url, p);
  try {
    return await p;
  } finally {
    inflightInfo.delete(url);
  }
}

function bestThumb(data) {
  const list = Array.isArray(data.thumbnails) ? data.thumbnails : [];
  let best = null;
  let bestArea = -1;
  for (const t of list) {
    const area = (Number(t.width) || 0) * (Number(t.height) || 0);
    if (area >= bestArea && t.url && !/\.webp(\?|$)/i.test(t.url)) {
      best = t;
      bestArea = area;
    }
  }
  return best?.url || data.thumbnail || '';
}

// Errors that will not change if the same link is tried again a minute later.
const PERMANENT = new Set(['PRIVATE', 'MEMBERS_ONLY', 'REMOVED', 'BAD_URL', 'LIVE']);

// "post_live" = stream just ended and is still being processed by YouTube;
// it can't be downloaded reliably yet.
const isLive = (data) =>
  !!data.is_live || ['is_live', 'is_upcoming', 'post_live'].includes(data.live_status);

function buildInfo(data, url) {
  let audio = null;
  try {
    audio = ytdlp.pickAudio(data);
  } catch {
    /* no audio */
  }
  const best = ytdlp.pickBestAudio(data);
  const duration = Number(data.duration) || 0;

  return {
    videoId: data.id,
    url: data.webpage_url || url,
    title: data.title || 'Unknown title',
    author: data.uploader || data.channel || 'Unknown',
    channelUrl: data.channel_url || data.uploader_url || null,
    lengthSeconds: duration,
    views: Number(data.view_count) || 0,
    uploadDate: data.upload_date || null,
    thumbnail: bestThumb(data),
    isLive: isLive(data),
    tooLong: duration > MAX_DURATION,
    maxAudioBitrate: best ? ytdlp.audioBitrate(best) : 0,
    qualities: QUALITIES,
    sourceExt: audio?.ext || null,
    sourceBitrate: audio ? ytdlp.audioBitrate(audio) : 0,
    sourceSize: audio ? ytdlp.formatBytes(audio, duration) : 0,
    estimatedSizes: Object.fromEntries(QUALITIES.map((q) => [q, ytdlp.estimateSize(duration, q)])),
    videoOptions: ytdlp.videoOptions(data),
    limits: {
      maxDurationSec: MAX_DURATION,
      maxFileBytes: jobs.maxFile,
    },
  };
}

// Turn a request into a job spec, validating everything up front.
async function buildSpec(body, ip) {
  const parsed = ytdlp.normalizeInput(body?.url);
  if (!parsed) throw ytdlp.err('BAD_URL');
  if (!ytdlp.hasBinary()) throw ytdlp.err('NO_BINARY');

  const raw = String(body?.format || 'mp3').toLowerCase();
  const kind = raw === 'video' ? 'video' : raw === 'audio' || raw === 'original' ? 'audio' : 'mp3';
  if ((kind === 'mp3' || kind === 'video') && !jobs.ffmpeg) {
    throw ytdlp.err('NO_BINARY', 'ffmpeg is not installed on this server.', 'Run npm install.');
  }

  // Per-user and queue limits first: they are free, extraction is not.
  const quality = QUALITIES.includes(Number(body?.quality)) ? Number(body.quality) : 192;
  const keyHint =
    kind === 'video'
      ? `${parsed.videoId}|video|${Number(body?.height) || 0}`
      : kind === 'audio'
        ? `${parsed.videoId}|audio`
        : `${parsed.videoId}|mp3|${quality}`;
  jobs.precheck(ip, keyHint);

  const data = await getInfo(parsed.url);
  if (isLive(data)) throw ytdlp.err('LIVE');
  const duration = Number(data.duration) || 0;
  if (!duration) {
    throw ytdlp.err('TOO_LONG', "This video's length is unknown, so it can't be downloaded here.");
  }
  if (duration > MAX_DURATION) {
    const hours = Math.round((MAX_DURATION / 3600) * 10) / 10;
    throw ytdlp.err('TOO_LONG', `Videos longer than ${hours} hours can't be downloaded here.`);
  }

  const id = data.id || parsed.videoId;
  const safe = ytdlp.sanitizeFilename(data.title, id);
  const base = { url: parsed.url, videoId: id, title: data.title, info: data, duration };

  if (kind === 'video') {
    const height = Number(body?.height);
    if (!height) throw ytdlp.err('FORMAT', 'Choose a video quality.');
    const picked = ytdlp.pickVideoFormat(data, height);
    if (!picked) throw ytdlp.err('FORMAT', 'That video quality is not available.');
    const label = `${picked.height}p${picked.fps >= 50 ? picked.fps : ''}`;
    return {
      ...base,
      key: `${id}|video|${picked.height}`,
      kind,
      selector: picked.selector,
      parts: picked.parts,
      estimatedSize: picked.estimatedSize,
      baseName: `${safe} (${label})`,
      filename: `${safe} (${label}).mp4`,
    };
  }

  if (kind === 'audio') {
    const audio = ytdlp.pickAudio(data);
    const size = ytdlp.formatBytes(audio, duration);
    return {
      ...base,
      key: `${id}|audio`,
      kind,
      audioExt: audio.ext,
      parts: [{ id: String(audio.format_id), size }],
      estimatedSize: size,
      baseName: safe,
      filename: `${safe}.${audio.ext || 'm4a'}`,
    };
  }

  const src = ytdlp.pickBestAudio(data);
  if (!src) throw ytdlp.err('UNAVAILABLE', 'No audio track found for this video.');
  const srcSize = ytdlp.formatBytes(src, duration);
  return {
    ...base,
    key: `${id}|mp3|${quality}`,
    kind,
    quality,
    parts: [{ id: String(src.format_id), size: srcSize }],
    downloadSize: srcSize,
    estimatedSize: srcSize + ytdlp.estimateSize(duration, quality),
    baseName: safe,
    filename: `${safe}.mp3`,
  };
}

// ---------------------------------------------------------------- routes -----

// Admin auth: requests must send "Authorization: Bearer <ADMIN_TOKEN>".
// With no ADMIN_TOKEN set, admin features are simply off.
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
if (ADMIN_TOKEN && ADMIN_TOKEN.length < 16) {
  console.warn('[security] ADMIN_TOKEN is shorter than 16 characters. Use a long random value.');
}

function isAdmin(req) {
  if (!ADMIN_TOKEN) return false;
  const m = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || '');
  if (!m) return false;
  const a = crypto.createHash('sha256').update(m[1].trim()).digest();
  const b = crypto.createHash('sha256').update(ADMIN_TOKEN).digest();
  return crypto.timingSafeEqual(a, b);
}

// Public health is a simple yes/no (used by the UI and Docker/uptime checks).
// Details (paths, versions, job stats) are only shown to the admin.
app.get('/api/health', rateLimit({ max: 120 }), async (req, res) => {
  const found = ytdlp.hasBinary();
  let ver = null;
  if (found) {
    try {
      ver = await ytdlp.version();
    } catch {
      /* ignore */
    }
  }
  const ok = found && !!ver && !!jobs.ffmpeg;
  res.setHeader('Cache-Control', 'no-store');
  if (!isAdmin(req)) return res.status(ok ? 200 : 503).json({ ok });
  res.json({
    ok,
    ytdlp: { found, version: ver, path: ytdlp.binary() },
    ffmpeg: { found: !!jobs.ffmpeg, path: jobs.ffmpeg },
    cookies: { configured: !!ytdlp.cookiesFile() },
    proxy: !!process.env.YTDLP_PROXY,
    jobs: { ...jobs.stats(), freeDiskBytes: jobs.freeBytes() },
    memory: { rssBytes: process.memoryUsage().rss, infoCacheEntries: infoCache.size },
    uptime: Math.round(process.uptime()),
  });
});

app.post('/api/info', rateLimit({ max: 40 }), async (req, res) => {
  const parsed = ytdlp.normalizeInput(req.body?.url);
  if (!parsed) return sendError(res, ytdlp.err('BAD_URL'));
  if (!ytdlp.hasBinary()) return sendError(res, ytdlp.err('NO_BINARY'));
  try {
    const data = await getInfo(parsed.url);
    res.setHeader('Cache-Control', 'no-store');
    res.json(buildInfo(data, parsed.url));
  } catch (e) {
    console.error('[info]', e.code || '', e.message);
    sendError(res, e);
  }
});

app.post('/api/jobs', rateLimit({ max: 20 }), async (req, res) => {
  try {
    const ip = clientIp(req);
    const spec = await buildSpec(req.body, ip);
    const job = jobs.create(spec, ip);
    res.setHeader('Cache-Control', 'no-store');
    res.status(202).json(jobs.view(job));
  } catch (e) {
    if (!['LIMIT', 'BUSY', 'TOO_LARGE', 'TOO_LONG', 'BAD_URL'].includes(e.code)) {
      console.error('[jobs:create]', e.code || '', e.message);
    }
    sendError(res, e);
  }
});

const pollLimit = rateLimit({ max: 400 });

app.get('/api/jobs/:id', pollLimit, (req, res) => {
  const job = jobs.get(req.params.id);
  res.setHeader('Cache-Control', 'no-store');
  if (!job) {
    return res.status(404).json({
      error: 'This download expired. Please start it again.',
      code: 'NOT_FOUND',
      hint: '',
    });
  }
  jobs.touch(job);
  res.json(jobs.view(job));
});

app.delete('/api/jobs/:id', pollLimit, (req, res) => {
  const job = jobs.get(req.params.id);
  if (job) jobs.cancel(job, clientIp(req));
  res.status(204).end();
});

app.get('/api/jobs/:id/file', rateLimit({ max: 60 }), (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.status !== 'ready' || !jobs.fileExists(job)) {
    return res.status(404).json({
      error: job ? 'This file is not ready yet.' : 'This download expired. Please start it again.',
      code: 'NOT_FOUND',
      hint: '',
    });
  }
  jobs.openStream(job);
  res.once('close', () => jobs.closeStream(job));
  // filename* carries the real (Unicode) name; the plain filename is a readable
  // ASCII fallback for very old clients. sendFile adds Content-Length,
  // Range/HEAD support and ETag.
  const name = job.spec.filename;
  res.setHeader('Content-Disposition', contentDisposition(name, { fallback: asciiFallback(name) }));
  res.sendFile(
    job.file,
    { headers: { 'Cache-Control': 'private, no-store' }, dotfiles: 'allow' },
    (e) => {
      if (e && !res.headersSent) sendError(res, ytdlp.err('UNKNOWN', 'Could not send the file.'));
    }
  );
});

// Self-update yt-dlp. Needs ALLOW_UPDATE=1 AND a valid ADMIN_TOKEN.
// Only one update runs at a time; concurrent calls share its result.
let updating = null;
app.post('/api/admin/update-ytdlp', rateLimit({ max: 5 }), async (req, res) => {
  if (process.env.ALLOW_UPDATE !== '1' || !ADMIN_TOKEN) {
    return res.status(403).json({
      error: 'Updating is disabled.',
      code: 'FORBIDDEN',
      hint: 'Set ALLOW_UPDATE=1 and ADMIN_TOKEN in the environment to enable this endpoint.',
    });
  }
  if (!isAdmin(req)) {
    return res.status(401).json({ error: 'Not authorized.', code: 'UNAUTHORIZED', hint: '' });
  }
  try {
    if (!updating) {
      updating = (async () => {
        const output = await ytdlp.update();
        infoCache.clear();
        failCache.clear();
        return { output: output.slice(-4000), version: await ytdlp.version(true) };
      })().finally(() => {
        updating = null;
      });
    }
    res.json({ ok: true, ...(await updating) });
  } catch (e) {
    sendError(res, e);
  }
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }));

// ---------------------------------------------------------------- start ------

const server = app.listen(PORT, (err) => {
  // Express 5 passes listen errors (e.g. EADDRINUSE) to this callback.
  if (err) {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Start on another port, e.g.:  $env:PORT=3001; npm start`);
    } else {
      console.error('Failed to start server:', err);
    }
    process.exit(1);
  }
  console.log(`YouTube downloader running at http://localhost:${PORT}`);
  console.log('yt-dlp :', ytdlp.hasBinary() ? ytdlp.binary() : 'MISSING — run: npm run setup');
  console.log('ffmpeg :', jobs.ffmpeg || 'MISSING');
  console.log('cookies:', ytdlp.cookiesFile() ? 'configured' : 'none (public videos only)');
  console.log('jobs   :', jobs.dir);
  console.log('admin  :', ADMIN_TOKEN ? 'enabled (ADMIN_TOKEN set)' : 'disabled');
  if (!corsOrigins.length) console.log('cors   : same-origin only');
});

// Stop cleanly: refuse new connections, cancel running downloads (killing
// their yt-dlp/ffmpeg processes), then exit. A process manager (pm2, systemd,
// Docker) restarts the app when the exit code is non-zero.
let stopping = false;
function shutdown(reason, code = 0) {
  if (stopping) return;
  stopping = true;
  console.log(`\n${reason}: stopping…`);
  try {
    jobs.shutdown();
  } catch (e) {
    console.error('[shutdown]', e);
  }
  server.close(() => process.exit(code));
  server.closeIdleConnections?.();
  setTimeout(() => {
    server.closeAllConnections?.();
    process.exit(code);
  }, 3000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
// After an unexpected exception the app state can't be trusted: exit and let
// the process manager start a fresh copy instead of limping along.
process.on('uncaughtException', (e) => {
  console.error('[uncaughtException]', e);
  shutdown('uncaughtException', 1);
});
