import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const keyB64 = process.env.GCS_SERVICE_ACCOUNT_KEY;
    const bucket = process.env.GCS_BUCKET_NAME || 'maastr-vibedev-audio';
    if (!keyB64) return NextResponse.json({ error: 'GCS_SERVICE_ACCOUNT_KEY not set' }, { status: 500 });

    const key = JSON.parse(Buffer.from(keyB64, 'base64').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    const { createSign } = await import('crypto');
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: key.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600, iat: now
    })).toString('base64url');
    const sign = createSign('RSA-SHA256');
    sign.update(header + '.' + payload);
    const sig = sign.sign(key.private_key, 'base64url');
    const jwt = header + '.' + payload + '.' + sig;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + jwt
    });
    const { access_token } = await tokenRes.json();

    // 1. Set CORS on the bucket
    const corsRes = await fetch(`https://storage.googleapis.com/storage/v1/b/${bucket}?fields=cors`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ' + access_token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cors: [{
          origin: ['*'],
          method: ['GET', 'HEAD', 'OPTIONS'],
          responseHeader: ['Content-Type', 'Content-Length', 'Accept-Ranges', 'Range'],
          maxAgeSeconds: 3600
        }]
      })
    });
    const corsData = await corsRes.json();

    // 2. Get existing bucket IAM policy
    const getIamRes = await fetch(`https://storage.googleapis.com/storage/v1/b/${bucket}/iam`, {
      headers: { Authorization: 'Bearer ' + access_token }
    });
    const iamPolicy = await getIamRes.json();

    // 3. Add allUsers:objectViewer if not already present
    const bindings = iamPolicy.bindings || [];
    const viewerBinding = bindings.find(b => b.role === 'roles/storage.objectViewer');
    if (viewerBinding) {
      if (!viewerBinding.members.includes('allUsers')) {
        viewerBinding.members.push('allUsers');
      }
    } else {
      bindings.push({ role: 'roles/storage.objectViewer', members: ['allUsers'] });
    }

    // 4. Set updated IAM policy
    const setIamRes = await fetch(`https://storage.googleapis.com/storage/v1/b/${bucket}/iam`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + access_token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...iamPolicy, bindings })
    });
    const iamData = await setIamRes.json();

    return NextResponse.json({
      cors: corsRes.status,
      corsOk: corsRes.ok,
      iam: setIamRes.status,
      iamOk: setIamRes.ok,
      iamError: iamData.error?.message || null
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
