'use client';
import { useRouter } from 'next/navigation';
import { useState, useEffect, useRef, useCallback } from 'react';
import { sb } from '@/lib/supabase';

export default function NotificationCenter({ user }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('new');
  const [notes, setNotes] = useState([]);
  const [uploads, setUploads] = useState([]);
  const panelRef = useRef(null);

  const loadNotes = useCallback(async () => {
    if (!user) return;
    const { data } = await sb
      .from('notes')
      .select('id,body,author_name,timestamp_label,timestamp_sec,created_at,resolved,project_id,track_id,projects(title)')
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
    return () => sub.unsubscribe();
  }, [user, loadNotes]);

  useEffect(() => {
    window.nc_startUpload = (uploadId, label, projectId, projectName, total) => {
      setUploads(prev => [...prev.filter(u => u.id !== uploadId), {
        id: uploadId, label, projectId, projectName, done: 0, total, status: 'uploading'
      }]);
    };
    window.nc_updateUpload = (uploadId, done, total) => {
      setUploads(prev => prev.map(u => u.id === uploadId ? {...u, done, total} : u));
    };
    window.nc_finishUpload = (uploadId) => {
      setUploads(prev => prev.map(u => u.id === uploadId ? {...u, status: 'done', done: u.total} : u));
    };
    window.nc_openToUploads = () => { setTab('uploads'); setOpen(true); };
    return () => {
      delete window.nc_startUpload;
      delete window.nc_updateUpload;
      delete window.nc_finishUpload;
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
  const activeUploads = uploads.filter(u => u.status === 'uploading');
  const totalBadge = unreadNotes.length + activeUploads.length;

  const markAllRead = async () => {
    if (!user || unreadNotes.length === 0) return;
    await sb.from('notes').update({ resolved: true, resolved_at: new Date().toISOString(), resolved_by: user.id }).in('id', unreadNotes.map(n => n.id));
    loadNotes();
  };

  const goToNote = (n) => {
    setOpen(false);
    let url = '/player?project=' + n.project_id;
    if (n.track_id) url += '&track=' + n.track_id;
    if (n.timestamp_sec != null) url += '&t=' + n.timestamp_sec;
    router.push(url);
  };

  const goToUpload = (u) => {
    if (!u.projectId) return;
    setOpen(false);
    router.push('/player?project=' + u.projectId);
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
        {n.projects?.title && <div style={{fontSize:10,color:'var(--amber)',marginTop:2,fontFamily:'var(--fm)'}}>{n.projects.title}</div>}
      </div>
    </div>
  );

  return (
    <div style={{position:'relative'}} ref={panelRef}>
      <button onClick={() => setOpen(o => !o)} title="Notifications"
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
        <div style={{position:'absolute',top:'calc(100% + 8px)',right:0,width:360,maxWidth:'calc(100vw - 32px)',background:'var(--surf)',border:'1px solid var(--border2)',borderRadius:14,boxShadow:'0 20px 60px rgba(0,0,0,.6)',zIndex:300,overflow:'hidden'}}>
          <div style={{display:'flex',borderBottom:'1px solid var(--border)',background:'var(--surf2)'}}>
            {[{key:'new',label:'New',count:unreadNotes.length},{key:'read',label:'Read',count:readNotes.length},{key:'uploads',label:'Uploads',count:activeUploads.length}].map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                style={{flex:1,padding:'12px 8px',border:'none',background:'transparent',color:tab===t.key?'var(--amber)':'var(--t3)',fontFamily:'var(--fm)',fontSize:11,fontWeight:600,letterSpacing:'.06em',textTransform:'uppercase',cursor:'pointer',borderBottom:tab===t.key?'2px solid var(--amber)':'2px solid transparent',display:'flex',alignItems:'center',justifyContent:'center',gap:5}}>
                {t.label}
                {t.count > 0 && <span style={{background:tab===t.key?'var(--amber)':'var(--surf3)',color:tab===t.key?'#000':'var(--t2)',borderRadius:99,fontSize:9,fontWeight:700,minWidth:16,height:16,display:'flex',alignItems:'center',justifyContent:'center',padding:'0 4px'}}>{t.count}</span>}
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
                : uploads.slice().reverse().map(u => (
                    <div key={u.id} onClick={() => goToUpload(u)}
                      style={{padding:'14px',borderBottom:'1px solid var(--border)',cursor:'pointer',transition:'background .15s'}}
                      onMouseEnter={e => e.currentTarget.style.background='var(--surf2)'}
                      onMouseLeave={e => e.currentTarget.style.background=''}
                    >
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                        <div style={{fontFamily:'var(--fm)',fontSize:12,color:'var(--text)',fontWeight:600}}>{u.projectName}</div>
                        <div style={{fontFamily:'var(--fm)',fontSize:10,color:u.status==='done'?'#4caf50':'var(--amber)',fontWeight:600}}>
                          {u.status==='done'?'✓ Done':u.done+' / '+u.total}
                        </div>
                      </div>
                      <div style={{height:4,borderRadius:2,background:'var(--surf3)',overflow:'hidden'}}>
                        <div style={{height:'100%',borderRadius:2,background:u.status==='done'?'#4caf50':'var(--amber)',width:(u.total>0?Math.round(u.done/u.total*100):0)+'%',transition:'width .3s'}}/>
                      </div>
                      {u.label && <div style={{fontFamily:'var(--fm)',fontSize:10,color:'var(--t3)',marginTop:5}}>{u.label}</div>}
                    </div>
                  ))
              }
            </div>
          )}
        </div>
      )}
    </div>
  );
}
