import { NextResponse } from 'next/server';

export const maxDuration = 60;

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

    // Encoder v4 is synchronous — holds the request open until done.
    // We wait for the full response so we can return the result.
    const encRes = await fetch(`${encoderUrl}/encode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackId, projectId, audioUrl, secret }),
      signal: AbortSignal.timeout(55000)
    });

    const data = await encRes.json();

    if (!encRes.ok) {
      console.error('[trigger-encode] encoder error:', data);
      return NextResponse.json({ error: data.error || 'encoder failed' }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (e) {
    console.error('[trigger-encode]', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
