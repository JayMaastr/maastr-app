// encoder v4.0 Ã¢ÂÂ synchronous processing (request held open for full CPU allocation)
// Cloud Run throttles CPU to ~0% after response is sent.
// Solution: keep the HTTP request open, do all work, THEN respond.
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
const app = express();
app.use(express.json());

async function getGCSToken() {
  // Use GCP metadata server â always available in Cloud Run, no library needed
  const res = await fetch(
    'http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token',
    { headers: { 'Metadata-Flavor': 'Google' } }
  );
  if (!res.ok) throw new Error('Metadata token fetch failed: ' + res.status);
  const data = await res.json();
  return data.access_token;
}

async function uploadToGCS(token, objectKey, filePath, contentType) {
  const fileBuffer = fs.readFileSync(filePath);
  const res = await fetch(
    `https://storage.googleapis.com/upload/storage/v1/b/${GCS_BUCKET}/o?uploadType=media&name=${encodeURIComponent(objectKey)}`,
    { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': contentType }, body: fileBuffer }
  );
  if (!res.ok) throw new Error('GCS upload failed: ' + (await res.text()).substring(0, 200));
}

async function updateMasterHLS(masterId, hlsUrl) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/masters?id=eq.${masterId}`, {
    method: 'PATCH',
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ hls_url: hlsUrl, status: 'ready', completed_at: new Date().toISOString() })
  });
  if (!res.ok) console.error('[encode] supabase update failed:', res.status);
}

async function updateTrackHLS(trackId, hlsUrl) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/tracks?id=eq.${trackId}`, {
    method: 'PATCH',
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ hls_url: hlsUrl })
  });
  if (!res.ok) console.error('[encode] supabase track update failed:', res.status);
}

app.get('/health', (req, res) => res.json({ status: 'ok', version: '4.0' }));
app.get('/', (req, res) => res.json({ status: 'ok', version: '4.0' }));

app.post('/encode', async (req, res) => {
  const { masterId, trackId, projectId, audioUrl, secret } = req.body;
  if (secret !== APP_SECRET) return res.status(403).json({ error: 'forbidden' });
  if (!projectId || !audioUrl || (!masterId && !trackId)) {
    return res.status(400).json({ error: 'projectId, audioUrl, and masterId or trackId required' });
  }

  const jobId = masterId || trackId;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maastr-'));
  const wavPath = path.join(tmpDir, 'source.wav');
  const hlsDir = path.join(tmpDir, 'hls');
  fs.mkdirSync(hlsDir);

  try {
    console.log('[encode] downloading:', audioUrl);
    const wavRes = await fetch(audioUrl);
    if (!wavRes.ok) throw new Error('WAV download failed: ' + wavRes.status);
    fs.writeFileSync(wavPath, await wavRes.buffer());
    console.log('[encode] downloaded', (fs.statSync(wavPath).size/1024/1024).toFixed(1) + 'MB');

    const m3u8Path = path.join(hlsDir, 'playlist.m3u8');
    await new Promise((resolve, reject) => {
      execFile('ffmpeg', [
        '-i', wavPath, '-c:a', 'aac', '-b:a', '192k',
        '-hls_time', '10', '-hls_list_size', '0',
        '-hls_segment_filename', path.join(hlsDir, 'segment_%04d.ts'),
        '-hls_flags', 'independent_segments', m3u8Path
      ], { timeout: 300000 }, (err, stdout, stderr) => {
        if (err) { console.error('[encode] ffmpeg failed:', stderr?.substring(0,500)); reject(err); }
        else resolve();
      });
    });
    console.log('[encode] ffmpeg done');

    const token = await getGCSToken();
    const hlsBase = `projects/${projectId}/hls/${jobId}`;
    const files = fs.readdirSync(hlsDir);
    for (const file of files) {
      const ct = file.endsWith('.m3u8') ? 'application/x-mpegURL' : 'video/MP2T';
      await uploadToGCS(token, `${hlsBase}/${file}`, path.join(hlsDir, file), ct);
    }

    const hlsUrl = `https://storage.googleapis.com/${GCS_BUCKET}/${hlsBase}/playlist.m3u8`;
    if (masterId) await updateMasterHLS(masterId, hlsUrl);
    else await updateTrackHLS(trackId, hlsUrl);

    console.log('[encode] done:', hlsUrl);
    res.json({ status: 'done', hlsUrl, files: files.length });

  } catch (e) {
    console.error('[encode] FAILED:', e.message);
    res.status(500).json({ error: e.message });
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log('maastr-encoder v4.0 on port', PORT));
