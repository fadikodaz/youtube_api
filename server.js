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
const { fetchImage } = require('./lib/safefetch');
const { buildPages, pageForSite } = require('./lib/pages');

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
  thumbCache.prune();
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
  const run = async (fn) => {
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
  run.busy = () => active > 0 || waiting.length > 0;
  return run;
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
    if (!req.path.startsWith('/api/') || (req.method === 'GET' && /^\/api\/jobs\/[\w-]+(\/events)?$/.test(req.path))) {
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
// Security headers. The UI has no inline script or style and embeds nothing,
// so the CSP allows only files served by this app (plus YouTube thumbnails).
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  // Thumbnails come from each site's own image CDN (YouTube, TikTok, Facebook...).
  "img-src 'self' data: https:",
  "frame-src 'none'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
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
// ---------------------------------------------------------------- pages -----
// Downloader pages (YouTube home + one per platform), rendered once at start.
const site = buildPages();

// Absolute site address for canonical links and the sitemap. Set PUBLIC_URL
// in production (e.g. https://ytpocket.com); otherwise it is derived from the
// request, accepting only a plain host name so a forged Host header can't
// inject anything into the page.
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
function originOf(req) {
  if (PUBLIC_URL) return PUBLIC_URL;
  const host = String(req.get('host') || '');
  return /^[a-z0-9.-]+(:\d+)?$/i.test(host) ? `${req.protocol}://${host}` : '';
}

function sendPage(res, html, req, status = 200) {
  res.status(status);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(html.replaceAll('{{origin}}', originOf(req)));
}

for (const [p, html] of site.pages) app.get(p, (req, res) => sendPage(res, html, req));

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nDisallow: /api/\nSitemap: ${originOf(req)}/sitemap.xml\n`);
});

app.get('/sitemap.xml', (req, res) => {
  const origin = originOf(req);
  const urls = site.list.map((p) => `  <url><loc>${origin}${p.path}</loc></url>`).join('\n');
  res
    .type('application/xml')
    .send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
    );
});

// Static UI. Fonts and icons rarely change: cache for a week. Everything else
// (JS, CSS, manifest, service worker) is revalidated on each load, so an
// update reaches users immediately. Pages are served by the routes above.
app.use(
  express.static(path.join(__dirname, 'public'), {
    index: false,
    setHeaders(res, file) {
      if (/\.(woff2|png|svg)$/.test(file)) res.setHeader('Cache-Control', 'public, max-age=604800');
      else res.setHeader('Cache-Control', 'no-cache');
      if (file.endsWith('.webmanifest')) res.setHeader('Content-Type', 'application/manifest+json');
    },
  })
);

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
    case 'LOGIN_REQUIRED':
    case 'NO_VIDEO':
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
const PERMANENT = new Set(['PRIVATE', 'MEMBERS_ONLY', 'REMOVED', 'BAD_URL', 'LIVE', 'LOGIN_REQUIRED', 'NO_VIDEO']);

// "post_live" = stream just ended and is still being processed by YouTube;
// it can't be downloaded reliably yet.
const isLive = (data) => !!data.is_live || ['is_live', 'is_upcoming', 'post_live'].includes(data.live_status);

// Stable identity of a video across requests: the bare ID for YouTube (as
// before), "Extractor:id" for other sites so IDs from different sites can't
// collide.
function videoKey(data, parsed) {
  return parsed.site === 'YouTube' ? data.id || parsed.videoId : `${data.extractor_key || parsed.site}:${data.id}`;
}

// Video choices. Sites whose formats carry no height get one "Best" option.
function videoChoices(data) {
  const list = ytdlp.videoOptions(data);
  if (list.length) return list;
  const formats = Array.isArray(data.formats) ? data.formats : [];
  // Some sites (Facebook...) report no codec or size at all; a format then
  // counts as video if its container is a video one.
  const isVideoish = (f) =>
    f &&
    f.vcodec !== 'none' &&
    !!(
      f.vcodec ||
      f.width ||
      f.height ||
      (f.video_ext && f.video_ext !== 'none') ||
      ['mp4', 'webm', 'mov', 'mkv', 'flv'].includes(f.ext)
    );
  const videos = formats.filter(isVideoish);
  if (!videos.length) return [];
  const best = videos[videos.length - 1]; // yt-dlp lists worst -> best
  return [
    {
      id: 'video:0',
      kind: 'video',
      label: 'Best',
      height: 0,
      fps: 0,
      ext: 'mp4',
      codec: '',
      compat: '',
      needsMerge: false,
      estimatedSize: ytdlp.formatBytes(best, Number(data.duration) || 0),
    },
  ];
}

function buildInfo(data, parsed) {
  const url = parsed.url;
  let audio = null;
  try {
    audio = ytdlp.pickAudio(data);
  } catch {
    /* no audio-only track (common outside YouTube) */
  }
  const best = ytdlp.pickAudioSource(data);
  const duration = Number(data.duration) || 0;

  return {
    key: videoKey(data, parsed),
    site: parsed.site,
    page: pageForSite(parsed.site), // the downloader page that matches this video
    needsLogin: !!parsed.login,
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
    hasAudio: !!best,
    videoOptions: videoChoices(data),
    limits: {
      maxDurationSec: MAX_DURATION,
      maxFileBytes: jobs.maxFile,
    },
  };
}

// "Link not supported" error, naming the site when we recognise it.
function badUrl(input) {
  const name = ytdlp.unsupportedSite(input);
  return name
    ? ytdlp.err('BAD_URL', `${name} links aren't supported yet.`, ytdlp.ERRORS.BAD_URL.hint)
    : ytdlp.err('BAD_URL');
}

// Optional "cut a part": { start, end } in whole seconds. Returns null when
// absent; throws on nonsense. Checked against the real duration later.
function parseCut(body) {
  if (body?.start == null && body?.end == null) return null;
  const start = Math.floor(Number(body.start));
  const end = Math.floor(Number(body.end));
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end - start < 1) {
    throw ytdlp.err('FORMAT', 'Choose a start time before the end time.', 'The part must be at least 1 second long.');
  }
  return { start, end };
}

const fmtClock = (s) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}.${String(m).padStart(2, '0')}.${sec}` : `${m}.${sec}`;
};

// Turn a request into a job spec, validating everything up front.
async function buildSpec(body, ip) {
  const cut = parseCut(body);
  const cutKey = cut ? `|cut:${cut.start}-${cut.end}` : '';
  const parsed = ytdlp.normalizeInput(body?.url);
  if (!parsed) throw badUrl(body?.url);
  if (!ytdlp.hasBinary()) throw ytdlp.err('NO_BINARY');

  const raw = String(body?.format || 'mp3').toLowerCase();
  const kind = raw === 'video' ? 'video' : raw === 'audio' || raw === 'original' ? 'audio' : 'mp3';
  if ((kind === 'mp3' || kind === 'video') && !jobs.ffmpeg) {
    throw ytdlp.err('NO_BINARY', 'ffmpeg is not installed on this server.', 'Run npm install.');
  }

  // Per-user and queue limits first: they are free, extraction is not.
  const quality = QUALITIES.includes(Number(body?.quality)) ? Number(body.quality) : 192;
  // (For non-YouTube links the real ID is only known after extraction, so the
  // pre-check can't detect a shared job; it just applies the limits.)
  const hintId = parsed.videoId || parsed.url;
  const keyHint =
    (kind === 'video'
      ? `${hintId}|video|${Number(body?.height) || 0}`
      : kind === 'audio'
        ? `${hintId}|audio`
        : `${hintId}|mp3|${quality}`) + cutKey;
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

  if (cut) {
    if (cut.start >= duration) throw ytdlp.err('FORMAT', 'The start time is after the end of the video.');
    cut.end = Math.min(cut.end, Math.ceil(duration));
    if (cut.end - cut.start < 1) throw ytdlp.err('FORMAT', 'The part must be at least 1 second long.');
  }
  // Size estimates and progress totals shrink with the cut.
  const share = cut ? Math.min(1, (cut.end - cut.start) / duration) : 1;
  const scale = (n) => Math.round((Number(n) || 0) * share);

  const id = videoKey(data, parsed);
  const safe =
    ytdlp.sanitizeFilename(data.title, String(data.id || 'video')) +
    (cut ? ` (${fmtClock(cut.start)}-${fmtClock(cut.end)})` : '');
  const base = { url: parsed.url, videoId: id, title: data.title, info: data, duration, cut };
  const spec = buildFormatSpec(kind, body, data, { id, safe, base, duration, quality });
  spec.key += cutKey;
  spec.estimatedSize = scale(spec.estimatedSize);
  if (spec.downloadSize) spec.downloadSize = scale(spec.downloadSize);
  spec.parts = (spec.parts || []).map((p) => ({ ...p, size: scale(p.size) }));
  return spec;
}

function buildFormatSpec(kind, body, data, { id, safe, base, duration, quality }) {
  if (kind === 'video') {
    const height = Number(body?.height);
    if (!Number.isFinite(height) || height < 0) throw ytdlp.err('FORMAT', 'Choose a video quality.');
    if (height === 0) {
      // "Best": sites that don't list resolutions. yt-dlp picks the best.
      const est = videoChoices(data)[0]?.estimatedSize || 0;
      return {
        ...base,
        key: `${id}|video|best`,
        kind,
        selector: 'bv*+ba/b',
        parts: [],
        estimatedSize: est,
        baseName: safe,
        filename: `${safe}.mp4`,
      };
    }
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

  const src = ytdlp.pickAudioSource(data);
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
  if (!parsed) return sendError(res, badUrl(req.body?.url));
  if (!ytdlp.hasBinary()) return sendError(res, ytdlp.err('NO_BINARY'));
  try {
    const data = await getInfo(parsed.url);
    res.setHeader('Cache-Control', 'no-store');
    res.json(buildInfo(data, parsed));
    // Other sites' image links are signed and expire within minutes: fetch the
    // thumbnail now (in the background) so preview and download work later.
    if (parsed.site !== 'YouTube') getThumbnail(parsed.url, data).catch(() => {});
  } catch (e) {
    console.error('[info]', e.code || '', e.message);
    sendError(res, e);
  }
});

// Thumbnails, downloaded completely and kept for a while: { buffer, type, name }.
// Bounded by entry count; each image is at most 8 MB (typically ~150 KB).
const thumbCache = new TTLMap(env('THUMB_CACHE_MS', 10 * 60 * 1000), env('THUMB_CACHE_MAX', 60));
const thumbInflight = new Map();

// Best image first (JPG before WebP; YouTube's largest sizes often don't
// exist, so try the next one), through the SSRF-safe fetcher.
function getThumbnail(url, data) {
  const hit = thumbCache.get(url);
  if (hit) return Promise.resolve(hit);
  if (thumbInflight.has(url)) return thumbInflight.get(url);
  const p = (async () => {
    const list = (Array.isArray(data.thumbnails) ? data.thumbnails : []).filter((t) => t?.url).reverse();
    const isWebp = (t) => /\.webp(\?|$)/i.test(t.url);
    const candidates = [...list.filter((t) => !isWebp(t)), ...list.filter(isWebp)];
    if (!candidates.length && data.thumbnail) candidates.push({ url: data.thumbnail });
    for (const t of candidates.slice(0, 6)) {
      try {
        const img = await fetchImage(t.url);
        const ext = { 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' }[img.type];
        const name = `${ytdlp.sanitizeFilename(data.title, String(data.id || 'thumbnail'))} (thumbnail).${ext || 'jpg'}`;
        const entry = { buffer: img.buffer, type: img.type, name };
        thumbCache.set(url, entry);
        return entry;
      } catch {
        /* try the next size */
      }
    }
    throw ytdlp.err('UNAVAILABLE', 'No thumbnail is available for this video.', 'Try again in a moment.');
  })();
  thumbInflight.set(url, p);
  return p.finally(() => thumbInflight.delete(url));
}

// GET /api/thumbnail?url=<video link>  (&inline=1 to display instead of save).
// Always a complete image with an exact Content-Length, or a JSON error.
app.get('/api/thumbnail', rateLimit({ max: 60 }), async (req, res) => {
  const parsed = ytdlp.normalizeInput(String(req.query.url || ''));
  if (!parsed) return sendError(res, badUrl(req.query.url));
  try {
    const data = await getInfo(parsed.url);
    const img = await getThumbnail(parsed.url, data);
    res.setHeader('Content-Type', img.type);
    res.setHeader('Content-Length', img.buffer.length);
    // inline: shown in the page (other sites often block hotlinking, and this
    // way the visitor's browser never contacts their servers).
    res.setHeader(
      'Content-Disposition',
      contentDisposition(img.name, {
        type: req.query.inline ? 'inline' : 'attachment',
        fallback: asciiFallback(img.name),
      })
    );
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.end(img.buffer);
  } catch (e) {
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

// Live progress (Server-Sent Events): one long-lived response per job that
// receives a JSON job view whenever something changes, instead of the browser
// asking every 0.8 s. Updates are coalesced to at most ~4 per second. The
// stream ends when the job is ready/failed/gone; browsers without
// EventSource (or behind proxies that break it) fall back to polling.
const STREAMS_PER_IP = env('STREAMS_PER_IP', 8);
const streamsByIp = new Map();

app.get('/api/jobs/:id/events', pollLimit, (req, res) => {
  const first = jobs.get(req.params.id);
  if (!first) {
    return res
      .status(404)
      .json({ error: 'This download expired. Please start it again.', code: 'NOT_FOUND', hint: '' });
  }
  const ip = clientIp(req);
  const open = streamsByIp.get(ip) || 0;
  if (open >= STREAMS_PER_IP) {
    return res.status(429).json({ error: 'Too many open downloads.', code: 'RATE_LIMIT', hint: '' });
  }
  streamsByIp.set(ip, open + 1);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no', // nginx: don't buffer this response
    Connection: 'keep-alive',
  });

  const id = first.id;
  let last = '';
  let timer = null;
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    clearInterval(heartbeat);
    jobs.off('change', onChange);
    const left = (streamsByIp.get(ip) || 1) - 1;
    if (left > 0) streamsByIp.set(ip, left);
    else streamsByIp.delete(ip);
    res.end();
  };

  const send = () => {
    timer = null;
    if (closed) return;
    const job = jobs.get(id);
    if (!job) {
      res.write('event: gone\ndata: {}\n\n');
      return close();
    }
    jobs.touch(job); // an open stream counts as "still watching"
    const data = JSON.stringify(jobs.view(job));
    if (data !== last) {
      last = data;
      res.write(`data: ${data}\n\n`);
    }
    if (['ready', 'error', 'cancelled'].includes(job.status)) close();
  };

  const onChange = (job) => {
    if (job.id === id && !timer) timer = setTimeout(send, 250);
  };
  jobs.on('change', onChange);

  // Comment lines keep proxies from timing out an idle stream and keep the
  // job from being treated as abandoned while it waits in the queue.
  const heartbeat = setInterval(() => {
    const job = jobs.get(id);
    if (job) jobs.touch(job);
    res.write(': ping\n\n');
  }, 15000);

  req.on('close', close);
  send();
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
  res.sendFile(job.file, { headers: { 'Cache-Control': 'private, no-store' }, dotfiles: 'allow' }, (e) => {
    if (e && !res.headersSent) sendError(res, ytdlp.err('UNKNOWN', 'Could not send the file.'));
  });
});

// One yt-dlp update at a time; concurrent callers share the result.
// (yt-dlp's own updater downloads the official release and verifies it.)
let updating = null;
function updateYtdlp(reason) {
  if (!updating) {
    updating = (async () => {
      const before = await ytdlp.version().catch(() => null);
      const output = await ytdlp.update();
      const after = await ytdlp.version(true);
      infoCache.clear();
      failCache.clear();
      lastUpdateCheck = Date.now();
      console.log(`[update] ${reason}: yt-dlp ${before} -> ${after}`);
      return { output: output.slice(-4000), version: after, previous: before };
    })().finally(() => {
      updating = null;
    });
  }
  return updating;
}

// Automatic updates: YouTube changes often and old yt-dlp versions stop
// working within weeks. Every AUTO_UPDATE_HOURS (default 24, 0 = off) the
// server updates yt-dlp, but only while no download or extraction is running.
const AUTO_UPDATE_HOURS = (() => {
  const n = Number(process.env.AUTO_UPDATE_HOURS ?? 24);
  return Number.isFinite(n) && n >= 0 ? n : 24;
})();
// Start counting from when the binary was installed/updated, so a server that
// was off for a week updates shortly after it starts.
let lastUpdateCheck = (() => {
  try {
    return fs.statSync(ytdlp.binary()).mtimeMs;
  } catch {
    return Date.now();
  }
})();
if (AUTO_UPDATE_HOURS > 0) {
  setInterval(
    () => {
      if (Date.now() - lastUpdateCheck < AUTO_UPDATE_HOURS * 3600 * 1000) return;
      const s = jobs.stats();
      if (s.running || s.queued || extractLimit.busy() || !ytdlp.hasBinary()) return; // try again later
      lastUpdateCheck = Date.now();
      updateYtdlp('auto-update').catch((e) => console.warn('[update] auto-update failed:', e.code || '', e.message));
    },
    5 * 60 * 1000
  ).unref();
}

// Manual update. Needs ALLOW_UPDATE=1 AND a valid ADMIN_TOKEN.
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
    res.json({ ok: true, ...(await updateYtdlp('admin request')) });
  } catch (e) {
    sendError(res, e);
  }
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }));

// Anything else: a friendly "page not found" that still contains the tool.
app.use((req, res) => {
  if (req.method === 'GET' && req.accepts('html')) return sendPage(res, site.notFound, req, 404);
  res.status(404).type('text/plain').send('Not found');
});

// ---------------------------------------------------------------- start ------

// HOST=127.0.0.1 keeps the app private behind a reverse proxy (nginx, Caddy,
// Cloudflare Tunnel). Default: all interfaces.
const HOST = process.env.HOST || undefined;
const server = app.listen(PORT, HOST, (err) => {
  // Express 5 passes listen errors (e.g. EADDRINUSE) to this callback.
  if (err) {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Start on another port, e.g.:  $env:PORT=3001; npm start`);
    } else {
      console.error('Failed to start server:', err);
    }
    process.exit(1);
  }
  console.log(`YouTube downloader running at http://${HOST && HOST !== '0.0.0.0' ? HOST : 'localhost'}:${PORT}`);
  console.log('yt-dlp :', ytdlp.hasBinary() ? ytdlp.binary() : 'MISSING — run: npm run setup');
  console.log('ffmpeg :', jobs.ffmpeg || 'MISSING');
  console.log('cookies:', ytdlp.cookiesFile() ? 'configured' : 'none (public videos only)');
  console.log('jobs   :', jobs.dir);
  console.log('admin  :', ADMIN_TOKEN ? 'enabled (ADMIN_TOKEN set)' : 'disabled');
  if (!corsOrigins.length) console.log('cors   : same-origin only');
  console.log(
    'update :',
    AUTO_UPDATE_HOURS > 0 ? `yt-dlp auto-update every ${AUTO_UPDATE_HOURS}h when idle` : 'auto-update off'
  );
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
  // A closed log pipe (EPIPE) is not a reason to stop serving users.
  if (e && e.code === 'EPIPE') return;
  console.error('[uncaughtException]', e);
  shutdown('uncaughtException', 1);
});
// Writing a log line to a closed terminal/pipe must never crash the server.
for (const s of [process.stdout, process.stderr]) s.on('error', () => {});
