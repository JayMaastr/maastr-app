import { NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(req) {
  try {
    const { token } = await req.json();
    if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 });

    // Look up invite using service key (bypasses RLS)
    const res = await fetch(
      SUPABASE_URL + '/rest/v1/project_collaborators?token=eq.' + token + '&select=*,projects(id,title,artist,image_url)',
      {
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': 'Bearer ' + SERVICE_KEY,
        },
      }
    );
    const rows = await res.json();
    const invite = rows[0];

    if (!invite) return NextResponse.json({ error: 'Invite not found' }, { status: 404 });

    // Check expiry
    if (new Date(invite.token_expires_at) < new Date()) {
      return NextResponse.json({ error: 'expired' }, { status: 410 });
    }

    // Check if already accepted
    if (invite.status === 'accepted') {
      return NextResponse.json({ error: 'already_accepted', project_id: invite.project_id }, { status: 200 });
    }

    return NextResponse.json({
      id: invite.id,
      project_id: invite.project_id,
      invited_email: invite.invited_email,
      status: invite.status,
      message: invite.message,
      project: invite.projects,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
