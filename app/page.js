'use client';
import { useEffect, useState, useRef } from 'react';
import { sb, UPLOAD_WORKER_URL } from '@/lib/supabase';

const STABLE_PEAKS = (() => {
  const p = []; let s = 0xABCDEF;
  for (let i = 0; i < 100; i++) {
    s ^= s << 13; s ^= s >> 17; s ^= s << 5; s >>>= 0;
    p.push(Math.max(0.04, Math.min(0.96, (0.3 + Math.sin(i/100*Math.PI)*0.4)*(0.5+s/0xFFFFFFFF*0.5))));
  }
  return p;
})();

function WaveformCanvas({ peaks }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const data = (peaks && peaks.length) ? peaks : STABLE_PEAKS;
    const W = canvas.offsetWidth || 268, H = 48;
    canvas.width = W * devicePixelRatio; canvas.height = H * devicePixelRatio;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(devicePixelRatio, devicePixelRatio);
    const cy = H/2, BAR=2, GAP=1, STEP=BAR+GAP, numBars=Math.floor(W/STEP);
    for (let i=0; i<numBars; i++) {
      const pi=Math.floor(i/numBars*data.length), amp=data[Math.min(pi,data.length-1)];
      const h=Math.max(1.5, amp*(cy-4));
      const g=ctx.createLinearGradient(0,cy-h,0,cy+h);
      g.addColorStop(0,'rgba(232,160,32,.55)'); g.addColorStop(.5,'rgba(232,160,32,.25)'); g.addColorStop(1,'rgba(232,160,32,.06)');
      ctx.fillStyle=g; ctx.fillRect(i*STEP, cy-h, BAR, h*2);
    }
  }, [peaks]);
  return <canvas ref={ref} style={{ display:'block', width:'100%', height:'100%' }} />;
}

function bytesToSize(b) {
  if (b < 1024*1024) return (b/1024).toFixed(0)+' KB';
  return (b/1024/1024).toFixed(1)+' MB';
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function urlToKey(url) {
  try { return decodeURIComponent(new URL(url).pathname.replace(/^\//, '')); } catch { return null; }
}

// Card with inline edit + menu
function ProjectCard({ project, idx, onDelete, onSave }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(project.title || '');
  const [editArtist, setEditArtist] = useState(project.artist || '');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuRef = useRef(null);
  const tc = project.tracks?.length || 0;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const date = new Date(project.updated_at || project.created_at);
  const dateStr = months[date.getMonth()]+' '+date.getDate()+', '+date.getFullYear();

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function handler(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('touchstart', handler); };
  }, [menuOpen]);

  async function saveEdit() {
    if (!editTitle.trim()) return;
    setSaving(true);
    await sb.from('projects').update({ title: editTitle.trim(), artist: editArtist.trim() }).eq('id', project.id);
    setSaving(false);
    setEditing(false);
    onSave(project.id, editTitle.trim(), editArtist.trim());
  }

  function cancelEdit() {
    setEditTitle(project.title || '');
    setEditArtist(project.artist || '');
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="card editing" style={{ animationDelay: idx*60+'ms' }}>
        <div className="card-edit">
          <div className="edit-label">Project Name</div>
          <input className="edit-input" value={editTitle} onChange={e=>setEditTitle(e.target.value)}
            onKeyDown={e=>{ if(e.key==='Enter') saveEdit(); if(e.key==='Escape') cancelEdit(); }}
            placeholder="Project name" autoFocus />
          <div className="edit-label" style={{ marginTop:10 }}>Artist / Band</div>
          <input className="edit-input" value={editArtist} onChange={e=>setEditArtist(e.target.value)}
            onKeyDown={e=>{ if(e.key==='Enter') saveEdit(); if(e.key==='Escape') cancelEdit(); }}
            placeholder="Artist name" />
          <div className="edit-actions">
            <button className="edit-cancel" onClick={cancelEdit}>Cancel</button>
            <button className="edit-save" disabled={!editTitle.trim()||saving} onClick={saveEdit}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
        <div className="card-wave"><WaveformCanvas peaks={project.peaks}/></div>
        <div className="card-meta"><span>{tc} track{tc!==1?'s':''}</span><span>{dateStr}</span></div>
      </div>
    );
  }

  if (confirmDelete) {
    return (
      <div className="card confirming" style={{ animationDelay: idx*60+'ms' }}>
        <div className="confirm-overlay">
          <div className="confirm-title">Delete “{project.title}”?</div>
          <div className="confirm-sub">Permanently deletes {tc} track{tc!==1?'s':''} and all files.</div>
          <div className="confirm-actions">
            <button className="btn-cancel-sm" onClick={()=>setConfirmDelete(false)}>Keep it</button>
            <button className="btn-delete-confirm" onClick={()=>onDelete(project)}>Delete forever</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ animationDelay: idx*60+'ms' }}
      onClick={e => {
        if (menuOpen) { setMenuOpen(false); e.stopPropagation(); return; }
        window.location.href='/player?project='+project.id;
      }}>
      <div className="card-header">
        <div className="card-titles">
          <div className="card-title">{project.title}</div>
          <div className="card-artist">{project.artist}</div>
        </div>
        {/* Always-visible menu button — works on mobile tap and desktop click */}
        <div ref={menuRef} style={{ position:'relative', flexShrink:0 }} onClick={e=>e.stopPropagation()}>
          <button className="menu-btn" onClick={()=>setMenuOpen(o=>!o)} aria-label="Project options">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/>
            </svg>
          </button>
          {menuOpen && (
            <div className="menu-dropdown">
              <button className="menu-item" onClick={()=>{ setMenuOpen(false); setEditing(true); }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                Edit details
              </button>
              <div className="menu-divider"/>
              <button className="menu-item danger" onClick={()=>{ setMenuOpen(false); setConfirmDelete(true); }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                Delete project
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="card-wave"><WaveformCanvas peaks={project.peaks}/></div>
      <div className="card-meta"><span>{tc} track{tc!==1?'s':''}</span><span>{dateStr}</span></div>
    </div>
  );
}

export default function Dashboard() {
  const [user, setUser] = useState(null);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [projName, setProjName] = useState('');
  const [projArtist, setProjArtist] = useState('');
  const [tracks, setTracks] = useState([]);
  const [creating, setCreating] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [dragging, setDragging] = useState(false);
  const [deleting, setDeleting] = useState(null);

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
      .select('*, tracks(id,updated_at,audio_url,mp3_url)')
      .order('updated_at', { ascending: false });
    if (!error) setProjects(data || []);
    setLoading(false);
  }

  function handleSave(id, title, artist) {
    setProjects(prev => prev.map(p => p.id===id ? {...p, title, artist} : p));
  }

  async function deleteProject(proj) {
    setDeleting(proj.id);
    try {
      const audioUrls = new Set();
      (proj.tracks||[]).forEach(t => {
        if (t.audio_url) audioUrls.add(t.audio_url);
        if (t.mp3_url && t.mp3_url!==t.audio_url) audioUrls.add(t.mp3_url);
      });
      const { data: revs } = await sb.from('revisions').select('audio_url,mp3_url').eq('project_id', proj.id);
      (revs||[]).forEach(r => {
        if (r.audio_url) audioUrls.add(r.audio_url);
        if (r.mp3_url && r.mp3_url!==r.audio_url) audioUrls.add(r.mp3_url);
      });
      await Promise.allSettled([...audioUrls].map(url => {
        const key = urlToKey(url);
        if (!key) return Promise.resolve();
        return fetch(UPLOAD_WORKER_URL, { method:'DELETE', headers:{'X-File-Key':key} });
      }));
      await sb.from('notes').delete().eq('project_id', proj.id);
      await sb.from('revisions').delete().eq('project_id', proj.id);
      await sb.from('project_collaborators').delete().eq('project_id', proj.id);
      await sb.from('tracks').delete().eq('project_id', proj.id);
      await sb.from('projects').delete().eq('id', proj.id);
      setProjects(prev => prev.filter(p => p.id!==proj.id));
    } catch(e) { console.error(e); }
    setDeleting(null);
  }

  function addFiles(files) {
    const audioFiles = [...files].filter(f =>
      f.type.startsWith('audio/') || /\.(wav|mp3|aiff|aif|flac|m4a)$/i.test(f.name)
    );
    if (!audioFiles.length) return;
    setTracks(prev => {
      const existing = new Set(prev.map(t=>t.file.name));
      const newOnes = audioFiles.filter(f=>!existing.has(f.name)).map(f=>({ file:f, name:f.name.replace(/\.[^.]+$/,'') }));
      return [...prev, ...newOnes];
    });
  }
  function updateTrackName(idx, name) { setTracks(prev=>prev.map((t,i)=>i===idx?{...t,name}:t)); }
  function removeTrack(idx) { setTracks(prev=>prev.filter((_,i)=>i!==idx)); }

  async function createProject() {
    if (!projName || tracks.length===0) return;
    setCreating(true);
    try {
      const { data: proj, error: projErr } = await sb.from('projects')
        .insert({ title:projName, artist:projArtist||'Unknown Artist', peaks:[] }).select().single();
      if (projErr) throw projErr;
      for (let i=0; i<tracks.length; i++) {
        const t = tracks[i];
        setStatusMsg('Uploading '+(i+1)+'/'+tracks.length+': '+t.name);
        const safeName = sanitizeFilename(t.file.name);
        const r = await fetch(UPLOAD_WORKER_URL, { method:'POST', headers:{'X-File-Name':safeName,'X-Project-Id':proj.id,'Content-Type':t.file.type||'audio/wav'}, body:t.file });
        const result = await r.json();
        if (result.url) await sb.from('tracks').insert({ project_id:proj.id, title:t.name||t.file.name, audio_url:result.url, mp3_url:result.url, position:i, peaks:[] });
      }
      closeModal();
      await loadProjects();
    } catch(e) { setStatusMsg('Error: '+e.message); setCreating(false); }
  }

  function closeModal() {
    setShowModal(false); setProjName(''); setProjArtist('');
    setTracks([]); setStatusMsg(''); setDragging(false); setCreating(false);
  }

  function handleDrop(e) { e.preventDefault(); e.stopPropagation(); setDragging(false); addFiles(e.dataTransfer?.files||[]); }
  function handleDragOver(e) { e.preventDefault(); e.stopPropagation(); setDragging(true); }
  function handleDragLeave(e) { e.preventDefault(); setDragging(false); }

  return (
    <>
      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        :root{--bg:#0a0a0b;--surf:#111113;--surf2:#16161a;--surf3:#1e1e24;--border:#24242c;--border2:#2e2e38;--amber:#e8a020;--aglow:rgba(232,160,32,0.08);--red:#e05050;--text:#f0ede8;--t2:#8a8780;--t3:#4a4945;--fh:'DM Serif Display',Georgia,serif;--fm:'DM Mono','SF Mono','Menlo',monospace;--radius:12px;}
        html,body{background:var(--bg);color:var(--text);font-family:var(--fm);min-height:100%;}
        .app{max-width:1100px;margin:0 auto;padding:0 24px;min-height:100vh;display:flex;flex-direction:column;}
        header{display:flex;align-items:center;justify-content:space-between;padding:20px 0 18px;border-bottom:1px solid var(--border);}
        .logo{font-family:var(--fh);font-size:22px;} .logo em{color:var(--amber);font-style:normal;}
        .avatar{width:32px;height:32px;border-radius:50%;background:var(--surf3);border:1px solid var(--border2);display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--t2);cursor:pointer;-webkit-tap-highlight-color:transparent;} .avatar:hover{background:var(--surf2);}
        .hero{padding:52px 0 40px;display:flex;align-items:flex-end;justify-content:space-between;gap:20px;border-bottom:1px solid var(--border);}
        .hero-title{font-family:var(--fh);font-size:clamp(32px,5vw,52px);line-height:1.05;letter-spacing:-.02em;margin-bottom:10px;} .hero-title em{font-style:italic;color:var(--amber);}
        .hero-sub{font-size:12px;color:var(--t2);line-height:1.6;max-width:420px;}
        .hero-stats{display:flex;gap:28px;flex-shrink:0;padding:20px 24px;background:var(--surf);border:1px solid var(--border);border-radius:var(--radius);}
        .stat{text-align:center;} .stat-num{font-family:var(--fh);font-size:28px;line-height:1;margin-bottom:4px;} .stat-label{font-size:10px;color:var(--t3);letter-spacing:.06em;text-transform:uppercase;} .stat-div{width:1px;background:var(--border);align-self:stretch;}
        .toolbar{display:flex;align-items:center;justify-content:space-between;padding:24px 0 16px;}
        .section-title{font-family:var(--fh);font-size:18px;}
        .create-btn{display:flex;align-items:center;gap:7px;font-family:var(--fm);font-size:12px;font-weight:500;padding:9px 18px;border-radius:8px;background:var(--amber);color:#000;border:none;cursor:pointer;transition:opacity .15s;-webkit-tap-highlight-color:transparent;touch-action:manipulation;} .create-btn:hover{opacity:.9;}
        .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:16px;padding-bottom:40px;}
        .card{background:var(--surf);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;cursor:pointer;transition:border-color .2s,transform .15s,box-shadow .2s;animation:cardIn .3s ease both;-webkit-tap-highlight-color:transparent;touch-action:manipulation;} 
        .card:hover{border-color:var(--border2);transform:translateY(-2px);box-shadow:0 12px 40px rgba(0,0,0,.4);}
        .card.editing{cursor:default;border-color:var(--amber);}
        .card.confirming{border-color:var(--red);position:relative;}
        @keyframes cardIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        .card-header{padding:14px 14px 10px;display:flex;align-items:flex-start;justify-content:space-between;gap:8px;}
        .card-titles{flex:1;min-width:0;}
        .card-title{font-family:var(--fh);font-size:16px;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .card-artist{font-size:11px;color:var(--t2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .card-wave{height:48px;padding:0 14px;margin-bottom:4px;}
        .card-meta{padding:9px 14px 13px;display:flex;align-items:center;justify-content:space-between;border-top:1px solid var(--border);font-size:10px;color:var(--t3);}
        /* Menu button — always visible, works on touch */
        .menu-btn{width:32px;height:32px;border-radius:8px;border:1px solid transparent;background:transparent;color:var(--t3);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .15s;-webkit-tap-highlight-color:transparent;touch-action:manipulation;padding:0;}
        .menu-btn:hover,.menu-btn:focus{background:var(--surf2);border-color:var(--border2);color:var(--t2);}
        .menu-btn:active{background:var(--surf3);}
        /* Dropdown */
        .menu-dropdown{position:absolute;top:calc(100% + 4px);right:0;background:var(--surf2);border:1px solid var(--border2);border-radius:10px;min-width:160px;z-index:50;box-shadow:0 8px 32px rgba(0,0,0,.5);overflow:hidden;}
        .menu-item{width:100%;padding:11px 14px;display:flex;align-items:center;gap:9px;font-family:var(--fm);font-size:12px;color:var(--t2);background:transparent;border:none;cursor:pointer;text-align:left;transition:background .12s,color .12s;-webkit-tap-highlight-color:transparent;touch-action:manipulation;}
        .menu-item:hover,.menu-item:active{background:var(--surf3);color:var(--text);}
        .menu-item.danger{color:#e08080;} .menu-item.danger:hover,.menu-item.danger:active{background:rgba(224,80,80,.1);color:var(--red);}
        .menu-divider{height:1px;background:var(--border);margin:2px 0;}
        /* Edit mode */
        .card-edit{padding:14px 14px 10px;}
        .edit-label{font-size:10px;color:var(--t3);letter-spacing:.07em;text-transform:uppercase;margin-bottom:6px;}
        .edit-input{width:100%;background:var(--bg);border:1.5px solid var(--border2);border-radius:8px;color:var(--text);font-family:var(--fm);font-size:14px;padding:9px 11px;outline:none;transition:border-color .15s;-webkit-tap-highlight-color:transparent;}
        .edit-input:focus{border-color:var(--amber);}
        .edit-actions{display:flex;gap:8px;margin-top:12px;}
        .edit-cancel{flex:1;font-family:var(--fm);font-size:12px;padding:9px;border-radius:8px;border:1.5px solid var(--border2);background:transparent;color:var(--t2);cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;}
        .edit-save{flex:1;font-family:var(--fm);font-size:12px;font-weight:500;padding:9px;border-radius:8px;background:var(--amber);color:#000;border:none;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;} .edit-save:disabled{opacity:.4;pointer-events:none;}
        /* Confirm delete */
        .confirm-overlay{padding:24px 20px;display:flex;flex-direction:column;align-items:center;gap:10px;min-height:160px;justify-content:center;}
        .confirm-title{font-family:var(--fh);font-size:15px;text-align:center;}
        .confirm-sub{font-size:11px;color:var(--t2);text-align:center;line-height:1.5;}
        .confirm-actions{display:flex;gap:8px;margin-top:4px;}
        .btn-cancel-sm{font-family:var(--fm);font-size:12px;padding:9px 16px;border-radius:8px;border:1.5px solid var(--border2);background:transparent;color:var(--t2);cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;}
        .btn-delete-confirm{font-family:var(--fm);font-size:12px;font-weight:500;padding:9px 16px;border-radius:8px;background:var(--red);color:#fff;border:none;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;}
        .empty{grid-column:1/-1;text-align:center;padding:80px 20px;color:var(--t2);} .empty-title{font-family:var(--fh);font-size:22px;margin-bottom:8px;}
        /* Modal */
        .modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.8);backdrop-filter:blur(8px);z-index:100;display:flex;align-items:flex-start;justify-content:center;padding:40px 16px 24px;overflow-y:auto;}
        .modal{background:var(--surf);border:1px solid var(--border2);border-radius:16px;width:100%;max-width:600px;padding:28px;margin:auto;}
        .modal-title{font-family:var(--fh);font-size:24px;margin-bottom:22px;}
        .field{margin-bottom:14px;} .field label{display:block;font-size:11px;color:var(--t2);letter-spacing:.07em;text-transform:uppercase;margin-bottom:7px;}
        .field input{width:100%;background:var(--surf2);border:1.5px solid var(--border2);border-radius:10px;color:var(--text);font-family:var(--fm);font-size:14px;padding:12px 14px;outline:none;transition:border-color .15s;-webkit-appearance:none;} .field input:focus{border-color:var(--amber);}
        .dropzone{border:2px dashed var(--border2);border-radius:12px;background:var(--surf2);padding:24px 16px;text-align:center;cursor:pointer;font-size:12px;color:var(--t2);transition:all .2s;-webkit-tap-highlight-color:transparent;touch-action:manipulation;}
        .dropzone:hover,.dropzone.over{border-color:var(--amber);background:var(--aglow);color:var(--amber);}
        .dropzone.has-files{border-color:var(--amber);background:var(--aglow);}
        .tracks-list{margin-top:14px;display:flex;flex-direction:column;gap:8px;}
        .track-row{display:flex;align-items:center;gap:8px;background:var(--surf2);border:1px solid var(--border);border-radius:10px;padding:9px 11px;animation:cardIn .2s ease both;}
        .track-num{font-size:11px;color:var(--t3);min-width:16px;text-align:right;}
        .track-input{flex:1;background:transparent;border:none;border-bottom:1.5px solid var(--border2);color:var(--text);font-family:var(--fm);font-size:13px;padding:4px 0;outline:none;min-width:0;-webkit-appearance:none;} .track-input:focus{border-color:var(--amber);}
        .track-meta{font-size:10px;color:var(--t3);white-space:nowrap;}
        .track-remove{width:24px;height:24px;border-radius:50%;border:1px solid var(--border2);background:transparent;color:var(--t3);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0;touch-action:manipulation;-webkit-tap-highlight-color:transparent;} .track-remove:hover{border-color:var(--red);color:var(--red);}
        .modal-footer{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:22px;border-top:1px solid var(--border);padding-top:18px;flex-wrap:wrap;}
        .status-msg{font-size:11px;color:var(--t2);}
        .btn-cancel{font-family:var(--fm);font-size:13px;padding:11px 18px;border-radius:9px;border:1.5px solid var(--border2);background:transparent;color:var(--t2);cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;}
        .btn-create{font-family:var(--fm);font-size:13px;font-weight:500;padding:11px 22px;border-radius:9px;background:var(--amber);color:#000;border:none;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;} .btn-create:disabled{opacity:.4;pointer-events:none;}
        @media(max-width:640px){
          .app{padding:0 16px;}
          .hero{flex-direction:column;align-items:flex-start;padding:32px 0 28px;}
          .hero-stats{width:100%;}
          .grid{grid-template-columns:1fr;}
          .modal-bg{padding:16px 12px 24px;}
          .modal{padding:20px 16px;}
          .modal-footer{gap:8px;}
          .btn-cancel,.btn-create{flex:1;text-align:center;}
        }
      `}</style>

      <div className="app">
        <header>
          <div className="logo">maastr<em>.</em></div>
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <span style={{ fontSize:11, color:'var(--t3)' }}>{user?.email}</span>
            <div className="avatar" onClick={()=>sb.auth.signOut().then(()=>window.location.href='/auth')}>
              {user?.email?.[0]?.toUpperCase()||'?'}
            </div>
          </div>
        </header>

        <div className="hero">
          <div>
            <div style={{ fontSize:10, color:'var(--amber)', letterSpacing:'.12em', textTransform:'uppercase', marginBottom:10 }}>Dashboard</div>
            <h1 className="hero-title">Your <em>projects,</em><br />all in one place.</h1>
            <p className="hero-sub">Upload your mixes, share with collaborators, and get mastering notes.</p>
          </div>
          <div className="hero-stats">
            <div className="stat"><div className="stat-num">{projects.length}</div><div className="stat-label">Projects</div></div>
            <div className="stat-div"/>
            <div className="stat"><div className="stat-num">{projects.reduce((t,p)=>t+(p.tracks?.length||0),0)}</div><div className="stat-label">Tracks</div></div>
          </div>
        </div>

        <div className="toolbar">
          <span className="section-title">Projects</span>
          <button className="create-btn" onClick={()=>setShowModal(true)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New Project
          </button>
        </div>

        <div className="grid">
          {loading ? <div className="empty"><div className="empty-title">Loading…</div></div>
          : projects.length === 0 ? (
            <div className="empty">
              <div className="empty-title">No projects yet.</div>
              <p style={{ fontSize:12, marginBottom:20 }}>Create your first mastering project.</p>
              <button className="create-btn" onClick={()=>setShowModal(true)}>New Project</button>
            </div>
          ) : projects.map((p, idx) => (
            <ProjectCard key={p.id} project={p} idx={idx}
              onDelete={deleteProject} onSave={handleSave} />
          ))}
        </div>
      </div>

      {showModal && (
        <div className="modal-bg" onClick={e=>e.target===e.currentTarget&&!creating&&closeModal()}>
          <div className="modal">
            <div className="modal-title">New Project</div>
            <div className="field">
              <label>Project Name</label>
              <input value={projName} onChange={e=>setProjName(e.target.value)} placeholder="Summer EP 2026" autoFocus/>
            </div>
            <div className="field">
              <label>Artist / Band</label>
              <input value={projArtist} onChange={e=>setProjArtist(e.target.value)} placeholder="Artist name"/>
            </div>
            <div className="field">
              <label>Tracks ({tracks.length})</label>
              <div className={`dropzone ${dragging?'over':''} ${tracks.length>0?'has-files':''}`}
                onDragOver={handleDragOver} onDragEnter={handleDragOver}
                onDragLeave={handleDragLeave} onDrop={handleDrop}
                onClick={()=>document.getElementById('file-upload').click()}>
                <div style={{ fontSize:28, marginBottom:8 }}>🎵</div>
                {tracks.length===0
                  ? <><strong>Drop WAV / MP3 files here</strong><br/><span style={{ fontSize:11, opacity:.6 }}>or tap to browse</span></>
                  : <><strong style={{ color:'var(--amber)' }}>{tracks.length} file{tracks.length!==1?'s':''} added</strong><br/><span style={{ fontSize:11, opacity:.6 }}>Drop more or tap to browse</span></>
                }
                <input id="file-upload" type="file" accept=".wav,.mp3,.aiff,.aif,.flac,.m4a,audio/*"
                  multiple style={{ display:'none' }} onChange={e=>{addFiles(e.target.files);e.target.value='';}}/>
              </div>
              {tracks.length > 0 && (
                <div className="tracks-list">
                  {tracks.map((t,i) => (
                    <div key={i} className="track-row" style={{ animationDelay:i*40+'ms' }}>
                      <span className="track-num">{i+1}</span>
                      <input className="track-input" value={t.name} onChange={e=>updateTrackName(i,e.target.value)} placeholder={`Track ${i+1}`}/>
                      <span className="track-meta">{bytesToSize(t.file.size)}</span>
                      <button className="track-remove" onClick={()=>removeTrack(i)}>×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <span className="status-msg">{statusMsg}</span>
              <div style={{ display:'flex', gap:10, flex:1, justifyContent:'flex-end' }}>
                <button className="btn-cancel" disabled={creating} onClick={closeModal}>Cancel</button>
                <button className="btn-create" disabled={!projName||tracks.length===0||creating} onClick={createProject}>
                  {creating?(statusMsg||'Creating…'):`Create (${tracks.length} track${tracks.length!==1?'s':''})`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
        }
