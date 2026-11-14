// Robust wrapper around the official yt-dlp binary.
// Handles: cookie files, proxies, extractor-client fallbacks, friendly errors,
// format picking, job command lines, process spawning and URL parsing.
//
// Official binary: https://github.com/yt-dlp/yt-dlp
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const IS_WIN = process.platform === 'win32';
const DEFAULT_BIN = path.join(ROOT, 'bin', IS_WIN ? 'yt-dlp.exe' : 'yt-dlp');

const ERRORS = {
  // Shown to visitors, so no technical advice here. (Server owners: see the
  // README section on the bot check: cookies, proxy or a residential IP.)
  BOT_CHECK: {
    msg: 'YouTube isn’t letting us download this right now.',
    hint: 'Please try again later. Links from TikTok, Facebook, Pinterest, Dailymotion and Twitch work.',
  },
  PRIVATE: {
    msg: 'This video is private.',
    hint: 'Only public or unlisted videos can be downloaded.',
  },
  MEMBERS_ONLY: {
    msg: 'This video is members-only.',
    hint: 'Only public or unlisted videos can be downloaded.',
  },
  AGE_RESTRICTED: {
    msg: 'This video is age-restricted.',
    hint: 'Age-restricted videos can’t be downloaded here.',
  },
  GEO_BLOCKED: {
    msg: "This video isn't available in our region.",
    hint: 'The site doesn’t allow it from where our server is. Try another video.',
  },
  NO_VIDEO: {
    msg: "This post doesn't contain a video.",
    hint: 'Open the post and copy the link of the video itself.',
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
    msg: "Live streams can't be downloaded while they are live.",
    hint: 'Wait until the stream ends, then try again.',
  },
  FORBIDDEN: {
    msg: 'The site refused the download.',
    hint: 'Try again in a moment.',
  },
  FORMAT: {
    msg: 'That format is not available for this video.',
    hint: 'Try another quality.',
  },
  TOO_LONG: {
    msg: 'This video is too long for this server.',
    hint: 'Try a shorter video.',
  },
  TOO_LARGE: {
    msg: 'That file would be too large.',
    hint: 'Pick a lower quality.',
  },
  BUSY: {
    msg: 'The server is busy right now.',
    hint: 'Please try again in a minute.',
  },
  LIMIT: {
    msg: 'You already have several downloads in progress.',
    hint: 'Wait for one to finish, then try again.',
  },
  NETWORK: {
    msg: 'We couldn’t reach the site just now.',
    hint: 'Try again in a moment.',
  },
  TIMEOUT: {
    msg: 'The site took too long to respond.',
    hint: 'Try again in a moment.',
  },
  BAD_URL: {
    msg: "This link isn't supported.",
    hint: 'Paste a video link from YouTube, TikTok, Facebook, Pinterest, Dailymotion or Twitch.',
  },
  LOGIN_REQUIRED: {
    msg: 'This site only shows this video to signed-in users.',
    hint: 'Public videos usually work. Try another video.',
  },
  PARSE: {
    msg: 'Something went wrong reading this video.',
    hint: 'Please try again later.',
  },
  NO_BINARY: {
    msg: 'Downloads are temporarily unavailable.',
    hint: 'Please try again later.',
  },
  CANCELLED: {
    msg: 'Download cancelled.',
    hint: '',
  },
  UNKNOWN: {
    msg: 'The request failed.',
    hint: 'Please try again in a moment.',
  },
};

class YtdlpError extends Error {
  constructor(message, code = 'UNKNOWN', hint = '', raw = '') {
    super(message || ERRORS[code]?.msg || ERRORS.UNKNOWN.msg);
    this.name = 'YtdlpError';
    this.code = code;
    this.hint = hint || ERRORS[code]?.hint || '';
    this.raw = raw;
  }
}

const err = (code, message, hint) => new YtdlpError(message || ERRORS[code].msg, code, hint);

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
  const candidates = [process.env.COOKIES_FILE, process.env.YTDLP_COOKIES, path.join(ROOT, 'cookies.txt')].filter(
    Boolean
  );
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
    [/not available in your country|geo.?restrict|blocked it in your country|IP address is blocked/i, 'GEO_BLOCKED'],
    [/No video could be found|does not contain (a )?video/i, 'NO_VIDEO'],
    // Generic "needs an account" (Instagram, Facebook, X...). After the
    // YouTube-specific rules above, whose messages also mention cookies.
    [
      /login required|log ?in to|requires? (a )?log ?in|rate-limit reached or login|use --cookies|cookies.{0,40}(needed|required)|not logged in|private account/i,
      'LOGIN_REQUIRED',
    ],
    [/This video has been removed|has been terminated|account associated with this video has been/i, 'REMOVED'],
    [/larger than max-filesize|File is larger than/i, 'TOO_LARGE'],
    [/Video unavailable|This video is unavailable|No video formats found/i, 'UNAVAILABLE'],
    [/is live|live event will begin|premieres in/i, 'LIVE'],
    [/HTTP Error 403|403 Forbidden|Forbidden/i, 'FORBIDDEN'],
    [/Requested format is not available/i, 'FORMAT'],
    [/Unsupported URL|is not a valid URL|Incomplete YouTube ID/i, 'BAD_URL'],
    [/timed out|Timeout|urlopen error|Temporary failure|getaddrinfo|ECONNREFUSED|ENOTFOUND|ECONNRESET/i, 'NETWORK'],
  ];
  for (const [re, code] of table) {
    if (re.test(raw)) return new YtdlpError(ERRORS[code].msg, code, ERRORS[code].hint, raw);
  }
  const lastLine =
    raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !/^WARNING/i.test(l))
      .pop() || '';
  return new YtdlpError(
    lastLine ? `Request failed: ${lastLine.replace(/^ERROR:\s*/i, '').slice(0, 180)}` : ERRORS.UNKNOWN.msg,
    'UNKNOWN',
    ERRORS.UNKNOWN.hint,
    raw
  );
}

// JavaScript runtime for YouTube's player challenges. Extraction without one
// is faster but deprecated, so it is used for the fallback attempts (or always
// when YTDLP_JS_RUNTIME=always, never when =off).
function jsRuntimeArgs(attempt) {
  const mode = String(process.env.YTDLP_JS_RUNTIME || 'auto').toLowerCase();
  if (mode === 'off') return [];
  if (mode === 'auto' && attempt === 0) return [];
  const custom = process.env.YTDLP_JS_RUNTIME_PATH;
  return ['--js-runtimes', custom ? custom : `node:${process.execPath}`];
}

// Build shared CLI flags. `attempt` selects fallback extractor clients.
function baseArgs(attempt = 0) {
  const args = [
    '--no-playlist',
    '--no-warnings',
    '--retries',
    '3',
    '--fragment-retries',
    '3',
    '--socket-timeout',
    '15',
    ...jsRuntimeArgs(attempt),
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

const MAX_STDOUT = 64 * 1024 * 1024;

// yt-dlp writes the cookie jar back when it exits. With several processes
// sharing one cookies.txt they overwrite each other (and it fails on a
// read-only mount), so every run gets its own throwaway copy.
function isolateCookies(args) {
  const i = args.indexOf('--cookies');
  if (i === -1 || !args[i + 1]) return { args, cleanup: () => {} };
  const tmp = path.join(os.tmpdir(), `ytdl-cookies-${process.pid}-${crypto.randomBytes(6).toString('hex')}.txt`);
  try {
    fs.copyFileSync(args[i + 1], tmp);
  } catch {
    return { args, cleanup: () => {} };
  }
  const copy = args.slice();
  copy[i + 1] = tmp;
  return { args: copy, cleanup: () => fs.rm(tmp, { force: true }, () => {}) };
}

// Run yt-dlp and collect its output. Uses spawn + killTree (not execFile) so a
// timeout also kills the child processes: on Windows yt-dlp.exe is a launcher
// that starts a separate Python process, which execFile's timeout would orphan.
function exec(rawArgs, { timeout = 90000, signal = null } = {}) {
  return new Promise((resolve, reject) => {
    const { args, cleanup } = isolateCookies(rawArgs);
    let child;
    try {
      child = spawn(binary(), args, {
        windowsHide: true,
        detached: !IS_WIN,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      cleanup();
      return reject(new YtdlpError('yt-dlp failed to start: ' + e.message, 'NETWORK'));
    }
    child.once('close', cleanup);
    child.once('error', cleanup);
    const out = [];
    let outLen = 0;
    let errText = '';
    let settled = false;
    let timer = null;

    const done = (fn, v) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
      fn(v);
    };
    const onAbort = () => {
      killTree(child);
      done(reject, err('CANCELLED'));
    };
    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
    }
    if (timeout) {
      timer = setTimeout(() => {
        killTree(child);
        done(reject, err('TIMEOUT'));
      }, timeout);
    }

    child.stdout.on('data', (c) => {
      outLen += c.length;
      if (outLen > MAX_STDOUT) {
        killTree(child);
        return done(reject, err('PARSE', 'YouTube returned an unexpectedly large response.'));
      }
      out.push(c);
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (c) => {
      errText = (errText + c).slice(-20000);
    });
    child.on('error', (e) => done(reject, new YtdlpError('yt-dlp failed to start: ' + e.message, 'NETWORK')));
    child.on('close', (code) => {
      const stdout = Buffer.concat(out).toString('utf8');
      if (code === 0) return done(resolve, { stdout, stderr: errText });
      const text = errText.trim();
      // A run that produced nothing is usually transient (AV lock, busy
      // binary, etc.) - treat it as retryable instead of a fatal error.
      if (!stdout.trim() && !text) {
        return done(
          reject,
          new YtdlpError(
            'yt-dlp could not start. Retrying should fix it.',
            'NETWORK',
            ERRORS.NETWORK.hint,
            `exit ${code}`
          )
        );
      }
      done(reject, mapError(text || `yt-dlp exited with code ${code}`));
    });
  });
}

// TIMEOUT is deliberately not retryable: a stuck request would just get stuck again.
const RETRYABLE = new Set([
  'BOT_CHECK',
  'UNAVAILABLE',
  'FORBIDDEN',
  'NETWORK',
  'AGE_RESTRICTED',
  'GEO_BLOCKED',
  'UNKNOWN',
]);

// Fetch full metadata JSON. Retries with different player clients on failure,
// but all attempts together must finish within YTDLP_INFO_DEADLINE_MS so the
// browser (and any reverse proxy, usually 60 s) gets an answer in time.
async function dumpJson(url) {
  const perAttempt = Number(process.env.YTDLP_TIMEOUT_MS) || 45000;
  const deadline = Date.now() + (Number(process.env.YTDLP_INFO_DEADLINE_MS) || 55000);
  let last = null;
  let partial = null; // best "reduced" answer so far
  for (const attempt of [0, 1, 2]) {
    const left = deadline - Date.now();
    if (left < 5000) break;
    try {
      const { stdout } = await exec([...baseArgs(attempt), '--no-check-formats', '--dump-single-json', '--', url], {
        timeout: Math.min(perAttempt, left),
      });
      let data;
      try {
        data = JSON.parse(stdout);
      } catch {
        throw new YtdlpError(ERRORS.PARSE.msg, 'PARSE', ERRORS.PARSE.hint, stdout.slice(0, 300));
      }
      if (!isDegraded(data)) return slimInfo(data);
      // YouTube sometimes answers with only a 360p file (no separate HD
      // streams). Try the next client set (with the JS runtime) for the full
      // list, but keep this answer in case nothing better comes back.
      if (!partial || formatCount(data) > formatCount(partial)) partial = data;
      console.warn(`[info] reduced format list from YouTube (attempt ${attempt}), retrying`);
    } catch (e) {
      last = e;
      if (!RETRYABLE.has(e.code)) break;
    }
  }
  if (partial) return slimInfo(partial);
  throw last || err('TIMEOUT');
}

const formatCount = (data) => (Array.isArray(data?.formats) ? data.formats.length : 0);

// A YouTube answer without any video-only (adaptive) streams is a reduced
// one: real videos always have them (that's where 720p and up live).
function isDegraded(data) {
  if (!data || data._type === 'playlist' || !/youtube/i.test(data.extractor_key || '')) return false;
  if (data.is_live || data.live_status === 'is_upcoming') return false;
  const formats = Array.isArray(data.formats) ? data.formats : [];
  return !formats.some((f) => f && f.vcodec && f.vcodec !== 'none' && (!f.acodec || f.acodec === 'none'));
}

// yt-dlp's full JSON is often 0.5-2 MB, mostly captions, heatmaps, storyboards
// and dozens of thumbnail sizes. Drop what neither the UI nor the download
// (--load-info-json) needs, so the cache stays small.
function slimInfo(data) {
  if (!data || typeof data !== 'object' || data._type === 'playlist') return data;
  const out = { ...data };
  for (const k of ['automatic_captions', 'subtitles', 'heatmap', 'requested_subtitles']) {
    delete out[k];
  }
  if (Array.isArray(out.formats)) {
    out.formats = out.formats.filter((f) => f && f.ext !== 'mhtml' && !/storyboard/i.test(String(f.format_note || '')));
  }
  if (Array.isArray(out.thumbnails) && out.thumbnails.length > 8) {
    // yt-dlp orders thumbnails worst -> best; keep the best few (jpg + webp).
    out.thumbnails = out.thumbnails.slice(-8);
  }
  return out;
}

let versionCache = { value: null, at: 0, failedAt: 0 };

async function version(force = false) {
  if (!force && versionCache.value && Date.now() - versionCache.at < 60 * 60 * 1000) {
    return versionCache.value;
  }
  // Don't spawn 3 processes on every health check while the binary is broken.
  if (!force && !versionCache.value && Date.now() - versionCache.failedAt < 60 * 1000) {
    throw err('NO_BINARY', 'yt-dlp did not respond.');
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
  versionCache.failedAt = Date.now();
  throw last || new YtdlpError(ERRORS.UNKNOWN.msg);
}

async function update() {
  const { stdout, stderr } = await exec(['-U'], { timeout: 180000 });
  versionCache = { value: null, at: 0, failedAt: 0 };
  return (stdout || stderr).trim();
}

// ------------------------------------------------------------ format picking -

const isHttp = (f) =>
  String(f?.protocol || '')
    .toLowerCase()
    .startsWith('http');
const hasAudio = (f) => !!(f && f.acodec && f.acodec !== 'none');
const hasVideo = (f) => !!(f && f.vcodec && f.vcodec !== 'none');
const isAac = (f) => /^mp4a/i.test(String(f?.acodec || '')) || f?.ext === 'm4a';

function formatBytes(f, duration) {
  const direct = Number(f?.filesize || f?.filesize_approx || 0);
  if (direct) return direct;
  const tbr = Number(f?.tbr || f?.abr || f?.vbr || 0);
  const secs = Number(duration) || 0;
  return tbr && secs ? Math.round((tbr * 1000 * secs) / 8) : 0;
}

function audioBitrate(f) {
  return Math.round(Number(f?.abr || f?.tbr || 0));
}

function audioFormats(data) {
  return (Array.isArray(data?.formats) ? data.formats : []).filter((f) => f && hasAudio(f) && !hasVideo(f));
}

// Best AAC (m4a) track - plays everywhere and fits in MP4/M4A containers.
function pickAac(data) {
  const list = audioFormats(data)
    .filter(isAac)
    .sort((a, b) => (isHttp(b) ? 1 : 0) - (isHttp(a) ? 1 : 0) || audioBitrate(b) - audioBitrate(a));
  return list[0] || null;
}

// Highest-bitrate audio of any codec - the best source to convert to MP3.
function pickBestAudio(data) {
  const list = audioFormats(data).sort(
    (a, b) => (isHttp(b) ? 1 : 0) - (isHttp(a) ? 1 : 0) || audioBitrate(b) - audioBitrate(a)
  );
  return list[0] || null;
}

// Best source for an MP3: an audio-only track if there is one, otherwise the
// best format that carries audio (many non-YouTube sites only offer
// combined video+audio files; yt-dlp extracts the audio from those).
function pickAudioSource(data) {
  const audioOnly = pickBestAudio(data);
  if (audioOnly) return audioOnly;
  const all = Array.isArray(data?.formats) ? data.formats : [];
  const withAudio = all.filter(hasAudio);
  // Some extractors don't report codecs at all: then any format may have audio.
  const pool = withAudio.length ? withAudio : all.filter((f) => f && !f.acodec && f.format_id);
  pool.sort(
    (a, b) =>
      (isHttp(b) ? 1 : 0) - (isHttp(a) ? 1 : 0) ||
      audioBitrate(b) - audioBitrate(a) ||
      (Number(a.tbr) || 0) - (Number(b.tbr) || 0)
  );
  return pool[0] || null;
}

function pickAudio(data) {
  const f = pickAac(data) || pickBestAudio(data);
  if (!f) {
    throw new YtdlpError('No playable audio stream found for this video.', 'UNAVAILABLE', ERRORS.UNAVAILABLE.hint);
  }
  return f;
}

function codecName(vcodec) {
  const v = String(vcodec || '').toLowerCase();
  if (v.startsWith('avc1') || v.startsWith('h264')) return 'H.264';
  if (v.startsWith('vp09') || v.startsWith('vp9')) return 'VP9';
  if (v.startsWith('av01')) return 'AV1';
  if (v.startsWith('hev1') || v.startsWith('hvc1')) return 'H.265';
  return v ? v.split('.')[0].toUpperCase() : 'Video';
}

function codecRank(vcodec) {
  // Compatibility first: H.264 plays on every phone, TV and editor.
  switch (codecName(vcodec)) {
    case 'H.264':
      return 3;
    case 'VP9':
      return 2;
    case 'AV1':
      return 1;
    default:
      return 0;
  }
}

function compatNote(codec) {
  switch (codec) {
    case 'H.264':
      return 'Plays everywhere';
    case 'VP9':
      return 'Plays in browsers & VLC';
    case 'AV1':
      return 'Newer devices only';
    default:
      return 'May need VLC';
  }
}

function videoScore(f) {
  return (
    (isHttp(f) ? 1e7 : 0) +
    codecRank(f.vcodec) * 1e6 +
    (hasAudio(f) ? 5e5 : 0) +
    Math.round(Number(f.fps) || 0) * 1000 +
    Math.min(999, Math.round(Number(f.tbr) || 0) / 10)
  );
}

// Choose the video (+ audio) to download for a given height.
function pickVideoFormat(data, height) {
  const videos = (data.formats || []).filter(
    (f) => f && f.format_id && hasVideo(f) && Number(f.height) === Number(height)
  );
  if (!videos.length) return null;
  videos.sort((a, b) => videoScore(b) - videoScore(a));
  const video = videos[0];
  const duration = Number(data.duration) || 0;

  let audio = null;
  let selector = video.format_id;
  if (!hasAudio(video)) {
    audio = pickAac(data) || pickBestAudio(data);
    selector = audio ? `${video.format_id}+${audio.format_id}` : `${video.format_id}+ba`;
  }
  // Fallback lets yt-dlp choose if the exact ids vanished on re-extraction.
  selector += `/bv*[height=${Number(height)}]+ba/b[height=${Number(height)}]`;

  const codec = codecName(video.vcodec);
  const fps = Math.round(Number(video.fps) || 0);
  return {
    video,
    audio,
    selector,
    height: Number(height),
    fps,
    codec,
    compat: compatNote(codec),
    merge: !hasAudio(video),
    ext: 'mp4',
    estimatedSize: formatBytes(video, duration) + (audio ? formatBytes(audio, duration) : 0),
    parts: [video, audio].filter(Boolean).map((f) => ({
      id: String(f.format_id),
      size: formatBytes(f, duration),
    })),
  };
}

// Distinct downloadable video qualities (one entry per height).
function videoOptions(data) {
  const heights = new Set(
    (data.formats || []).filter((f) => f && hasVideo(f) && Number(f.height) > 0).map((f) => Number(f.height))
  );
  return [...heights]
    .map((h) => pickVideoFormat(data, h))
    .filter(Boolean)
    .map((p) => ({
      id: `video:${p.height}`,
      kind: 'video',
      label: `${p.height}p${p.fps >= 50 ? p.fps : ''}`,
      height: p.height,
      fps: p.fps,
      ext: 'mp4',
      codec: p.codec,
      compat: p.compat,
      needsMerge: p.merge,
      estimatedSize: p.estimatedSize,
    }))
    .sort((a, b) => a.height - b.height);
}

// ------------------------------------------------------------- job commands --

const PROGRESS_MARK = '@@P';
const FILE_MARK = '@@F';

// Square-crop the cover art so it looks right in music players.
const SQUARE_COVER =
  "ThumbnailsConvertor+ffmpeg_o:-c:v mjpeg -qmin 1 -qscale:v 2 -vf crop=\"'if(gt(ih,iw),iw,ih)':'if(gt(iw,ih),ih,iw)'\"";

// Arguments for a download job. `source` is either { infoJson } (re-uses the
// cached metadata, saving a full extraction) or { url }.
function jobArgs({ kind, quality, selector, audioExt, cut, outDir, source, attempt = 0, ffmpeg, maxBytes }) {
  const fragments = Math.max(1, Math.min(16, Number(process.env.YTDLP_CONCURRENT_FRAGMENTS) || 8));
  const args = [
    ...baseArgs(attempt),
    '--newline',
    '--progress',
    '--progress-delta',
    '0.5',
    '--progress-template',
    `download:${PROGRESS_MARK} %(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(info.format_id)s`,
    '--print',
    `after_move:${FILE_MARK} %(filepath)s`,
    '--no-mtime',
    '-N',
    String(fragments),
    '--http-chunk-size',
    '10M',
    '-o',
    path.join(outDir, 'media.%(ext)s'),
  ];
  if (ffmpeg) args.push('--ffmpeg-location', ffmpeg);
  if (maxBytes) args.push('--max-filesize', String(Math.ceil(maxBytes)));

  if (kind === 'mp3') {
    args.push(
      '-f',
      'ba/b',
      '-x',
      '--audio-format',
      'mp3',
      '--audio-quality',
      `${quality}K`,
      '--embed-metadata',
      '--embed-thumbnail',
      '--convert-thumbnails',
      'jpg',
      '--ppa',
      SQUARE_COVER
    );
  } else if (kind === 'audio') {
    args.push('-f', 'ba[ext=m4a]/ba', '--embed-metadata');
    if (audioExt === 'm4a') {
      args.push('--embed-thumbnail', '--convert-thumbnails', 'jpg', '--ppa', SQUARE_COVER);
    }
  } else {
    // Title/channel tags, chapter markers and the thumbnail as cover art, so
    // the file shows a proper title and picture in phone galleries/players.
    args.push(
      '-f',
      selector,
      '--merge-output-format',
      'mp4',
      '--remux-video',
      'mp4',
      '--embed-metadata',
      '--embed-chapters',
      '--embed-thumbnail',
      '--convert-thumbnails',
      'jpg'
    );
  }

  // "Cut a part": download just that section; cut on exact seconds (video is
  // re-encoded around the cut points so it doesn't start on a frozen frame).
  if (cut && Number.isFinite(cut.start) && Number.isFinite(cut.end)) {
    args.push('--download-sections', `*${Math.floor(cut.start)}-${Math.ceil(cut.end)}`, '--force-keyframes-at-cuts');
  }

  if (source.infoJson) args.push('--load-info-json', source.infoJson);
  else args.push('--', source.url);
  return args;
}

function parseProgress(line) {
  const i = line.indexOf(PROGRESS_MARK);
  if (i === -1) return null;
  const [status, done, total, estimate, speed, formatId] = line
    .slice(i + PROGRESS_MARK.length)
    .trim()
    .split('|');
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  return {
    status: String(status || '').trim(),
    downloaded: num(done),
    total: num(total) || num(estimate),
    speed: num(speed),
    formatId: String(formatId || '').trim(),
  };
}

function parseFile(line) {
  const i = line.indexOf(FILE_MARK);
  return i === -1 ? null : line.slice(i + FILE_MARK.length).trim();
}

// Kill a process and everything it started (yt-dlp spawns ffmpeg).
function killTree(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  try {
    if (IS_WIN) {
      const tk = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      const fallback = () => {
        try {
          if (child.exitCode === null) child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      };
      tk.on('error', fallback);
      tk.on('close', (code) => code !== 0 && fallback());
    } else {
      process.kill(-child.pid, 'SIGKILL');
    }
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  }
}

// Run yt-dlp, streaming each output line to `onLine`. Resolves on exit 0.
function run(rawArgs, { onLine, signal, timeout = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const { args, cleanup } = isolateCookies(rawArgs);
    let child;
    try {
      child = spawn(binary(), args, {
        windowsHide: true,
        detached: !IS_WIN,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      cleanup();
      return reject(new YtdlpError('yt-dlp failed to start: ' + e.message, 'NETWORK'));
    }
    child.once('close', cleanup);
    child.once('error', cleanup);
    let tail = '';
    let settled = false;
    let timer = null;

    const done = (fn, v) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
      fn(v);
    };
    const onAbort = () => {
      killTree(child);
      done(reject, err('CANCELLED'));
    };
    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
    }
    if (timeout) {
      timer = setTimeout(() => {
        killTree(child);
        done(reject, err('TIMEOUT', 'The download took too long and was stopped.'));
      }, timeout);
    }

    const feed = (stream, isErr) => {
      let buf = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        buf += chunk;
        let nl;
        while ((nl = buf.search(/\r?\n|\r/)) !== -1) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + (buf[nl] === '\r' && buf[nl + 1] === '\n' ? 2 : 1));
          if (isErr || !line.includes(PROGRESS_MARK)) tail = (tail + line + '\n').slice(-6000);
          if (line) onLine?.(line);
        }
      });
      stream.on('end', () => {
        if (buf) onLine?.(buf);
      });
    };
    feed(child.stdout, false);
    feed(child.stderr, true);

    child.on('error', (e) => done(reject, new YtdlpError('yt-dlp failed to start: ' + e.message, 'NETWORK')));
    child.on('close', (code) => {
      if (code === 0) done(resolve);
      else done(reject, mapError(tail || `yt-dlp exited with code ${code}`));
    });
  });
}

// ------------------------------------------------------------------ misc ----

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

// Keep Unicode (Arabic, CJK, emoji...) but drop characters that are illegal in
// filenames on Windows/macOS/Linux.
function sanitizeFilename(name, fallback = 'download') {
  let s = String(name || '')
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex -- stripping control chars is the point
    .replace(/[<>:"/\\|?*\u0000-\u001F\u007F]/g, '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  s = Array.from(s)
    .slice(0, 120)
    .join('')
    .replace(/[. ]+$/, '')
    .trim();
  if (!s || RESERVED.test(s)) return fallback;
  return s;
}

function estimateSize(durationSeconds, kbps) {
  const seconds = Number(durationSeconds) || 0;
  const rate = Number(kbps) || 0;
  if (!seconds || !rate) return 0;
  return Math.round((seconds * rate * 1000) / 8);
}

// Sites accepted besides YouTube. Only these hosts (and their subdomains) are
// ever passed to yt-dlp, so the server can't be used to fetch arbitrary URLs.
// `login: true` = often needs a signed-in cookies file on the server.
const SITES = [
  { name: 'TikTok', hosts: ['tiktok.com'] },
  { name: 'Facebook', hosts: ['facebook.com', 'fb.watch'], login: true },
  { name: 'Dailymotion', hosts: ['dailymotion.com', 'dai.ly'] },
  { name: 'Twitch', hosts: ['twitch.tv'] },
  { name: 'Pinterest', hosts: ['pinterest.com', 'pin.it'] },
];

// Recognised but turned away politely: these currently need a signed-in
// account for nearly every video (or aren't offered yet).
const NOT_YET = [
  { name: 'Instagram', hosts: ['instagram.com'] },
  { name: 'X (Twitter)', hosts: ['x.com', 'twitter.com'] },
  { name: 'Vimeo', hosts: ['vimeo.com'] },
  { name: 'Reddit', hosts: ['reddit.com', 'redd.it'] },
  { name: 'SoundCloud', hosts: ['soundcloud.com'] },
];

// Name of a known-but-unsupported site for a pasted link, else null.
function unsupportedSite(input) {
  try {
    const raw = String(input || '').trim();
    const h = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase();
    return NOT_YET.find((s) => s.hosts.some((d) => h === d || h.endsWith(`.${d}`)))?.name || null;
  } catch {
    return null;
  }
}

const YT_HOSTS = ['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'youtu.be'];

function siteFor(host) {
  const h = host.toLowerCase().replace(/\.$/, '');
  return SITES.find((s) => s.hosts.some((d) => h === d || h.endsWith(`.${d}`))) || null;
}

// Accept a link (or a bare 11-character YouTube ID). YouTube links are rebuilt
// from the video ID; other allowed sites get a cleaned https URL.
// Returns { url, videoId, site, login } or null.
function normalizeInput(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim();
  if (!s || s.length > 2048) return null;

  if (/^[\w-]{11}$/.test(s)) {
    return { url: `https://www.youtube.com/watch?v=${s}`, videoId: s, site: 'YouTube' };
  }

  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;

  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.username || u.password || (u.port && !['80', '443'].includes(u.port))) return null;

  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (YT_HOSTS.includes(host)) {
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
    return { url: `https://www.youtube.com/watch?v=${id}`, videoId: id, site: 'YouTube' };
  }

  const site = siteFor(u.hostname);
  if (!site || u.pathname === '/' || u.pathname === '') return null;
  // Canonical form: https, no port, no fragment, no tracking parameters.
  u.protocol = 'https:';
  u.port = '';
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) {
    if (/^(utm_|fbclid|igsh|igshid|si$|_r$|_t$|share_|is_from_webapp|sender_device|ref)/i.test(k)) {
      u.searchParams.delete(k);
    }
  }
  return { url: u.href, videoId: null, site: site.name, login: !!site.login };
}

module.exports = {
  ERRORS,
  YtdlpError,
  RETRYABLE,
  err,
  binary,
  hasBinary,
  cookiesFile,
  mapError,
  dumpJson,
  pickAudio,
  pickAac,
  pickBestAudio,
  audioBitrate,
  formatBytes,
  videoOptions,
  pickVideoFormat,
  jobArgs,
  parseProgress,
  parseFile,
  run,
  killTree,
  sanitizeFilename,
  estimateSize,
  normalizeInput,
  pickAudioSource,
  isDegraded,
  unsupportedSite,
  SITES,
  version,
  update,
};
