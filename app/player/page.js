'use client';
import { useEffect, useState, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  'https://btgednpwlkimgjwcopru.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0Z2VkbnB3bGtpbWdqd2NvcHJ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMDkwNzEsImV4cCI6MjA4OTc4NTA3MX0.6rVWXxzZRDkHrJhKm5MW45QZOvNJOv56kSKZG6MpBD0'
);

function fmt(s) {
  if (!s || isNaN(s)) return '0:00';
  return Math.floor(s/60) + ':' + String(Math.floor(s%60)).padStart(2,'0');
}

export default function Player() {
  const [user, setUser] = useState(null);
  const [project, setProject] = useState(null);
  const [tracks, setTracks] = useState([]);
  const [activeTrack, setActiveTrack] = useState(null);
  const [notes, setNotes] = useState([]);
  const [noteText, setNoteText] = useState('');
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [pinnedTime, setPinnedTime] = useState(0);
  const audioRef = useRef(null);
  const waveRef = useRef(null);

  useEffect(() => {
    sb.auth.getSession().then(({ data: { session } }) => {
      if (!session) { window.location.href = '/auth'; return; }
      setUser(session.user);
      const params = new URLSearchParams(window.location.search);
      const pid = params.get('project');
      if (!pid) { window.location.href = '/'; return; }
      loadProject(pid);
    });
  }, []);

  async function loadProject(pid) {
    const { data: proj } = await sb.from('projects').select('*').eq('id', pid).single();
    if (!proj) { window.location.href = '/'; return; }
    setProject(proj);
    const { data: tr } = await sb.from('tracks')
      .select('*, revisions(*)')
      .eq('project_id', pid)
      .order('position');
    const trackList = tr || [];
    setTracks(trackList);
    if (trackList.length > 0) {
      setActiveTrack(trackList[0]);
      loadNotes(trackList[0].id);
    }
  }

  async function loadNotes(trackId) {
    const { data } = await sb.from('notes')
      .select('*').eq('track_id', trackId)
      .order('timestamp_sec');
    setNotes(data || []);
  }

  function selectTrack(t) {
    setActiveTrack(t);
    setPlaying(false);
    setCurrentTime(0);
    setPinnedTime(0);
    if (audioRef.current) audioRef.current.pause();
    loadNotes(t.id);
  }

  function togglePlay() {
    if (!audioRef.current) return;
    if (playing) { audioRef.current.pause(); setPlaying(false); }
    else { audioRef.current.play(); setPlaying(true); }
  }

  function getAudioUrl() {
    if (!activeTrack) return null;
    // Use mp3_url for mobile compatibility, fall back to audio_url
    const rev = activeTrack.revisions?.find(r => r.is_active);
    return rev?.mp3_url || rev?.audio_url || activeTrack.mp3_url || activeTrack.audio_url;
  }

  async function postNote() {
    if (!noteText.trim() || !activeTrack) return;
    await sb.from('notes').insert({
      track_id: activeTrack.id,
      project_id: project.id,
      author_name: user?.email?.split('@')[0] || 'You',
      timestamp_sec: pinnedTime,
      timestamp_label: fmt(pinnedTime),
      body: noteText.trim()
    });
    setNoteText('');
    loadNotes(activeTrack.id);
  }

  const audioUrl = getAudioUrl();

  return (
    <>
      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        :root{
          --bg:#0a0a0b;--surf:#111113;--surf2:#16161a;--surf3:#1e1e24;
          --border:#24242c;--border2:#2e2e38;
          --amber:#e8a020;--aglow:rgba(232,160,32,0.08);
          --text:#f0ede8;--t2:#8a8780;--t3:#4a4945;
          --fh:'DM Serif Display',Georgia,serif;
          --fm:'DM Mono','SF Mono','Menlo',monospace;
        }
        html,body{background:var(--bg);color:var(--text);font-family:var(--fm);height:100%;overflow:hidden;}
        .topbar{height:52px;display:flex;align-items:center;justify-content:space-between;padding:0 24px;background:var(--surf);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:50;}
        .logo{font-family:var(--fh);font-size:18px;color:var(--text);text-decoration:none;}
        .logo em{color:var(--amber);font-style:normal;}
        .back{font-size:11px;color:var(--t2);text-decoration:none;display:flex;align-items:center;gap:6px;}
        .back:hover{color:var(--text);}
        .layout{display:flex;height:calc(100vh - 52px);}
        .left{flex:1;overflow-y:auto;padding:28px 32px;border-right:1px solid var(--border);}
        .right{width:340px;flex-shrink:0;display:flex;flex-direction:column;overflow:hidden;}
        .proj-title{font-family:var(--fh);font-size:26px;letter-spacing:-.02em;margin-bottom:4px;}
        .proj-artist{font-size:12px;color:var(--t2);margin-bottom:24px;}
        .track-tabs{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap;}
        .track-tab{padding:6px 14px;font-family:var(--fm);font-size:11px;cursor:pointer;border-radius:8px;border:1.5px solid var(--border2);background:transparent;color:var(--t2);transition:all .15s;}
        .track-tab:hover{color:var(--text);border-color:var(--t2);}
        .track-tab.active{background:var(--aglow);border-color:var(--amber);color:var(--amber);}
        .player-box{background:var(--surf);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:20px;}
        .waveform-bar{height:64px;background:var(--surf2);border-radius:8px;margin-bottom:16px;display:flex;align-items:center;justify-content:center;cursor:pointer;overflow:hidden;position:relative;}
        .progress-fill{position:absolute;left:0;top:0;height:100%;background:rgba(232,160,32,.15);pointer-events:none;transition:width .1s linear;}
        .waveform-label{font-size:11px;color:var(--t3);}
        .transport{display:flex;align-items:center;gap:16px;}
        .play-btn{width:40px;height:40px;border-radius:50%;background:var(--amber);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:opacity .15s;}
        .play-btn:hover{opacity:.85;}
        .time{font-size:13px;color:var(--t2);}
        .time span{color:var(--text);}
        .note-bar{background:var(--surf);border:1px solid var(--border2);border-radius:12px;padding:16px;}
        .note-bar-top{display:flex;align-items:center;gap:10px;margin-bottom:10px;font-size:11px;color:var(--t2);}
        .ts-badge{padding:3px 10px;background:var(--aglow);border:1px solid rgba(232,160,32,.2);border-radius:6px;font-size:11px;color:var(--amber);}
        textarea{width:100%;background:var(--bg);border:1.5px solid var(--border2);border-radius:8px;padding:10px 12px;color:var(--text);font-family:var(--fm);font-size:12px;resize:none;outline:none;min-height:64px;}
        textarea:focus{border-color:var(--amber);}
        .note-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:8px;}
        .btn-ghost{font-family:var(--fm);font-size:11px;padding:7px 14px;border-radius:8px;border:1.5px solid var(--border2);background:transparent;color:var(--t2);cursor:pointer;}
        .btn-amber{font-family:var(--fm);font-size:11px;font-weight:500;padding:7px 16px;border-radius:8px;background:var(--amber);color:#000;border:none;cursor:pointer;}
        .panel-tabs{display:flex;border-bottom:1px solid var(--border);background:var(--surf);}
        .panel-tab{flex:1;padding:14px;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--t3);cursor:pointer;text-align:center;border:none;background:transparent;font-family:var(--fm);border-bottom:2px solid transparent;transition:all .15s;}
        .panel-tab.active{color:var(--amber);border-bottom-color:var(--amber);background:var(--aglow);}
        .panel-body{flex:1;overflow-y:auto;padding:16px;}
        .note-item{padding:12px 0;border-bottom:1px solid var(--border);}
        .note-item:last-child{border-bottom:none;}
        .note-header{display:flex;align-items:center;gap:8px;margin-bottom:6px;}
        .note-author{font-size:11px;color:var(--text);}
        .note-ts{font-size:10px;padding:2px 7px;background:var(--aglow);color:var(--amber);border-radius:4px;cursor:pointer;}
        .note-ts:hover{background:rgba(232,160,32,.2);}
        .note-date{font-size:10px;color:var(--t3);margin-left:auto;}
        .note-body{font-size:12px;color:#ccc;line-height:1.6;}
        .empty-notes{text-align:center;padding:40px 0;color:var(--t3);font-size:11px;}
      `}</style>

      <div className="topbar">
        <div style={{ display:'flex', alignItems:'center', gap:16 }}>
          <a href="/" className="logo">maastr<em>.</em></a>
          <span style={{ color:'var(--border2)' }}>/</span>
          <span style={{ fontSize:13, color:'var(--t2)', fontStyle:'italic' }}>{project?.title || 'Loading…'}</span>
        </div>
        <a href="/" className="back">← Dashboard</a>
      </div>

      <div className="layout">
        <div className="left">
          <div className="proj-title">{project?.title}</div>
          <div className="proj-artist">{project?.artist}</div>

          {tracks.length > 1 && (
            <div className="track-tabs">
              {tracks.map(t => (
                <button key={t.id} className={`track-tab ${activeTrack?.id===t.id?'active':''}`}
                  onClick={() => selectTrack(t)}>{t.title}</button>
              ))}
            </div>
          )}

          <div className="player-box">
            <div className="waveform-bar" onClick={e => {
              if (!audioRef.current || !duration) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const pct = (e.clientX - rect.left) / rect.width;
              audioRef.current.currentTime = pct * duration;
            }}>
              <div className="progress-fill" style={{ width: duration ? (currentTime/duration*100)+'%' : '0%' }} />
              <span className="waveform-label">{audioUrl ? (playing ? '▶ Playing' : 'Click to seek') : 'No audio'}</span>
            </div>
            <div className="transport">
              <button className="play-btn" onClick={togglePlay} disabled={!audioUrl}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="#000">
                  {playing
                    ? <><rect x="3" y="1" width="3" height="12"/><rect x="8" y="1" width="3" height="12"/></>
                    : <polygon points="3,1 13,7 3,13"/>
                  }
                </svg>
              </button>
              <div className="time"><span>{fmt(currentTime)}</span> / {fmt(duration)}</div>
            </div>
          </div>

          <div className="note-bar">
            <div className="note-bar-top">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              Note at <span className="ts-badge">{fmt(pinnedTime)}</span>
            </div>
            <textarea value={noteText} onChange={e => setNoteText(e.target.value)}
              placeholder="Add a timestamped note…" />
            <div className="note-actions">
              <button className="btn-ghost" onClick={() => setNoteText('')}>Clear</button>
              <button className="btn-amber" onClick={postNote} disabled={!noteText.trim()}>Post Note</button>
            </div>
          </div>
        </div>

        <div className="right">
          <div className="panel-tabs">
            <button className="panel-tab active">Notes ({notes.length})</button>
          </div>
          <div className="panel-body">
            {notes.length === 0 ? (
              <div className="empty-notes">
                <div style={{ fontSize:24, marginBottom:8 }}>♪</div>
                No notes yet. Hit play and leave feedback.
              </div>
            ) : notes.map((n, i) => (
              <div key={n.id} className="note-item" style={{ animationDelay: i*40+'ms' }}>
                <div className="note-header">
                  <span className="note-author">{n.author_name || 'Anonymous'}</span>
                  {n.timestamp_sec != null && (
                    <span className="note-ts" onClick={() => {
                      if (audioRef.current) audioRef.current.currentTime = n.timestamp_sec;
                    }}>{n.timestamp_label || fmt(n.timestamp_sec)}</span>
                  )}
                  <span className="note-date">{new Date(n.created_at).toLocaleDateString()}</span>
                </div>
                <div className="note-body">{n.body}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {audioUrl && (
        <audio ref={audioRef} src={audioUrl} preload="metadata"
          onTimeUpdate={e => { setCurrentTime(e.target.currentTime); setPinnedTime(e.target.currentTime); }}
          onDurationChange={e => setDuration(e.target.duration)}
          onEnded={() => setPlaying(false)}
        />
      )}
    </>
  );
}
