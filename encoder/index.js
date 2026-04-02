// encoder v3.0 — Cloud Run / ADC auth (no service account key needed on GCP)
const express = require('express');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const os = require('os');
const { GoogleAuth } = require('google-auth-library');

const APP_SECRET = process.env.ENCODE_SECRET || 'secret';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const GCS_BUCKET = process.env.GCS_BUCKET_NAME || 'maastr-vibedev-audio';

const gcsAuth = new GoogleAuth({
  scopes: 'https://www.googleapis.com/auth/devstorage.read_write'
});

// Get GCS access token — uses ADC on Cloud Run (service account), key file locally
async function getGCSToken() {
  const client = await gcsAuth.getClient();
  const tokenRes = await client.getAccessToken();
  return tokenRes.token;
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

const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'maastr-encoder', version: '3.0' }));
app.get('/', (req, res) => res.json({ status: 'ok', service: 'maastr-encoder', version: '3.0' }));

app.post('/encode', async (req, res) => {
  const { trackId, masterId, projectId, audioUrl, secret } = req.body;
  if (secret !== APP_SECRET) return res.status(403).json({ error: 'forbidden' });
  if ((!trackId && !masterId) || !projectId || !audioUrl) {
    return res.status(400).json({ error: 'trackId or masterId, projectId, audioUrl required' });
  }

  // Return immediately — encode in background
  res.json({ status: 'encoding', id: masterId || trackId });

  (async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maastr-'));
    const wavPath = path.join(tmpDir, 'source.wav');
    const hlsDir = path.join(tmpDir, 'hls');
    fs.mkdirSync(hlsDir);

    try {
      console.log(`[encode] START id=${(masterId||trackId)?.substring(0,8)} audioUrl=${audioUrl.substring(0,60)}`);

      const wavRes = await fetch(audioUrl, { timeout: 120000 });
      if (!wavRes.ok) throw new Error('WAV download failed: ' + wavRes.status);
      const wavBuffer = await wavRes.buffer();
      fs.writeFileSync(wavPath, wavBuffer);
      console.log(`[encode] downloaded ${Math.round(wavBuffer.length/1024)}KB`);

      // ffmpeg: WAV -> HLS (AAC 192k, 10s segments)
      await new Promise((resolve, reject) => {
        execFile('ffmpeg', [
          '-i', wavPath,
          '-c:a', 'aac',
          '-b:a', '192k',
          '-hls_time', '10',
          '-hls_list_size', '0',
          '-hls_segment_filename', path.join(hlsDir, 'segment_%04d.ts'),
          '-hls_flags', 'independent_segments',
          path.join(hlsDir, 'playlist.m3u8')
        ], (err, stdout, stderr) => {
          if (err) { console.error('[encode] ffmpeg error:', stderr?.substring(0,300)); reject(err); }
          else resolve();
        });
      });
      console.log('[encode] ffmpeg done');

      const token = await getGCSToken();
      const hlsBase = `projects/${projectId}/hls/${masterId || trackId}`;
      const files = fs.readdirSync(hlsDir);

      for (const file of files) {
        const objectKey = `${hlsBase}/${file}`;
        const contentType = file.endsWith('.m3u8') ? 'application/x-mpegURL' : 'video/MP2T';
        await uploadToGCS(token, objectKey, path.join(hlsDir, file), contentType);
      }

      const hlsUrl = `https://storage.googleapis.com/${GCS_BUCKET}/${hlsBase}/playlist.m3u8`;
      console.log('[encode] uploaded HLS, url:', hlsUrl);

      if (masterId) await updateMasterHLS(masterId, hlsUrl);
      else await updateTrackHLS(trackId, hlsUrl);
      console.log('[encode] DONE');

    } catch (e) {
      console.error('[encode] FAILED:', e.message);
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
    }
  })();
});

const PORT = parseInt(process.env.PORT || '3001', 10);
app.listen(PORT, '0.0.0.0', () => console.log(`maastr-encoder v3.0 listening on ${PORT}`));
