// encoder v2.1 — masterId support
const express = require('express');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const os = require('os');

const APP_SECRET = process.env.ENCODE_SECRET || 'secret';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const GCS_BUCKET = process.env.GCS_BUCKET_NAME || 'maastr-vibedev-audio';
const GCS_KEY_B64 = process.env.GCS_SERVICE_ACCOUNT_KEY || '';

const app = express();
app.use(express.json());

// Get GCS access token using service account JWT
async function getGCSToken() {
  const keyJson = Buffer.from(GCS_KEY_B64, 'base64').toString('utf8');
  const key = JSON.parse(keyJson);
  const now = Math.floor(Date.now() / 1000);
  const { createSign } = require('crypto');
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/devstorage.read_write',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  })).toString('base64url');
  const sign = createSign('RSA-SHA256');
  sign.update(header + '.' + payload);
  const sig = sign.sign(key.private_key, 'base64url');
  const jwt = header + '.' + payload + '.' + sig;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + jwt
  });
  const data = await res.json();
  return data.access_token;
}

// Upload a file to GCS
async function uploadToGCS(token, objectKey, filePath, contentType) {
  const fileBuffer = fs.readFileSync(filePath);
  const res = await fetch(
    `https://storage.googleapis.com/upload/storage/v1/b/${GCS_BUCKET}/o?uploadType=media&name=${encodeURIComponent(objectKey)}`,
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': contentType,
        'Content-Length': fileBuffer.length
      },
      body: fileBuffer
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error('GCS upload failed: ' + err.substring(0, 200));
  }
  return `https://storage.googleapis.com/${GCS_BUCKET}/${objectKey}`;
}

// Update track hls_url in Supabase
async function updateTrackHLS(trackId, hlsUrl) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/tracks?id=eq.${trackId}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ hls_url: hlsUrl })
  });
  return res.ok;
}

async function updateMasterHLS(masterId, hlsUrl) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/masters?id=eq.${masterId}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ hls_url: hlsUrl, status: 'ready', completed_at: new Date().toISOString() })
  });
  return res.ok;
}

app.get('/', (req, res) => res.json({ status: 'ok', service: 'maastr-encoder', storage: 'gcs' }));

app.post('/encode', async (req, res) => {
  const { trackId, masterId, projectId, audioUrl, secret } = req.body;
  if (secret !== APP_SECRET) return res.status(403).json({ error: 'forbidden' });
  if ((!trackId && !masterId) || !projectId || !audioUrl) return res.status(400).json({ error: 'trackId or masterId, projectId, audioUrl required' });

  res.json({ status: 'encoding', trackId: trackId || masterId });

  // Run encoding in background
  (async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maastr-'));
    const wavPath = path.join(tmpDir, 'source.wav');
    const hlsDir = path.join(tmpDir, 'hls');
    fs.mkdirSync(hlsDir);

    try {
      console.log('[encode] Downloading WAV:', audioUrl);
      const wavRes = await fetch(audioUrl);
      if (!wavRes.ok) throw new Error('Failed to download WAV: ' + wavRes.status);
      const wavBuffer = await wavRes.buffer();
      fs.writeFileSync(wavPath, wavBuffer);
      console.log('[encode] Downloaded', wavBuffer.length, 'bytes');

      // ffmpeg: WAV -> HLS (AAC, 128k, 10s segments)
      const m3u8Path = path.join(hlsDir, 'playlist.m3u8');
      await new Promise((resolve, reject) => {
        execFile('ffmpeg', [
          '-i', wavPath,
          '-c:a', 'aac',
          '-b:a', '192k',
          '-hls_time', '10',
          '-hls_list_size', '0',
          '-hls_segment_filename', path.join(hlsDir, 'segment_%04d.ts'),
          '-hls_flags', 'independent_segments',
          m3u8Path
        ], (err, stdout, stderr) => {
          if (err) { console.error('[encode] ffmpeg error:', stderr); reject(err); }
          else resolve();
        });
      });
      console.log('[encode] ffmpeg done');

      // Upload all HLS files to GCS
      const token = await getGCSToken();
      const hlsBase = `projects/${projectId}/hls/${masterId || trackId}`;
      const files = fs.readdirSync(hlsDir);

      for (const file of files) {
        const filePath = path.join(hlsDir, file);
        const objectKey = `${hlsBase}/${file}`;
        const contentType = file.endsWith('.m3u8') ? 'application/x-mpegURL' : 'video/MP2T';
        await uploadToGCS(token, objectKey, filePath, contentType);
        console.log('[encode] Uploaded', objectKey);
      }

      const hlsUrl = `https://storage.googleapis.com/${GCS_BUCKET}/${hlsBase}/playlist.m3u8`;
      if (masterId) {
        await updateMasterHLS(masterId, hlsUrl);
      } else {
        await updateTrackHLS(trackId, hlsUrl);
      }
      console.log('[encode] Done! hls_url:', hlsUrl);

    } catch (e) {
      console.error('[encode] FAILED:', e.message);
    } finally {
      // Cleanup temp files
      try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
    }
  })();
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log('maastr-encoder listening on', PORT));
