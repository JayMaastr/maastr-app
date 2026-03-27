import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://btgednpwlkimgjwcopru.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0Z2VkbnB3bGtpbWdqd2NvcHJ1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDIwOTA3MSwiZXhwIjoyMDg5Nzg1MDcxfQ.n3tmGubf7IO_1SX1_sd7cgjcTvHVbJd67hBMfSJUBaA';
const UPLOAD_WORKER = 'https://maastr-upload.jay-288.workers.dev';
const NUM_PEAKS = 800;

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Pure-JS WAV peak extractor — no dependencies
// Handles 16-bit, 24-bit, and 32-bit WAV files
function extractPeaksFromWav(buffer) {
  const view = new DataView(buffer);
  // Validate RIFF header
  const riff = String.fromCharCode(view.getUint8(0),view.getUint8(1),view.getUint8(2),view.getUint8(3));
  if (riff !== 'RIFF') throw new Error('Not a valid WAV file');
  const numChannels = view.getUint16(22, true);
  const bitsPerSample = view.getUint16(34, true);
  const bytesPerSample = bitsPerSample / 8;
  // Find the 'data' chunk (skip any extra chunks like 'JUNK', 'bext', 'fmt ')
  let offset = 12;
  let dataOffset = -1, dataLength = 0;
  while (offset < Math.min(view.byteLength - 8, 4096)) {
    const id = String.fromCharCode(view.getUint8(offset),view.getUint8(offset+1),view.getUint8(offset+2),view.getUint8(offset+3));
    const sz = view.getUint32(offset + 4, true);
    if (id === 'data') { dataOffset = offset + 8; dataLength = sz; break; }
    offset += 8 + sz + (sz & 1); // chunks are word-aligned
  }
  if (dataOffset === -1) throw new Error('WAV data chunk not found');
  const frameSize = bytesPerSample * numChannels;
  const totalFrames = Math.floor(dataLength / frameSize);
  const blockSize = Math.floor(totalFrames / NUM_PEAKS);
  if (blockSize < 1) throw new Error('WAV file too short for peak extraction');
  const peaks = new Array(NUM_PEAKS);
  for (let i = 0; i < NUM_PEAKS; i++) {
    let max = 0;
    const start = dataOffset + i * blockSize * frameSize;
    // Sample only the first channel to keep it fast
    for (let j = 0; j < blockSize; j++) {
      const pos = start + j * frameSize;
      if (pos + bytesPerSample > view.byteLength) break;
      let val = 0;
      if (bitsPerSample === 16) {
        val = Math.abs(view.getInt16(pos, true)) / 32768;
      } else if (bitsPerSample === 24) {
        const b0 = view.getUint8(pos), b1 = view.getUint8(pos+1), b2 = view.getUint8(pos+2);
        let s = b0 | (b1 << 8) | (b2 << 16);
        if (s >= 0x800000) s -= 0x1000000;
        val = Math.abs(s) / 8388608;
      } else if (bitsPerSample === 32) {
        const s = view.getInt32(pos, true);
        val = Math.abs(s) / 2147483648;
      }
      if (val > max) max = val;
    }
    peaks[i] = parseFloat(max.toFixed(4));
  }
  return peaks;
}

// Upload a buffer to R2 via the Cloudflare Worker
async function uploadToR2(projectId, filename, buffer, contentType) {
  const url = UPLOAD_WORKER + '?project=' + projectId + '&name=' + encodeURIComponent(filename);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: buffer,
  });
  if (!res.ok) throw new Error('R2 upload failed for ' + filename + ': ' + res.status);
  const json = await res.json();
  return json.url;
}

// Main processing pipeline
async function processTrack(trackId, projectId, audioUrl) {
  try {
    // 1. Download the WAV from R2
    console.log('[process] downloading WAV:', audioUrl);
    const wavRes = await fetch(audioUrl);
    if (!wavRes.ok) throw new Error('Failed to download WAV: ' + wavRes.status);
    const wavBuffer = await wavRes.arrayBuffer();
    console.log('[process] WAV downloaded, size:', wavBuffer.byteLength);

    // 2. Extract peaks (fast: ~2-5s regardless of file size)
    const peaks = extractPeaksFromWav(wavBuffer);
    console.log('[process] peaks extracted:', peaks.length);

    // 3. Save peaks to DB immediately so the player gets a real waveform ASAP
    await sb.from('tracks').update({ peaks }).eq('id', trackId);
    console.log('[process] peaks saved to DB for track', trackId);

    // 4. HLS encoding happens in a separate request to avoid timeout
    // We'll trigger it via a background queue approach — for now, log that it's needed
    // The HLS encoding endpoint is /api/process/hls
    // It will be called separately after peaks are saved
    
  } catch (err) {
    console.error('[process] error for track', trackId, err.message);
    // Don't throw — we don't want to block the response
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { trackId, projectId, audioUrl } = body;
    if (!trackId || !audioUrl) {
      return NextResponse.json({ error: 'trackId and audioUrl required' }, { status: 400 });
    }
    // Process in background — return 202 immediately
    // The Vercel function keeps running after the response is sent
    processTrack(trackId, projectId, audioUrl).catch(e => console.error('[process] bg error:', e.message));
    return NextResponse.json({ status: 'processing', trackId }, { status: 202 });
  } catch (err) {
    console.error('[process] route error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
