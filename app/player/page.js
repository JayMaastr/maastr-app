'use client';
import { useEffect, useState, useRef } from 'react';
import { sb } from '@/lib/supabase';

function fmt(s) {
  if (!s || isNaN(s)) return '0:00';
  return Math.floor(s/60) + ':' + String(Math.floor(s%60)).padStart(2,'0');
}

const FALLBACK_PEAKS = (() => {
  const p = []; let s = 0x12345678;
  for (let i = 0; i < 200; i++) {
    s ^= s << 13; s ^= s >> 17; s ^= s << 5; s >>>= 0;
    const env = Math.sin(i / 200 * Math.PI) * 0.6 + 0.35;
    p.push(Math.max(0.05, Math.min(0.95, env * (0.45 + s / 0xFFFFFFFF * 0.55))));
  }
  return p;
})();

function Waveform({ peaks, progress, notes, duration, onSeek }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const progressRef = useRef(progress);
  useEffect(() => { progressRef.current = progress; }, [progress]);

  const stablePeaks = useRef(FALLBACK_PEAKS);
  if (peaks && peaks.length > 4) stablePeaks.current = peaks;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.parentElement?.offsetWidth || 800;
    const H = 96;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const data = stablePeaks.current;
    const BAR = 2, GAP = 1, STEP = BAR + GAP;
    const numBars = Math.floor(W / STEP);
    const cy = H / 2;

    const heights = new Float32Array(numBars);
    for (let i = 0; i < numBars; i++) {
      const pi = Math.floor(i / numBars * data.length);
      heights[i] = Math.max(2, data[Math.min(pi, data.length - 1)] * (cy - 6));
    }

    // Bake note markers onto offscreen canvas (CSS pixel dimensions)
    const nc = document.createElement('canvas');
    nc.width = W; nc.height = H;
    const nctx = nc.getContext('2d');
    if (notes && notes.length && duration > 0) {
      notes.forEach(n => {
        if (n.timestamp_sec == null || n.timestamp_sec > duration) return;
        const x = (n.timestamp_sec / duration) * W;
        nctx.save();
        nctx.strokeStyle = 'rgba(255,255,255,0.3)';
        nctx.lineWidth = 1; nctx.setLineDash([2,3]);
        nctx.beginPath(); nctx.moveTo(x,4); nctx.lineTo(x,H-4); nctx.stroke();
        nctx.restore();
        nctx.fillStyle = '#e8a020';
        nctx.beginPath(); nctx.arc(x,5,3.5,0,Math.PI*2); nctx.fill();
        nctx.beginPath(); nctx.arc(x,H-5,3.5,0,Math.PI*2); nctx.fill();
      });
    }

    let lastPlayX = -999;

    function draw() {
      const prog = Math.max(0, Math.min(1, progressRef.current || 0));
      const playX = prog * W;

      if (Math.abs(playX - lastPlayX) >= 0.5) {
        lastPlayX = playX;
        const cutBar = Math.floor(prog * numBars);
        ctx.clearRect(0, 0, W, H);

        // Bars
        for (let i = 0; i < numBars; i++) {
          const h = heights[i];
          ctx.fillStyle = i < cutBar ? 'rgba(232,160,32,0.88)' : 'rgba(255,255,255,0.16)';
          ctx.fillRect(i * STEP, cy - h, BAR, h * 2);
        }

        // Note markers (baked at CSS size, drawn at CSS size — no scale needed)
        ctx.drawImage(nc, 0, 0);

        // Playhead — bright white so it pops against both amber and grey
        if (prog > 0.001) {
          const px = Math.round(playX);
          ctx.save();
          // Dark shadow for contrast
          ctx.shadowColor = 'rgba(0,0,0,0.8)';
          ctx.shadowBlur = 4;
          // Bright white line
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(px - 1, 0, 2, H);
          // Amber top handle
          ctx.shadowColor = 'rgba(232,160,32,0.9)';
          ctx.shadowBlur = 8;
          ctx.fillStyle = '#ffcc44';
          ctx.beginPath();
          ctx.arc(px, 3, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

      rafRef.current = requestAnimationFrame(draw);
    }

    draw();
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [notes, duration]);

  return (
    <div onClick={e => {
      if (!onSeek) return;
      const rect = e.currentTarget.getBoundingClientRect();
      onSeek(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
    }} style={{ width:'100%', height:96, cursor:'crosshair', userSelect:'none' }}>
      <canvas ref={canvasRef} style={{ display:'block', width:'100%', height:96 }} />
    </div>
  );
}

export default function Player() {
  const [user, setUser] = useState(null);
  const [project, setProject] = useState(null);
  const [tracks, setTracks] = useState([]);
  const [activeTrack, setActiveTrack] = useState(null);
  const [activeRevision, setActiveRevision] = useState(null);
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
    const { data: tr } = await sb.from('tracks').select('*, revisions(*)').eq('project_id', pid).order('position');
    const trackList = tr || [];
    setTracks(trackList);
    if (trackList.length > 0) {
      const first = trackList[0];
      setActiveTrack(first);
      const rev = first.revisions?.find(r => r.is_active) || first.revisions?.[first.revisions.length-1] || null;
      setActiveRevision(rev);
      loadNotes(first.id);
    }
  }

  async function loadNotes(trackId) {
    const { data } = await sb.from('notes').select('*').eq('track_id', trackId).order('timestamp_sec');
    setNotes(data || []);
  }

  function selectTrack(t) {
    setActiveTrack(t); setPlaying(false); setCurrentTime(0); setPinnedTime(0);
    if (audioRef.current) audioRef.current.pause();
    const rev = t.revisions?.find(r => r.is_active) || t.revisions?.[t.revisions.length-1] || null;
    setActiveRevision(rev); loadNotes(t.id);
  }

  function selectRevision(rev) {
    setActiveRevision(rev); setPlaying(false); setCurrentTime(0); setPinnedTime(0);
    if (audioRef.current) audioRef.current.pause();
  }

  function togglePlay() {
    if (!audioRef.current) return;
    if (playing) { audioRef.current.pause(); setPlaying(false); }
    else { audioRef.current.play(); setPlaying(true); }
  }

  function getAudioUrl() {
    if (activeRevision) return activeRevision.mp3_url || activeRevision.audio_url;
    if (activeTrack) return activeTrack.mp3_url || activeTrack.audio_url;
    return null;
  }

  function handleSeek(pct) {
    if (!audioRef.current || !duration) return;
    const t = pct * duration;
    audioRef.current.currentTime = t; setCurrentTime(t); setPinnedTime(t);
  }

  async function postNote() {
    if (!noteText.trim() || !activeTrack) return;
    await sb.from('notes').insert({
      track_id: activeTrack.id, project_id: project.id,
      author_name: user?.email?.split('@')[0] || 'You',
      timestamp_sec: pinnedTime, timestamp_label: fmt(pinnedTime), body: noteText.trim()
    });
    setNoteText(''); loadNotes(activeTrack.id);
  }

  const audioUrl = getAudioUrl();
  const progress = duration ? currentTime / duration : 0;
  const revisions = activeTrack?.revisions || [];

  return (
    <>
      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        :root{--bg:#0a0a0b;--surf:#111113;--surf2:#16161a;--border:#24242c;--border2:#2e2e38;--amber:#e8a020;--aglow:rgba(232,160,32,0.08);--aglow2:rgba(232,160,32,0.15);--text:#f0ede8;--t2:#8a8780;--t3:#4a4945;--fh:'DM Serif Display',Georgia,serif;--fm:'DM Mono','SF Mono','Menlo',monospace;}
        html,body{background:var(--bg);color:var(--text);font-family:var(--fm);height:100%;overflow:hidden;}
        .topbar{height:52px;display:flex;align-items:center;justify-content:space-between;padding:0 24px;background:var(--surf);border-bottom:1px solid var(--border);}
        .logo{font-family:var(--fh);font-size:18px;color:var(--text);text-decoration:none;} .logo em{color:var(--amber);font-style:normal;}
        .breadcrumb{font-size:13px;color:var(--t2);font-style:italic;margin-left:8px;}
        .back{font-size:11px;color:var(--t2);text-decoration:none;letter-spacing:.04em;transition:color .15s;} .back:hover{color:var(--text);}
        .layout{display:flex;height:calc(100vh - 52px);}
        .left{flex:1;overflow-y:auto;padding:28px 32px;border-right:1px solid var(--border);}
        .right{width:340px;flex-shrink:0;display:flex;flex-direction:column;overflow:hidden;background:var(--surf);}
        .proj-title{font-family:var(--fh);font-size:28px;letter-spacing:-.02em;margin-bottom:4px;}
        .proj-artist{font-size:12px;color:var(--t2);margin-bottom:24px;letter-spacing:.04em;}
        .tabs-row{display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;align-items:center;}
        .tabs-label{font-size:10px;color:var(--t3);letter-spacing:.1em;text-transform:uppercase;margin-right:4px;}
        .tab-btn{padding:5px 12px;font-family:var(--fm);font-size:11px;cursor:pointer;border-radius:8px;border:1.5px solid var(--border2);background:transparent;color:var(--t2);transition:all .15s;max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .tab-btn:hover{color:var(--text);border-color:var(--t2);} .tab-btn.active{background:var(--aglow);border-color:var(--amber);color:var(--amber);}
        .player-box{background:var(--surf);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:20px;}
        .waveform-wrap{background:var(--surf2);border-radius:8px;padding:12px 14px 8px;margin-bottom:14px;}
        .time-row{display:flex;justify-content:space-between;margin-top:8px;}
        .time-label{font-size:10px;color:var(--t3);font-variant-numeric:tabular-nums;}
        .transport{display:flex;align-items:center;gap:14px;}
        .play-btn{width:44px;height:44px;border-radius:50%;background:var(--amber);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:opacity .15s,transform .1s;}
        .play-btn:hover{opacity:.85;} .play-btn:active{transform:scale(.94);} .play-btn:disabled{opacity:.3;pointer-events:none;}
        .time-display{font-size:14px;color:var(--t2);font-variant-numeric:tabular-nums;} .time-cur{color:var(--text);font-weight:500;}
        .rev-badge{margin-left:auto;font-size:9px;padding:3px 9px;border-radius:4px;background:var(--aglow);border:1px solid rgba(232,160,32,.2);color:var(--amber);letter-spacing:.06em;text-transform:uppercase;}
        .note-bar{background:var(--surf);border:1px solid var(--border2);border-radius:12px;padding:16px;}
        .note-bar-top{display:flex;align-items:center;gap:10px;margin-bottom:10px;font-size:11px;color:var(--t2);}
        .ts-badge{padding:3px 10px;background:var(--aglow);border:1px solid rgba(232,160,32,.25);border-radius:6px;font-size:11px;color:var(--amber);font-weight:500;}
        textarea{width:100%;background:var(--bg);border:1.5px solid var(--border2);border-radius:8px;padding:10px 12px;color:var(--text);font-family:var(--fm);font-size:12px;resize:none;outline:none;min-height:64px;transition:border-color .15s;} textarea:focus{border-color:var(--amber);}
        .note-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:10px;}
        .btn-ghost{font-family:var(--fm);font-size:11px;padding:7px 14px;border-radius:8px;border:1.5px solid var(--border2);background:transparent;color:var(--t2);cursor:pointer;transition:all .15s;} .btn-ghost:hover{color:var(--text);border-color:var(--t2);}
        .btn-amber{font-family:var(--fm);font-size:11px;font-weight:500;padding:7px 16px;border-radius:8px;background:var(--amber);color:#000;border:none;cursor:pointer;transition:opacity .15s;} .btn-amber:hover{opacity:.88;} .btn-amber:disabled{opacity:.35;pointer-events:none;}
        .panel-header{padding:14px 16px;border-bottom:1px solid var(--border);}
        .panel-title{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--amber);font-weight:500;}
        .panel-body{flex:1;overflow-y:auto;}
        .note-item{padding:14px 16px;border-bottom:1px solid var(--border);transition:background .15s;} .note-item:hover{background:var(--surf2);} .note-item:last-child{border-bottom:none;}
        .note-header{display:flex;align-items:center;gap:8px;margin-bottom:6px;}
        .note-author{font-size:11px;color:var(--text);font-weight:500;}
        .note-ts{font-size:10px;padding:2px 8px;background:var(--aglow);border:1px solid rgba(232,160,32,.2);color:var(--amber);border-radius:4px;cursor:pointer;transition:background .15s;} .note-ts:hover{background:var(--aglow2);}
        .note-date{font-size:10px;color:var(--t3);margin-left:auto;}
        .note-body{font-size:12px;color:var(--t2);line-height:1.6;}
        .empty-notes{text-align:center;padding:48px 16px;color:var(--t3);font-size:11px;line-height:1.8;}
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
            <div className="tabs-row" style={{ marginBottom:16 }}>
              <span className="tabs-label">Track</span>
              {tracks.map(t => (<button key={t.id} className={`tab-btn ${activeTrack?.id===t.id?'active':''}`} title={t.title} onClick={() => selectTrack(t)}>{t.title}</button>))}
            </div>
          )}
          {revisions.length > 1 && (
            <div className="tabs-row" style={{ marginBottom:20 }}>
              <span className="tabs-label">Version</span>
              {revisions.map((rev, i) => (<button key={rev.id} className={`tab-btn ${activeRevision?.id===rev.id?'active':''}`} onClick={() => selectRevision(rev)}>{rev.label || `v${rev.version_number || i+1}`}</button>))}
            </div>
          )}
          <div className="player-box">
            <div className="waveform-wrap">
              <Waveform peaks={activeTrack?.peaks} progress={progress} notes={notes} duration={duration} onSeek={handleSeek} />
              <div className="time-row">
                <span className="time-label">{fmt(currentTime)}</span>
                <span className="time-label">{notes.length > 0 ? notes.length + (notes.length===1?' note':' notes') : ''}</span>
                <span className="time-label">{fmt(duration)}</span>
              </div>
            </div>
            <div className="transport">
              <button className="play-btn" onClick={togglePlay} disabled={!audioUrl}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="#000">
                  {playing ? <><rect x="3" y="1" width="3.5" height="14" rx="1"/><rect x="9.5" y="1" width="3.5" height="14" rx="1"/></> : <polygon points="3,1 15,8 3,15"/>}
                </svg>
              </button>
              <div className="time-display"><span className="time-cur">{fmt(currentTime)}</span><span> / {fmt(duration)}</span></div>
              {activeRevision && <span className="rev-badge">{activeRevision.label || `v${activeRevision.version_number || 1}`}</span>}
            </div>
          </div>
          <div className="note-bar">
            <div className="note-bar-top">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              Note at <span className="ts-badge">{fmt(pinnedTime)}</span>
              <span style={{ fontSize:10, color:'var(--t3)' }}>(updates while playing)</span>
            </div>
            <textarea value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Add a timestamped note…" />
            <div className="note-actions">
              <button className="btn-ghost" onClick={() => setNoteText('')}>Clear</button>
              <button className="btn-amber" onClick={postNote} disabled={!noteText.trim()}>Post Note</button>
            </div>
          </div>
        </div>
        <div className="right">
          <div className="panel-header"><div className="panel-title">Notes ({notes.length})</div></div>
          <div className="panel-body">
            {notes.length === 0 ? (
              <div className="empty-notes"><div style={{ fontSize:28, marginBottom:8, opacity:.4 }}>♪</div>No notes yet.<br />Hit play and leave feedback.</div>
            ) : notes.map(n => (
              <div key={n.id} className="note-item">
                <div className="note-header">
                  <span className="note-author">{n.author_name || 'Anonymous'}</span>
                  {n.timestamp_sec != null && (<span className="note-ts" onClick={() => { if (audioRef.current && duration) { audioRef.current.currentTime = n.timestamp_sec; setCurrentTime(n.timestamp_sec); setPinnedTime(n.timestamp_sec); } }}>{n.timestamp_label || fmt(n.timestamp_sec)}</span>)}
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
          onEnded={() => setPlaying(false)} />
      )}
    </>
  );
            }
