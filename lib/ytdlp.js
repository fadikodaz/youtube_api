// Robust wrapper around the official yt-dlp binary.
// Handles: cookie files, proxies, extractor-client fallbacks, friendly errors,
// version/update and URL parsing. Everything else in the app talks to this.
//
// Official binary: https://github.com/yt-dlp/yt-dlp
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const IS_WIN = process.platform === 'win32';
const DEFAULT_BIN = path.join(ROOT, 'bin', IS_WIN ? 'yt-dlp.exe' : 'yt-dlp');

const ERRORS = {
  BOT_CHECK: {
    msg: 'YouTube is blocking this server (bot check).',
    hint: 'Add a logged-in cookies.txt (see README) or run on a residential IP / VPS. Datacenter IPs like Vercel are often blocked.',
  },
  PRIVATE: {
    msg: 'This video is private.',
    hint: 'Only public or unlisted videos can be downloaded.',
  },
  MEMBERS_ONLY: {
    msg: 'This video is members-only.',
    hint: 'A logged-in cookies.txt for an account subscribed to the channel is required.',
  },
  AGE_RESTRICTED: {
    msg: 'This video is age-restricted.',
    hint: 'Age verification needs a cookies.txt from a logged-in account.',
  },
  GEO_BLOCKED: {
    msg: 'This video is not available in the server region.',
    hint: 'Set YTDLP_PROXY to a proxy in an allowed country.',
  },
  UNAVAILABLE: {
    msg: 'Video unavailable.',
    hint: 'It may be removed, region-locked or temporarily down.',
  },
  REMOVED: {
    msg: 'This video was removed.',
    hint: 'Try another link.',
  },
  LIVE: {
    msg: "Live streams can't be converted to MP3.",
    hint: 'Wait until the stream ends, then try again.',
  },
  FORBIDDEN: {
    msg: 'YouTube refused the media request (403).',
    hint: 'Restart the server or update yt-dlp: npm run setup',
  },
  FORMAT: {
    msg: 'That audio format is not available.',
    hint: 'Try another quality.',
  },
  NETWORK: {
    msg: 'Network/timeout error while contacting YouTube.',
    hint: 'Check the server connection or set YTDLP_PROXY.',
  },
  BAD_URL: {
    msg: 'Invalid YouTube URL.',
    hint: 'Paste a full youtube.com or youtu.be link (or an 11-character video ID).',
  },
  PARSE: {
    msg: 'Could not read the YouTube response.',
    hint: 'Update yt-dlp: npm run setup',
  },
  NO_BINARY: {
    msg: 'yt-dlp binary is missing.',
    hint: 'Run: npm run setup  (or reinstall dependencies)',
  },
  UNKNOWN: {
    msg: 'YouTube request failed.',
    hint: 'Try again. If it keeps failing, update yt-dlp: npm run setup',
  },
};

class YtdlpError extends Error {
  constructor(message, code = 'UNKNOWN', hint = '', raw = '') {
    super(message);
    this.name = 'YtdlpError';
    this.code = code;
    this.hint = hint || ERRORS[code]?.hint || '';
    this.raw = raw;
  }
}

function binary() {
  return process.env.YTDLP_PATH || DEFAULT_BIN;
}

function hasBinary() {
  try {
    return fs.existsSync(binary());
  } catch {
    return false;
  }
}

function cookiesFile() {
  const candidates = [
    process.env.COOKIES_FILE,
    process.env.YTDLP_COOKIES,
    path.join(ROOT, 'cookies.txt'),
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function mapError(text) {
  const raw = String(text || '');
  const table = [
    [/Sign in to confirm you.?re not a bot|confirm you.?re not a bot/i, 'BOT_CHECK'],
    [/This video is private|Private video/i, 'PRIVATE'],
    [/members-only|Join this channel|channel members/i, 'MEMBERS_ONLY'],
    [/age.?restricted|confirm your age|inappropriate for some users/i, 'AGE_RESTRICTED'],
    [/not available in your country|geo.?restrict|blocked it in your country/i, 'GEO_BLOCKED'],
    [/This video has been removed|has been terminated|account associated with this video has been/i, 'REMOVED'],
    [/Video unavailable|This video is unavailable|No video formats found/i, 'UNAVAILABLE'],
    [/is live|live event will begin|premieres in/i, 'LIVE'],
    [/HTTP Error 403|403 Forbidden|Forbidden/i, 'FORBIDDEN'],
    [/Requested format is not available/i, 'FORMAT'],
    [/Unsupported URL|is not a valid URL|Incomplete YouTube ID/i, 'BAD_URL'],
    [/timed out|Timeout|urlopen error|Temporary failure|getaddrinfo|ECONNREFUSED|ENOTFOUND/i, 'NETWORK'],
  ];
  for (const [re, code] of table) {
    if (re.test(raw)) return new YtdlpError(ERRORS[code].msg, code, ERRORS[code].hint, raw);
  }
  const lastLine =
    raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .pop() || '';
  return new YtdlpError(
    lastLine ? `YouTube request failed: ${lastLine.slice(0, 180)}` : ERRORS.UNKNOWN.msg,
    'UNKNOWN',
    ERRORS.UNKNOWN.hint,
    raw
  );
}

// Build shared CLI flags. `attempt` selects fallback extractor clients.
function baseArgs(attempt = 0) {
  const args = [
    '--no-playlist',
    '--no-warnings',
    '--no-progress',
    '--retries',
    '3',
    '--fragment-retries',
    '3',
    '--socket-timeout',
    '15',
  ];

  const cookies = cookiesFile();
  if (cookies) args.push('--cookies', cookies);
  if (process.env.YTDLP_PROXY) args.push('--proxy', process.env.YTDLP_PROXY);
  if (process.env.YTDLP_FORCE_IPV4 === '1') args.push('-4');

  // Explicit env override wins. Otherwise use nothing for attempt 0 (yt-dlp's
  // maintained defaults) and try alternate client sets only when it fails.
  const override = (process.env.YTDLP_EXTRACTOR_ARGS || '').trim();
  if (override) {
    args.push('--extractor-args', override);
  } else if (attempt === 1) {
    args.push('--extractor-args', 'youtube:player_client=tv,android_vr,web_safari');
  } else if (attempt === 2) {
    args.push('--extractor-args', 'youtube:player_client=ios,android,web');
  }

  return args;
}

function downloadArgs(url, attempt = 0) {
  return [
    ...baseArgs(attempt),
    '-f',
    'bestaudio[ext=m4a]/bestaudio/best',
    '-o',
    '-',
    '--',
    url,
  ];
}

function exec(args, { timeout = 90000, signal = null } = {}) {
  return new Promise((resolve, reject) => {
    const opts = { maxBuffer: 64 * 1024 * 1024, timeout, windowsHide: true };
    if (signal) opts.signal = signal;
    execFile(
      binary(),
      args,
      opts,
      (err, stdout, stderr) => {
        if (err) {
          const out = String(stdout || '');
          const errText = String(stderr || '').trim();
          // A spawn that produced nothing is usually transient (AV lock, busy
          // binary, etc.) - treat it as retryable instead of a fatal error.
          if (!out.trim() && !errText && !err.signal) {
            const transient = new YtdlpError(
              'yt-dlp could not start. Retrying should fix it.',
              'NETWORK',
              ERRORS.NETWORK.hint,
              err.message
            );
            transient.stdout = out;
            return reject(transient);
          }
          const mapped = mapError(errText || err.message);
          mapped.stdout = out;
          return reject(mapped);
        }
        resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
      }
    );
  });
}

const RETRYABLE = new Set([
  'BOT_CHECK',
  'UNAVAILABLE',
  'FORBIDDEN',
  'NETWORK',
  'AGE_RESTRICTED',
  'GEO_BLOCKED',
]);

// Fetch full metadata JSON. Retries with different player clients on failure.
async function dumpJson(url) {
  let last = null;
  for (const attempt of [0, 1, 2]) {
    try {
      const { stdout } = await exec(
        [...baseArgs(attempt), '--no-check-formats', '--dump-single-json', '--', url],
        { timeout: Number(process.env.YTDLP_TIMEOUT_MS) || 90000 }
      );
      try {
        return JSON.parse(stdout);
      } catch {
        throw new YtdlpError(ERRORS.PARSE.msg, 'PARSE', ERRORS.PARSE.hint, stdout.slice(0, 300));
      }
    } catch (e) {
      last = e;
      if (!RETRYABLE.has(e.code)) break;
    }
  }
  throw last || new YtdlpError(ERRORS.UNKNOWN.msg);
}

let versionCache = { value: null, at: 0 };

async function version(force = false) {
  if (!force && versionCache.value && Date.now() - versionCache.at < 60 * 60 * 1000) {
    return versionCache.value;
  }
  let last = null;
  for (let i = 0; i < 3; i += 1) {
    try {
      const { stdout } = await exec(['--version'], { timeout: 20000 });
      const v = stdout.trim();
      if (v) {
        versionCache = { value: v, at: Date.now() };
        return v;
      }
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (versionCache.value) return versionCache.value;
  throw last || new YtdlpError(ERRORS.UNKNOWN.msg);
}

async function update() {
  const { stdout, stderr } = await exec(['-U'], { timeout: 180000 });
  versionCache = { value: null, at: 0 };
  return (stdout || stderr).trim();
}

function pickAudio(data) {
  const all = Array.isArray(data?.formats) ? data.formats : [];
  const audio = all.filter(
    (f) => f && f.url && f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none')
  );
  if (!audio.length) {
    throw new YtdlpError(
      'No playable audio stream found for this video.',
      'UNAVAILABLE',
      ERRORS.UNAVAILABLE.hint
    );
  }
  const pref = { m4a: 0, mp3: 0, mp4: 1, webm: 2, opus: 3, ogg: 4 };
  audio.sort((a, b) => {
    const pa = pref[a.ext] ?? 9;
    const pb = pref[b.ext] ?? 9;
    if (pa !== pb) return pa - pb;
    return (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0);
  });
  return audio[0];
}

function contentTypeFor(ext) {
  switch ((ext || '').toLowerCase()) {
    case 'mp3':
      return 'audio/mpeg';
    case 'webm':
    case 'opus':
      return 'audio/webm';
    case 'ogg':
    case 'oga':
      return 'audio/ogg';
    case 'aac':
      return 'audio/aac';
    case 'm4a':
    case 'mp4':
      return 'audio/mp4';
    default:
      return 'audio/mp4';
  }
}

function videoContentType(ext) {
  switch ((ext || '').toLowerCase()) {
    case 'webm':
      return 'video/webm';
    case 'mkv':
      return 'video/x-matroska';
    case 'mov':
      return 'video/quicktime';
    default:
      return 'video/mp4';
  }
}

function isDirectFormat(f) {
  return !!(f && f.url && String(f.protocol || '').toLowerCase().startsWith('http'));
}

function estimateVideoSize(data, format) {
  let videoBytes = Number(format.filesize || format.filesize_approx || 0);
  if (!videoBytes && format.tbr && data.duration) {
    videoBytes = Math.round((format.tbr * 1000 * Number(data.duration)) / 8);
  }
  if (!videoBytes && data.duration) {
    // rough 1 Mbit/s fallback
    videoBytes = Math.round((1000 * 1000 * Number(data.duration)) / 8);
  }
  let audioBytes = 0;
  try {
    const audio = pickAudio(data);
    audioBytes = Number(audio.filesize || audio.filesize_approx || 0);
  } catch {
    /* no audio */
  }
  if (!audioBytes && data.duration) {
    audioBytes = Math.round((128 * 1000 * Number(data.duration)) / 8);
  }
  return videoBytes + audioBytes;
}

// Distinct downloadable video qualities (one entry per height/fps combo).
function videoOptions(data) {
  const videos = (data.formats || []).filter(
    (f) => f && f.vcodec && f.vcodec !== 'none' && Number(f.height) > 0
  );

  const seen = new Map();
  for (const f of videos) {
    const height = Number(f.height);
    const fps = Math.round(Number(f.fps) || 0);
    const key = String(height);
    const direct = !!(f.acodec && f.acodec !== 'none') && isDirectFormat(f);
    const isHttp = String(f.protocol || '').toLowerCase().startsWith('http');
    const score =
      (direct ? 100000 : 0) +
      (isHttp ? 8000 : 0) +
      (f.ext === 'mp4' ? 1000 : 0) +
      (String(f.vcodec || '').startsWith('avc1') ? 500 : 0) +
      Number(f.tbr || 0);
    const cur = seen.get(key);
    if (!cur || score > cur.score) seen.set(key, { f, score, direct });
  }

  return [...seen.values()]
    .map(({ f, direct }) => {
      const height = Number(f.height);
      const fps = Math.round(Number(f.fps) || 0);
      const ext = direct ? f.ext || 'mp4' : 'mp4';
      return {
        id: `video:${height}:${fps}`,
        kind: 'video',
        label: `${height}p${fps >= 50 ? fps : ''}`,
        height,
        fps,
        ext,
        needsMerge: !direct,
        estimatedSize: estimateVideoSize(data, f),
      };
    })
    .sort((a, b) => a.height - b.height || a.fps - b.fps);
}

function pickVideoFormat(data, height, fps) {
  const videos = (data.formats || []).filter(
    (f) => f && f.vcodec && f.vcodec !== 'none' && Number(f.height) === Number(height)
  );
  if (!videos.length) return null;

  let pool = videos;
  if (fps) {
    const matching = videos.filter((f) => Math.abs((Number(f.fps) || 0) - Number(fps)) < 1);
    if (matching.length) pool = matching;
  }

  const score = (f) =>
    ((f.acodec && f.acodec !== 'none') && isDirectFormat(f) ? 100000 : 0) +
    (String(f.protocol || '').toLowerCase().startsWith('http') ? 8000 : 0) +
    (f.ext === 'mp4' ? 1000 : 0) +
    (String(f.vcodec || '').startsWith('avc1') ? 500 : 0) +
    Number(f.tbr || 0);
  pool.sort((a, b) => score(b) - score(a));

  const format = pool[0];
  const direct = !!(format.acodec && format.acodec !== 'none') && isDirectFormat(format);
  const hasAudio = !!(format.acodec && format.acodec !== 'none');
  const selector = direct
    ? format.format_id
    : hasAudio
      ? format.format_id
      : `${format.format_id}+bestaudio/best`;

  return {
    format,
    direct,
    needsMerge: !direct,
    selector,
    ext: direct ? format.ext || 'mp4' : 'mp4',
    estimatedSize: estimateVideoSize(data, format),
  };
}

function videoDownloadArgs(url, selector, outTemplate, attempt = 0) {
  const fragments = Math.max(
    1,
    Math.min(16, Number(process.env.YTDLP_CONCURRENT_FRAGMENTS) || 8)
  );
  return [
    ...baseArgs(attempt),
    '-f',
    selector,
    '-N',
    String(fragments),
    '--http-chunk-size',
    '10M',
    '--merge-output-format',
    'mp4',
    '-o',
    outTemplate,
    '--',
    url,
  ];
}

// Download + merge a video into `dir`, returning the finished file path.
async function downloadToFile(url, selector, dir, base = 'media', { signal = null } = {}) {
  let last = null;
  for (const attempt of [0, 1, 2]) {
    if (signal?.aborted) break;
    const template = path.join(dir, `${base}-${attempt}.%(ext)s`);
    try {
      await exec(videoDownloadArgs(url, selector, template, attempt), {
        timeout: Number(process.env.VIDEO_TIMEOUT_MS) || 900000,
        signal,
      });
      const files = fs
        .readdirSync(dir)
        .filter((n) => n.startsWith(`${base}-${attempt}.`) && !n.endsWith('.part'));
      if (!files.length) {
        throw new YtdlpError('Video download produced no output.', 'UNAVAILABLE');
      }
      return path.join(dir, files[0]);
    } catch (e) {
      last = e;
      if (!RETRYABLE.has(e.code)) break;
    }
  }
  throw last || new YtdlpError(ERRORS.UNKNOWN.msg);
}

function sanitizeFilename(name) {
  return (
    (name || 'audio')
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
      .replace(/\s+/g, ' ')
      .slice(0, 100)
      .trim() || 'audio'
  );
}

function estimateSize(durationSeconds, kbps) {
  const seconds = Number(durationSeconds) || 0;
  const rate = Number(kbps) || 0;
  if (!seconds || !rate) return 0;
  return Math.round((seconds * rate * 1000) / 8);
}

// Accept a URL or a bare 11-character video ID and return a canonical watch URL.
function normalizeInput(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim();
  if (!s) return null;

  if (/^[\w-]{11}$/.test(s)) {
    return { url: `https://www.youtube.com/watch?v=${s}`, videoId: s };
  }

  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;

  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }

  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const allowed = [
    'youtube.com',
    'm.youtube.com',
    'music.youtube.com',
    'youtube-nocookie.com',
    'youtu.be',
  ];
  if (!allowed.includes(host)) return null;

  let id = null;
  if (host === 'youtu.be') {
    id = u.pathname.split('/').filter(Boolean)[0];
  } else if (u.pathname === '/watch') {
    id = u.searchParams.get('v');
  } else {
    const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})/);
    if (m) id = m[1];
  }

  if (!id || !/^[\w-]{11}$/.test(id)) return null;
  return { url: `https://www.youtube.com/watch?v=${id}`, videoId: id };
}

module.exports = {
  ERRORS,
  YtdlpError,
  binary,
  hasBinary,
  cookiesFile,
  mapError,
  dumpJson,
  downloadArgs,
  pickAudio,
  contentTypeFor,
  videoContentType,
  videoOptions,
  pickVideoFormat,
  downloadToFile,
  sanitizeFilename,
  estimateSize,
  normalizeInput,
  version,
  update,
};
