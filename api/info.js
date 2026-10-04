// POST /api/info  { url } -> { title, author, lengthSeconds, thumbnail, videoId }
// Vercel serverless version (no binaries). Local express server.js keeps the MP3 path.
const { extractVideoId, getPlayerData } = require('./_yt');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    const videoId = extractVideoId((body || {}).url || '');
    if (!videoId) return res.status(400).json({ error: 'Invalid YouTube URL' });

    const data = await getPlayerData(videoId);
    if (data.playabilityStatus?.status !== 'OK') {
      return res.status(400).json({
        error: 'Video unavailable: ' + (data.playabilityStatus?.reason || data.playabilityStatus?.status),
      });
    }
    const vd = data.videoDetails || {};
    const thumbs = vd.thumbnail?.thumbnails || [];
    res.json({
      title: vd.title,
      author: vd.author,
      lengthSeconds: Number(vd.lengthSeconds) || 0,
      thumbnail: thumbs[thumbs.length - 1]?.url || '',
      thumbnails: thumbs,
      videoId: vd.videoId || videoId,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not fetch video info. ' + e.message });
  }
};
