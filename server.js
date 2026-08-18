const express = require('express');
const expressWs = require('express-ws');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { v4: uuidv4 } = require('uuid');

const app = express();
expressWs(app);

const BASE_DIR     = __dirname;
const PUBLIC_DIR   = path.join(BASE_DIR, 'public');
const IMAGES_DIR   = path.join(BASE_DIR, 'images');
const DOWNLOADS_DIR = path.join(BASE_DIR, 'downloads');

if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });

if (!fs.existsSync(PUBLIC_DIR)) {
  console.error('\n[ERROR] "public/" folder not found next to server.js');
  process.exit(1);
}

app.use(express.json());
app.use(express.static(PUBLIC_DIR));
app.use('/images', express.static(IMAGES_DIR));

app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

const rateLimiters = new Map();
const BUCKET_CAPACITY = 3;        // Max bursts allowed concurrently 
const REFILL_RATE_MS  = 30000;    // Time required to regenerate 1 operational token (30 seconds)

function checkSpamRateLimit(ip) {
  const now = Date.now();
  if (!rateLimiters.has(ip)) {
    rateLimiters.set(ip, { tokens: BUCKET_CAPACITY, lastRefill: now });
    return true;
  }

  const limitData = rateLimiters.get(ip);
  // Calculate tokens regenerated over time delta elapsed
  const elapsed = now - limitData.lastRefill;
  const tokensToAdd = Math.floor(elapsed / REFILL_RATE_MS);

  if (tokensToAdd > 0) {
    limitData.tokens = Math.min(BUCKET_CAPACITY, limitData.tokens + tokensToAdd);
    limitData.lastRefill = limitData.lastRefill + (tokensToAdd * REFILL_RATE_MS);
  }

  if (limitData.tokens > 0) {
    limitData.tokens -= 1;
    return true;
  }

  return false; 
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of rateLimiters.entries()) {
    if (now - data.lastRefill > 300000) { // Inactive for over 5 minutes
      rateLimiters.delete(ip);
    }
  }
}, 60000);

const clients = new Map();

app.ws('/ws', (ws, req) => {
  const clientId = uuidv4();
  clients.set(clientId, ws);
  ws.send(JSON.stringify({ type: 'connected', id: clientId }));
  ws.on('close', () => { clients.delete(clientId); });
});

function sendToClient(clientId, data) {
  const ws = clients.get(clientId);
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(data));
  }
}

app.post('/api/info', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  const proc = spawn('yt-dlp', [
    '--dump-json',
    '--flat-playlist',
    '--no-warnings',
    url
  ]);

  let stdout = '';
  proc.stdout.on('data', data => { stdout += data; });

  proc.on('close', code => {
    if (code !== 0) return res.status(500).json({ error: 'Failed to extract media information info' });

    try {
      const lines = stdout.trim().split('\n').filter(Boolean);
      if (lines.length === 0) throw new Error('No items found');

      const isPlaylist = lines.length > 1 || JSON.parse(lines[0])._type === 'playlist';
      let items = [];

      if (lines.length === 1 && !isPlaylist) {
        const meta = JSON.parse(lines[0]);
        items.push({
          id: meta.id,
          title: meta.title || 'Untitled Track',
          uploader: meta.uploader || meta.artist || 'Unknown',
          duration: meta.duration,
          thumbnail: meta.thumbnail,
          url: meta.webpage_url || url
        });
      } else {
        lines.forEach(line => {
          const meta = JSON.parse(line);
          items.push({
            id: meta.id || meta.url,
            title: meta.title || 'Untitled Track',
            uploader: meta.uploader || 'Playlist Track',
            duration: meta.duration,
            thumbnail: meta.thumbnails?.[0]?.url || meta.thumbnail,
            url: meta.url || meta.webpage_url
          });
        });
      }
      res.json({ isPlaylist, items });
    } catch (err) {
      res.status(500).json({ error: 'Data parse failure: ' + err.message });
    }
  });
});

app.post('/api/convert', (req, res) => {
  const { url, clientId, title, quality, normalize, speed, pitch } = req.body;
  
  // Resolve requesting client location IP reference profile context
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  // Execute smart algorithmic token-bucket validator defense line
  if (!checkSpamRateLimit(clientIp)) {
    return res.status(429).json({ 
      error: 'Rate limit exceeded. System anti-spam mechanism active. Please wait a few seconds before trying again.' 
    });
  }

  if (!clientId || !clients.has(clientId)) {
    return res.status(400).json({ error: 'Invalid or missing active Client Connection ID' });
  }

  const jobId = uuidv4();
  // Sanitize title safely for file outputs
  const safeTitle = (title || 'Track').replace(/[/\\?%*:|"<>\s]/g, '_');
  const outputPath = path.join(DOWNLOADS_DIR, `${jobId}.%(ext)s`);

  let filters = [];
  if (speed && parseFloat(speed) !== 1.0) filters.push(`atempo=${speed}`);
  if (pitch && parseInt(pitch) !== 0) {
    const factor = Math.pow(2, parseInt(pitch) / 12);
    filters.push(`asetrate=44100*${factor},aresample=44100`);
  }
  if (normalize) filters.push('loudnorm=I=-16:TP=-1.5:LRA=11');

  let ytdlArgs = [
    '-x',
    '--audio-format', 'mp3',
    '--audio-quality', quality === '320' ? '0' : quality === '256' ? '2' : quality === '192' ? '5' : '7',
    '--no-warnings',
    '--prefer-ffmpeg',
    '-o', outputPath
  ];

  if (filters.length > 0) {
    ytdlArgs.push('--postprocessor-args', `ffmpeg:-af ${filters.join(',')}`);
  }

  ytdlArgs.push(url);

  const proc = spawn('yt-dlp', ytdlArgs);
  sendToClient(clientId, { type: 'progress', jobId, stage: 'downloading', percent: 25 });

  proc.on('close', code => {
    if (code === 0) {
      sendToClient(clientId, { type: 'progress', jobId, stage: 'saving', percent: 90 });
      sendToClient(clientId, {
        type: 'done',
        jobId,
        downloadUrl: `/api/download/${jobId}.mp3`,
        filename: safeTitle
      });
    } else {
      sendToClient(clientId, { type: 'error', jobId, message: 'Conversion failed during audio extraction processing loop.' });
    }
  });

  proc.on('error', (err) => {
    sendToClient(clientId, { type: 'error', jobId, message: 'Process initialization failure: ' + err.message });
  });

  res.json({ jobId });
});

app.get('/api/download/:filename', (req, res) => {
  const safe = path.basename(req.params.filename);
  const file = path.join(DOWNLOADS_DIR, safe);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'File not found' });

  
  let rawName = req.query.name || 'Track';
  if (!rawName.startsWith('mp3.orvonex.online')) {
    rawName = `mp3.orvonex.online - ${rawName}`;
  }
  
  const finalFilename = `${rawName}.mp3`;

  res.download(file, finalFilename, err => {
    if (!err) {
      // Unlink/cleanup storage after 5 seconds to preserve disk space safely
      setTimeout(() => { try { fs.unlinkSync(file); } catch {} }, 5000);
    }
  });
});

function findFreePort(start) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(start, () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', () => resolve(findFreePort(start + 1)));
  });
}

findFreePort(3001).then(port => {
  app.listen(port, () => {
    console.log(`\n==================================================`);
    console.log(` MP3 Active on: http://localhost:${port}`);
    console.log(`==================================================\n`);
  });
});