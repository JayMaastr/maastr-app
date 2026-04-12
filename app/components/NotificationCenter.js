'use client';
import { useRouter } from 'next/navigation';
import { useState, useEffect, useRef, useCallback } from 'react';
import { sb } from '@/lib/supabase';

export default function NotificationCenter({ user }) {
  const router = useRouter();
  const [notes, setNotes] = useState([]);
  const [uploads, setUploads] = useState([]);
  const [tab, setTab] = useState('new');
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);
  const trackedMasterIds = useRef({});  // masterId -> uploadId

  const loadNotes = useCallback(async () => {
    if (!user) return;
    const { data: ownedProj } = await sb.from('projects').select('id').eq('user_id', user.id);
    const { data: collabProj } = await sb.from('project_collaborators').select('project_id').eq('invited_email', user.email).eq('status', 'accepted');
    const userProjectIds = [...(ownedProj||[]).map(p=>p.id),...(collabProj||[]).map(c=>c.project_id)];
    if (userProjectIds.length === 0) { setNotes([]); return; }

    const { data } = await sb
      .from('notes')
      .select('id,body,author_name,timestamp_label,timestamp_sec,created_at,resolved,project_id,track_id,projects(title)')
      .in('project_id', userProjectIds)
      .order('created_at', { ascending: false })
      .limit(50);
    setNotes(data || []);
  }, [user]);

  useEffect(() => { loadNotes(); }, [loadNotes]);

  useEffect(() => {
    if (!user) return;
    const sub = sb.channel('nc-notes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notes' }, () => loadNotes())
      .subscribe();
    return () => sb.removeChannel(sub);
  }, [user, loadNotes]);

  // Realtime: update upload row when master status changes
  useEffect(() => {
    if (!user) return;
    const sub = sb.channel('nc-masters')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'masters' }, (payload) => {
        const { id, status } = payload.new;
        const uploadId = trackedMasterIds.current[id];
        if (uploadId && (status === 'ready' || status === 'failed')) {
          setUploads(prev => prev.map(u => u.id === uploadId
            ? { ...u, phase: status === 'ready' ? 'done' : 'failed', masterProgress: 100, readyAt: Date.now() }
            : u
          ));
        }
      })
      .subscribe();
    return () => sb.removeChannel(sub);
  }, [user]);

  // Polling fallback for master completion
  useEffect(() => {
    const masterIds = Object.keys(trackedMasterIds.current);
    const mastering = uploads.filter(u => u.phase === 'mastering');
    if (!masterIds.length || !mastering.length) return;
    const iv = setInterval(async () => {
      try {
        const { data } = await sb.from('masters').select('id,status').in('id', masterIds);
        if (!data) return;
        data.forEach(row => {
          if (row.status === 'ready' || row.status === 'failed') {
            const uploadId = trackedMasterIds.current[row.id];
            if (uploadId) {
              setUploads(prev => prev.map(u => u.id === uploadId
                ? { ...u, phase: row.status === 'ready' ? 'done' : 'failed', masterProgress: 100, readyAt: Date.now() }
                : u
              ));
              delete trackedMasterIds.current[row.id];
            }
          }
        });
      } catch(e) {}
    }, 4000);
    return () => clearInterval(iv);
  }, [uploads.filter(u=>u.phase==='mastering').length]);

  // Master progress ticker
  useEffect(() => {
    const mastering = uploads.filter(u => u.phase === 'mastering' && u.masterStartedAt);
    if (!mastering.length) return;
    const iv = setInterval(() => {
      setUploads(prev => prev.map(u => {
        if (u.phase !== 'mastering' || !u.masterStartedAt) return u;
        const elapsed = Date.now() - u.masterStartedAt;
        const pct = Math.min(85, Math.round((elapsed / u.estimatedMs) * 85));
        return { ...u, masterProgress: pct };
      }));
    }, 250);
    return () => clearInterval(iv);
  }, [uploads.filter(u=>u.phase==='mastering').length]);

  // Auto-dismiss done/failed rows after 8s
  useEffect(() => {
    const done = uploads.filter(u => (u.phase === 'done' || u.phase === 'failed') && u.readyAt);
    if (!done.length) return;
    const timers = done.map(u => {
      const delay = Math.max(0, 8000 - (Date.now() - u.readyAt));
      return setTimeout(() => setUploads(prev => prev.filter(p => p.id !== u.id)), delay);
    });
    return () => timers.forEach(clearTimeout);
  }, [uploads.filter(u=>u.phase==='done'||u.phase==='failed').length]);

  // Inject pulse keyframe
  useEffect(() => {
    if (document.getElementById('nc-pulse-style')) return;
    const s = document.createElement('style');
    s.id = 'nc-pulse-style';
    s.textContent = '@keyframes nc-pulse{0%,100%{opacity:.75}50%{opacity:.35}}';
    document.head.appendChild(s);
  }, []);

  useEffect(() => {
    window.nc_startUpload = (uploadId, label, projectId, projectName, total) => {
      setUploads(prev => [...prev.filter(u => u.id !== uploadId), {
        id: uploadId, label, projectId, projectName,
        uploadProgress: 0, total,
        phase: 'uploading',  // uploading | mastering | done | failed
        masterProgress: 0, estimatedMs: 0, masterStartedAt: null, readyAt: null
      }]);
    };
    window.nc_updateUpload = (uploadId, done, total) => {
      setUploads(prev => prev.map(u => u.id === uploadId
        ? { ...u, uploadProgress: Math.round(done / total * 100), total }
        : u
      ));
    };
    window.nc_finishUpload = (uploadId) => {
      setUploads(prev => prev.map(u => u.id === uploadId
        ? { ...u, uploadProgress: 100 }
        : u
      ));
    };
    window.nc_startMaster = (masterId, trackName, projectId, fileSize, ncId) => {
      const estimatedMs = Math.max(3000, 2000 + fileSize / 3500);
      trackedMasterIds.current[masterId] = null;
      setUploads(prev => {
        // If ncId provided, find that exact upload row (parallel multi-track support)
        // Otherwise fall back to projectId search
        let idx = -1;
        if (ncId) {
          idx = prev.findIndex(u => u.id === ncId && u.phase !== 'done' && u.phase !== 'failed');
          if (idx !== -1) {
            trackedMasterIds.current[masterId] = prev[idx].id;
            return prev.map((u, i) => i === idx
              ? { ...u, label: trackName, phase: 'mastering', masterProgress: 0, estimatedMs, masterStartedAt: Date.now() }
              : u
            );
          }
        }
        // Fallback: find most recent uploading row for this project
        const revIdx = [...prev].reverse().findIndex(u => u.projectId === projectId && u.phase !== 'done' && u.phase !== 'failed');
        if (revIdx !== -1) {
          const realIdx = prev.length - 1 - revIdx;
          const uploadId = prev[realIdx].id;
          trackedMasterIds.current[masterId] = uploadId;
          return prev.map((u, i) => i === realIdx
            ? { ...u, label: trackName, phase: 'mastering', masterProgress: 0, estimatedMs, masterStartedAt: Date.now() }
            : u
          );
        }
        // No upload row — create a masterOnly row (green bar from scratch, no amber phase)
        const newId = masterId + '-nc';
        trackedMasterIds.current[masterId] = newId;
        return [...prev, {
          id: newId, label: trackName, projectId,
          projectName: trackName, uploadProgress: 100, total: 1,
          phase: 'mastering', masterOnly: true,
          masterProgress: 0, estimatedMs, masterStartedAt: Date.now(), readyAt: null
        }];
      });
      setOpen(true);
      setTab('uploads');
    };
    window.nc_openToUploads = () => { setTab('uploads'); setOpen(true); };
    if (window.nc_requestSync) window.nc_requestSync();
    return () => {
      delete window.nc_startUpload;
      delete window.nc_updateUpload;
      delete window.nc_finishUpload;
      delete window.nc_startMaster;
      delete window.nc_openToUploads;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const unreadNotes = notes.filter(n => !n.resolved);
  const readNotes = notes.filter(n => n.resolved);
  const activeUploads = uploads.filter(u => u.phase === 'uploading' || u.phase === 'mastering');
  const totalBadge = unreadNotes.length + activeUploads.length;

  const markAllRead = async () => {
    const ids = unreadNotes.map(n => n.id);
    if (ids.length) await sb.from('notes').update({ resolved: true }).in('id', ids);
    loadNotes();
  };

  const goToNote = (n) => {
    setOpen(false);
    const url = n.project_id
      ? `/player?project=${n.project_id}${n.track_id ? `&track=${n.track_id}` : ''}`
      : '/';
    router.push(url);
  };

  const fmtTime = (iso) => {
    const diff = (Date.now() - new Date(iso)) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff/60) + 'm ago';
    if (diff < 86400) return Math.floor(diff/3600) + 'h ago';
    return new Date(iso).toLocaleDateString();
  };

  const noteRow = (n, unread) => (
    <div key={n.id} onClick={() => goToNote(n)}
      style={{padding:'12px 14px',borderBottom:'1px solid var(--border)',display:'flex',gap:10,alignItems:'flex-start',cursor:'pointer',opacity:unread?1:0.65,transition:'background .15s'}}
      onMouseEnter={e => e.currentTarget.style.background='var(--surf2)'}
      onMouseLeave={e => e.currentTarget.style.background=''}
    >
      <div style={{width:8,height:8,borderRadius:'50%',background:unread?'var(--amber)':'var(--t3)',flexShrink:0,marginTop:5}}/>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:12,color:unread?'var(--text)':'var(--t3)',lineHeight:1.5,fontFamily:'var(--fm)'}}>{n.body}</div>
        <div style={{fontSize:10,color:'var(--t3)',marginTop:4,fontFamily:'var(--fm)',display:'flex',gap:8,flexWrap:'wrap'}}>
          <span>{n.author_name}</span>
          {n.timestamp_label && <span>at {n.timestamp_label}</span>}
          <span>{fmtTime(n.created_at)}</span>
        </div>
        {n.projects?.title && <div style={{fontSize:10,color:'var(--t3)',marginTop:2,fontFamily:'var(--fm)'}}>{n.projects.title}</div>}
      </div>
    </div>
  );

  const uploadRow = (u) => {
    const isDone = u.phase === 'done';
    const isFailed = u.phase === 'failed';
    const isMastering = u.phase === 'mastering';
    const isUploading = u.phase === 'uploading';

    // Label
    const statusLabel = isDone ? '\u2713 Done'
      : isFailed ? '\u2717 Failed'
      : isMastering ? 'Mastering...'
      : u.uploadProgress + '%';

    const statusColor = isDone ? '#4caf50' : isFailed ? '#f44336' : 'var(--amber)';

    // The bar is a single track. During upload: amber fills left to right.
    // During mastering: green eats the amber from left. Done: fully green.
    const uploadPct = u.uploadProgress || 0;        // 0-100
    const masterPct = u.masterProgress || 0;         // 0-100 of the mastered portion
    // Green eats amber: green width = masterPct% of total, amber = remaining of upload (100%)
    const greenWidth = isMastering || isDone || isFailed ? masterPct : 0;
    const amberWidth = isDone ? 0 : isFailed ? 0 : isUploading ? uploadPct : 100; // amber is full during mastering

    const isPulsing = isMastering && masterPct >= 84;

    return (
      <div key={u.id}
        onClick={() => { if (u.projectId) { setOpen(false); router.push(`/player?project=${u.projectId}`); } }}
        style={{padding:'14px',borderBottom:'1px solid var(--border)',cursor:u.projectId?'pointer':'default',transition:'background .15s'}}
        onMouseEnter={e => e.currentTarget.style.background='var(--surf2)'}
        onMouseLeave={e => e.currentTarget.style.background=''}
      >
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
          <div style={{display:'flex',alignItems:'center',gap:7}}>
            {isMastering && (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
              </svg>
            )}
            <div style={{fontFamily:'var(--fm)',fontSize:12,color:'var(--text)',fontWeight:600}}>{u.label || u.projectName}</div>
          </div>
          <div style={{fontFamily:'var(--fm)',fontSize:10,color:statusColor,fontWeight:600}}>{statusLabel}</div>
        </div>

        {/* Single unified bar */}
        <div style={{height:4,borderRadius:2,background:'var(--surf3)',overflow:'hidden',position:'relative'}}>
          {/* Amber layer — upload fill or mastering remainder */}
          <div style={{
            position:'absolute',left:0,top:0,height:'100%',borderRadius:2,
            background:'var(--amber)',
            width: isDone || isFailed ? '100%' : isUploading ? uploadPct+'%' : '100%',
            transition:'width .3s'
          }}/>
          {/* Green layer — eats amber from the left during mastering */}
          {(isMastering || isDone || isFailed) && (
            <div style={{
              position:'absolute',left:0,top:0,height:'100%',borderRadius:2,
              background: isFailed ? '#f44336' : '#4caf50',
              width: isDone || isFailed ? '100%' : greenWidth+'%',
              transition: isDone || isFailed ? 'width .4s' : 'width .25s',
              animation: isPulsing ? 'nc-pulse 1.2s ease-in-out infinite' : 'none'
            }}/>
          )}
        </div>

        <div style={{fontFamily:'var(--fm)',fontSize:10,color:'var(--t3)',marginTop:5}}>
          {u.projectName || ''}
        </div>
      </div>
    );
  };

  return (
    <div style={{position:'relative'}} ref={panelRef}>
      <button onClick={() => setOpen(o => !o)}
        style={{width:36,height:36,borderRadius:8,border:'1px solid var(--border2)',background:open?'var(--surf3)':'transparent',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',position:'relative',flexShrink:0}}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--t2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        {totalBadge > 0 && (
          <span style={{position:'absolute',top:-4,right:-4,background:'var(--amber)',color:'#000',borderRadius:99,fontSize:9,fontWeight:700,fontFamily:'var(--fm)',minWidth:16,height:16,display:'flex',alignItems:'center',justifyContent:'center',padding:'0 3px'}}>
            {totalBadge > 99 ? '99+' : totalBadge}
          </span>
        )}
      </button>

      {open && (
        <div style={{position:'fixed',top:48,right:16,width:360,maxWidth:'calc(100vw - 32px)',background:'var(--surf)',border:'1px solid var(--border2)',borderRadius:14,boxShadow:'0 20px 60px rgba(0,0,0,.6)',zIndex:300,overflow:'hidden'}}>
          <div style={{display:'flex',borderBottom:'1px solid var(--border)',background:'var(--surf2)'}}>
            {[
              {key:'new',    label:'New',     count:unreadNotes.length},
              {key:'read',   label:'Read',    count:readNotes.length},
              {key:'uploads',label:'Uploads', count:activeUploads.length}
            ].map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                style={{flex:1,padding:'12px 8px',border:'none',background:'transparent',color:tab===t.key?'var(--amber)':'var(--t3)',fontFamily:'var(--fm)',fontSize:11,fontWeight:600,letterSpacing:'.06em',textTransform:'uppercase',cursor:'pointer',borderBottom:tab===t.key?'2px solid var(--amber)':'2px solid transparent',display:'flex',alignItems:'center',justifyContent:'center',gap:5}}>
                {t.label}
                {t.count > 0 && <span style={{background:tab===t.key?'var(--amber)':'var(--surf3)',color:tab===t.key?'#000':'var(--t3)',borderRadius:99,fontSize:9,fontWeight:700,minWidth:16,height:16,display:'flex',alignItems:'center',justifyContent:'center',padding:'0 3px'}}>{t.count}</span>}
              </button>
            ))}
          </div>

          {tab === 'new' && (
            <div style={{maxHeight:400,overflowY:'auto'}}>
              {unreadNotes.length === 0
                ? <div style={{padding:32,textAlign:'center',color:'var(--t3)',fontSize:13,fontFamily:'var(--fm)'}}>No new notifications</div>
                : <>
                    <div style={{padding:'10px 14px',display:'flex',justifyContent:'flex-end'}}>
                      <button onClick={markAllRead} style={{fontSize:11,color:'var(--amber)',background:'transparent',border:'none',cursor:'pointer',fontFamily:'var(--fm)',fontWeight:600}}>Mark all as read</button>
                    </div>
                    {unreadNotes.map(n => noteRow(n, true))}
                  </>
              }
            </div>
          )}

          {tab === 'read' && (
            <div style={{maxHeight:400,overflowY:'auto'}}>
              {readNotes.length === 0
                ? <div style={{padding:32,textAlign:'center',color:'var(--t3)',fontSize:13,fontFamily:'var(--fm)'}}>No read messages</div>
                : readNotes.map(n => noteRow(n, false))
              }
            </div>
          )}

          {tab === 'uploads' && (
            <div style={{maxHeight:400,overflowY:'auto'}}>
              {uploads.length === 0
                ? <div style={{padding:32,textAlign:'center',color:'var(--t3)',fontSize:13,fontFamily:'var(--fm)'}}>No uploads yet</div>
                : uploads.slice().reverse().map(u => uploadRow(u))
              }
            </div>
          )}
        </div>
      )}
    </div>
  );
}
