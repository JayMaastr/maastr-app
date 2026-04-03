import { NextResponse } from 'next/server';

export const maxDuration = 60;

export async function POST(request) {
  try {
    const { masterId, projectId, audioUrl, secret } = await request.json();

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

    const encRes = await fetch(`${encoderUrl}/encode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ masterId, projectId, audioUrl, secret: process.env.ENCODE_SECRET }),
      signal: AbortSignal.timeout(55000)
    });

    const data = await encRes.json();
    if (!encRes.ok) {
      console.error('[encode-master] encoder failed:', data);
      return NextResponse.json({ error: data.error || 'encoder failed' }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (e) {
    console.error('[encode-master]', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
