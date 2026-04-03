// encoder v3.0 â ADC auth (no GCS service account key needed)
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

const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/devstorage.read_write'] });
const app = express();
app.use(express.json());

async function getGCSToken() {
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  return token.token;
}

async function uploadToGCS(token, objectKey, filePath, contentType) {
  const fileBuffer = fs.readFileSync(filePath);
  const res = await fetch(
    `https://storage.googleapis.com/upload/storage/v1/b/${GCS_BUCKET}/o?uploadType=media&name=${encodeURIComponent(objectKey)}&predefinedAcl=publicRead`,
    { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': contentType }, body: fileBuffer }
  );
  if (!res.ok) throw new Error('GCS upload failed: ' + (await res.text()).substring(0, 200));
  return `https://storage.googleapis.com/${GCS_BUCKET}/${objectKey}`;
}

async function updateMasterHLS(masterId, hlsUrl) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/masters?id=eq.${masterId}`, {
    method: 'PATCH',
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ hls_url: hlsUrl, status: 'ready', completed_at: new Date().toISOString() })
  });
  if (!res.ok) console.error('[encode] supabase patch failed:', res.status, await res.text());
  return res.ok;
}

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'maastr-encoder', version: '3.0' }));
app.get('/', (req, res) => res.json({ status: 'ok', service: 'maastr-encoder', version: '3.0' }));

app.post('/encode', async (req, res) => {
  const { masterId, projectId, audioUrl, secret } = req.body;
  if (secret !== APP_SECRET) return res.status(403).json({ error: 'forbidden' });
  if (!masterId || !projectId || !audioUrl) return res.status(400).json({ error: 'masterId, projectId, audioUrl required' });

  res.json({ status: 'encoding', masterId });

  (async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maastr-'));
    const wavPath = path.join(tmpDir, 'source.wav');
    const hlsDir = path.join(tmpDir, 'hls');
    fs.mkdirSync(hlsDir);
    try {
      console.log('[encode] downloading WAV:', audioUrl);
      const wavRes = await fetch(audioUrl);
      if (!wavRes.ok) throw new Error('WAV download failed: ' + wavRes.status);
      fs.writeFileSync(wavPath, await wavRes.buffer());
      console.log('[encode] WAV downloaded, running ffmpeg...');

      const m3u8Path = path.join(hlsDir, 'playlist.m3u8');
      await new Promise((resolve, reject) => {
        execFile('ffmpeg', [
          '-i', wavPath, '-c:a', 'aac', '-b:a', '192k',
          '-hls_time', '10', '-hls_list_size', '0',
          '-hls_segment_filename', path.join(hlsDir, 'segment_%04d.ts'),
          '-hls_flags', 'independent_segments', m3u8Path
        ], (err, stdout, stderr) => {
          if (err) { console.error('[encode] ffmpeg error:', stderr); reject(err); } else resolve();
        });
      });
      console.log('[encode] ffmpeg done, uploading to GCS...');

      const token = await getGCSToken();
      const hlsBase = `projects/${projectId}/hls/${masterId}`;
      for (const file of fs.readdirSync(hlsDir)) {
        const ct = file.endsWith('.m3u8') ? 'application/x-mpegURL' : 'video/MP2T';
        await uploadToGCS(token, `${hlsBase}/${file}`, path.join(hlsDir, file), ct);
      }

      const hlsUrl = `https://storage.googleapis.com/${GCS_BUCKET}/${hlsBase}/playlist.m3u8`;
      await updateMasterHLS(masterId, hlsUrl);
      console.log('[encode] done:', hlsUrl);
    } catch (e) {
      console.error('[encode] FAILED:', e.message);
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
    }
  })();
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log('maastr-encoder v3.0 listening on', PORT));
