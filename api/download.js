// GET /api/download?url=YOUTUBE_URL -> streams best audio (m4a/webm).
// Vercel serverless version: proxies the direct audio stream with a nice
// filename. No conversion here (no ffmpeg on serverless) - the file is the
// original YouTube audio (plays everywhere; rename to .mp3 is NOT needed,
// most players handle .m4a). The VPS/local server.js still gives real MP3.
const { extractVideoId, sanitizeFilename, getPlayerData, pickBestAudio, extFor } = require('./_yt');

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const videoId = extractVideoId(req.query?.url || '');
    if (!videoId) return res.status(400).send('Invalid YouTube URL');

    const data = await getPlayerData(videoId, { requireAudioUrl: true });
    if (data.playabilityStatus?.status !== 'OK') {
      const reason = data.playabilityStatus?.reason || data.playabilityStatus?.status;
      return res.status(400).send('Video unavailable: ' + reason);
    }
    const title = sanitizeFilename(data.videoDetails?.title);

    let audio = pickBestAudio(data);
    let lastErr = '';

    // googlevideo can reject datacenter IPs or hand out a URL that went bad.
    // Try a few ways before giving up:
    //   variant 0: plain browser-ish request (works from residential IPs)
    //   variant 1: + Referer and a Range header (looks like a real media player;
    //               some CDNs that block plain GETs allow range requests)
    // then, if still failing, get a freshly issued URL from a new player call.
    const tryFetch = async (url, variant) => {
      const headers = {
        'User-Agent': BROWSER_UA,
        'Accept-Language': 'en-US,en;q=0.9',
      };
      if (variant === 1) {
        headers.Referer = 'https://www.youtube.com/';
        headers.Range = 'bytes=0-';
      }
      const ctrl = new AbortController();
      // only guards connect/headers; cleared on success so the body can stream
      const timer = setTimeout(() => ctrl.abort(), 15000);
      try {
        const r = await fetch(url, { headers, signal: ctrl.signal });
        clearTimeout(timer);
        if (r.ok && r.body) return r;
        let snippet = '';
        try {
          snippet = (await r.text()).slice(0, 160).replace(/\s+/g, ' ');
        } catch {}
        lastErr = `HTTP ${r.status}${snippet ? ' ' + snippet : ''}`;
      } catch (e) {
        clearTimeout(timer);
        lastErr = String((e && e.message) || e).slice(0, 160);
      }
      return null;
    };

    let upstream = (await tryFetch(audio.url, 0)) || (await tryFetch(audio.url, 1));

    if (!upstream) {
      // The URL may have been issued to a flagged session - ask for a fresh one.
      try {
        const fresh = await getPlayerData(videoId, { requireAudioUrl: true });
        if (fresh.playabilityStatus?.status === 'OK') {
          audio = pickBestAudio(fresh);
          upstream = (await tryFetch(audio.url, 0)) || (await tryFetch(audio.url, 1));
        }
      } catch (e) {
        lastErr = lastErr || String(e.message || e).slice(0, 160);
      }
    }

    if (!upstream) {
      return res.status(502).send('Could not fetch audio stream: ' + lastErr);
    }

    const ext = extFor(audio.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${title}.${ext}"`);
    res.setHeader('Content-Type', ext === 'webm' ? 'audio/webm' : 'audio/mp4');
    const len = upstream.headers.get('content-length');
    if (len) res.setHeader('Content-Length', len);
    else if (audio.contentLength) res.setHeader('Content-Length', audio.contentLength);

    // Stream through without buffering (fits serverless time limits)
    const reader = upstream.body.getReader();
    req.on?.('close', () => reader.cancel().catch(() => {}));
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(value)) await new Promise((r) => res.once('drain', r));
    }
    res.end();
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.status(500).send('Download failed: ' + e.message);
    else res.end();
  }
};
