// Shared YouTube helper for Vercel serverless functions.
// Uses the public YouTube InnerTube player API (pure fetch - no binaries, no
// heavy libs, fits serverless limits).
// GitHub refs: https://github.com/yt-dlp/yt-dlp (same endpoint + headers yt-dlp uses)
//
// Why the extra headers/tokens: YouTube bot-checks datacenter IPs (Vercel).
// A bare request gets "Video unavailable: Sign in to confirm you're not a bot".
// To pass, we send what a real client sends:
//   1. a matching User-Agent + X-YouTube-Client-Name/Version headers
//   2. a visitorData session token fetched from youtube.com (cached per instance)
//   3. Origin / Referer / consent cookie
// We then fall back across several InnerTube clients until one is playable.

const PLAYER_URL =
  'https://www.youtube.com/youtubei/v1/player?key=AIzaSyA8eiZmM1FaDVjRy-df2KTi0O5Bxw8k1Co&prettyPrint=false';

const CONSENT_COOKIE = 'SOCS=CAI'; // skips YouTube's consent interstitial
const HOMEPAGE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Optional: real signed-in YouTube cookies (env var YOUTUBE_COOKIES, set in
// Vercel dashboard). The bot check says "Sign in to confirm..." - sending a
// logged-in session satisfies it directly. Format: the Cookie header string
// exported from a browser while logged into YouTube (e.g. via a
// "Get cookies.txt" extension, then paste the values as "A=b; C=d; ...").
function cookieHeader() {
  const extra = (process.env.YOUTUBE_COOKIES || '').trim();
  return extra ? `${CONSENT_COOKIE}; ${extra}` : CONSENT_COOKIE;
}

// Logged-in cookies need a matching SAPISIDHASH Authorization header,
// otherwise YouTube ignores the session. Same scheme yt-dlp uses:
// SAPISIDHASH <unixts>_<sha1("ts sapisid https://www.youtube.com")>
function authHeaders() {
  const raw = (process.env.YOUTUBE_COOKIES || '').trim();
  if (!raw) return {};
  const jar = {};
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) jar[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  const sapisid = jar.SAPISID || jar['__Secure-3PAPISID'] || jar['__Secure-1PAPISID'];
  if (!sapisid) return {};
  const ts = Math.floor(Date.now() / 1000);
  const sha1 = (s) => require('crypto').createHash('sha1').update(s).digest('hex');
  const origin = 'https://www.youtube.com';
  const schemes = [];
  if (jar.SAPISID) schemes.push('SAPISIDHASH');
  if (jar['__Secure-1PAPISID']) schemes.push('SAPISID1PHASH');
  if (jar['__Secure-3PAPISID']) schemes.push('SAPISID3PHASH');
  const auth = schemes
    .map((sch) => {
      const sid = sch === 'SAPISIDHASH' ? jar.SAPISID : sch === 'SAPISID1PHASH' ? jar['__Secure-1PAPISID'] : jar['__Secure-3PAPISID'];
      return `${sch} ${ts}_${sha1(`${ts} ${sid} ${origin}`)}`;
    })
    .join(' ');
  return { Authorization: auth, 'X-Origin': origin, 'X-Youtube-Bootstrap-Logged-In': 'true' };
}

// InnerTube clients, ordered best-first. Versions/UA from yt-dlp's
// INNERTUBE_CLIENTS (yt_dlp/extractor/youtube/_base.py).
// visionos/tv need no JS player and no PO token for stream URLs.
const CLIENTS = [
  {
    name: 'VISIONOS',
    version: '1.02',
    nameId: '101',
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
    client: {
      deviceMake: 'Apple',
      deviceModel: 'RealityDevice17,1',
      osName: 'visionOS',
      osVersion: '26.5.23O471',
    },
  },
  {
    name: 'TVHTML5',
    version: '5.20260707',
    nameId: '7',
    ua: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 2.4.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/2.4.0 TV Safari/538.1',
    client: {
      deviceMake: 'Samsung',
      deviceModel: 'UKS9800',
      osName: 'Tizen',
      osVersion: '2.4.0',
    },
  },
  {
    name: 'ANDROID',
    version: '21.26.364',
    nameId: '3',
    ua: 'com.google.android.youtube/21.26.364 (Linux; U; Android 11) gzip',
    client: { androidSdkVersion: 30, osName: 'Android', osVersion: '11' },
  },
  {
    name: 'IOS',
    version: '21.26.4',
    nameId: '5',
    ua: 'com.google.ios.youtube/21.26.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)',
    client: {
      deviceMake: 'Apple',
      deviceModel: 'iPhone16,2',
      osName: 'iPhone',
      osVersion: '18.3.2.22D82',
    },
  },
  {
    name: 'WEB',
    version: '2.20260708.00.00',
    nameId: '1',
    ua: HOMEPAGE_UA,
    client: {},
  },
];

function extractVideoId(url) {
  if (typeof url !== 'string') return null;
  const m = url.trim().match(
    /(?:youtube\.com\/(?:watch\?[^#]*v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/
  );
  return m ? m[1] : null;
}

function sanitizeFilename(name) {
  return (
    (name || 'audio').replace(/[<>:"/\\|?*\x00-\x1F]/g, '').slice(0, 100).trim() ||
    'audio'
  );
}

// visitorData identifies this instance's "browser session" to YouTube.
// Cached in module scope so warm serverless instances don't refetch it.
const visitorCache = { value: null, at: 0 };
const VISITOR_TTL_MS = 10 * 60 * 1000;

async function getVisitorData() {
  if (visitorCache.value && Date.now() - visitorCache.at < VISITOR_TTL_MS) {
    return visitorCache.value;
  }
  try {
    const r = await fetch('https://www.youtube.com/', {
      // fail fast: if this hangs/fails we still recover via the harvested
      // visitorData inside getPlayerData()
      signal: AbortSignal.timeout(5000),
      headers: {
        'User-Agent': HOMEPAGE_UA,
        'Accept-Language': 'en-US,en;q=0.9',
        Cookie: cookieHeader(),
      },
    });
    const html = await r.text();
    const m =
      html.match(/"VISITOR_DATA":"([^"]+)"/) ||
      html.match(/"visitorData":"([^"]+)"/);
    if (m && m[1]) {
      visitorCache.value = m[1];
      visitorCache.at = Date.now();
      return m[1];
    }
  } catch {
    // fall through - player call still works without visitorData, just weaker
  }
  return visitorCache.value;
}

async function callPlayer(videoId, cfg, visitorData) {
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': cfg.ua,
    'X-YouTube-Client-Name': cfg.nameId,
    'X-YouTube-Client-Version': cfg.version,
    Origin: 'https://www.youtube.com',
    Referer: 'https://www.youtube.com/',
    'Accept-Language': 'en-US,en;q=0.9',
    Cookie: cookieHeader(),
    ...authHeaders(),
  };
  if (visitorData) headers['X-Goog-Visitor-Id'] = visitorData;

  const client = {
    clientName: cfg.name,
    clientVersion: cfg.version,
    hl: 'en',
    timeZone: 'UTC',
    utcOffsetMinutes: 0,
    ...cfg.client,
  };
  if (visitorData) client.visitorData = visitorData;

  const r = await fetch(PLAYER_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(10000),
    headers,
    body: JSON.stringify({
      videoId,
      context: { client },
      playbackContext: {
        contentPlaybackContext: { html5Preference: 'HTML5_PREF_WANTS' },
      },
      contentCheckOk: true,
      racyCheckOk: true,
    }),
  });
  if (!r.ok) throw new Error('YouTube API error: ' + r.status);
  const data = await r.json();

  // The response carries a session-bound visitorData; keep it fresh.
  const respVd = data.responseContext?.visitorData;
  if (respVd) {
    visitorCache.value = respVd;
    visitorCache.at = Date.now();
  }
  return data;
}

function hasPlayableAudio(data) {
  const sd = data.streamingData || {};
  const all = [...(sd.formats || []), ...(sd.adaptiveFormats || [])];
  return all.some(
    (f) => f.mimeType && f.mimeType.startsWith('audio/') && f.url
  );
}

// Try each client until one returns a playable response.
// opts.requireAudioUrl: also require direct (non-ciphered) audio stream URLs,
// so the download endpoint never gets a response it can't use.
// If nothing is playable, the last response is returned so callers can show
// YouTube's own reason (e.g. "Sign in to confirm you're not a bot").
//
// Self-healing token: when YouTube answers LOGIN_REQUIRED ("Sign in to
// confirm you're not a bot"), the response still carries a fresh visitorData
// issued to *this* IP. callPlayer() caches it, so we retry the same client
// with it - this flips the bot check to OK with direct stream URLs. It's what
// makes the code work on datacenter IPs (Vercel) where the homepage fetch
// for a token fails or returns a weak one.
async function getPlayerData(videoId, opts = {}) {
  const requireAudioUrl = !!opts.requireAudioUrl;
  const trace = Array.isArray(opts.trace) ? opts.trace : null;
  let visitorData = await getVisitorData();
  let last = null;

  const countAudioUrls = (d) => {
    const sd = d.streamingData || {};
    return [...(sd.formats || []), ...(sd.adaptiveFormats || [])].filter(
      (f) => (f.mimeType || '').startsWith('audio/') && f.url
    ).length;
  };

  for (const cfg of CLIENTS) {
    let data;
    let tokenNote = visitorData ? 'homepage' : 'none';
    try {
      data = await callPlayer(videoId, cfg, visitorData);
    } catch (e) {
      trace?.push({ client: cfg.name, error: String(e.message || e).slice(0, 80) });
      continue; // network/HTTP error for this client - try the next one
    }

    if (data.playabilityStatus?.status === 'LOGIN_REQUIRED') {
      const harvested = visitorCache.value; // token from this very response
      if (harvested && harvested !== visitorData) {
        visitorData = harvested;
        tokenNote = 'harvested-retry';
        try {
          data = await callPlayer(videoId, cfg, visitorData);
        } catch {
          // keep the LOGIN_REQUIRED response; handled below
        }
      } else {
        tokenNote = harvested ? 'same-token-skip-retry' : 'no-token-skip-retry';
      }
    }

    trace?.push({
      client: cfg.name,
      status: data.playabilityStatus?.status || '?',
      reason: String(data.playabilityStatus?.reason || '').slice(0, 60),
      token: tokenNote,
      audioUrls: countAudioUrls(data),
    });

    last = data;
    if (data.playabilityStatus?.status !== 'OK') continue;
    if (requireAudioUrl && !hasPlayableAudio(data)) continue;
    return data;
  }
  if (last) return last;
  throw new Error('All YouTube clients failed');
}

function pickBestAudio(playerData) {
  const sd = playerData.streamingData || {};
  const all = [...(sd.formats || []), ...(sd.adaptiveFormats || [])];
  const audio = all.filter(
    (f) => f.mimeType && f.mimeType.startsWith('audio/') && f.url
  );
  if (!audio.length) throw new Error('No playable audio formats (video may be restricted)');
  // Prefer m4a (plays on iPhone/Android/Windows) over opus/webm, then highest bitrate
  const mp4 = audio.filter((f) => (f.mimeType || '').includes('mp4'));
  const pool = mp4.length ? mp4 : audio;
  pool.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  return pool[0];
}

function extFor(mime) {
  if (!mime) return 'm4a';
  if (mime.includes('webm') || mime.includes('opus')) return 'webm';
  if (mime.includes('mp4')) return 'm4a';
  return 'm4a';
}

module.exports = { extractVideoId, sanitizeFilename, getPlayerData, pickBestAudio, extFor, CLIENTS, callPlayer, getVisitorData };
