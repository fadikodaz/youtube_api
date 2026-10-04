// Shared YouTube helper for Vercel serverless functions.
// Uses the public YouTube InnerTube player API with the ANDROID client
// (pure fetch - no binaries, no heavy libs, fits serverless limits).
// GitHub refs: https://github.com/yt-dlp/yt-dlp (same endpoint yt-dlp uses)

const PLAYER_URL =
  'https://www.youtube.com/youtubei/v1/player?key=AIzaSyA8eiZmM1FaDVjRy-df2KTi0O5Bxw8k1Co';

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

async function getPlayerData(videoId) {
  const r = await fetch(PLAYER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      videoId,
      context: {
        client: {
          clientName: 'ANDROID',
          clientVersion: '20.10.38',
          androidSdkVersion: 35,
        },
      },
    }),
  });
  if (!r.ok) throw new Error('YouTube API error: ' + r.status);
  return r.json();
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

module.exports = { extractVideoId, sanitizeFilename, getPlayerData, pickBestAudio, extFor };
