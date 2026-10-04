// YouTube MP3 Downloader - backend
// GitHub libs used:
//  - yt-dlp (https://github.com/yt-dlp/yt-dlp) - standalone bin/yt-dlp.exe, no Python needed
//  - ffmpeg (https://github.com/ffmpeg/ffmpeg via ffmpeg-static npm) - convert to MP3
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { spawn, execFile } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const app = express();
const PORT = process.env.PORT || 3000;
const YTDLP_EXE = path.join(__dirname, 'bin', 'yt-dlp.exe');
const YTDLP_BIN = path.join(__dirname, 'bin', 'yt-dlp');
const YTDLP = fs.existsSync(YTDLP_EXE) ? YTDLP_EXE : YTDLP_BIN;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function isValidYouTubeUrl(url) {
  if (typeof url !== 'string') return false;
  return /^(https?:\/\/)?(www\.|m\.|music\.)?(youtube\.com\/(watch\?|shorts\/|embed\/|live\/)|youtu\.be\/)[\w\-?=&#%.+/]+$/i.test(url.trim());
}

function sanitizeFilename(name) {
  return (name || 'audio').replace(/[<>:"/\\|?*\x00-\x1F]/g, '').slice(0, 100).trim() || 'audio';
}

function ytDlpJson(url) {
  return new Promise((resolve, reject) => {
    execFile(
      YTDLP,
      ['--dump-single-json', '--no-playlist', '--no-warnings', '--retries', '3', url],
      { maxBuffer: 30 * 1024 * 1024, timeout: 60000 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error((stderr || err.message).slice(0, 500)));
        try {
          resolve(JSON.parse(stdout));
        } catch (e) {
          reject(new Error('Failed to parse video info'));
        }
      }
    );
  });
}

// Get video info
app.post('/api/info', async (req, res) => {
  try {
    const { url } = req.body;
    if (!isValidYouTubeUrl(url)) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }
    if (!fs.existsSync(YTDLP)) {
      return res.status(500).json({ error: 'yt-dlp binary missing in bin/ folder' });
    }
    const d = await ytDlpJson(url.trim());
    res.json({
      title: d.title,
      author: d.uploader || d.channel,
      lengthSeconds: d.duration,
      thumbnail: d.thumbnail,
      thumbnails: d.thumbnails,
      videoId: d.id,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not fetch video info. ' + e.message });
  }
});

// Download as MP3
// GET /api/download?url=YOUTUBE_URL
app.get('/api/download', async (req, res) => {
  try {
    const url = (req.query.url || '').trim();
    if (!isValidYouTubeUrl(url)) {
      return res.status(400).send('Invalid YouTube URL');
    }

    // Get title first for a nice filename (fallback to generic)
    let title = 'audio';
    try {
      const d = await ytDlpJson(url);
      title = sanitizeFilename(d.title);
    } catch (e) {
      console.warn('info lookup failed, using generic filename:', e.message);
    }

    res.setHeader('Content-Disposition', `attachment; filename="${title}.mp3"`);
    res.setHeader('Content-Type', 'audio/mpeg');

    // 1) yt-dlp streams best audio to stdout
    const ytdlp = spawn(YTDLP, [
      '-f', 'bestaudio[protocol^=http]/bestaudio/best[protocol^=http]/best',
      '--no-playlist',
      '--no-warnings',
      '--retries', '3',
      '-o', '-',
      url,
    ]);

    // 2) ffmpeg converts whatever audio it gets -> 192k mp3 to stdout
    const ff = spawn(ffmpegPath, [
      '-i', 'pipe:0',
      '-vn',
      '-c:a', 'libmp3lame',
      '-b:a', '192k',
      '-f', 'mp3',
      'pipe:1',
    ]);

    ytdlp.stdout.pipe(ff.stdin);

    ytdlp.stderr.on('data', (d) => process.stderr.write('[yt-dlp] ' + d.toString().slice(0, 200)));
    ff.stderr.on('data', () => {}); // quiet ffmpeg chatter

    let failed = false;
    const fail = (msg) => {
      if (failed) return;
      failed = true;
      console.error(msg);
      try { ytdlp.kill(); } catch {}
      try { ff.kill(); } catch {}
      if (!res.headersSent) res.status(500).send(msg);
      else res.end();
    };

    ytdlp.on('error', (e) => fail('Download failed: ' + e.message));
    ff.on('error', (e) => fail('Conversion failed: ' + e.message));
    ff.on('close', (code) => {
      if (code !== 0 && !res.writableEnded) fail('Conversion failed (ffmpeg exit ' + code + ')');
    });

    ff.stdout.pipe(res);
    req.on('close', () => {
      try { ytdlp.kill(); } catch {}
      try { ff.kill(); } catch {}
    });
  } catch (e) {
    console.error(e);
    res.status(500).send('Download failed: ' + e.message);
  }
});

app.listen(PORT, () => {
  console.log(`YT MP3 Downloader running at http://localhost:${PORT}`);
  console.log('yt-dlp:', fs.existsSync(YTDLP) ? 'found' : 'MISSING (put yt-dlp.exe in bin/)');
});
