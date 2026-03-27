import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SB_URL = 'https://btgednpwlkimgjwcopru.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0Z2VkbnB3bGtpbWdqd2NvcHJ1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDIwOTA3MSwiZXhwIjoyMDg5Nzg1MDcxfQ.n3tmGubf7IO_1SX1_sd7cgjcTvHVbJd67hBMfSJUBaA';
const ENCODER_URL = process.env.ENCODER_URL;
const ENCODE_SECRET = process.env.ENCODE_SECRET || '';
const NUM_PEAKS = 800;

const sb = createClient(SB_URL, SB_KEY);

function extractPeaksFromWav(buffer) {
  const view = new DataView(buffer);
  const riff = String.fromCharCode(view.getUint8(0),view.getUint8(1),view.getUint8(2),view.getUint8(3));
  if (riff !== 'RIFF') throw new Error('Not a valid WAV file');
  const numChannels = view.getUint16(22, true);
  const bitsPerSample = view.getUint16(34, true);
  const bytesPerSample = bitsPerSample / 8;
  let offset = 12, dataOffset = -1, dataLength = 0;
  while (offset < Math.min(view.byteLength - 8, 65536)) {
    const id = String.fromCharCode(view.getUint8(offset),view.getUint8(offset+1),view.getUint8(offset+2),view.getUint8(offset+3));
    const sz = view.getUint32(offset + 4, true);
    if (id === 'data') { dataOffset = offset + 8; dataLength = sz; break; }
    if (sz > view.byteLength) break;
    offset += 8 + sz + (sz & 1);
  }
  if (dataOffset === -1) throw new Error('WAV data chunk not found');
  const frameSize = bytesPerSample * numChannels;
  const totalFrames = Math.floor(dataLength / frameSize);
  const blockSize = Math.floor(totalFrames / NUM_PEAKS);
  if (blockSize < 1) throw new Error('File too short');
  const peaks = [];
  for (let i = 0; i < NUM_PEAKS; i++) {
    let max = 0;
    const base = dataOffset + i * blockSize * frameSize;
    for (let j = 0; j < blockSize; j++) {
      const pos = base + j * frameSize;
      if (pos + bytesPerSample > view.byteLength) break;
      let val = 0;
      if (bitsPerSample === 16) val = Math.abs(view.getInt16(pos, true)) / 32768;
      else if (bitsPerSample === 24) {
        const b0=view.getUint8(pos),b1=view.getUint8(pos+1),b2=view.getUint8(pos+2);
        let s=b0|(b1<<8)|(b2<<16); if(s>=0x800000)s-=0x1000000;
        val = Math.abs(s) / 8388608;
      } else if (bitsPerSample === 32) val = Math.abs(view.getInt32(pos, true)) / 2147483648;
      if (val > max) max = val;
    }
    peaks.push(parseFloat(max.toFixed(4)));
  }
  return peaks;
}

async function runPipeline(trackId, projectId, audioUrl) {
  console.log('[process] start track', trackId);
  // 1. Download WAV
  const wavRes = await fetch(audioUrl);
  if (!wavRes.ok) throw new Error('WAV download failed: ' + wavRes.status);
  const buf = await wavRes.arrayBuffer();
  console.log('[process] WAV size', (buf.byteLength/1024/1024).toFixed(1), 'MB');

  // 2. Extract peaks — save to DB immediately so player has waveform data ASAP
  const peaks = extractPeaksFromWav(buf);
  const { error: peakErr } = await sb.from('tracks').update({ peaks }).eq('id', trackId);
  if (peakErr) console.error('[process] peak save error:', peakErr.message);
  else console.log('[process] peaks saved', peaks.length, 'points');

  // 3. Trigger HLS encoding (only if encoder service is configured)
  if (ENCODER_URL && ENCODE_SECRET) {
    console.log('[process] triggering encoder at', ENCODER_URL);
    const encRes = await fetch(ENCODER_URL + '/encode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-encode-secret': ENCODE_SECRET },
      body: JSON.stringify({ trackId, projectId, audioUrl }),
    });
    if (!encRes.ok) console.error('[process] encoder responded', encRes.status);
    else console.log('[process] encoder accepted track', trackId);
  } else {
    console.log('[process] ENCODER_URL not set — skipping HLS encoding');
  }
}

export async function POST(request) {
  try {
    const { trackId, projectId, audioUrl } = await request.json();
    if (!trackId || !audioUrl) return NextResponse.json({ error: 'trackId and audioUrl required' }, { status: 400 });
    // Fire and forget — respond 202 immediately
    runPipeline(trackId, projectId, audioUrl).catch(e => console.error('[process] pipeline error:', e.message));
    return NextResponse.json({ status: 'processing', trackId }, { status: 202 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
