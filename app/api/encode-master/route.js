import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  try {
    const { masterId, projectId, audioUrl, secret } = await request.json();

    // Validate Railway is the caller using MASTERING_SECRET
    if (secret !== process.env.MASTERING_SECRET) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    if (!masterId || !projectId || !audioUrl) {
      return NextResponse.json({ error: 'masterId, projectId, audioUrl required' }, { status: 400 });
    }

    const encoderUrl = process.env.ENCODER_URL;
    if (!encoderUrl) {
      return NextResponse.json({ error: 'encoder not configured' }, { status: 503 });
    }

    // Call encoder with the correct ENCODE_SECRET — Vercel holds this safely
    await fetch(`${encoderUrl}/encode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        masterId,
        projectId,
        audioUrl,
        secret: process.env.ENCODE_SECRET
      })
    });

    return NextResponse.json({ status: 'encoding', masterId });
  } catch (e) {
    console.error('[encode-master]', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
