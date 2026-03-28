import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const { trackId, projectId, audioUrl } = await request.json();
    if (!trackId || !projectId || !audioUrl) {
      return NextResponse.json({ error: 'trackId, projectId, audioUrl required' }, { status: 400 });
    }
    const encoderUrl = process.env.ENCODER_URL;
    const secret = process.env.ENCODE_SECRET;
    if (!encoderUrl) {
      return NextResponse.json({ error: 'encoder not configured' }, { status: 503 });
    }
    // Fire and forget — don't await, return immediately to client
    fetch(`${encoderUrl}/encode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackId, projectId, audioUrl, secret })
    }).catch(e => console.error('[trigger-encode] Railway error:', e.message));

    return NextResponse.json({ status: 'triggered', trackId });
  } catch (e) {
    console.error('[trigger-encode]', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
