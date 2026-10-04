// GET /api/download?url=YOUTUBE_URL -> streams best audio (m4a/webm).
// Vercel serverless version: proxies the direct audio stream with a nice
// filename. No conversion here (no ffmpeg on serverless) - the file is the
// original YouTube audio (plays everywhere; rename to .mp3 is NOT needed,
// most players handle .m4a). The VPS/local server.js still gives real MP3.
const { extractVideoId, sanitizeFilename, getPlayerData, pickBestAudio, extFor } = require('./_yt');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const videoId = extractVideoId(req.query?.url || '');
    if (!videoId) return res.status(400).send('Invalid YouTube URL');

    const data = await getPlayerData(videoId);
    if (data.playabilityStatus?.status !== 'OK') {
      return res.status(400).send('Video unavailable');
    }
    const audio = pickBestAudio(data);
    const title = sanitizeFilename(data.videoDetails?.title);
    const ext = extFor(audio.mimeType);

    const upstream = await fetch(audio.url);
    if (!upstream.ok || !upstream.body) {
      return res.status(502).send('Could not fetch audio stream');
    }

    res.setHeader('Content-Disposition', `attachment; filename="${title}.${ext}"`);
    res.setHeader(
      'Content-Type',
      ext === 'webm' ? 'audio/webm' : 'audio/mp4'
    );
    if (audio.contentLength) res.setHeader('Content-Length', audio.contentLength);

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
