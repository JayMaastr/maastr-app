import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SB_URL = 'https://btgednpwlkimgjwcopru.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0Z2VkbnB3bGtpbWdqd2NvcHJ1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDIwOTA3MSwiZXhwIjoyMDg5Nzg1MDcxfQ.n3tmGubf7IO_1SX1_sd7cgjcTvHVbJd67hBMfSJUBaA';
const ENCODER_URL = process.env.ENCODER_URL;
const ENCODE_SECRET = process.env.ENCODE_SECRET || '';
const NUM_PEAKS = 800;

const sb = createClient(SB_URL, SB_KEY);

// Read WAV header only (first 512 bytes) to get format info
async function getWavFormat(audioUrl) {
  const r = await fetch(audioUrl, { headers: { Range: 'bytes=0-511' } });
  if (!r.ok) throw new Error('WAV header fetch failed: ' + r.status);
  const buf = await r.arrayBuffer();
  const view = new DataView(buf);
  const numChannels = view.getUint16(22, true);
  const bitsPerSample = view.getUint16(34, true);
  const bytesPerSample = bitsPerSample / 8;
  // Find data chunk
  let offset = 12, dataOffset = -1, dataLength = 0;
  while (offset < buf.byteLength - 8) {
    const id = String.fromCharCode(view.getUint8(offset),view.getUint8(offset+1),view.getUint8(offset+2),view.getUint8(offset+3));
    const sz = view.getUint32(offset + 4, true);
    if (id === 'data') { dataOffset = offset + 8; dataLength = sz; break; }
    if (sz === 0 || sz > 1e9) break;
    offset += 8 + sz + (sz & 1);
  }
  return { numChannels, bitsPerSample, bytesPerSample, dataOffset, dataLength };
}

// Get total file size via HEAD
async function getFileSize(audioUrl) {
  const r = await fetch(audioUrl, { method: 'HEAD' });
  const cl = r.headers.get('content-length');
  return cl ? parseInt(cl) : 0;
}

// Extract a single peak value from a small chunk
function peakFromChunk(buf, bitsPerSample) {
  const view = new DataView(buf);
  const bytesPerSample = bitsPerSample / 8;
  let max = 0;
  for (let i = 0; i + bytesPerSample <= buf.byteLength; i += bytesPerSample) {
    let val = 0;
    if (bitsPerSample === 16) val = Math.abs(view.getInt16(i, true)) / 32768;
    else if (bitsPerSample === 24) {
      const b0=view.getUint8(i),b1=view.getUint8(i+1),b2=view.getUint8(i+2);
      let s=b0|(b1<<8)|(b2<<16); if(s>=0x800000)s-=0x1000000;
      val = Math.abs(s) / 8388608;
    } else if (bitsPerSample === 32) val = Math.abs(view.getInt32(i, true)) / 2147483648;
    if (val > max) max = val;
  }
  return parseFloat(max.toFixed(4));
}

async function runPipeline(trackId, projectId, audioUrl) {
  console.log('[process] start track', trackId);

  // 1. Get file size and WAV format from header only
  const [fileSize, fmt] = await Promise.all([
    getFileSize(audioUrl),
    getWavFormat(audioUrl)
  ]);
  console.log('[process] fileSize:', fileSize, 'fmt:', JSON.stringify(fmt));

  if (fmt.dataOffset === -1 || fmt.dataLength === 0 || fileSize === 0) {
    throw new Error('Could not parse WAV format');
  }

  const frameSize = fmt.bytesPerSample * fmt.numChannels;
  const totalFrames = Math.floor(fmt.dataLength / frameSize);
  // Bytes to sample per peak (one frame = one sample point)
  const samplesPerPeak = Math.max(1, Math.floor(totalFrames / NUM_PEAKS));
  const chunkSize = frameSize * Math.min(samplesPerPeak, 512); // max 512 frames per fetch

  // 2. Fetch NUM_PEAKS evenly-spaced chunks via parallel range requests (batched)
  const peaks = new Array(NUM_PEAKS).fill(0);
  const BATCH = 20; // parallel requests per batch

  for (let batch = 0; batch < NUM_PEAKS; batch += BATCH) {
    const end = Math.min(batch + BATCH, NUM_PEAKS);
    const fetches = [];
    for (let i = batch; i < end; i++) {
      const byteOffset = fmt.dataOffset + i * samplesPerPeak * frameSize;
      const byteEnd = Math.min(byteOffset + chunkSize - 1, fileSize - 1);
      if (byteOffset >= fileSize) { peaks[i] = 0; continue; }
      fetches.push(
        fetch(audioUrl, { headers: { Range: `bytes=${byteOffset}-${byteEnd}` } })
          .then(r => r.arrayBuffer())
          .then(buf => { peaks[i] = peakFromChunk(buf, fmt.bitsPerSample); })
          .catch(() => { peaks[i] = 0; })
      );
    }
    await Promise.all(fetches);
  }

  console.log('[process] peaks extracted:', peaks.length, 'max:', Math.max(...peaks).toFixed(3));

  // 3. Save peaks + estimated duration to DB immediately
  const durationSec = totalFrames / (fmt.dataLength / frameSize) *
    (fmt.dataLength / frameSize / (44100)); // rough estimate, encoder will correct
  const sampleRate = 44100; // default — WAV header has this but we only read 512 bytes
  const estimatedDuration = Math.round(totalFrames / sampleRate);
  await sb.from('tracks').update({ peaks, duration: estimatedDuration }).eq('id', trackId);
  console.log('[process] peaks+duration saved, estimatedDuration:', estimatedDuration);

  // 4. Trigger HLS encoding if encoder is configured
  if (ENCODER_URL && ENCODE_SECRET) {
    fetch(ENCODER_URL + '/encode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-encode-secret': ENCODE_SECRET },
      body: JSON.stringify({ trackId, projectId, audioUrl }),
    }).then(r => console.log('[process] encoder accepted:', r.status))
      .catch(e => console.error('[process] encoder error:', e.message));
  }
}

export async function POST(request) {
  try {
    const { trackId, projectId, audioUrl } = await request.json();
    if (!trackId || !audioUrl) {
      return NextResponse.json({ error: 'trackId and audioUrl required' }, { status: 400 });
    }
    // Run pipeline — Vercel keeps function alive until response is sent
    // We respond 202 immediately then continue processing
    const responsePromise = NextResponse.json({ status: 'processing', trackId }, { status: 202 });
    runPipeline(trackId, projectId, audioUrl).catch(e => console.error('[process] error:', e.message));
    return responsePromise;
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
