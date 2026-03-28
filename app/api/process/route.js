import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://btgednpwlkimgjwcopru.supabase.co';
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0Z2VkbnB3bGtpbWdqd2NvcHJ1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDIwOTA3MSwiZXhwIjoyMDg5Nzg1MDcxfQ.n3tmGubf7IO_1SX1_sd7cgjcTvHVbJd67hBMfSJUBaA';
const ENCODER_URL = process.env.ENCODER_URL;
const ENCODE_SECRET = process.env.ENCODE_SECRET || '';
const NUM_PEAKS = 800;

export const maxDuration = 60; // Vercel max function duration in seconds

async function extractPeaks(audioUrl) {
  // Get file size + read 4KB header to find fmt/data chunks
  const [headR, hdrR] = await Promise.all([
    fetch(audioUrl, { method: 'HEAD' }),
    fetch(audioUrl, { headers: { Range: 'bytes=0-4095' } })
  ]);
  const fileSize = parseInt(headR.headers.get('content-length') || '0');
  if (!fileSize) throw new Error('Could not get file size');

  const buf = await hdrR.arrayBuffer();
  const v = new DataView(buf);

  // Walk RIFF chunks to find fmt and data
  let off = 12, fmt = {}, dataOffset = -1, dataLength = 0;
  while (off + 8 <= buf.byteLength) {
    const id = String.fromCharCode(v.getUint8(off), v.getUint8(off+1), v.getUint8(off+2), v.getUint8(off+3));
    const sz = v.getUint32(off + 4, true);
    if (id === 'fmt ') {
      fmt.ch  = v.getUint16(off + 10, true);
      fmt.sr  = v.getUint32(off + 12, true);
      fmt.bps = v.getUint16(off + 22, true);
    }
    if (id === 'data') { dataOffset = off + 8; dataLength = sz; break; }
    if (sz === 0 || sz > 1e9) break;
    off += 8 + sz + (sz & 1);
  }
  if (!fmt.sr || dataOffset === -1) throw new Error(`WAV parse failed: sr=${fmt.sr} dataOffset=${dataOffset}`);

  const frameSize = Math.round((fmt.bps / 8) * fmt.ch);
  const totalFrames = Math.floor(dataLength / frameSize);
  const duration = Math.round(totalFrames / fmt.sr);
  const spp = Math.max(1, Math.floor(totalFrames / NUM_PEAKS));
  const chunkBytes = Math.min(frameSize * spp, frameSize * 256);

  // Extract NUM_PEAKS via parallel range requests, 25 at a time
  const peaks = new Array(NUM_PEAKS).fill(0);
  for (let b = 0; b < NUM_PEAKS; b += 25) {
    const end = Math.min(b + 25, NUM_PEAKS);
    await Promise.all(Array.from({ length: end - b }, (_, k) => {
      const i = b + k;
      const s = dataOffset + i * spp * frameSize;
      const e = Math.min(s + chunkBytes - 1, fileSize - 1);
      if (s >= fileSize) return;
      return fetch(audioUrl, { headers: { Range: `bytes=${s}-${e}` } })
        .then(r => r.arrayBuffer())
        .then(chunk => {
          const cv = new DataView(chunk);
          const bsamp = fmt.bps / 8;
          let max = 0;
          for (let j = 0; j + bsamp <= chunk.byteLength; j += bsamp) {
            let val = 0;
            if (fmt.bps === 16) val = Math.abs(cv.getInt16(j, true)) / 32768;
            else if (fmt.bps === 24) {
              const a = cv.getUint8(j), b = cv.getUint8(j+1), c = cv.getUint8(j+2);
              let s = a | (b << 8) | (c << 16); if (s >= 0x800000) s -= 0x1000000;
              val = Math.abs(s) / 8388608;
            } else if (fmt.bps === 32) val = Math.abs(cv.getInt32(j, true)) / 2147483648;
            if (val > max) max = val;
          }
          peaks[i] = parseFloat(max.toFixed(4));
        }).catch(() => {});
    }));
  }
  return { peaks, duration };
}

export async function POST(request) {
  try {
    const { trackId, projectId, audioUrl } = await request.json();
    if (!trackId || !audioUrl) {
      return NextResponse.json({ error: 'trackId and audioUrl required' }, { status: 400 });
    }

    // Run synchronously — Vercel keeps the function alive until we return
    const { peaks, duration } = await extractPeaks(audioUrl);
    const maxPeak = Math.max(...peaks);
    if (maxPeak < 0.001) throw new Error('Peak extraction produced all zeros');

    // Save peaks + duration to Supabase
    const sb = createClient(SB_URL, SB_SERVICE_KEY);
    const { error } = await sb.from('tracks').update({ peaks, duration }).eq('id', trackId);
    if (error) throw new Error('DB save failed: ' + error.message);

    // Fire encoder in background (separate service, can be async)
    if (ENCODER_URL && ENCODE_SECRET) {
      fetch(ENCODER_URL + '/encode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-encode-secret': ENCODE_SECRET },
        body: JSON.stringify({ trackId, projectId, audioUrl }),
      }).catch(e => console.error('[process] encoder fire-and-forget error:', e.message));
    }

    return NextResponse.json({ 
      status: 'done', 
      trackId, 
      peaks: peaks.length, 
      duration,
      maxPeak: maxPeak.toFixed(3)
    }, { status: 200 });

  } catch (e) {
    console.error('[process] error:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
