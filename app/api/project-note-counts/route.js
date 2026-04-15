import { NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(req) {
  try {
    const { projectIds } = await req.json();
    if (!projectIds || !projectIds.length) return NextResponse.json({ counts: {} });

    // Fetch all unresolved notes for these projects
    const res = await fetch(
      SUPABASE_URL + '/rest/v1/notes?select=project_id&resolved=is.false&project_id=in.(' + projectIds.join(',') + ')',
      {
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': 'Bearer ' + SERVICE_KEY,
        },
      }
    );

    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch notes' }, { status: 500 });
    }

    const notes = await res.json();

    // Group by project_id and count
    const counts = {};
    for (const note of notes) {
      counts[note.project_id] = (counts[note.project_id] || 0) + 1;
    }

    return NextResponse.json({ counts });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
