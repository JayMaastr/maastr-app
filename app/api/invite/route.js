import { NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function sbFetch(path, method = 'GET', body) {
  return fetch(SUPABASE_URL + '/rest/v1/' + path, {
    method,
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': 'Bearer ' + SERVICE_KEY,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=representation' : 'return=minimal',
    },
    body: body ? JSON.stringify(body) : undefined,
  }).then(r => r.status === 204 ? null : r.json());
}

function generateToken() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 32; i++) token += chars[Math.floor(Math.random() * chars.length)];
  return token;
}

export async function POST(req) {
  try {
    const { projectId, invitedEmail, invitedBy, role = 'client', message = '' } = await req.json();
    if (!projectId || !invitedEmail || !invitedBy) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Get project info
    const projects = await sbFetch('projects?id=eq.' + projectId + '&select=id,title,artist');
    const project = projects[0];
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

    // Get inviter info
    const profiles = await sbFetch('profiles?id=eq.' + invitedBy + '&select=email,full_name');
    const inviter = profiles[0];

    // Upsert collaborator with fresh token
    const token = generateToken();
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const existing = await sbFetch('project_collaborators?project_id=eq.' + projectId + '&invited_email=eq.' + encodeURIComponent(invitedEmail));

    if (existing.length > 0) {
      await sbFetch('project_collaborators?id=eq.' + existing[0].id, 'PATCH', {
        token, token_expires_at: expires, role, message, invited_by: invitedBy, status: 'pending'
      });
    } else {
      await sbFetch('project_collaborators', 'POST', {
        project_id: projectId, invited_email: invitedEmail, invited_by: invitedBy,
        role, status: 'pending', token, token_expires_at: expires, message,
      });
    }

    const origin = req.headers.get('origin') || 'https://maastr-app.vercel.app';
    const inviteUrl = origin + '/invite/' + token;
    const inviterName = inviter?.full_name || inviter?.email || 'Your engineer';

    // Send email via SendGrid
    const emailRes = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + process.env.SENDGRID_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: invitedEmail }] }],
        from: { email: 'getawayrecording@hotmail.com', name: 'Maastr' },
        subject: inviterName + ' invited you to review a master on maastr',
        content: [{ type: 'text/html', value: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0b;font-family:'DM Mono',Menlo,monospace;color:#f0ede8">
  <div style="max-width:520px;margin:0 auto;padding:40px 24px">
    <div style="font-size:24px;margin-bottom:32px">maastr<span style="color:#e8a020">.</span></div>
    <h1 style="font-family:Georgia,serif;font-size:28px;font-weight:400;margin:0 0 16px;line-height:1.2">You have a master to review.</h1>
    <p style="font-size:13px;color:#8a8780;line-height:1.7;margin:0 0 8px">
      <strong style="color:#f0ede8">${inviterName}</strong> has invited you to listen to
      <strong style="color:#f0ede8">${project.title}${project.artist ? ' by ' + project.artist : ''}</strong>
      on maastr.
    </p>
    ${message ? '<p style="font-size:13px;color:#8a8780;line-height:1.7;margin:8px 0 0;padding:12px;background:#111113;border-left:2px solid #e8a020;border-radius:4px">' + message + '</p>' : ''}
    <div style="margin:32px 0">
      <a href="${inviteUrl}" style="display:inline-block;padding:14px 28px;background:#e8a020;color:#000;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600">
        Open Project
      </a>
    </div>
    <p style="font-size:11px;color:#4a4945;margin:0">
      This invite expires in 7 days. If you weren't expecting this, you can ignore it.
    </p>
  </div>
</body>
</html>` }],
      }),
    });

    if (!emailRes.ok) { const errData = await emailRes.json().catch(()=>({})); throw new Error(errData.errors?.[0]?.message || 'SendGrid error ' + emailRes.status); }

    return NextResponse.json({ ok: true, inviteUrl });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
