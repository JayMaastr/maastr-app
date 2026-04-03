import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 60;

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Valid presets â matches TONES array short codes (Warm/Neutral/Bright x Loud/Normal/Gentle)
// mastering service: https://mastering-production-008a.up.railway.app
const VALID_PRESETS = ['W+L','N+L','B+L','W+N','N+N','B+N','W+G','N+G','B+G'];

export async function POST(request) {
  try {
    const { revisionId, preset } = await request.json();

    if (!revisionId || !preset) {
      return NextResponse.json({ error: 'revisionId and preset required' }, { status: 400 });
    }
    if (!VALID_PRESETS.includes(preset)) {
      return NextResponse.json({ error: 'invalid preset' }, { status: 400 });
    }

    // Get revision to verify it exists and get project/track context
    const { data: revision, error: revErr } = await sb
      .from('revisions')
      .select('id, track_id, project_id, audio_url')
      .eq('id', revisionId)
      .single();

    if (revErr || !revision) {
      return NextResponse.json({ error: 'revision not found' }, { status: 404 });
    }

    // Upsert master row â if already exists just return its current state
    const { data: master, error: masterErr } = await sb
      .from('masters')
      .upsert({
        revision_id: revisionId,
        track_id: revision.track_id,
        project_id: revision.project_id,
        preset,
        status: 'pending',
        requested_at: new Date().toISOString()
      }, {
        onConflict: 'revision_id,preset',
        ignoreDuplicates: false
      })
      .select('id, status')
      .single();

    if (masterErr) {
      console.error('[request-master] upsert error:', masterErr.message);
      return NextResponse.json({ error: masterErr.message }, { status: 500 });
    }

    // Fire mastering service (stub for now â will call DawDreamer service later)
    const masteringUrl = process.env.MASTERING_URL;
    const masteringSecret = process.env.MASTERING_SECRET;
    if (masteringUrl) {
      // Set to processing before fire-and-forget so NC updates immediately
      await sb.from('masters').update({ status: 'processing' }).eq('id', master.id);
      try {
        await fetch(`${masteringUrl}/master`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(10000),
          body: JSON.stringify({
            masterId: master.id,
            revisionId,
            projectId: revision.project_id,
            audioUrl: revision.audio_url,
            preset,
            secret: masteringSecret
          })
        });
      } catch(e) {
        console.error('[request-master] mastering fire:', e.message);
      }
    } else {
      console.log('[request-master] no MASTERING_URL set â stub mode, master row created as pending');
    }

    return NextResponse.json({ status: 'queued', masterId: master.id, preset });
  } catch (e) {
    console.error('[request-master]', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
