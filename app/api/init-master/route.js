import { NextResponse } from 'next/server';
import { sb } from '@/lib/supabase';

export async function POST(req) {
  try {
    const { trackId, projectId } = await req.json();
    if (!trackId || !projectId) {
      return NextResponse.json({ error: 'trackId and projectId required' }, { status: 400 });
    }
    const { data: track, error: trackErr } = await sb
      .from('tracks')
      .select('id, audio_url, tone_setting, tone_label, project_id')
      .eq('id', trackId)
      .single();
    if (trackErr || !track) {
      return NextResponse.json({ error: 'Track not found' }, { status: 404 });
    }
    const { data: existing } = await sb
      .from('revisions')
      .select('id')
      .eq('track_id', trackId)
      .eq('label', 'v1')
      .maybeSingle();
    if (existing?.id) {
      return NextResponse.json({ status: 'already_initialized', revisionId: existing.id });
    }
    const { data: revision, error: revErr } = await sb
      .from('revisions')
      .insert({
        track_id: trackId,
        project_id: track.project_id || projectId,
        label: 'v1',
        version_number: 1,
        audio_url: track.audio_url,
        tone_setting: track.tone_setting ?? 4,
        tone_label: track.tone_label,
        is_active: true,
      })
      .select('id')
      .single();
    if (revErr || !revision) {
      console.error('[init-master] revision insert error:', revErr);
      return NextResponse.json({ error: 'Failed to create revision', detail: revErr?.message }, { status: 500 });
    }
    const base = process.env.NEXT_PUBLIC_APP_URL || 'https://maastr-app.vercel.app';
    fetch(base + '/api/request-master', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revisionId: revision.id, projectId: track.project_id || projectId, preset: track.tone_label ?? 'N+N' }),
    }).catch(e => console.error('[init-master] request-master error:', e));
    return NextResponse.json({ status: 'ok', revisionId: revision.id });
  } catch (e) {
    console.error('[init-master] error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}