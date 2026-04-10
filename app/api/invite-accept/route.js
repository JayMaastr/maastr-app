import { NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(req) {
  try {
    const { token, userId } = await req.json();
    if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 });

    // Verify the token exists and is still pending
    const lookupRes = await fetch(
      SUPABASE_URL + '/rest/v1/project_collaborators?token=eq.' + token + '&select=id,project_id,status',
      {
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': 'Bearer ' + SERVICE_KEY,
        },
      }
    );
    const rows = await lookupRes.json();
    const invite = rows[0];

    if (!invite) return NextResponse.json({ error: 'Invite not found' }, { status: 404 });
    if (invite.status === 'accepted') return NextResponse.json({ error: 'Already accepted' }, { status: 400 });

    // Accept the invite using service key (bypasses RLS)
    const updateRes = await fetch(
      SUPABASE_URL + '/rest/v1/project_collaborators?id=eq.' + invite.id,
      {
        method: 'PATCH',
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': 'Bearer ' + SERVICE_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({
          status: 'accepted',
          user_id: userId || null,
          token: null,
          token_expires_at: null,
        }),
      }
    );

    if (!updateRes.ok) {
      return NextResponse.json({ error: 'Failed to accept invite' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, project_id: invite.project_id });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
