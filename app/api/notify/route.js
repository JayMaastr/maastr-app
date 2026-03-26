import { NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function sbGet(path) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    headers: { 'apikey': SERVICE_KEY, 'Authorization': 'Bearer ' + SERVICE_KEY }
  });
  return r.json();
}

async function sbPatch(path, body) {
  return fetch(SUPABASE_URL + '/rest/v1/' + path, {
    method: 'PATCH',
    headers: { 'apikey': SERVICE_KEY, 'Authorization': 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify(body),
  });
}

export async function POST(req) {
  try {
    const { trackId, projectId, clientName, clientEmail } = await req.json();
    if (!trackId || !projectId) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });

    // Mark track as review requested
    await sbPatch('tracks?id=eq.' + trackId, { review_requested_at: new Date().toISOString() });

    // Get project + owner info
    const projects = await sbGet('projects?id=eq.' + projectId + '&select=id,title,artist,user_id');
    const project = projects[0];
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

    const profiles = await sbGet('profiles?id=eq.' + project.user_id + '&select=email,full_name');
    const owner = profiles[0];
    if (!owner?.email) return NextResponse.json({ error: 'Owner not found' }, { status: 404 });

    const tracks = await sbGet('tracks?id=eq.' + trackId + '&select=title');
    const trackTitle = tracks[0]?.title || 'a track';

    const origin = req.headers.get('origin') || 'https://maastr-app.vercel.app';
    const projectUrl = origin + '/player?id=' + projectId;
    const senderName = clientName || clientEmail || 'Your client';

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'maastr <onboarding@resend.dev>',
        to: [owner.email],
        subject: senderName + ' has marked a master ready for review',
        html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0b;font-family:'DM Mono',Menlo,monospace;color:#f0ede8">
  <div style="max-width:520px;margin:0 auto;padding:40px 24px">
    <div style="font-size:24px;margin-bottom:32px">maastr<span style="color:#e8a020">.</span></div>
    <h1 style="font-family:Georgia,serif;font-size:28px;font-weight:400;margin:0 0 16px;line-height:1.2">Ready for your review.</h1>
    <p style="font-size:13px;color:#8a8780;line-height:1.7;margin:0 0 24px">
      <strong style="color:#f0ede8">${senderName}</strong> has listened to
      <strong style="color:#f0ede8">${trackTitle}</strong> on
      <strong style="color:#f0ede8">${project.title}${project.artist ? ' by ' + project.artist : ''}</strong>
      and marked it ready for your review.
    </p>
    <div style="margin:32px 0">
      <a href="${projectUrl}" style="display:inline-block;padding:14px 28px;background:#e8a020;color:#000;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600">
        Open Project
      </a>
    </div>
    <p style="font-size:11px;color:#4a4945;margin:0">maastr — music mastering review platform</p>
  </div>
</body>
</html>`,
      }),
    });

    const emailData = await emailRes.json();
    if (emailData.error) throw new Error(emailData.error.message || JSON.stringify(emailData.error));

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
