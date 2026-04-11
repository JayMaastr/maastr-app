import { NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(req) {
  try {
    const { email } = await req.json();
    if (!email) return NextResponse.json({ error: 'Missing email' }, { status: 400 });

    // Fetch all collaborator rows for this email with project details
    const res = await fetch(
      SUPABASE_URL + '/rest/v1/project_collaborators?invited_email=eq.' + encodeURIComponent(email) + '&select=id,project_id,status,role,token,invited_by,created_at,projects:project_id(id,title,artist,image_url)',
      {
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': 'Bearer ' + SERVICE_KEY,
        },
      }
    );

    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch invites' }, { status: 500 });
    }

    const rows = await res.json();

    const pending = rows
      .filter(r => r.status === 'pending')
      .map(r => ({
        id: r.id,
        project_id: r.project_id,
        token: r.token,
        role: r.role,
        created_at: r.created_at,
        project: r.projects,
      }));

    const accepted = rows
      .filter(r => r.status === 'accepted')
      .map(r => ({
        id: r.id,
        project_id: r.project_id,
        role: r.role,
        project: r.projects,
      }));

    return NextResponse.json({ pending, accepted });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
