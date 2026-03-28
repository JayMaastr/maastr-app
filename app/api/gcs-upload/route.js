import { NextResponse } from 'next/server';

const BUCKET = process.env.GCS_BUCKET_NAME || 'maastr-vibedev-audio';

async function getServiceAccountKey() {
  const keyJson = Buffer.from(process.env.GCS_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8');
  return JSON.parse(keyJson);
}

// Sign bytes with RSA-SHA256 using the service account private key
async function signBytes(privateKeyPem, data) {
  const encoder = new TextEncoder();
  const keyData = privateKeyPem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');
  const binaryDer = Uint8Array.from(atob(keyData), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', binaryDer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, encoder.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

export async function POST(request) {
  try {
    const { projectId, fileName, contentType } = await request.json();
    if (!projectId || !fileName) {
      return NextResponse.json({ error: 'projectId and fileName required' }, { status: 400 });
    }

    const key = await getServiceAccountKey();
    const objectKey = `projects/${projectId}/${fileName.replace(/[^a-zA-Z0-9._\-]/g, '_')}`;
    const publicUrl = `https://storage.googleapis.com/${BUCKET}/${objectKey}`;

    // V4 Signed URL for XML API PUT (covered by bucket CORS)
    const now = new Date();
    const dateStamp = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const datePart = dateStamp.substring(0, 8);
    const credential = `${key.client_email}/${datePart}/auto/storage/goog4_request`;
    const expires = 900; // 15 minutes

    const headers = `content-type:${contentType || 'audio/wav'}\nhost:storage.googleapis.com\n`;
    const signedHeaders = 'content-type;host';

    const canonicalRequest = [
      'PUT',
      `/${BUCKET}/${objectKey}`,
      `X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Credential=${encodeURIComponent(credential)}&X-Goog-Date=${dateStamp}&X-Goog-Expires=${expires}&X-Goog-SignedHeaders=${signedHeaders}`,
      headers,
      signedHeaders,
      'UNSIGNED-PAYLOAD'
    ].join('\n');

    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalRequest));
    const canonicalHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2,'0')).join('');

    const stringToSign = `GOOG4-RSA-SHA256\n${dateStamp}\n${datePart}/auto/storage/goog4_request\n${canonicalHash}`;
    const signature = await signBytes(key.private_key, stringToSign);
    const sigHex = Array.from(Uint8Array.from(atob(signature), c => c.charCodeAt(0))).map(b => b.toString(16).padStart(2,'0')).join('');

    const uploadUrl = `https://storage.googleapis.com/${BUCKET}/${objectKey}?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Credential=${encodeURIComponent(credential)}&X-Goog-Date=${dateStamp}&X-Goog-Expires=${expires}&X-Goog-SignedHeaders=${signedHeaders}&X-Goog-Signature=${sigHex}`;

    return NextResponse.json({ uploadUrl, publicUrl, objectKey });
  } catch (e) {
    console.error('[gcs-upload] error:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
