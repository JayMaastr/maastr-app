'use client';
import { useEffect, useState, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://btgednpwlkimgjwcopru.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0Z2VkbnB3bGtpbWdqd2NvcHJ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMDkwNzEsImV4cCI6MjA4OTc4NTA3MX0.6rVWXxzZRDkHrJhKm5MW45QZOvNJOv56kSKZG6MpBD0';
const UPLOAD_WORKER_URL = 'https://maastr-upload.jay-288.workers.dev';
const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

function fallbackPeaks() {
  const p = []; let s = Date.now() & 0xFFFFFF;
  for (let i = 0; i < 100; i++) {
    s ^= s << 13; s ^= s >> 17; s ^= s << 5;
    const n = i / 100;
    p.push(Math.max(0.04, Math.min(0.96, (0.3 + Math.sin(n * Math.PI) * 0.4) * (0.5 + (s >>> 0) / 0xFFFFFFFF * 0.5))));
  }
  return p;
}

function WaveformCanvas({ peaks }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const data = (peaks && peaks.length) ? peaks : fallbackPeaks();
    const W = canvas.offsetWidth || 268, H = 48;
    canvas.width = W * window.devicePixelRatio;
    canvas.height = H * window.devicePixelRatio;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    const cy = H / 2, BAR = 2, GAP = 1, STEP = BAR + GAP;
    const numBars = Math.floor(W / STEP);
    ctx.clearRect(0, 0, W, H);
    for (let i = 0; i < numBars; i++) {
      const pi = Math.floor((i / numBars) * data.length);
      const amp = data[Math.min(pi, data.length - 1)];
      const maxH = cy - 4, h = Math.max(1.5, amp * maxH);
      const g = ctx.createLinearGradient(0, cy - h, 0, cy + h);
      g.addColorStop(0, 'rgba(232,160,32,.55)');
      g.addColorStop(.5, 'rgba(232,160,32,.25)');
      g.addColorStop(1, 'rgba(232,160,32,.06)');
      ctx.fillStyle = g;
      ctx.fillRect(i * STEP, cy - h, BAR, h * 2);
    }
  }, [peaks]);
  return <canvas ref={ref} style={{ display: 'block', width: '100%', height: '100%' }} />;
}

export default function Dashboard() {
  const [user, setUser] = useState(null);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [projName, setProjName] = useState('');
  const [projArtist, setProjArtist] = useState('');
  const [pendingFile, setPendingFile] = useState(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    sb.auth.getSession().then(({ data: { session } }) => {
      if (!session) { window.location.href = '/auth'; return; }
      setUser(session.user);
      loadProjects();
    });
  }, []);

  async function loadProjects() {
    setLoading(true);
    const { data, error } = await sb.from('projects')
      .select('*, tracks(id, updated_at)')
      .order('updated_at', { ascending: false });
    if (!error) setProjects(data || []);
    setLoading(false);
  }

  async function createProject() {
    if (!projName || !pendingFile) return;
    setCreating(true);
    setShowModal(false);
    try {
      const { data: proj } = await sb.from('projects')
        .insert({ title: projName, artist: projArtist || 'Unknown Artist', peaks: [] })
        .select().single();
      if (proj) {
        const r = await fetch(UPLOAD_WORKER_URL, {
          method: 'POST',
          headers: { 'X-File-Name': pendingFile.name, 'X-Project-Id': proj.id, 'Content-Type': pendingFile.type },
          body: pendingFile
        });
        const result = await r.json();
        if (result.url) {
          await sb.from('tracks').insert({
            project_id: proj.id, title: projName, audio_url: result.url, position: 0, peaks: []
          });
        }
        await loadProjects();
      }
    } catch (e) { console.error(e); }
    setCreating(false);
    setProjName(''); setProjArtist(''); setPendingFile(null);
  }

  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

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
          --radius:12px;
        }
        html,body{background:var(--bg);color:var(--text);font-family:var(--fm);min-height:100%;}
        .app{max-width:1100px;margin:0 auto;padding:0 24px;min-height:100vh;display:flex;flex-direction:column;}
        header{display:flex;align-items:center;justify-content:space-between;padding:20px 0 18px;border-bottom:1px solid var(--border);}
        .logo{font-family:var(--fh);font-size:22px;letter-spacing:-.01em;}
        .logo em{color:var(--amber);font-style:normal;}
        .avatar{width:32px;height:32px;border-radius:50%;background:var(--surf3);border:1px solid var(--border2);display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--t2);cursor:pointer;}
        .hero{padding:52px 0 40px;display:flex;align-items:flex-end;justify-content:space-between;gap:20px;border-bottom:1px solid var(--border);}
        .hero-title{font-family:var(--fh);font-size:clamp(32px,5vw,52px);line-height:1.05;letter-spacing:-.02em;margin-bottom:10px;}
        .hero-title em{font-style:italic;color:var(--amber);}
        .hero-sub{font-size:12px;color:var(--t2);line-height:1.6;max-width:420px;}
        .hero-stats{display:flex;gap:28px;flex-shrink:0;padding:20px 24px;background:var(--surf);border:1px solid var(--border);border-radius:var(--radius);}
        .stat{text-align:center;}
        .stat-num{font-family:var(--fh);font-size:28px;line-height:1;margin-bottom:4px;}
        .stat-label{font-size:10px;color:var(--t3);letter-spacing:.06em;text-transform:uppercase;}
        .stat-div{width:1px;background:var(--border);align-self:stretch;}
        .toolbar{display:flex;align-items:center;justify-content:space-between;padding:24px 0 16px;}
        .section-title{font-family:var(--fh);font-size:18px;}
        .create-btn{display:flex;align-items:center;gap:7px;font-family:var(--fm);font-size:12px;font-weight:500;padding:8px 16px;border-radius:8px;background:var(--amber);color:#000;border:none;cursor:pointer;}
        .create-btn:hover{opacity:.9;}
        .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;padding-bottom:40px;}
        .card{background:var(--surf);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;cursor:pointer;transition:border-color .2s,transform .15s;animation:cardIn .3s ease both;}
        .card:hover{border-color:var(--border2);transform:translateY(-2px);}
        @keyframes cardIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        .card-header{padding:16px 16px 12px;}
        .card-title{font-family:var(--fh);font-size:16px;margin-bottom:4px;}
        .card-artist{font-size:11px;color:var(--t2);}
        .card-wave{height:48px;padding:0 16px;margin-bottom:4px;}
        .card-meta{padding:10px 16px 14px;display:flex;align-items:center;justify-content:space-between;border-top:1px solid var(--border);font-size:10px;color:var(--t3);}
        .empty{grid-column:1/-1;text-align:center;padding:80px 20px;color:var(--t2);}
        .empty-title{font-family:var(--fh);font-size:22px;margin-bottom:8px;}
        .modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.8);backdrop-filter:blur(8px);z-index:100;display:flex;align-items:center;justify-content:center;padding:20px;}
        .modal{background:var(--surf);border:1px solid var(--border2);border-radius:16px;width:100%;max-width:560px;padding:32px;}
        .modal-title{font-family:var(--fh);font-size:24px;margin-bottom:24px;}
        .field{margin-bottom:16px;}
        .field label{display:block;font-size:11px;color:var(--t2);letter-spacing:.07em;text-transform:uppercase;margin-bottom:8px;}
        .field input{width:100%;background:var(--surf2);border:1.5px solid var(--border2);border-radius:10px;color:var(--text);font-family:var(--fm);font-size:14px;padding:12px 14px;outline:none;}
        .field input:focus{border-color:var(--amber);}
        .dropzone{border:1.5px dashed var(--border2);border-radius:12px;background:var(--surf2);padding:28px 20px;text-align:center;cursor:pointer;font-size:12px;color:var(--t2);}
        .dropzone:hover{border-color:var(--amber);background:var(--aglow);color:var(--amber);}
        .modal-footer{display:flex;justify-content:flex-end;gap:10px;margin-top:24px;border-top:1px solid var(--border);padding-top:20px;}
        .btn-cancel{font-family:var(--fm);font-size:13px;padding:11px 18px;border-radius:9px;border:1.5px solid var(--border2);background:transparent;color:var(--t2);cursor:pointer;}
        .btn-create{font-family:var(--fm);font-size:13px;font-weight:500;padding:11px 24px;border-radius:9px;background:var(--amber);color:#000;border:none;cursor:pointer;}
        .btn-create:disabled{opacity:.4;pointer-events:none;}
      `}</style>

      <div className="app">
        <header>
          <div className="logo">maastr<em>.</em></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 11, color: 'var(--t3)' }}>{user?.email}</span>
            <div className="avatar" onClick={() => sb.auth.signOut().then(() => window.location.href = '/auth')}>
              {user?.email?.[0]?.toUpperCase() || '?'}
            </div>
          </div>
        </header>

        <div className="hero">
          <div>
            <div style={{ fontSize: 10, color: 'var(--amber)', letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 10 }}>Dashboard</div>
            <h1 className="hero-title">Your <em>projects,</em><br />all in one place.</h1>
            <p className="hero-sub">Upload your mixes, share with collaborators, and get mastering notes — all in one workflow.</p>
          </div>
          <div className="hero-stats">
            <div className="stat">
              <div className="stat-num">{projects.length}</div>
              <div className="stat-label">Projects</div>
            </div>
            <div className="stat-div" />
            <div className="stat">
              <div className="stat-num">{projects.reduce((t, p) => t + (p.tracks?.length || 0), 0)}</div>
              <div className="stat-label">Tracks</div>
            </div>
          </div>
        </div>

        <div className="toolbar">
          <span className="section-title">Projects</span>
          <button className="create-btn" onClick={() => setShowModal(true)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New Project
          </button>
        </div>

        <div className="grid">
          {loading ? (
            <div className="empty"><div className="empty-title">Loading…</div></div>
          ) : projects.length === 0 ? (
            <div className="empty">
              <div className="empty-title">No projects yet.</div>
              <p style={{ fontSize: 12, marginBottom: 20 }}>Create your first mastering project.</p>
              <button className="create-btn" onClick={() => setShowModal(true)}>New Project</button>
            </div>
          ) : projects.map((p, idx) => {
            const date = new Date(p.updated_at || p.created_at);
            const dateStr = months[date.getMonth()] + ' ' + date.getDate() + ', ' + date.getFullYear();
            const tc = p.tracks?.length || 0;
            return (
              <div key={p.id} className="card" style={{ animationDelay: idx * 60 + 'ms' }}
                onClick={() => window.location.href = '/player?project=' + p.id}>
                <div className="card-header">
                  <div className="card-title">{p.title}</div>
                  <div className="card-artist">{p.artist}</div>
                </div>
                <div className="card-wave"><WaveformCanvas peaks={p.peaks} /></div>
                <div className="card-meta">
                  <span>{tc} track{tc !== 1 ? 's' : ''}</span>
                  <span>{dateStr}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {showModal && (
        <div className="modal-bg" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal">
            <div className="modal-title">New Project</div>
            <div className="field">
              <label>Project Name</label>
              <input value={projName} onChange={e => setProjName(e.target.value)} placeholder="Summer EP 2026" />
            </div>
            <div className="field">
              <label>Artist / Band</label>
              <input value={projArtist} onChange={e => setProjArtist(e.target.value)} placeholder="Artist name" />
            </div>
            <div className="field">
              <label>Audio File (WAV or MP3)</label>
              <div className="dropzone" onClick={() => document.getElementById('file-upload').click()}>
                {pendingFile ? pendingFile.name : 'Click to browse or drop a file'}
                <input id="file-upload" type="file" accept=".wav,.mp3,.aiff" style={{ display: 'none' }}
                  onChange={e => setPendingFile(e.target.files[0])} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-cancel" onClick={() => { setShowModal(false); setProjName(''); setProjArtist(''); setPendingFile(null); }}>Cancel</button>
              <button className="btn-create" disabled={!projName || !pendingFile || creating} onClick={createProject}>
                {creating ? 'Creating…' : 'Create Project →'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
