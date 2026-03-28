import { NextResponse } from 'next/server';

export const maxDuration = 60;

async function getGCSToken() {
  const keyJson = Buffer.from(process.env.GCS_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8');
  const key = JSON.parse(keyJson);
  const now = Math.floor(Date.now() / 1000);
  const header = btoa(JSON.stringify({alg:'RS256',typ:'JWT'})).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const payload = btoa(JSON.stringify({iss:key.client_email,scope:'https://www.googleapis.com/auth/devstorage.full_control',aud:'https://oauth2.googleapis.com/token',exp:now+3600,iat:now})).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const signing = header+'.'+payload;
  const pemKey = key.private_key.replace(/-----BEGIN PRIVATE KEY-----/g,'').replace(/-----END PRIVATE KEY-----/g,'').replace(/\s/g,'');
  const binaryDer = Uint8Array.from(atob(pemKey), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey('pkcs8', binaryDer, {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'}, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signing));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const jwt = signing + '.' + sigB64;
  const res = await fetch('https://oauth2.googleapis.com/token', {method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion='+jwt});
  const data = await res.json();
  return data.access_token;
}

export async function GET(request) {
  const secret = request.nextUrl.searchParams.get('s');
  if(secret !== 'maastr-cleanup-2026') return NextResponse.json({error:'no'},{status:403});
  
  const BUCKET = process.env.GCS_BUCKET_NAME || 'maastr-vibedev-audio';
  const token = await getGCSToken();
  
  // List all objects
  const listRes = await fetch(`https://storage.googleapis.com/storage/v1/b/${BUCKET}/o?maxResults=1000`, {headers:{Authorization:'Bearer '+token}});
  const list = await listRes.json();
  const objects = list.items || [];
  
  // Valid project IDs from Supabase - hardcoded to be safe
  const validIds = ['61cdb85a-72ef-4d37-8dba-b2b5fd47ca54','b6dbded3-1ff3-4b17-a852-4015c9ab2884','a82acbb6-e55b-47a8-9a67-27f2a07d3b03','edb2ac6b-2ee4-4b0e-9893-0f43a28dd2c6','952114c2-be4e-4fb7-a23f-e2a571f6f2d3'];
  
  const toDelete = objects.filter(o => {
    const parts = o.name.split('/');
    if(parts[0] !== 'projects') return false;
    return !validIds.includes(parts[1]);
  });
  
  const results = [];
  for(const obj of toDelete) {
    const encodedName = encodeURIComponent(obj.name);
    const delRes = await fetch(`https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodedName}`, {method:'DELETE',headers:{Authorization:'Bearer '+token}});
    results.push({name:obj.name, status:delRes.status});
  }
  
  return NextResponse.json({deleted:results.length, results});
}
