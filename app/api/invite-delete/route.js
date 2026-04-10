import { NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(req) {
  try {
    const { collaboratorId } = await req.json();
    if (!collaboratorId) {
      return NextResponse.json({ error: 'Missing collaboratorId' }, { status: 400 });
    }

    // Verify the collaborator row exists
    const lookupRes = await fetch(
      SUPABASE_URL + '/rest/v1/project_collaborators?id=eq.' + collaboratorId + '&select=id,project_id,invited_email',
      {
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': 'Bearer ' + SERVICE_KEY,
        },
      }
    );
    const rows = await lookupRes.json();
    const collab = rows[0];

    if (!collab) {
      return NextResponse.json({ error: 'Collaborator not found' }, { status: 404 });
    }

    // Delete the collaborator row using service key (bypasses RLS)
    const deleteRes = await fetch(
      SUPABASE_URL + '/rest/v1/project_collaborators?id=eq.' + collaboratorId,
      {
        method: 'DELETE',
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': 'Bearer ' + SERVICE_KEY,
          'Prefer': 'return=minimal',
        },
      }
    );

    if (!deleteRes.ok && deleteRes.status !== 204) {
      return NextResponse.json({ error: 'Failed to delete collaborator' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, deleted: collab.invited_email });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
