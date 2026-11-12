// YT -> MP3 backend (local / VPS / Docker).
// Built on the official yt-dlp binary + ffmpeg-static.
//   yt-dlp : https://github.com/yt-dlp/yt-dlp
//   ffmpeg : https://github.com/ffmpeg/ffmpeg (via npm ffmpeg-static)
//
// Endpoints:
//   GET  /api/health
//   POST /api/info      { url }
//   GET  /api/stream    ?url=            inline audio (range/seek support)
//   GET  /api/download  ?url=&format=mp3|original&quality=128|192|256|320
//   POST /api/admin/update-ytdlp         (only when ALLOW_UPDATE=1)
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { Readable } = require('stream');
const ffmpegPath = require('ffmpeg-static');
const ytdlp = require('./lib/ytdlp');
const { TTLMap } = require('./lib/cache');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const QUALITIES = [128, 192, 256, 320];
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const INFO_TTL = Number(process.env.INFO_CACHE_MS) || 10 * 60 * 1000;
const infoCache = new TTLMap(INFO_TTL, 300);

app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(
  cors({
    exposedHeaders: ['Content-Disposition', 'X-Estimated-Size', 'Content-Length', 'X-Quality'],
  })
);
app.use(express.json({ limit: '16kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// ---------------------------------------------------------------- helpers ---

function rateLimit({ windowMs = 60000, max = 60 } = {}) {
  const hits = new Map();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
  }, windowMs);
  sweep.unref?.();
  return (req, res, next) => {
    const key = req.ip || req.socket?.remoteAddress || 'anon';
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
    case 'NO_BINARY':
      return 503;
    case 'RATE_LIMIT':
      return 429;
    case 'PRIVATE':
    case 'MEMBERS_ONLY':
    case 'AGE_RESTRICTED':
    case 'GEO_BLOCKED':
    case 'UNAVAILABLE':
    case 'REMOVED':
    case 'FORMAT':
      return 422;
    case 'BOT_CHECK':
    case 'FORBIDDEN':
    case 'NETWORK':
    case 'PARSE':
      return 502;
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
  res.status(statusForCode(code)).json({
    error: err?.message || meta.msg,
    code,
    hint: err?.hint || meta.hint,
  });
}

async function getInfo(url) {
  const cached = infoCache.get(url);
  if (cached) return cached;
  const data = await ytdlp.dumpJson(url);
  if (!data || data._type === 'playlist') {
    throw new ytdlp.YtdlpError(
      'Playlists are not supported. Paste a single video link.',
      'BAD_URL',
      'Paste one video URL.'
    );
  }
  infoCache.set(url, data);
  return data;
}

async function getAudio(url, { refresh = false } = {}) {
  if (refresh) infoCache.delete(url);
  const data = await getInfo(url);
  const audio = ytdlp.pickAudio(data);
  return { data, audio };
}

function bestThumb(data) {
  const list = Array.isArray(data.thumbnails) ? data.thumbnails : [];
  let best = null;
  let bestArea = -1;
  for (const t of list) {
    const area = (Number(t.width) || 0) * (Number(t.height) || 0);
    if (area >= bestArea && t.url) {
      best = t;
      bestArea = area;
    }
  }
  return best?.url || data.thumbnail || '';
}

function buildInfo(data, url) {
  const audio = (() => {
    try {
      return ytdlp.pickAudio(data);
    } catch {
      return null;
    }
  })();

  const maxAbr = (data.formats || [])
    .filter((f) => f && f.acodec && f.acodec !== 'none')
    .reduce((m, f) => Math.max(m, Math.round(f.abr || f.tbr || 0)), 0);

  return {
    videoId: data.id,
    url: data.webpage_url || url,
    title: data.title || 'Unknown title',
    author: data.uploader || data.channel || 'Unknown',
    channelUrl: data.channel_url || data.uploader_url || null,
    lengthSeconds: Number(data.duration) || 0,
    views: Number(data.view_count) || 0,
    uploadDate: data.upload_date || null,
    thumbnail: bestThumb(data),
    isLive: !!data.is_live,
    description: String(data.description || '').slice(0, 400),
    maxAudioBitrate: maxAbr,
    qualities: QUALITIES,
    sourceExt: audio?.ext || null,
    sourceSize: audio?.filesize || audio?.filesize_approx || 0,
    estimatedSizes: Object.fromEntries(
      QUALITIES.map((q) => [q, ytdlp.estimateSize(data.duration, q)])
    ),
    videoOptions: ytdlp.videoOptions(data),
  };
}

function sendDownloadHeaders(res, job, { quality } = {}) {
  res.status(200);
  res.setHeader('Content-Type', job.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${job.filename}"`);
  if (job.estimatedSize) res.setHeader('X-Estimated-Size', String(job.estimatedSize));
  if (quality) res.setHeader('X-Quality', String(quality));
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
}

// Resolve everything needed to start a download, without transferring media.
// Shared by the check endpoint and the real download route.
async function resolveDownload(req) {
  const parsed = ytdlp.normalizeInput(req.query.url);
  if (!parsed) throw new ytdlp.YtdlpError(ytdlp.ERRORS.BAD_URL.msg, 'BAD_URL');
  if (!ytdlp.hasBinary()) throw new ytdlp.YtdlpError(ytdlp.ERRORS.NO_BINARY.msg, 'NO_BINARY');

  const rawFormat = String(req.query.format || 'mp3').toLowerCase();
  const format = rawFormat === 'original' ? 'original' : rawFormat === 'video' ? 'video' : 'mp3';
  const quality = QUALITIES.includes(Number(req.query.quality)) ? Number(req.query.quality) : 192;

  if (format === 'video') {
    const height = Number(req.query.height);
    const fps = Number(req.query.fps) || 0;
    if (!height) throw new ytdlp.YtdlpError('Choose a video quality.', 'FORMAT');
    const data = await getInfo(parsed.url);
    if (data.is_live) throw new ytdlp.YtdlpError(ytdlp.ERRORS.LIVE.msg, 'LIVE');
    const picked = ytdlp.pickVideoFormat(data, height, fps);
    if (!picked) {
      throw new ytdlp.YtdlpError('That video quality is not available.', 'FORMAT');
    }
    const title = ytdlp.sanitizeFilename(data.title);
    return {
      parsed,
      format,
      quality,
      data,
      picked,
      title,
      filename: `${title}.${picked.ext}`,
      contentType: ytdlp.videoContentType(picked.ext),
      estimatedSize: picked.estimatedSize || 0,
      needsMerge: !picked.direct,
    };
  }

  if (format === 'original') {
    const data = await getInfo(parsed.url);
    if (data.is_live) throw new ytdlp.YtdlpError(ytdlp.ERRORS.LIVE.msg, 'LIVE');
    const audio = ytdlp.pickAudio(data);
    const title = ytdlp.sanitizeFilename(data.title);
    const ext = audio.ext || 'm4a';
    return {
      parsed,
      format,
      quality,
      data,
      audio,
      title,
      filename: `${title}.${ext}`,
      contentType: ytdlp.contentTypeFor(ext),
      estimatedSize: audio.filesize || audio.filesize_approx || 0,
      needsMerge: false,
    };
  }

  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
    throw new ytdlp.YtdlpError(
      'ffmpeg is not installed on this server.',
      'NO_BINARY',
      'Run npm install (ffmpeg-static) or use format=original.'
    );
  }

  let data = null;
  try {
    data = await getInfo(parsed.url);
  } catch (e) {
    // Download may still work even if metadata failed; keep a generic name.
    console.warn('[download:mp3] info failed:', e.code || '', e.message);
  }
  if (data?.is_live) throw new ytdlp.YtdlpError(ytdlp.ERRORS.LIVE.msg, 'LIVE');
  const title = ytdlp.sanitizeFilename(data?.title);
  const duration = Number(data?.duration) || 0;
  return {
    parsed,
    format,
    quality,
    data,
    title,
    filename: `${title}.mp3`,
    contentType: 'audio/mpeg',
    estimatedSize: ytdlp.estimateSize(duration, quality),
    needsMerge: false,
  };
}

// ---------------------------------------------------------------- proxy ------

async function proxyMedia(remoteUrl, req, res, opts = {}) {
  const { attachment = false, filename = 'audio', contentType = 'audio/mp4' } = opts;
  const ac = new AbortController();
  const onClose = () => ac.abort();
  req.on('close', onClose);

  const headers = { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' };
  if (req.headers.range) headers.Range = req.headers.range;

  let upstream;
  try {
    upstream = await fetch(remoteUrl, { headers, signal: ac.signal, redirect: 'follow' });
  } catch (e) {
    req.off('close', onClose);
    throw new ytdlp.YtdlpError(
      'Could not reach the media server: ' + (e.message || e),
      'NETWORK',
      ytdlp.ERRORS.NETWORK.hint
    );
  }

  if (!upstream.ok && upstream.status !== 206) {
    req.off('close', onClose);
    let detail = '';
    try {
      detail = (await upstream.text()).slice(0, 140).replace(/\s+/g, ' ');
    } catch {
      /* ignore */
    }
    const err = new ytdlp.YtdlpError(
      `Media server returned HTTP ${upstream.status}${detail ? ' ' + detail : ''}`,
      upstream.status === 403 || upstream.status === 401 || upstream.status === 410
        ? 'FORBIDDEN'
        : 'NETWORK'
    );
    err.status = upstream.status;
    throw err;
  }

  res.status(upstream.status);
  for (const h of [
    'content-type',
    'content-length',
    'content-range',
    'accept-ranges',
    'last-modified',
    'etag',
  ]) {
    const v = upstream.headers.get(h);
    if (v) res.setHeader(h, v);
  }
  if (!res.getHeader('content-type')) res.setHeader('content-type', contentType);
  res.setHeader(
    'Content-Disposition',
    `${attachment ? 'attachment' : 'inline'}; filename="${filename}"`
  );
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Accel-Buffering', 'no');

  if (!upstream.body) {
    req.off('close', onClose);
    res.end();
    return;
  }

  const stream = Readable.fromWeb(upstream.body);
  const cleanup = () => {
    try {
      stream.destroy();
    } catch {
      /* ignore */
    }
    try {
      ac.abort();
    } catch {
      /* ignore */
    }
    req.off('close', onClose);
  };
  res.on('close', cleanup);
  stream.on('error', () => {
    try {
      res.end();
    } catch {
      /* ignore */
    }
    cleanup();
  });
  stream.pipe(res);
}

async function streamOrDownload(req, res, url, { attachment = false } = {}) {
  let refreshed = false;
  for (;;) {
    const { data, audio } = await getAudio(url, { refresh: refreshed });
    try {
      await proxyMedia(audio.url, req, res, {
        attachment,
        filename: `${ytdlp.sanitizeFilename(data.title)}.${audio.ext || 'm4a'}`,
        contentType: ytdlp.contentTypeFor(audio.ext),
      });
      return;
    } catch (e) {
      const stale = e.status === 401 || e.status === 403 || e.status === 410;
      if (!refreshed && stale && !res.headersSent) {
        refreshed = true;
        continue;
      }
      throw e;
    }
  }
}

async function downloadVideoToTemp(req, res, url, picked, title) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytmp3-'));
  const ac = new AbortController();
  const onClientClose = () => {
    if (!res.writableEnded) ac.abort();
  };
  res.once('close', onClientClose);
  const cleanup = () => fs.rm(dir, { recursive: true, force: true }, () => {});

  // Send the attachment headers right away so the browser opens its download
  // entry immediately. The merged file usually has no Content-Length (chunked).
  const ext = picked.ext || 'mp4';
  sendDownloadHeaders(res, {
    contentType: ytdlp.videoContentType(ext),
    filename: `${title}.${ext}`,
    estimatedSize: picked.estimatedSize || 0,
  });

  try {
    const file = await ytdlp.downloadToFile(url, picked.selector, dir, 'media', {
      signal: ac.signal,
    });
    res.off('close', onClientClose);
    const stat = fs.statSync(file);
    if (!stat.size) throw new ytdlp.YtdlpError('Downloaded video is empty.', 'UNAVAILABLE');
    res.on('close', cleanup);
    const stream = fs.createReadStream(file);
    stream.on('error', () => {
      try {
        res.end();
      } catch {
        /* ignore */
      }
      cleanup();
    });
    stream.pipe(res);
  } catch (e) {
    res.off('close', onClientClose);
    cleanup();
    if (!res.headersSent) throw e;
    console.error('[download:video]', e.code || '', e.message);
    try {
      res.destroy();
    } catch {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------- mp3 pipe ---

function pipeMp3(req, res, url, quality) {
  let attempt = 0;
  let finished = false;
  let generation = 0;
  let current = null;
  let anyBytes = false;

  const killCurrent = () => {
    if (!current) return;
    try {
      current.yt.kill();
    } catch {
      /* ignore */
    }
    try {
      current.ff.kill();
    } catch {
      /* ignore */
    }
  };

  const onClientClose = () => {
    if (!finished) killCurrent();
  };
  req.on('close', onClientClose);

  const finish = () => {
    if (finished) return;
    finished = true;
    req.off('close', onClientClose);
    killCurrent();
    try {
      res.end();
    } catch {
      /* ignore */
    }
  };

  const fail = (raw) => {
    if (finished) return;
    const e = typeof raw === 'string' ? ytdlp.mapError(raw) : raw;
    if (!anyBytes && attempt < 2) {
      attempt += 1;
      killCurrent();
      start();
      return;
    }
    finished = true;
    req.off('close', onClientClose);
    killCurrent();
    console.error('[download:mp3]', e.code || '', e.message);
    if (!res.headersSent) {
      sendError(res, e);
    } else {
      try {
        res.destroy();
      } catch {
        /* ignore */
      }
    }
  };

  const start = () => {
    const myGen = ++generation;
    const yt = spawn(ytdlp.binary(), ytdlp.downloadArgs(url, attempt), {
      windowsHide: true,
    });
    const ff = spawn(
      ffmpegPath,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        'pipe:0',
        '-vn',
        '-c:a',
        'libmp3lame',
        '-b:a',
        `${quality}k`,
        '-ar',
        '44100',
        '-f',
        'mp3',
        'pipe:1',
      ],
      { windowsHide: true }
    );
    current = { yt, ff };

    let ytErr = '';

    yt.stdout.pipe(ff.stdin);
    yt.stderr.on('data', (d) => {
      ytErr = (ytErr + d.toString()).slice(-4000);
    });
    ff.stdin.on('error', () => {});
    ff.stderr.on('data', () => {});

    const stale = () => myGen !== generation;

    yt.on('error', (e) => {
      if (!stale()) fail(new ytdlp.YtdlpError('yt-dlp failed to start: ' + e.message));
    });
    ff.on('error', (e) => {
      if (!stale()) fail(new ytdlp.YtdlpError('ffmpeg failed to start: ' + e.message));
    });

    yt.on('close', (code) => {
      if (stale() || finished) return;
      if (code !== 0 && !anyBytes) {
        fail(ytdlp.mapError(ytErr || `yt-dlp exited with code ${code}`));
      }
    });

    ff.stdout.on('data', (chunk) => {
      if (stale() || finished || res.destroyed) return;
      anyBytes = true;
      if (!res.write(chunk)) {
        ff.stdout.pause();
        res.once('drain', () => ff.stdout.resume());
      }
    });

    ff.stdout.on('end', () => {
      if (stale() || finished) return;
      if (!anyBytes) {
        fail(
          new ytdlp.YtdlpError(
            'No audio was produced for this video.',
            'UNAVAILABLE',
            ytdlp.ERRORS.UNAVAILABLE.hint
          )
        );
        return;
      }
      finish();
    });

    ff.on('close', (code) => {
      if (stale() || finished) return;
      if (!anyBytes) {
        fail(ytdlp.mapError(ytErr || `ffmpeg exited with code ${code}`));
      } else if (code !== 0) {
        finish();
      }
    });
  };

  start();
}

// ---------------------------------------------------------------- routes -----

app.get('/api/health', async (req, res) => {
  const found = ytdlp.hasBinary();
  let ver = null;
  if (found) {
    try {
      ver = await ytdlp.version();
    } catch {
      /* ignore */
    }
  }
  res.json({
    ok: found && !!ffmpegPath,
    ytdlp: { found, version: ver, path: ytdlp.binary() },
    ffmpeg: { found: !!ffmpegPath, path: ffmpegPath || null },
    cookies: { configured: !!ytdlp.cookiesFile(), file: ytdlp.cookiesFile() || null },
    proxy: !!process.env.YTDLP_PROXY,
    uptime: Math.round(process.uptime()),
  });
});

app.post('/api/info', rateLimit({ max: 60 }), async (req, res) => {
  const parsed = ytdlp.normalizeInput(req.body?.url);
  if (!parsed) return sendError(res, new ytdlp.YtdlpError(ytdlp.ERRORS.BAD_URL.msg, 'BAD_URL'));
  if (!ytdlp.hasBinary()) {
    return sendError(res, new ytdlp.YtdlpError(ytdlp.ERRORS.NO_BINARY.msg, 'NO_BINARY'));
  }
  try {
    const data = await getInfo(parsed.url);
    res.setHeader('Cache-Control', 'no-store');
    res.json(buildInfo(data, parsed.url));
  } catch (e) {
    console.error('[info]', e.code || '', e.message);
    sendError(res, e);
  }
});

app.get('/api/stream', rateLimit({ max: 180 }), async (req, res) => {
  const parsed = ytdlp.normalizeInput(req.query.url);
  if (!parsed) return sendError(res, new ytdlp.YtdlpError(ytdlp.ERRORS.BAD_URL.msg, 'BAD_URL'));
  if (!ytdlp.hasBinary()) {
    return sendError(res, new ytdlp.YtdlpError(ytdlp.ERRORS.NO_BINARY.msg, 'NO_BINARY'));
  }
  try {
    await streamOrDownload(req, res, parsed.url, { attachment: false });
  } catch (e) {
    console.error('[stream]', e.code || '', e.message);
    sendError(res, e);
  }
});

app.get('/api/download/check', rateLimit({ max: 60 }), async (req, res) => {
  try {
    const job = await resolveDownload(req);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      format: job.format,
      quality: job.quality,
      filename: job.filename,
      contentType: job.contentType,
      estimatedSize: job.estimatedSize,
      needsMerge: job.needsMerge,
    });
  } catch (e) {
    console.error('[download:check]', e.code || '', e.message);
    sendError(res, e);
  }
});

app.get('/api/download', rateLimit({ max: 30 }), async (req, res) => {
  let job;
  try {
    job = await resolveDownload(req);
  } catch (e) {
    console.error('[download]', e.code || '', e.message);
    return sendError(res, e);
  }

  try {
    if (job.format === 'video') {
      if (job.picked.direct) {
        await proxyMedia(job.picked.format.url, req, res, {
          attachment: true,
          filename: job.filename,
          contentType: job.contentType,
        });
      } else {
        await downloadVideoToTemp(req, res, job.parsed.url, job.picked, job.title);
      }
    } else if (job.format === 'original') {
      await streamOrDownload(req, res, job.parsed.url, { attachment: true });
    } else {
      sendDownloadHeaders(res, job, { quality: job.quality });
      pipeMp3(req, res, job.parsed.url, job.quality);
    }
  } catch (e) {
    console.error(`[download:${job.format}]`, e.code || '', e.message);
    sendError(res, e);
  }
});

app.post('/api/admin/update-ytdlp', async (req, res) => {
  if (process.env.ALLOW_UPDATE !== '1') {
    return res.status(403).json({
      error: 'Updating is disabled.',
      code: 'FORBIDDEN',
      hint: 'Set ALLOW_UPDATE=1 in the environment to enable this endpoint.',
    });
  }
  try {
    const output = await ytdlp.update();
    infoCache.clear();
    res.json({ ok: true, output: output.slice(-4000), version: await ytdlp.version(true) });
  } catch (e) {
    sendError(res, e);
  }
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }));

// ---------------------------------------------------------------- start ------

app.listen(PORT, () => {
  console.log(`YT MP3 backend running at http://localhost:${PORT}`);
  console.log(
    'yt-dlp:',
    ytdlp.hasBinary() ? ytdlp.binary() : 'MISSING — run: npm run setup'
  );
  console.log('ffmpeg:', ffmpegPath || 'MISSING');
  console.log('cookies:', ytdlp.cookiesFile() || 'none (public videos only)');
});

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));
