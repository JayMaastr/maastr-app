import { NextResponse } from 'next/server';

const BUCKET = process.env.GCS_BUCKET_NAME || 'maastr-vibedev-audio';

async function getGCSToken() {
  const keyJson = Buffer.from(process.env.GCS_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8');
  const key = JSON.parse(keyJson);
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claim = Buffer.from(JSON.stringify({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/devstorage.full_control',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  })).toString('base64url');
  const sigInput = header + '.' + claim;
  const { createSign } = await import('crypto');
  const sign = createSign('RSA-SHA256');
  sign.update(sigInput);
  const sig = sign.sign(key.private_key, 'base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const jwt = sigInput + '.' + sig;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  });
  const { access_token } = await res.json();
  return access_token;
}

export async function POST(request) {
  try {
    const { projectId, fileName, contentType } = await request.json();
    if (!projectId || !fileName) {
      return NextResponse.json({ error: 'projectId and fileName required' }, { status: 400 });
    }

    const objectKey = `projects/${projectId}/${fileName.replace(/\s+/g, '_')}`;
    const token = await getGCSToken();

    // Create a resumable upload session
    const initRes = await fetch(
      `https://storage.googleapis.com/upload/storage/v1/b/${BUCKET}/o?uploadType=resumable&name=${encodeURIComponent(objectKey)}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Upload-Content-Type': contentType || 'audio/wav',
        },
        body: JSON.stringify({ name: objectKey })
      }
    );

    const uploadUrl = initRes.headers.get('location');
    if (!uploadUrl) throw new Error('No upload URL returned from GCS');

    const publicUrl = `https://storage.googleapis.com/${BUCKET}/${objectKey}`;

    return NextResponse.json({ uploadUrl, publicUrl, objectKey });
  } catch (e) {
    console.error('[gcs-upload] error:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { objectKey } = await request.json();
    if (!objectKey) return NextResponse.json({ error: 'objectKey required' }, { status: 400 });
    const token = await getGCSToken();
    await fetch(`https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(objectKey)}`,
      { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
