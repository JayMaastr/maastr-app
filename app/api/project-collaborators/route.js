import { NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(req) {
  try {
    const { projectId } = await req.json();
    if (!projectId) return NextResponse.json({ error: 'Missing projectId' }, { status: 400 });

    const res = await fetch(
      SUPABASE_URL + '/rest/v1/project_collaborators?project_id=eq.' + encodeURIComponent(projectId) + '&select=id,invited_email,status,role,created_at',
      {
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': 'Bearer ' + SERVICE_KEY,
        },
      }
    );

    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch collaborators' }, { status: 500 });
    }

    const collaborators = await res.json();
    return NextResponse.json({ collaborators });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
