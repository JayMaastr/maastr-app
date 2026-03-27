'use strict';
const http = require('http');
const https = require('https');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 3001;
const R2_WORKER = process.env.R2_WORKER_URL || 'https://maastr-upload.jay-288.workers.dev';
const SB_URL = process.env.SUPABASE_URL || 'https://btgednpwlkimgjwcopru.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const ENCODE_SECRET = process.env.ENCODE_SECRET || 'maastr-encode-secret-2026';

// Simple fetch wrapper for Node.js 18+
const fetchUrl = fetch;

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    protocol.get(url, res => {
      if (res.statusCode !== 200) { reject(new Error('Download failed: ' + res.statusCode)); return; }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', reject);
  });
}

function runFFmpeg(inputPath, outputDir) {
  const m3u8 = path.join(outputDir, 'stream.m3u8');
  // Lossless FLAC in fMP4 containers — exactly what Samply uses
  const cmd = [
    'ffmpeg', '-y',
    '-i', JSON.stringify(inputPath),
    '-c:a flac',
    '-f hls',
    '-hls_time 5',
    '-hls_playlist_type vod',
    '-hls_segment_type fmp4',
    '-hls_fmp4_init_filename init.mp4',
    '-hls_list_size 0',
    '-hls_flags single_file+temp_file',
    JSON.stringify(m3u8),
  ].join(' ');
  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) { console.error('[ffmpeg] error:', stderr.slice(-500)); reject(err); }
      else resolve(m3u8);
    });
  });
}

async function uploadSegmentToR2(localPath, projectId, trackId) {
  const filename = 'hls/' + trackId + '/' + path.basename(localPath);
  const content = fs.readFileSync(localPath);
  const ct = localPath.endsWith('.m3u8') ? 'application/x-mpegURL'
             : localPath.endsWith('.mp4') ? 'video/mp4'
             : 'application/octet-stream';
  const url = R2_WORKER + '?project=' + projectId + '&name=' + encodeURIComponent(filename);
  const res = await fetchUrl(url, { method: 'POST', headers: { 'Content-Type': ct }, body: content });
  const json = await res.json();
  if (!json.url) throw new Error('R2 upload failed for ' + filename);
  return json.url;
}

async function updateTrackDB(trackId, hlsUrl, durationSec) {
  const res = await fetchUrl(SB_URL + '/rest/v1/tracks?id=eq.' + trackId, {
    method: 'PATCH',
    headers: {
      'apikey': SB_KEY,
      'Authorization': 'Bearer ' + SB_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({ hls_url: hlsUrl, duration: durationSec }),
  });
  return res.status;
}

async function processTrack(trackId, projectId, audioUrl) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maastr-'));
  const wavPath = path.join(tmpDir, 'input.wav');
  const hlsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maastr-hls-'));
  try {
    console.log('[encode] downloading WAV for track', trackId, '...');
    await download(audioUrl, wavPath);
    const wavSize = fs.statSync(wavPath).size;
    console.log('[encode] WAV downloaded, size:', (wavSize/1024/1024).toFixed(1), 'MB');

    console.log('[encode] running ffmpeg...');
    const m3u8Path = await runFFmpeg(wavPath, hlsDir);
    console.log('[encode] ffmpeg done');

    // Upload all segments + init + m3u8 to R2
    const files = fs.readdirSync(hlsDir);
    let m3u8Url = null;
    for (const f of files) {
      const localPath = path.join(hlsDir, f);
      const url = await uploadSegmentToR2(localPath, projectId, trackId);
      if (f === 'stream.m3u8') m3u8Url = url;
      console.log('[encode] uploaded', f, '->', url.split('/').slice(-2).join('/'));
    }

    // Get duration from ffprobe
    const durationSec = await new Promise(resolve => {
      exec('ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 ' + JSON.stringify(wavPath),
        (err, stdout) => resolve(err ? 0 : parseFloat(stdout.trim()) || 0));
    });

    // Update Supabase
    const status = await updateTrackDB(trackId, m3u8Url, durationSec);
    console.log('[encode] DB updated, status:', status, 'hls_url:', m3u8Url);
    return { ok: true, hlsUrl: m3u8Url, durationSec };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(hlsDir, { recursive: true, force: true });
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200); res.end('ok'); return;
  }
  if (req.method !== 'POST' || req.url !== '/encode') {
    res.writeHead(404); res.end('Not found'); return;
  }
  // Verify secret
  const auth = req.headers['x-encode-secret'];
  if (auth !== ENCODE_SECRET) {
    res.writeHead(401); res.end('Unauthorized'); return;
  }
  let body = '';
  req.on('data', c => body += c);
  req.on('end', async () => {
    let payload;
    try { payload = JSON.parse(body); } catch { res.writeHead(400); res.end('Bad JSON'); return; }
    const { trackId, projectId, audioUrl } = payload;
    if (!trackId || !audioUrl) { res.writeHead(400); res.end('Missing fields'); return; }
    // Respond 202 immediately, process in background
    res.writeHead(202, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({ status: 'encoding', trackId }));
    // Background encode
    processTrack(trackId, projectId, audioUrl)
      .then(r => console.log('[encode] done:', trackId, r.durationSec + 's'))
      .catch(e => console.error('[encode] failed:', trackId, e.message));
  });
});

server.listen(PORT, () => console.log('[maastr-encoder] listening on port', PORT));
