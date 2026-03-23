'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  'https://btgednpwlkimgjwcopru.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0Z2VkbnB3bGtpbWdqd2NvcHJ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMDkwNzEsImV4cCI6MjA4OTc4NTA3MX0.6rVWXxzZRDkHrJhKm5MW45QZOvNJOv56kSKZG6MpBD0'
);

function fmt(s) {
  if (!s || isNaN(s)) return '0:00';
  return Math.floor(s/60) + ':' + String(Math.floor(s%60)).padStart(2,'0');
}

function fallbackPeaks() {
  const p = []; let s = Date.now() & 0xFFFFFF;
  for (let i = 0; i < 100; i++) {
    s ^= s << 13; s ^= s >> 17; s ^= s << 5;
    p.push(Math.max(0.04, Math.min(0.96, (0.3 + Math.sin(i/100 * Math.PI) * 0.4) * (0.5 + (s>>>0)/0xFFFFFFFF * 0.5))));
  }
  return p;
}

function Waveform({ peaks, progress, notes, duration, onSeek }) {
  const ref = useRef(null);
  const data = (peaks && peaks.length > 4) ? peaks : fallbackPeaks();

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const W = canvas.offsetWidth || 600, H = 80;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    const cy = H / 2, BAR = 2, GAP = 1, STEP = BAR + GAP;
    const numBars = Math.floor(W / STEP);
    const cutoff = Math.floor(numBars * (progress || 0));
    for (let i = 0; i < numBars; i++) {
      const pi = Math.floor((i / numBars) * data.length);
      const amp = data[Math.min(pi, data.length - 1)];
      const h = Math.max(2, amp * (cy - 4));
      const played = i < cutoff;
      const g = ctx.createLinearGradient(0, cy - h, 0, cy + h);
      if (played) {
        g.addColorStop(0, 'rgba(232,160,32,.9)');
        g.addColorStop(.5, 'rgba(232,160,32,.55)');
        g.addColorStop(1, 'rgba(232,160,32,.12)');
      } else {
        g.addColorStop(0, 'rgba(255,255,255,.18)');
        g.addColorStop(.5, 'rgba(255,255,255,.09)');
        g.addColorStop(1, 'rgba(255,255,255,.02)');
      }
      ctx.fillStyle = g;
      ctx.fillRect(i * STEP, cy - h, BAR, h * 2);
    }
    // Note markers
    if (notes && duration) {
      notes.forEach(n => {
        if (n.timestamp_sec == null) return;
        const x = (n.timestamp_sec / duration) * W;
        ctx.fillStyle = 'rgba(232,160,32,0.9)';
        ctx.beginPath();
        ctx.arc(x, H - 6, 3, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }, [data, progress, notes, duration]);

  return (
    <canvas ref={ref} style={{ display:'block', width:'100%', height:80, cursor:'pointer' }}
      onClick={e => {
        if (!onSeek) return;
        const rect = e.currentTarget.getBoundingClientRect();
        onSeek((e.clientX - rect.left) / rect.width);
      }} />
  );
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
      loadNotes(trackList[0].id, pid);
    }
  }

  async function loadNotes(trackId, pid) {
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
    const rev = activeTrack.revisions?.find(r => r.is_active);
    return rev?.mp3_url || rev?.audio_url || activeTrack.mp3_url || activeTrack.audio_url;
  }

  function handleSeek(pct) {
    if (!audioRef.current || !duration) return;
    audioRef.current.currentTime = pct * duration;
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
  const progress = duration ? currentTime / duration : 0;
  const activePeaks = activeTrack?.peaks;

  return (
    <>
      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        :root{
          --bg:#0a0a0b;--surf:#111113;--surf2:#16161a;--surf3:#1e1e24;
          --border:#24242c;--border2:#2e2e38;
          --amber:#e8a020;--aglow:rgba(232,160,32,0.08);--aglow2:rgba(232,160,32,0.15);
          --text:#f0ede8;--t2:#8a8780;--t3:#4a4945;
          --fh:'DM Serif Display',Georgia,serif;
          --fm:'DM Mono','SF Mono','Menlo',monospace;
        }
        html,body{background:var(--bg);color:var(--text);font-family:var(--fm);height:100%;overflow:hidden;}
        .topbar{height:52px;display:flex;align-items:center;justify-content:space-between;padding:0 24px;background:var(--surf);border-bottom:1px solid var(--border);}
        .logo{font-family:var(--fh);font-size:18px;color:var(--text);text-decoration:none;}
        .logo em{color:var(--amber);font-style:normal;}
        .breadcrumb{font-size:13px;color:var(--t2);font-style:italic;margin-left:8px;}
        .back{font-size:11px;color:var(--t2);text-decoration:none;letter-spacing:.04em;transition:color .15s;}
        .back:hover{color:var(--text);}
        .layout{display:flex;height:calc(100vh - 52px);}
        .left{flex:1;overflow-y:auto;padding:28px 32px;border-right:1px solid var(--border);}
        .right{width:340px;flex-shrink:0;display:flex;flex-direction:column;overflow:hidden;background:var(--surf);}
        .proj-title{font-family:var(--fh);font-size:28px;letter-spacing:-.02em;margin-bottom:4px;}
        .proj-artist{font-size:12px;color:var(--t2);margin-bottom:24px;letter-spacing:.04em;}
        .track-tabs{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap;}
        .track-tab{padding:6px 14px;font-family:var(--fm);font-size:11px;cursor:pointer;border-radius:8px;border:1.5px solid var(--border2);background:transparent;color:var(--t2);transition:all .15s;max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .track-tab:hover{color:var(--text);border-color:var(--t2);}
        .track-tab.active{background:var(--aglow);border-color:var(--amber);color:var(--amber);}
        .player-box{background:var(--surf);border:1px solid var(--border);border-radius:12px;padding:20px 20px 16px;margin-bottom:20px;}
        .waveform-wrap{margin-bottom:16px;background:var(--surf2);border-radius:8px;padding:12px 12px 8px;overflow:hidden;}
        .transport{display:flex;align-items:center;gap:16px;}
        .play-btn{width:40px;height:40px;border-radius:50%;background:var(--amber);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:opacity .15s,transform .1s;}
        .play-btn:hover{opacity:.85;}
        .play-btn:active{transform:scale(.95);}
        .time{font-size:13px;color:var(--t2);}
        .time-cur{color:var(--text);}
        .note-bar{background:var(--surf);border:1px solid var(--border2);border-radius:12px;padding:16px;}
        .note-bar-top{display:flex;align-items:center;gap:10px;margin-bottom:10px;font-size:11px;color:var(--t2);}
        .ts-badge{padding:3px 10px;background:var(--aglow);border:1px solid rgba(232,160,32,.25);border-radius:6px;font-size:11px;color:var(--amber);font-weight:500;}
        textarea{width:100%;background:var(--bg);border:1.5px solid var(--border2);border-radius:8px;padding:10px 12px;color:var(--text);font-family:var(--fm);font-size:12px;resize:none;outline:none;min-height:64px;transition:border-color .15s;}
        textarea:focus{border-color:var(--amber);}
        .note-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:10px;}
        .btn-ghost{font-family:var(--fm);font-size:11px;padding:7px 14px;border-radius:8px;border:1.5px solid var(--border2);background:transparent;color:var(--t2);cursor:pointer;transition:all .15s;}
        .btn-ghost:hover{color:var(--text);border-color:var(--t2);}
        .btn-amber{font-family:var(--fm);font-size:11px;font-weight:500;padding:7px 16px;border-radius:8px;background:var(--amber);color:#000;border:none;cursor:pointer;transition:opacity .15s;}
        .btn-amber:hover{opacity:.88;}
        .btn-amber:disabled{opacity:.35;pointer-events:none;}
        .panel-header{padding:14px 16px;border-bottom:1px solid var(--border);background:var(--surf);}
        .panel-title{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--amber);font-weight:500;}
        .panel-body{flex:1;overflow-y:auto;padding:0;}
        .note-item{padding:14px 16px;border-bottom:1px solid var(--border);transition:background .15s;}
        .note-item:hover{background:var(--surf2);}
        .note-item:last-child{border-bottom:none;}
        .note-header{display:flex;align-items:center;gap:8px;margin-bottom:6px;}
        .note-author{font-size:11px;color:var(--text);font-weight:500;}
        .note-ts{font-size:10px;padding:2px 8px;background:var(--aglow);border:1px solid rgba(232,160,32,.2);color:var(--amber);border-radius:4px;cursor:pointer;transition:background .15s;}
        .note-ts:hover{background:var(--aglow2);}
        .note-date{font-size:10px;color:var(--t3);margin-left:auto;}
        .note-body{font-size:12px;color:var(--t2);line-height:1.6;}
        .empty-notes{text-align:center;padding:48px 16px;color:var(--t3);}
        .empty-notes-icon{font-size:28px;margin-bottom:10px;opacity:.4;}
      `}</style>

      <div className="topbar">
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <a href="/" className="logo">maastr<em>.</em></a>
          <span style={{ color:'var(--border2)', fontSize:16 }}>/</span>
          <span className="breadcrumb">{project?.title || 'Loading…'}</span>
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
                  title={t.title} onClick={() => selectTrack(t)}>{t.title}</button>
              ))}
            </div>
          )}

          <div className="player-box">
            <div className="waveform-wrap">
              <Waveform
                peaks={activePeaks}
                progress={progress}
                notes={notes}
                duration={duration}
                onSeek={handleSeek}
              />
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
              <div className="time">
                <span className="time-cur">{fmt(currentTime)}</span>
                {' / ' + fmt(duration)}
              </div>
            </div>
          </div>

          <div className="note-bar">
            <div className="note-bar-top">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              Note at <span className="ts-badge">{fmt(pinnedTime)}</span>
              <span style={{ fontSize:10, color:'var(--t3)' }}>(updates while playing)</span>
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
          <div className="panel-header">
            <div className="panel-title">Notes ({notes.length})</div>
          </div>
          <div className="panel-body">
            {notes.length === 0 ? (
              <div className="empty-notes">
                <div className="empty-notes-icon">♪</div>
                No notes yet.<br />Hit play and leave feedback.
              </div>
            ) : notes.map(n => (
              <div key={n.id} className="note-item">
                <div className="note-header">
                  <span className="note-author">{n.author_name || 'Anonymous'}</span>
                  {n.timestamp_sec != null && (
                    <span className="note-ts" onClick={() => {
                      if (audioRef.current) {
                        audioRef.current.currentTime = n.timestamp_sec;
                        setPinnedTime(n.timestamp_sec);
                      }
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
