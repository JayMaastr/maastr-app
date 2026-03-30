'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import { sb, UPLOAD_WORKER_URL } from '@/lib/supabase';
import NotificationCenter from '@/app/components/NotificationCenter';

function fmt(s){if(!s||isNaN(s))return'0:00';return Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0');}
function sanitize(n){return n.replace(/[^a-zA-Z0-9._-]/g,'_');}
function fmtDate(d){if(!d)return'';const dt=new Date(d);const m=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];return m[dt.getMonth()]+' '+dt.getDate();}
const TONES=[
  {label:'Warm + Loud',short:'W+L',desc:'Rich low end, maximum punch.'},
  {label:'Neutral + Loud',short:'N+L',desc:'Balanced and loud.'},
  {label:'Bright + Loud',short:'B+L',desc:'Aggressive and forward.'},
  {label:'Warm + Normal',short:'W+N',desc:'Warm, rich and cinematic.'},
  {label:'Neutral + Normal',short:'N+N',desc:'Balanced for all genres.'},
  {label:'Bright + Normal',short:'B+N',desc:'Clear and present.'},
  {label:'Warm + Gentle',short:'W+G',desc:'Warm and intimate.'},
  {label:'Neutral + Gentle',short:'N+G',desc:'Natural dynamics.'},
  {label:'Bright + Gentle',short:'B+G',desc:'Airy and delicate.'}
];
/* Brighter color swatches — warmth (col) x loudness (row opacity) */
const TONE_BG=[
  'rgba(232,160,32,0.82)','rgba(190,190,210,0.70)','rgba(60,180,255,0.78)',
  'rgba(232,160,32,0.55)','rgba(160,160,185,0.48)','rgba(60,180,255,0.52)',
  'rgba(232,160,32,0.28)','rgba(130,130,155,0.25)','rgba(60,180,255,0.26)',
];
const TONE_BORDER=['#c47800','#7878a0','#0099dd','#c47800','#7878a0','#0099dd','#c47800','#7878a0','#0099dd'];
const DEFAULT_TONE=4;
function getToneMemory(n){try{const v=localStorage.getItem('mt_'+n.toLowerCase().replace(/\s+/g,'_'));return v!=null?parseInt(v):DEFAULT_TONE;}catch{return DEFAULT_TONE;}}
function setToneMemory(n,i){try{localStorage.setItem('mt_'+n.toLowerCase().replace(/\s+/g,'_'),i);}catch{}}
;
async function computePeaks(file,n=400){try{const ab=await file.arrayBuffer();const ac=new(window.AudioContext||window.webkitAudioContext)();const buf=await ac.decodeAudioData(ab);ac.close();const raw=buf.getChannelData(0),bs=Math.floor(raw.length/n),peaks=[];for(let i=0;i<n;i++){let max=0;const s=i*bs;for(let j=0;j<bs;j++){const v=Math.abs(raw[s+j]||0);if(v>max)max=v;}peaks.push(Math.min(1,max));}const mx=Math.max(...peaks)||1;return peaks.map(p=>Math.max(0.04,(p/mx)*0.95));}catch(e){return[];}}
function Waveform({peaks, progress, notes, duration, onSeek}) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const progressRef = useRef(progress);
  const roRef = useRef(null);

  // Keep progress ref current without re-running full draw
  useEffect(() => { progressRef.current = progress; }, [progress]);

  // Main draw effect — runs on mount and when peaks change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let running = true;

    function draw() {
      if (!running) return;
      const dpr = window.devicePixelRatio || 1;
      const W = canvas.parentElement ? canvas.parentElement.clientWidth : 600;
      const H = 72;
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        canvas.style.width = '100%';
        canvas.style.height = H + 'px';
      }
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.scale(dpr, dpr);

      if (!peaks || peaks.length < 4) {
      const t = Date.now() / 600;
      const pulse = 0.35 + 0.35 * Math.sin(t * Math.PI * 2);
      ctx.clearRect(0, 0, W, H);
      ctx.font = '500 12px DM Mono, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(232,160,32,' + (0.4 + pulse * 0.4) + ')';
      ctx.fillText('Processing audio… won’t be long', W / 2, H / 2);
      ctx.beginPath();
      ctx.arc(W / 2 - 132, H / 2, 3 + pulse * 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      rafRef.current = requestAnimationFrame(draw);
      return;
    }

      const prog = progressRef.current || 0;
      const BAR = 1, GAP = 0.5, STEP = BAR + GAP;
      const numBars = Math.floor(W / STEP);
      const cutBar = Math.floor(prog * numBars);
      const cy = H / 2;

      // Pre-compute heights
      const heights = new Float32Array(numBars);
      for (let i = 0; i < numBars; i++) {
        const pi = Math.min(Math.floor(i / numBars * peaks.length), peaks.length - 1);
        heights[i] = Math.max(2, peaks[pi] * (cy - 4));
      }

      // Draw bars
      for (let i = 0; i < numBars; i++) {
        const h = heights[i];
        const played = i < cutBar;
        const alpha = played ? 1 : 0.3;
        // Upper bar gradient
        const grad = ctx.createLinearGradient(0, cy - h, 0, cy);
        grad.addColorStop(0, played ? 'rgba(232,160,32,'+alpha+')' : 'rgba(200,140,30,'+alpha+')');
        grad.addColorStop(1, played ? 'rgba(200,130,20,'+alpha+')' : 'rgba(180,120,15,'+alpha+')');
        ctx.fillStyle = grad;
        ctx.fillRect(i * STEP, cy - h, BAR, h);
        // Reflection
        const rGrad = ctx.createLinearGradient(0, cy, 0, cy + h * 0.6);
        rGrad.addColorStop(0, 'rgba(232,160,32,'+(alpha*0.4)+')');
        rGrad.addColorStop(1, 'rgba(232,160,32,0)');
        ctx.fillStyle = rGrad;
        ctx.fillRect(i * STEP, cy, BAR, h * 0.6);
      }

      // Playhead
      if (prog > 0.001) {
        const px = Math.round(prog * W);
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fillRect(px, 0, 1, H);
        // Dot
        ctx.beginPath();
        ctx.arc(px, 4, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#e8a020';
        ctx.fill();
      }

      // Time stamps
      ctx.font = '11px DM Mono, monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillText(fmt(prog * duration), 4, H - 4);
      ctx.textAlign = 'right';
      ctx.fillText(fmt(duration), W - 4, H - 4);
      ctx.textAlign = 'left';

      // Note markers
      if (notes && notes.length) {
        const activeNotes = notes.filter(n => !n.resolved);
        for (const note of activeNotes) {
          if (!note.timestamp_sec || !duration) continue;
          const nx = (note.timestamp_sec / duration) * W;
          ctx.fillStyle = '#e8a020';
          ctx.fillRect(nx - 1, 0, 2, H);
          ctx.beginPath();
          ctx.arc(nx, H - 8, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      rafRef.current = requestAnimationFrame(draw);
    }

    draw();

    // ResizeObserver — just let the draw loop handle resize naturally
    const ro = new ResizeObserver(() => {}); // canvas checks size on every frame
    if (canvas.parentElement) ro.observe(canvas.parentElement);
    roRef.current = ro;

    return () => {
      running = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [peaks, notes, duration]); // Re-run when peaks/notes/duration change

  function handleClick(e) {
    if (!onSeek || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    onSeek((e.clientX - rect.left) / rect.width);
  }

  return (
    <div className="td-wave-wrap" onClick={handleClick} style={{cursor:'pointer',width:'100%',position:'relative'}}>
      <canvas ref={canvasRef} style={{display:'block',width:'100%',height:'72px'}}/>
    </div>
  );
}

function FixedDropdown({anchorRef,open,onClose,children}){const [pos,setPos]=useState({top:0,right:0});function recalc(){if(!anchorRef.current)return;const rect=anchorRef.current.getBoundingClientRect();setPos({top:rect.bottom+4,right:window.innerWidth-rect.right});}useEffect(()=>{if(!open)return;recalc();window.addEventListener('scroll',recalc,true);return()=>{window.removeEventListener('scroll',recalc,true);};},[open]);if(!open)return null;return(<><div style={{position:'fixed',inset:0,zIndex:998,background:'transparent'}} onClick={onClose}/><div style={{position:'fixed',top:pos.top,right:pos.right,zIndex:999,background:'var(--surf2)',border:'1px solid var(--border2)',borderRadius:10,minWidth:176,boxShadow:'0 8px 40px rgba(0,0,0,.6)',overflow:'hidden'}}>{children}</div></>);}

/* ToneGrid — bright color swatches, no text in cells, X through used (color kept) */
function ToneGrid({value,usedTones=[],onChange,onSetAll,showSetAll}){
  const [hov,setHov]=useState(null);
  const tip=TONES[hov!=null?hov:value!=null?value:DEFAULT_TONE];
  return(<div className="tgm-wrap">
    <div className="tgm-axes"><span>← Warmer</span><span style={{margin:'0 auto',color:'var(--amber)',fontWeight:500,fontSize:10}}>TONE GRID</span><span>Brighter →</span></div>
    <div style={{display:'flex',gap:6,alignItems:'flex-start'}}>
      <div className="tgm-row-labels"><div>Louder</div><div>Normal</div><div>Gentler</div></div>
      <div className="tgm-grid">
        {TONES.map((t,i)=>{
          const used=usedTones.includes(i);
          const isActive=i===value;
          return(<button key={i}
            className={'tgm-cell'+(isActive?' active':'')+(used?' used':'')}
            style={{
              background:TONE_BG[i],
              borderColor:isActive||i===hov?TONE_BORDER[i]:'rgba(0,0,0,0.2)',
              borderWidth:isActive?'2.5px':'1.5px',
              opacity:used?0.55:1,
              cursor:used?'not-allowed':'pointer'
            }}
            onMouseEnter={()=>setHov(i)} onMouseLeave={()=>setHov(null)}
            onClick={()=>!used&&onChange(i)} disabled={used}>
            {used&&(<svg width="18" height="18" viewBox="0 0 18 18" style={{position:'absolute',pointerEvents:'none'}}><line x1="3" y1="3" x2="15" y2="15" stroke="rgba(255,255,255,0.9)" strokeWidth="2.5" strokeLinecap="round"/><line x1="15" y1="3" x2="3" y2="15" stroke="rgba(255,255,255,0.9)" strokeWidth="2.5" strokeLinecap="round"/></svg>)}
          </button>);
        })}
      </div>
    </div>
    <div className="tgm-tip">{tip&&<><span className="tgm-tip-label">{tip.label}</span><span className="tgm-tip-desc">{tip.desc}</span></>}</div>
    {usedTones.length>0&&<div style={{fontSize:10,color:'var(--t3)',marginTop:6}}>✓ Already mastered — crossed cells unavailable</div>}
    {showSetAll&&<button className="tgm-set-all" onClick={()=>onSetAll&&onSetAll(value)}>Apply to all tracks</button>}
  </div>);}

function TrackDetail({open,track,activeRevision,notes,currentTime,duration,progress,isPlaying,onTogglePlay,onSkip,onPrevTrack,onNextTrack,canPrev,canNext,onSeek,onClose,onPost,onSeekToTime,onRevisionSelect,activeMaster,onMasterSelect}){
  const [noteText,setNoteText]=useState('');const [posting,setPosting]=useState(false);const [lockedTime,setLockedTime]=useState(currentTime);const [revSwitcherOpen,setRevSwitcherOpen]=useState(false);const inputRef=useRef(null);
  const revisions=track?[...(track.revisions||[])].sort((a,b)=>(b.version_number||0)-(a.version_number||0)):[];
  const displayRev=activeRevision||(revisions.find(r=>r.is_active)||revisions[0]||null);
  // Poll for pending masters every 8s while any are processing
  useEffect(()=>{
    if(!displayRev?.id) return;
    const pending=displayRev.masters?.filter(m=>m.status==='pending'||m.status==='processing');
    if(!pending?.length) return;
    const t=setTimeout(async()=>{
      try{
        const {data}=await sb.from('masters').select('*').eq('revision_id',displayRev.id);
        if(data) window.dispatchEvent(new CustomEvent('masters-updated',{detail:{revisionId:displayRev.id,masters:data}}));
      }catch(e){}
    },8000);
    return ()=>clearTimeout(t);
  },[displayRev?.id,displayRev?.masters?.map(m=>m.status).join()]);

  function focusNote(){setLockedTime(currentTime);setTimeout(()=>inputRef.current?.focus(),60);}
  async function handlePost(){if(!noteText.trim()||posting)return;setPosting(true);await onPost(noteText.trim(),lockedTime);setNoteText('');setPosting(false);}
  return(<>
    <div className={'td-backdrop'+(open?' td-open':'')} onClick={onClose}/>
    <div className={'td-modal'+(open?' td-open':'')}>
      <div className="td-header">
        <button className="td-close" onClick={onClose}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        <div className="td-title-block">
          <div className="td-track-name">{track?.title}</div>
          {displayRev&&<div className="td-rev-row"><span className="td-rev-badge">{displayRev.label||'v1'}</span>{displayRev.tone_label&&<span className="td-tone-badge">{displayRev.tone_label}</span>}{revisions.length>1&&<button className="td-rev-switch" onClick={()=>setRevSwitcherOpen(v=>!v)}>{revisions.length} versions ▾</button>}</div>}
        </div>
      </div>
      {revSwitcherOpen&&(<div className="td-rev-list">{revisions.map(rev=>(<button key={rev.id} className={'td-rev-item'+(displayRev?.id===rev.id?' active':'')} onClick={()=>{onRevisionSelect(rev);setRevSwitcherOpen(false);setActiveMaster(null);}}><span className="td-rev-item-label">{rev.label||'v?'}</span>{rev.tone_label&&<span className="td-rev-item-tone">{rev.tone_label}</span>}<span className="td-rev-item-date">{fmtDate(rev.created_at)}</span>{displayRev?.id===rev.id&&<span className="td-rev-curr">playing</span>}</button>))}</div>)}
      {/* Master selector — shows preset pills for active revision */}
      {displayRev&&<div className="td-master-section">
        <div className="td-master-label">REMASTER</div>
        <div className="td-master-pills">
          {[
            {short:'W+L',label:'Warm + Loud'},
            {short:'N+L',label:'Neutral + Loud'},
            {short:'B+L',label:'Bright + Loud'},
            {short:'W+N',label:'Warm + Normal'},
            {short:'N+N',label:'Neutral + Normal'},
            {short:'B+N',label:'Bright + Normal'},
            {short:'W+G',label:'Warm + Gentle'},
            {short:'N+G',label:'Neutral + Gentle'},
            {short:'B+G',label:'Bright + Gentle'}
          ].map(preset=>{
            const master=displayRev.masters?.find(m=>m.preset===preset.short);
            const isActive=activeMaster?.preset===preset.short&&activeMaster?.revision_id===displayRev.id;
            const isReady=master?.status==='ready';
            const isPending=master?.status==='pending'||master?.status==='processing';
            return(<button key={preset.short}
              className={'td-master-pill'+(isActive?' active':'')+(isReady?' ready':'')+(isPending?' pending':'')}
              title={preset.label}
              onClick={()=>{
                if(isActive){onMasterSelect(null);return;}
                if(isReady){onMasterSelect({...master,revision_id:displayRev.id});return;}
                if(!master||master.status==='failed'){
                  fetch('/api/request-master',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revisionId:displayRev.id,preset:preset.short})}).catch(()=>{});
                }
              }}
            >
              <span className="td-master-pill-short">{preset.short}</span>
              {isPending&&<span className="td-master-pill-status">⟳</span>}
              {isReady&&!isActive&&<span className="td-master-pill-status">✓</span>}
              {isActive&&<span className="td-master-pill-status">▶</span>}
            </button>);
          })}
        </div>
        {activeMaster&&<button className="td-master-clear" onClick={()=>onMasterSelect(null)}>
          ✕ Back to original
        </button>}
      </div>}

      <div className="td-wave-wrap"><Waveform peaks={track?.peaks} progress={progress} notes={notes} duration={duration} onSeek={onSeek}/><div className="td-time-row"><span>{fmt(currentTime)}</span><span>{fmt(duration)}</span></div></div>
      <div className="td-notes-scroll">
        {notes.length>0?(<><div className="td-notes-label">NOTES{displayRev&&<span className="td-notes-rev"> — {displayRev.label||'v1'}</span>}</div>{notes.map(n=>(<div key={n.id} className="td-note-item"><div className="td-note-meta"><span className="td-note-author">{n.author_name||'You'}</span>{n.timestamp_sec!=null&&(<button className="td-note-pill" onClick={()=>onSeekToTime(n.timestamp_sec)}><svg width="9" height="9" viewBox="0 0 10 10" fill="currentColor"><polygon points="2,1 9,5 2,9"/></svg>{n.timestamp_label||fmt(n.timestamp_sec)}</button>)}</div><div className="td-note-body">{n.body}</div><span className="td-note-date">{new Date(n.created_at).toLocaleDateString()}</span></div>))}</>):(<div className="td-notes-empty">No notes yet — add the first one below</div>)}
      </div>
      <div className="td-compose">
        {noteText?(<><textarea ref={inputRef} className="td-compose-textarea" value={noteText} onChange={e=>setNoteText(e.target.value)} placeholder={"Note at "+fmt(lockedTime)+"…"} rows={2} onKeyDown={e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey))handlePost();}} autoFocus/><div className="td-compose-actions"><span className="td-compose-ts">{fmt(lockedTime)}</span><button className="td-compose-cancel" onClick={()=>setNoteText('')}>Cancel</button><button className="td-compose-post" onClick={handlePost} disabled={posting}>{posting?'Posting…':'Post'}</button></div></>):(<button className="td-compose-trigger" onClick={focusNote}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Add note at <strong>{fmt(currentTime)}</strong></button>)}
      </div>
      <div className="td-modal-bar">
        <div className="td-modal-transport">
          <div className="td-transport-left"><button className="ps-track-btn" onClick={onPrevTrack} disabled={!canPrev}><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="19,5 9,12 19,19"/><rect x="5" y="5" width="2.5" height="14" rx="1"/></svg></button><button className="ps-skip-btn" onClick={()=>onSkip(-10)} disabled={!duration}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.95"/></svg><span className="ps-skip-label">10</span></button></div>
          <div className="td-transport-center"><button className="ps-play-btn" onClick={onTogglePlay} disabled={!duration}><svg width="16" height="16" viewBox="0 0 16 16" fill="#000">{isPlaying?<><rect x="3" y="1" width="3.5" height="14" rx="1"/><rect x="9.5" y="1" width="3.5" height="14" rx="1"/></>:<polygon points="3,1 15,8 3,15"/>}</svg></button></div>
          <div className="td-transport-right"><button className="ps-skip-btn" onClick={()=>onSkip(10)} disabled={!duration}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.49-3.95"/></svg><span className="ps-skip-label">10</span></button><button className="ps-track-btn" onClick={onNextTrack} disabled={!canNext}><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,5 15,12 5,19"/><rect x="16.5" y="5" width="2.5" height="14" rx="1"/></svg></button></div>
        </div>
      </div>
    </div>
  </>);}
function TrackRow({track,idx,isActive,isPlaying,noteCount,onPlay,onDetail,onRename,onDeleteTrack,onDeleteRevision,onRerunRevision,isMastering}){
  const [menuOpen,setMenuOpen]=useState(false);const [renaming,setRenaming]=useState(false);const [renameVal,setRenameVal]=useState(track.title||'');const menuBtnRef=useRef(null);
  const revisions=[...(track.revisions||[])].sort((a,b)=>(b.version_number||0)-(a.version_number||0));const revCount=revisions.length;
  const [revDeleteOpen,setRevDeleteOpen]=useState(false);const [deleteRevStep,setDeleteRevStep]=useState(0);const [deleteRevTarget,setDeleteRevTarget]=useState(null);
  async function saveRename(){const v=renameVal.trim();if(v&&v!==track.title)await onRename(track.id,v);setRenaming(false);}
  function cancelRename(){setRenameVal(track.title||'');setRenaming(false);}
  return(<div className={'tr-row'+(isActive?' tr-active':'')}>
    {renaming?(<div className="tr-rename" onClick={e=>e.stopPropagation()}><input className="tr-rename-input" value={renameVal} autoFocus onChange={e=>setRenameVal(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')saveRename();if(e.key==='Escape')cancelRename();}}/><button className="tr-rename-save" onClick={saveRename}>Save</button><button className="tr-rename-cancel" onClick={cancelRename}>Cancel</button></div>):(<>
      <div className="tr-play-zone" onClick={()=>onPlay(track.id)}>
        <div className="tr-num-play">{isPlaying?(<svg className="tr-playing-icon" width="14" height="14" viewBox="0 0 14 14" fill="var(--amber)"><rect x="1" y="1" width="4" height="12" rx="1"/><rect x="9" y="1" width="4" height="12" rx="1"/></svg>):(<span className="tr-idx">{idx+1}</span>)}</div>
        <div className="tr-info"><span className="tr-name">{track.title}</span><div className="tr-meta">{isMastering&&<span style={{display:'flex',alignItems:'center',gap:4,fontSize:11,color:'var(--gold)',fontWeight:600,letterSpacing:'0.02em'}}><svg style={{animation:'spin 1s linear infinite',flexShrink:0}} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>Mastering…</span>}{revisions.length>0&&<span className="tr-rev">{revisions[0]?.label||("v"+(revisions[0]?.version_number||"?"))}</span>}</div></div>
      </div>
      <div className="tr-actions">
        <button className="tr-comment-btn" onClick={e=>{e.stopPropagation();onDetail(track);}}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>{noteCount>0&&<span className="tr-note-count">{noteCount}</span>}</button>
        <div style={{position:'relative'}}><button ref={menuBtnRef} className="tr-menu-btn" onClick={e=>{e.stopPropagation();setMenuOpen(o=>!o);}}><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg></button>
          <FixedDropdown anchorRef={menuBtnRef} open={menuOpen} onClose={()=>setMenuOpen(false)}>
            <button className="tdrop-item" onClick={()=>{setMenuOpen(false);setRenameVal(track.title||'');setRenaming(true);}}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Rename Track</button>
            <button className="tdrop-item" onClick={()=>{setMenuOpen(false);onRerunRevision(track);}}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.95"/></svg>Remaster</button>
            {revCount>1&&<button className="tdrop-item" onClick={()=>{setMenuOpen(false);setDeleteRevStep(0);setDeleteRevTarget(null);setRevDeleteOpen(true);}}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>Delete a Revision</button>}
            <div className="tdrop-divider"/>
            <button className="tdrop-item danger" onClick={()=>{setMenuOpen(false);onDeleteTrack(track);}}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>Delete Track</button>
          </FixedDropdown>
        </div>
      </div>
    </>)}
    {revDeleteOpen&&(<div className="rev-action-panel" onClick={e=>e.stopPropagation()}>{deleteRevStep===1&&deleteRevTarget?(<div className="rev-del-confirm"><div className="rev-del-confirm-title">Delete {deleteRevTarget.label||('v'+(deleteRevTarget.version_number||'?'))}?</div><div className="rev-del-confirm-sub">Permanently deletes this revision and all its notes.</div><div className="rev-del-actions"><button className="btn-ghost-sm" onClick={()=>{setDeleteRevStep(0);setDeleteRevTarget(null);}}>Cancel</button><button className="btn-delete-sm" onClick={()=>{onDeleteRevision(deleteRevTarget,track);setRevDeleteOpen(false);setDeleteRevTarget(null);setDeleteRevStep(0);}}>Delete Forever</button></div></div>):(<><div className="rev-action-label">Which revision to delete?</div>{revisions.map(rev=>(<button key={rev.id} className="rev-del-row" onClick={()=>{setDeleteRevTarget(rev);setDeleteRevStep(1);}}><span className="rev-del-row-label">{rev.label||('v'+(rev.version_number||'?'))}</span>{rev.tone_label&&<span className="rev-del-row-tone">{rev.tone_label}</span>}<span className="rev-del-row-date">{fmtDate(rev.created_at)}</span>{rev.is_active&&<span className="rev-del-row-active">current</span>}</button>))}<button className="btn-ghost-sm" style={{width:'100%',marginTop:8}} onClick={()=>{setRevDeleteOpen(false);setDeleteRevTarget(null);}}>Cancel</button></>)}</div>)}
  </div>);}
export default function Player(){
  const [user,setUser]=useState(null);const [project,setProject]=useState(null);const [tracks,setTracks]=useState([]);
  useEffect(()=>{
    if(tracks.length===0||tracks.every(t=>t.peaks&&t.peaks.length>=4)) return;
    const timer=setInterval(async()=>{
      const {data}=await sb.from('tracks').select('id,peaks,duration').in('id',tracks.map(t=>t.id));
      if(!data) return;
      setTracks(prev=>prev.map(t=>{const f=data.find(d=>d.id===t.id);return f?{...t,peaks:f.peaks,duration:f.duration}:t;}));
      if(data.every(t=>t.peaks&&t.peaks.length>=4)) clearInterval(timer);
    },3000);
    return ()=>clearInterval(timer);
  },[tracks.length]);const [activeTrackId,setActiveTrackId]=useState(null);const [activeRevision,setActiveRevision]=useState(null);const [activeMaster,setActiveMaster]=useState(null);const [notes,setNotes]=useState([]);const [playing,setPlaying]=useState(false);const [currentTime,setCurrentTime]=useState(0);const [duration,setDuration]=useState(0);
  const [pendingSeek,setPendingSeek]=useState(null);const audioRef=useRef(null);
  const [detailTrack,setDetailTrack]=useState(null);
  const [showRevModal,setShowRevModal]=useState(false);const [revFiles,setRevFiles]=useState([]);const [revDragging,setRevDragging]=useState(false);const [revUploading,setRevUploading]=useState(false);const [revStatus,setRevStatus]=useState('');
  const [rerunTrack,setRerunTrack]=useState(null);const [rerunTone,setRerunTone]=useState(null);
  const [processingMasters,setProcessingMasters]=useState({});const [rerunUploading,setRerunUploading]=useState(false);const [rerunStatus,setRerunStatus]=useState('');
  const [deleteTrackConfirm,setDeleteTrackConfirm]=useState(null);
    const [showMenu,setShowMenu]=useState(false);
const [showInvite,setShowInvite]=useState(false);
  const [inviteEmail,setInviteEmail]=useState('');
  const [inviteMsg,setInviteMsg]=useState('');
  const [inviteSending,setInviteSending]=useState(false);
  const [inviteDone,setInviteDone]=useState('');
  const [downloadEnabled,setDownloadEnabled]=useState(false);
  const [isOwner,setIsOwner]=useState(false);
  const [useWav,setUseWav]=useState(false);
  const [showReport,setShowReport]=useState(false);
  const [reportMsg,setReportMsg]=useState('');
  const [reportSent,setReportSent]=useState(false);
  useEffect(()=>{sb.auth.getSession().then(({data:{session}})=>{if(!session){window.location.href='/auth';return;}setUser(session.user);const pid=new URLSearchParams(window.location.search).get('project');const _sp=new URLSearchParams(window.location.search);const _trackId=_sp.get('track');const _tSec=_sp.get('t');if(!pid){window.location.href='/';return;}loadProject(pid,_trackId,_tSec);});},[]);

  useEffect(()=>{
    if(!project?.id) return;
    let interval;
    const poll=async()=>{
      const {data}=await sb.from('masters').select('id,status,revision_id').eq('project_id',project.id).in('status',['pending','processing']);
      if(!data||data.length===0){setProcessingMasters({});clearInterval(interval);loadProject(project.id);return;}
      const map={};data.forEach(m=>{map[m.revision_id]=m.status;});setProcessingMasters(map);
    };
    poll();interval=setInterval(poll,3000);
    return()=>clearInterval(interval);
  },[project?.id]);

  async function loadProject(pid,_trackId,_tSec){const {data:proj}=await sb.from('projects').select('*').eq('id',pid).single();if(!proj){window.location.href='/';return;}setProject(proj);
        setIsOwner(!!(user && proj.user_id === user.id));
        setDownloadEnabled(!!proj.downloads_enabled);
        setIsOwner(user && proj.user_id === user.id);
        setDownloadEnabled(!!proj.downloads_enabled);const {data:tr}=await sb.from('tracks').select('*,revisions(*,masters(*))').eq('project_id',pid).order('position');const {data:noteCounts}=await sb.from('notes').select('track_id').eq('project_id',pid);const countMap={};(noteCounts||[]).forEach(n=>{countMap[n.track_id]=(countMap[n.track_id]||0)+1;});const tl=(tr||[]).map(t=>({...t,revisions:[...(t.revisions||[])].sort((a,b)=>(a.version_number||0)-(b.version_number||0)),_noteCount:countMap[t.id]||0}));setTracks(tl);if(tl.length>0){const first=(_trackId&&tl.find(t=>t.id===_trackId))||tl[0];setActiveTrackId(first.id);if(_tSec!=null)setPendingSeek(parseFloat(_tSec));const rev=first.revisions?.find(r=>r.is_active)||first.revisions?.[first.revisions.length-1]||null;setActiveRevision(rev);loadNotes(first.id,rev?.id);}}
  async function loadNotes(trackId,revId){const {data}=await sb.from('notes').select('*').eq('track_id',trackId).order('timestamp_sec');const all=data||[];const filtered=revId?all.filter(n=>n.revision_id===revId||n.revision_id===null):all;setNotes(filtered);setTracks(prev=>prev.map(t=>t.id===trackId?{...t,_noteCount:filtered.length}:t));}
  const activeTrack=tracks.find(t=>t.id===activeTrackId)||null;
  const activeIdx=tracks.findIndex(t=>t.id===activeTrackId);
  const audioUrl=activeRevision?activeRevision.mp3_url||activeRevision.audio_url:activeTrack?.mp3_url||activeTrack?.audio_url;
  useEffect(()=>{
    const el=audioRef.current;
    if(!el||!activeTrackId)return;
    const track=tracks.find(t=>t.id===activeTrackId);
    const rev=activeRevision;
    const hlsUrl=activeMaster?.hls_url||rev?.hls_url||track?.hls_url||null;
    const wavUrl=activeMaster?.audio_url||rev?.audio_url||track?.audio_url||null;
    if(!hlsUrl&&!wavUrl)return;
    // Destroy any existing HLS instance
    if(window.__hlsInst){window.__hlsInst.destroy();window.__hlsInst=null;}
    el.pause();
    if(hlsUrl){
      // HLS path — instant start, FLAC quality
      import('hls.js').then(({default:Hls})=>{
        if(Hls.isSupported()){
          const hls=new Hls({startLevel:-1,autoStartLoad:true,lowLatencyMode:false});
          hls.loadSource(hlsUrl);
          hls.attachMedia(el);
          hls.on(Hls.Events.MANIFEST_PARSED,()=>{
            if(window.__pendingSeek){el.currentTime=window.__pendingSeek*el.duration||0;window.__pendingSeek=null;}
          });
          hls.on(Hls.Events.ERROR,(_,data)=>{
            if(data.fatal){
              console.warn('[hls] fatal error, falling back to WAV',data);
              hls.destroy();
              if(wavUrl){el.src=wavUrl;el.load();}
            }
          });
          window.__hlsInst=hls;
        } else if(el.canPlayType('application/vnd.apple.mpegurl')){
          // Safari handles HLS natively
          el.src=hlsUrl; el.load();
        } else if(wavUrl){
          el.src=wavUrl; el.load();
        }
      }).catch(()=>{if(wavUrl){el.src=wavUrl;el.load();}});
    } else {
      // WAV fallback — direct stream
      el.src=wavUrl; el.load();
    }
    return ()=>{
      if(window.__hlsInst){window.__hlsInst.destroy();window.__hlsInst=null;}
    };
  },[activeTrackId,activeRevision,activeMaster,tracks]);

  // HLS polling — watches for hls_url to appear after encoding completes
  useEffect(()=>{
    if(!activeTrackId) return;
    const track=tracks.find(t=>t.id===activeTrackId);
    if(!track||track.hls_url) return; // already has HLS, nothing to do
    let timer=null;
    let attempts=0;
    const maxAttempts=36; // 3 minutes max (36 * 5s)
    const poll=async()=>{
      try{
        const {data}=await sb.from('tracks').select('id,hls_url').eq('id',activeTrackId).single();
        if(data?.hls_url){
          setTracks(prev=>prev.map(t=>t.id===activeTrackId?{...t,hls_url:data.hls_url}:t));
          return; // stop polling
        }
      }catch(e){}
      attempts++;
      if(attempts<maxAttempts) timer=setTimeout(poll,5000);
    };
    timer=setTimeout(poll,5000); // first check after 5s
    return()=>{if(timer)clearTimeout(timer);};
  },[activeTrackId,tracks]);

  function playTrack(trackId){if(trackId===activeTrackId){if(audioRef.current){if(playing){audioRef.current.pause();setPlaying(false);}else{audioRef.current.play().catch(()=>{});setPlaying(true);}}return;}if(audioRef.current)audioRef.current.pause();setPlaying(false);setCurrentTime(0);setDuration(0);setActiveTrackId(trackId);const t=tracks.find(tr=>tr.id===trackId);if(!t)return;const rev=t.revisions?.find(r=>r.is_active)||t.revisions?.[t.revisions.length-1]||null;setActiveRevision(rev);loadNotes(t.id,rev?.id);setTimeout(()=>{audioRef.current?.play().catch(()=>{});setPlaying(true);},80);}
  function openDetail(track){if(track.id!==activeTrackId){if(audioRef.current)audioRef.current.pause();setPlaying(false);setCurrentTime(0);setDuration(0);setActiveTrackId(track.id);const rev=track.revisions?.find(r=>r.is_active)||track.revisions?.[track.revisions.length-1]||null;setActiveRevision(rev);loadNotes(track.id,rev?.id);}setDetailTrack(track);}
  function jumpToTrack(idx){if(idx<0||idx>=tracks.length)return;const t=tracks[idx];if(audioRef.current)audioRef.current.pause();setPlaying(false);setCurrentTime(0);setDuration(0);setActiveTrackId(t.id);const rev=t.revisions?.find(r=>r.is_active)||t.revisions?.[t.revisions.length-1]||null;setActiveRevision(rev);loadNotes(t.id,rev?.id);setDetailTrack(prev=>prev?t:null);setTimeout(()=>{audioRef.current?.play().catch(()=>{});setPlaying(true);},80);}
  function togglePlay(){if(!audioRef.current)return;if(playing){audioRef.current.pause();setPlaying(false);}else{audioRef.current.play().catch(()=>{});setPlaying(true);}}
  function skip(secs){if(!audioRef.current)return;const t=Math.max(0,Math.min(duration||0,audioRef.current.currentTime+secs));audioRef.current.currentTime=t;setCurrentTime(t);}
  function handleSeek(pct){if(!audioRef.current||!duration)return;const t=pct*duration;audioRef.current.currentTime=t;setCurrentTime(t);}
  function seekToTime(sec){if(!audioRef.current)return;audioRef.current.currentTime=sec;setCurrentTime(sec);if(!playing){audioRef.current.play().catch(()=>{});setPlaying(true);}}
  async function postNote(body,timestampSec){if(!body.trim()||!activeTrack)return;await sb.from('notes').insert({track_id:activeTrack.id,project_id:project.id,revision_id:activeRevision?.id||null,author_name:user?.email?.split('@')[0]||'You',timestamp_sec:timestampSec,timestamp_label:fmt(timestampSec),body:body.trim()});loadNotes(activeTrack.id,activeRevision?.id);}
  function selectRevisionInDetail(rev){setActiveMaster(null);if(audioRef.current)audioRef.current.pause();setPlaying(false);setCurrentTime(0);setDuration(0);setActiveRevision(rev);loadNotes(activeTrack?.id,rev?.id);}
  async function reorderTracks(fromIdx,toIdx){if(fromIdx===toIdx)return;const nt=[...tracks];const [m]=nt.splice(fromIdx,1);nt.splice(toIdx,0,m);const updated=nt.map((t,i)=>({...t,position:i}));setTracks(updated);await Promise.all(updated.map(t=>sb.from('tracks').update({position:t.position}).eq('id',t.id)));}
  async function renameTrack(trackId,newTitle){await sb.from('tracks').update({title:newTitle}).eq('id',trackId);setTracks(prev=>prev.map(t=>t.id===trackId?{...t,title:newTitle}:t));}
  async function deleteTrack(track){setDeleteTrackConfirm(null);const urls=new Set();(track.revisions||[]).forEach(r=>{if(r.audio_url)urls.add(r.audio_url);if(r.mp3_url&&r.mp3_url!==r.audio_url)urls.add(r.mp3_url);});if(track.audio_url)urls.add(track.audio_url);await Promise.allSettled([...urls].map(url=>{try{const k=decodeURIComponent(new URL(url).pathname.replace(/^\//,''));return fetch(UPLOAD_WORKER_URL,{method:'DELETE',headers:{'X-File-Key':k}});}catch{return Promise.resolve();}}));await sb.from('notes').delete().eq('track_id',track.id);await sb.from('revisions').delete().eq('track_id',track.id);await sb.from('tracks').delete().eq('id',track.id);setTracks(prev=>prev.filter(t=>t.id!==track.id));if(activeTrackId===track.id){setActiveTrackId(null);setActiveRevision(null);setNotes([]);}}
  async function deleteRevision(rev,track){try{const k=decodeURIComponent(new URL(rev.audio_url||rev.mp3_url).pathname.replace(/^\//,''));await fetch(UPLOAD_WORKER_URL,{method:'DELETE',headers:{'X-File-Key':k}});}catch{}await sb.from('notes').delete().eq('revision_id',rev.id);await sb.from('revisions').delete().eq('id',rev.id);if(rev.is_active){const {data:rem}=await sb.from('revisions').select('id').eq('track_id',track.id).order('version_number',{ascending:false}).limit(1);if(rem?.[0])await sb.from('revisions').update({is_active:true}).eq('id',rem[0].id);}await loadProject(project.id);}
  async function submitRerun(){if(!rerunTrack||rerunTone===null)return;setRerunUploading(true);try{const activeRev=rerunTrack.revisions?.find(r=>r.is_active)||rerunTrack.revisions?.[rerunTrack.revisions.length-1];if(!activeRev){const revRes=await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/revisions`,{method:'POST',headers:{'apikey':process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,'Authorization':'Bearer '+process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,'Content-Type':'application/json','Prefer':'return=representation'},body:JSON.stringify({track_id:rerunTrack.id,project_id:project.id,audio_url:rerunTrack.audio_url,hls_url:rerunTrack.hls_url,duration:rerunTrack.duration,version_number:1,label:'v1',is_active:true})});const [newRev]=await revRes.json();if(!newRev)return;const rmRes=await fetch('/api/request-master',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revisionId:newRev.id,preset:TONES[rerunTone]?.short||rerunTone})});setRerunUploading(false);setRerunTrack(null);if(rmRes.ok)await loadProject(project.id);return;};setRerunStatus('Fetching audio…');const resp=await fetch(activeRev.audio_url||activeRev.mp3_url);const blob=await resp.blob();const fname='rerun_'+Date.now()+'.wav';setRerunStatus('Uploading…');const r=await fetch(UPLOAD_WORKER_URL,{method:'POST',headers:{'X-File-Name':fname,'X-Project-Id':project.id,'Content-Type':'audio/wav'},body:blob});const result=await r.json();if(!result.url)throw new Error('Upload failed');const {data:existing}=await sb.from('revisions').select('version_number').eq('track_id',rerunTrack.id).order('version_number',{ascending:false}).limit(1);const nextVer=(existing?.[0]?.version_number||1)+1;await sb.from('revisions').update({is_active:false}).eq('track_id',rerunTrack.id);const tone=TONES[rerunTone];await sb.from('revisions').insert({track_id:rerunTrack.id,project_id:project.id,version_number:nextVer,label:'v'+nextVer,audio_url:result.url,mp3_url:result.url,tone_setting:rerunTone,tone_label:tone.label,is_active:true});if(rerunTrack.title)setToneMemory(rerunTrack.title,rerunTone);setRerunTrack(null);setRerunTone(null);setRerunStatus('');await loadProject(project.id);}catch(e){setRerunStatus('Error: '+e.message);}setRerunUploading(false);}
  function autoMatch(filename,trackList){const base=filename.replace(/\.[^.]+$/,'').replace(/[_-]/g,' ').toLowerCase().trim();const exact=trackList.find(t=>t.title.toLowerCase()===base);if(exact)return exact;let bestScore=0,bestTrack=null;for(const t of trackList){const tName=t.title.toLowerCase();let score=0;for(let i=0;i<tName.length;i++)for(let j=i+1;j<=tName.length;j++){const sub=tName.slice(i,j);if(sub.length>score&&base.includes(sub))score=sub.length;}const threshold=Math.max(4,Math.floor(tName.length*0.6));if(score>=threshold&&score>bestScore){bestScore=score;bestTrack=t;}}return bestTrack;}
  function addRevFiles(files){const audio=[...files].filter(f=>f.type.startsWith('audio/')||/\.(wav|mp3|aiff|aif|flac|m4a)$/i.test(f.name));if(!audio.length)return;const newEntries=audio.map(file=>{const matched=autoMatch(file.name,tracks);const tone=matched?getToneMemory(matched.title):DEFAULT_TONE;const entry={file,name:matched?.title||file.name.replace(/\.[^.]+$/,'').replace(/[_-]/g,' ').trim(),tone,peaks:[],peaksComputed:false,matchedTrackId:matched?.id||null,isNew:!matched};computePeaks(file).then(peaks=>{setRevFiles(prev=>prev.map(e=>e.file.name===file.name?{...e,peaks,peaksComputed:peaks.length>0}:e));});return entry;});setRevFiles(prev=>{const ex=new Set(prev.map(e=>e.file.name));return [...prev,...newEntries.filter(e=>!ex.has(e.file.name))];});}
  async function submitRevisions(){if(!revFiles.length||!project)return;setRevUploading(true);try{for(let i=0;i<revFiles.length;i++){const entry=revFiles[i];setRevStatus('Uploading '+(i+1)+'/'+revFiles.length+': '+entry.name);const safeName=sanitize(entry.file.name);const r=await fetch(UPLOAD_WORKER_URL,{method:'POST',headers:{'X-File-Name':safeName,'X-Project-Id':project.id,'Content-Type':entry.file.type||'audio/wav'},body:entry.file});const result=await r.json();if(!result.url)continue;const tone=TONES[entry.tone];const peaks=entry.peaks.length>0?entry.peaks:[];if(entry.matchedTrackId&&!entry.isNew){const {data:existing}=await sb.from('revisions').select('version_number').eq('track_id',entry.matchedTrackId).order('version_number',{ascending:false}).limit(1);const nextVer=(existing?.[0]?.version_number||1)+1;await sb.from('revisions').update({is_active:false}).eq('track_id',entry.matchedTrackId);await sb.from('revisions').insert({track_id:entry.matchedTrackId,project_id:project.id,version_number:nextVer,label:'v'+nextVer,audio_url:result.url,mp3_url:result.url,tone_setting:entry.tone,tone_label:tone.label,is_active:true});if(peaks.length>0)await sb.from('tracks').update({peaks,tone_setting:entry.tone,tone_label:tone.label}).eq('id',entry.matchedTrackId);}else{const {data:newTrack}=await sb.from('tracks').insert({project_id:project.id,title:entry.name,audio_url:result.url,mp3_url:result.url,position:tracks.length+i,peaks,tone_setting:entry.tone,tone_label:tone.label}).select().single();if(newTrack){await sb.from('revisions').insert({track_id:newTrack.id,project_id:project.id,version_number:1,label:'v1',audio_url:result.url,mp3_url:result.url,tone_setting:entry.tone,tone_label:tone.label,is_active:true});}}if(entry.name.trim())setToneMemory(entry.name.trim(),entry.tone);}setShowRevModal(false);setRevFiles([]);setRevStatus('');await loadProject(project.id);}catch(e){setRevStatus('Error: '+e.message);}setRevUploading(false);}
  const progress=duration?currentTime/duration:0;
  const rerunUsedTones=rerunTrack?(rerunTrack.revisions||[]).map(r=>r.tone_setting).filter(t=>t!=null):[];
  useEffect(()=>{
    if(pendingSeek==null||!audioRef.current)return;
    const el=audioRef.current;
    const doSeek=()=>{if(el.readyState>=1){el.currentTime=pendingSeek;setPendingSeek(null);}};
    doSeek();
    el.addEventListener('loadedmetadata',doSeek,{once:true});
    return ()=>el.removeEventListener('loadedmetadata',doSeek);
  },[pendingSeek,activeTrackId]);

  return(<>
    <style>{`*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}:root{--bg:#0a0a0b;--surf:#111113;--surf2:#16161a;--surf3:#1e1e24;--border:#24242c;--border2:#2e2e38;--amber:#e8a020;--aglow:rgba(232,160,32,0.08);--text:#f0ede8;--t2:#8a8780;--t3:#4a4945;--red:#e05050;--fh:'DM Serif Display',Georgia,serif;--fm:'DM Mono','SF Mono','Menlo',monospace;}input,textarea,select{font-size:16px!important;-webkit-text-size-adjust:100%;}html,body{background:var(--bg);color:var(--text);font-family:var(--fm);-webkit-font-smoothing:antialiased;}
    .ps-waveform-bar{position:sticky;top:0;z-index:30;background:var(--bg);border-bottom:1px solid var(--border);padding:10px 16px 8px;box-shadow:0 2px 20px rgba(0,0,0,.5);}
    .ps-track-info{display:flex;align-items:center;gap:8px;margin-bottom:8px;}.ps-track-name{font-family:var(--fh);font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0;}.ps-rev-badge{font-size:9px;padding:2px 8px;border-radius:4px;background:var(--aglow);border:1px solid rgba(232,160,32,.25);color:var(--amber);white-space:nowrap;flex-shrink:0;}.ps-tone-badge{font-size:9px;padding:2px 7px;border-radius:4px;background:var(--surf2);border:1px solid var(--border2);color:var(--t3);white-space:nowrap;flex-shrink:0;}
    .ps-waveform{border-radius:8px;background:var(--surf2);padding:8px 10px 4px;}.ps-time-row{display:flex;justify-content:space-between;font-size:12px;font-weight:500;color:var(--t2);margin-top:4px;}
    .ps-no-track-top{font-size:12px;color:var(--t3);padding:8px 0;}
    .ps-controls-bar{position:fixed;bottom:0;left:0;right:0;z-index:30;background:var(--bg);border-top:1px solid var(--border);box-shadow:0 -4px 24px rgba(0,0,0,.6);padding:8px 16px;padding-bottom:calc(8px + env(safe-area-inset-bottom,0px));}
    .ps-transport{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;}
    .ps-transport-left{display:flex;align-items:center;justify-content:flex-end;gap:14px;}
    .ps-transport-center{display:flex;align-items:center;justify-content:center;padding:0 20px;}
    .ps-transport-right{display:flex;align-items:center;justify-content:flex-start;gap:14px;}
    .ps-play-btn{width:48px;height:48px;border-radius:50%;background:var(--amber);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;-webkit-tap-highlight-color:transparent;touch-action:manipulation;}.ps-play-btn:disabled{opacity:.3;pointer-events:none;}
    .ps-skip-btn{width:44px;height:44px;border-radius:10px;background:transparent;border:none;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;color:var(--t2);-webkit-tap-highlight-color:transparent;touch-action:manipulation;flex-shrink:0;}.ps-skip-btn:hover,.ps-skip-btn:active{color:var(--text);}.ps-skip-btn:disabled{opacity:.25;pointer-events:none;}
    .ps-skip-label{font-family:var(--fm);font-size:9px;font-weight:600;line-height:1;letter-spacing:.04em;}
    .ps-track-btn{width:40px;height:44px;border-radius:10px;background:transparent;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--t2);-webkit-tap-highlight-color:transparent;touch-action:manipulation;flex-shrink:0;}.ps-track-btn:hover,.ps-track-btn:active{color:var(--text);}.ps-track-btn:disabled{opacity:.2;pointer-events:none;}
    .td-backdrop{position:fixed;inset:0;z-index:200;background:transparent;pointer-events:none;transition:background .2s;}.td-backdrop.td-open{background:rgba(0,0,0,.7);pointer-events:auto;}
    .td-modal{position:fixed;inset:0;z-index:201;background:var(--bg);display:flex;flex-direction:column;transform:translateY(100%);transition:transform .32s cubic-bezier(.32,.72,0,1);will-change:transform;}.td-modal.td-open{transform:translateY(0);}
    .td-header{display:flex;align-items:flex-start;gap:12px;padding:14px 16px 10px;border-bottom:1px solid var(--border);flex-shrink:0;}
    .td-close{width:36px;height:36px;border-radius:9px;border:1px solid var(--border2);background:transparent;color:var(--t2);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;-webkit-tap-highlight-color:transparent;}.td-close:hover{color:var(--text);}
    .td-title-block{flex:1;min-width:0;}.td-track-name{font-family:var(--fh);font-size:18px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:4px;}
    .td-rev-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}.td-rev-badge{font-size:10px;padding:2px 8px;border-radius:4px;background:var(--aglow);border:1px solid rgba(232,160,32,.25);color:var(--amber);}.td-tone-badge{font-size:10px;padding:2px 7px;border-radius:4px;background:var(--surf2);border:1px solid var(--border2);color:var(--t3);}
    .td-rev-switch{font-family:var(--fm);font-size:10px;padding:2px 8px;border-radius:4px;border:1px solid var(--border2);background:transparent;color:var(--t2);cursor:pointer;-webkit-tap-highlight-color:transparent;}.td-rev-switch:hover{border-color:var(--amber);color:var(--amber);}
    .td-rev-list{background:var(--surf2);border-bottom:1px solid var(--border);flex-shrink:0;}
    .td-rev-item{width:100%;padding:12px 16px;text-align:left;background:transparent;border:none;border-bottom:1px solid var(--border);color:var(--t2);font-family:var(--fm);cursor:pointer;-webkit-tap-highlight-color:transparent;display:flex;align-items:center;gap:10px;min-height:52px;}.td-rev-item:last-child{border-bottom:none;}.td-rev-item:hover,.td-rev-item:active{background:var(--surf3);}.td-rev-item.active{color:var(--amber);}
    .td-rev-item-label{font-size:14px;font-weight:600;color:var(--text);}.td-rev-item-tone{font-size:11px;color:var(--amber);}.td-rev-item-date{font-size:11px;color:var(--t3);margin-left:auto;}.td-rev-curr{font-size:9px;color:var(--amber);padding:2px 6px;background:var(--aglow);border-radius:4px;border:1px solid rgba(232,160,32,.25);}
    .td-wave-wrap{padding:12px 16px 10px;border-bottom:1px solid var(--border);background:var(--surf);flex-shrink:0;}
    .td-time-row{display:flex;justify-content:space-between;font-size:12px;font-weight:500;color:var(--t2);margin-top:4px;}
    .td-notes-scroll{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:12px 16px;}
    .td-notes-label{font-size:9px;color:var(--amber);letter-spacing:.12em;text-transform:uppercase;font-weight:500;margin-bottom:10px;}.td-notes-rev{color:var(--t3);text-transform:none;letter-spacing:normal;font-weight:normal;}
    .td-note-item{padding:10px 0;border-bottom:1px solid var(--border);}.td-note-item:last-child{border-bottom:none;}.td-note-meta{display:flex;align-items:center;justify-content:space-between;margin-bottom:5px;}.td-note-author{font-family:var(--fh);font-size:13px;color:var(--text);}
    .td-note-pill{display:inline-flex;align-items:center;gap:5px;font-family:var(--fm);font-size:12px;font-weight:600;padding:0 10px;min-height:32px;background:var(--amber);color:#000;border:none;border-radius:7px;cursor:pointer;-webkit-tap-highlight-color:transparent;flex-shrink:0;}.td-note-pill:active{opacity:.8;}
    .td-note-body{font-size:13px;color:#c8c4be;line-height:1.6;}.td-note-date{display:block;font-size:10px;color:var(--t3);margin-top:3px;}.td-notes-empty{font-size:13px;color:var(--t3);padding:16px 0;text-align:center;}
    .td-compose{flex-shrink:0;border-top:1px solid var(--border);padding:10px 16px;background:var(--surf);}
    .td-compose-trigger{display:flex;align-items:center;gap:8px;width:100%;padding:13px 16px;border-radius:12px;border:1.5px dashed var(--border2);background:transparent;color:var(--t2);font-family:var(--fm);font-size:13px;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:all .15s;text-align:left;}.td-compose-trigger:hover,.td-compose-trigger:active{border-color:var(--amber);color:var(--amber);background:var(--aglow);}.td-compose-trigger strong{color:var(--text);}
    .td-compose-textarea{width:100%;background:var(--surf2);border:1.5px solid var(--amber);border-radius:12px;padding:12px 14px;color:var(--text);font-family:var(--fm);font-size:16px!important;resize:none;outline:none;-webkit-appearance:none;line-height:1.5;margin-bottom:8px;display:block;}
    .td-compose-actions{display:flex;align-items:center;gap:8px;}.td-compose-ts{font-family:var(--fm);font-size:12px;font-weight:600;padding:3px 10px;background:var(--amber);color:#000;border-radius:6px;flex-shrink:0;}
    .td-compose-cancel{font-family:var(--fm);font-size:13px;padding:8px 14px;border-radius:9px;border:1.5px solid var(--border2);background:transparent;color:var(--t2);cursor:pointer;-webkit-tap-highlight-color:transparent;margin-left:auto;}
    .td-compose-post{font-family:var(--fm);font-size:13px;font-weight:600;padding:8px 18px;border-radius:9px;background:var(--amber);color:#000;border:none;cursor:pointer;-webkit-tap-highlight-color:transparent;}.td-compose-post:disabled{opacity:.35;pointer-events:none;}
    .td-modal-bar{flex-shrink:0;background:var(--bg);border-top:1px solid var(--border);box-shadow:0 -4px 24px rgba(0,0,0,.5);padding:8px 16px;padding-bottom:calc(8px + env(safe-area-inset-bottom,0px));}
    .td-modal-transport{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;}
    .td-transport-left{display:flex;align-items:center;justify-content:flex-end;gap:14px;}
    .td-transport-center{display:flex;align-items:center;justify-content:center;padding:0 20px;}
    .td-transport-right{display:flex;align-items:center;justify-content:flex-start;gap:14px;}
    .topbar{height:48px;display:flex;align-items:center;justify-content:space-between;padding:0 16px;z-index:50;background:var(--surf);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:20;}.logo{font-family:var(--fh);font-size:17px;color:var(--text);text-decoration:none;}.logo em{color:var(--amber);font-style:normal;}.breadcrumb{font-size:12px;color:var(--t2);margin-left:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px;}.back{font-size:11px;color:var(--t2);text-decoration:none;padding:5px 10px;border-radius:7px;border:1px solid var(--border2);white-space:nowrap;-webkit-tap-highlight-color:transparent;}.back:hover{color:var(--text);}
    .page{padding:12px 12px 120px;}.page-header{padding:12px 0 16px;}.proj-title{font-family:var(--fh);font-size:clamp(20px,5vw,30px);margin-bottom:2px;}.proj-artist{font-size:11px;color:var(--t2);margin-bottom:14px;}.top-actions{display:flex;gap:8px;}.btn-upload-rev{display:flex;align-items:center;gap:6px;font-family:var(--fm);font-size:13px;font-weight:500;padding:10px 16px;border-radius:9px;background:var(--amber);color:#000;border:none;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;}
    .tracks-lbl{font-size:10px;color:var(--t3);letter-spacing:.12em;text-transform:uppercase;margin-bottom:4px;}
    .tr-row{display:flex;align-items:center;border-bottom:1px solid var(--border);background:var(--surf);}.tr-row:last-child{border-bottom:none;}.tr-row.tr-active{background:var(--surf2);}
    .tr-play-zone{display:flex;align-items:center;flex:1;min-width:0;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;padding:14px 0 14px 12px;min-height:60px;}
    .tr-num-play{width:32px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}.tr-idx{font-family:var(--fm);font-size:12px;color:var(--t3);}
    .tr-playing-icon{animation:pulse 1.2s ease-in-out infinite alternate;}@keyframes pulse{from{opacity:.6;}to{opacity:1;}}
    .tr-info{flex:1;min-width:0;padding:0 8px;}.tr-name{font-family:var(--fh);font-size:16px;color:var(--text);display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .tr-meta{display:flex;align-items:center;gap:8px;margin-top:2px;}.tr-rev{font-size:10px;color:var(--t3);}
    .tr-actions{display:flex;align-items:center;gap:2px;padding-right:8px;flex-shrink:0;}
    .tr-comment-btn{position:relative;width:40px;height:44px;border-radius:9px;border:none;background:transparent;color:var(--t3);cursor:pointer;display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent;touch-action:manipulation;flex-shrink:0;}.tr-comment-btn:hover,.tr-comment-btn:active{color:var(--t2);}
    .tr-note-count{position:absolute;top:6px;right:4px;font-size:8px;font-weight:700;background:var(--amber);color:#000;border-radius:8px;padding:1px 4px;font-family:var(--fm);min-width:14px;text-align:center;}
    .tr-menu-btn{width:36px;height:44px;border-radius:9px;border:none;background:transparent;color:var(--t3);cursor:pointer;display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent;touch-action:manipulation;padding:0;flex-shrink:0;}.tr-menu-btn:hover,.tr-menu-btn:active{color:var(--t2);}
    .tr-rename{display:flex;gap:6px;align-items:center;padding:10px 12px;flex:1;min-width:0;}.tr-rename-input{flex:1;min-width:0;background:var(--bg);border:2px solid var(--amber);border-radius:8px;color:var(--text);font-family:var(--fh);font-size:16px;padding:7px 11px;outline:none;-webkit-appearance:none;}
    .tr-rename-save{font-family:var(--fm);font-size:12px;font-weight:500;padding:7px 14px;border-radius:7px;background:var(--amber);color:#000;border:none;cursor:pointer;white-space:nowrap;flex-shrink:0;-webkit-tap-highlight-color:transparent;}.tr-rename-cancel{font-family:var(--fm);font-size:12px;padding:7px 12px;border-radius:7px;border:1.5px solid var(--border2);background:transparent;color:var(--t2);cursor:pointer;white-space:nowrap;flex-shrink:0;-webkit-tap-highlight-color:transparent;}
    .tdrop-item{width:100%;padding:14px 16px;display:flex;align-items:center;gap:10px;font-family:var(--fm);font-size:14px;color:var(--t2);background:transparent;border:none;cursor:pointer;text-align:left;-webkit-tap-highlight-color:transparent;touch-action:manipulation;}.tdrop-item:hover,.tdrop-item:active{background:var(--surf3);color:var(--text);}.tdrop-item.danger{color:#e08080;}.tdrop-item.danger:hover,.tdrop-item.danger:active{background:rgba(224,80,80,.08);color:var(--red);}.tdrop-divider{height:1px;background:var(--border);margin:2px 0;}
    .rev-action-panel{padding:14px;border-top:1px solid var(--border);background:var(--surf2);}.rev-action-label{font-size:10px;color:var(--t3);letter-spacing:.08em;text-transform:uppercase;margin-bottom:10px;}.rev-del-row{width:100%;padding:14px 12px;text-align:left;background:var(--surf);border:1px solid var(--border);border-radius:10px;color:var(--text);font-family:var(--fm);cursor:pointer;margin-bottom:8px;display:flex;flex-wrap:wrap;align-items:center;gap:6px;-webkit-tap-highlight-color:transparent;touch-action:manipulation;min-height:52px;}.rev-del-row:hover,.rev-del-row:active{border-color:var(--red);background:rgba(224,80,80,.05);}.rev-del-row-label{font-size:14px;font-weight:600;}.rev-del-row-tone{font-size:11px;color:var(--amber);}.rev-del-row-date{font-size:11px;color:var(--t3);margin-left:auto;}.rev-del-row-active{font-size:9px;color:#6ab4ff;padding:2px 7px;background:rgba(100,180,255,.1);border-radius:4px;border:1px solid rgba(100,180,255,.25);}.rev-del-confirm-title{font-family:var(--fh);font-size:17px;margin-bottom:8px;}.rev-del-confirm-sub{font-size:12px;color:var(--t2);line-height:1.6;margin-bottom:14px;}.rev-del-actions{display:flex;gap:8px;justify-content:flex-end;}
    .btn-ghost-sm{font-family:var(--fm);font-size:13px;padding:8px 14px;border-radius:8px;border:1.5px solid var(--border2);background:transparent;color:var(--t2);cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;}.btn-delete-sm{font-family:var(--fm);font-size:13px;font-weight:500;padding:8px 16px;border-radius:8px;background:var(--red);color:#fff;border:none;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;}
    .overlay-bg{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:300;display:flex;align-items:center;justify-content:center;padding:20px;}.confirm-box{background:var(--surf);border:1px solid var(--red);border-radius:14px;padding:28px 24px;max-width:340px;width:100%;text-align:center;}.confirm-box-title{font-family:var(--fh);font-size:18px;margin-bottom:8px;}.confirm-box-sub{font-size:13px;color:var(--t2);margin-bottom:20px;line-height:1.5;}.confirm-box-actions{display:flex;gap:10px;justify-content:center;}.btn-confirm-cancel{font-family:var(--fm);font-size:13px;padding:11px 20px;border-radius:9px;border:1.5px solid var(--border2);background:transparent;color:var(--t2);cursor:pointer;-webkit-tap-highlight-color:transparent;}.btn-confirm-delete{font-family:var(--fm);font-size:13px;font-weight:500;padding:11px 20px;border-radius:9px;background:var(--red);color:#fff;border:none;cursor:pointer;-webkit-tap-highlight-color:transparent;}
    .modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.88);backdrop-filter:blur(10px);z-index:100;overflow-y:auto;-webkit-overflow-scrolling:touch;padding-bottom:env(safe-area-inset-bottom,24px);}.modal-scroll-inner{min-height:100%;display:flex;align-items:flex-start;justify-content:center;padding:20px 12px 32px;}.rev-modal{background:var(--surf);border:1px solid var(--border2);border-radius:16px;width:100%;max-width:560px;padding:20px;}.rev-modal-title{font-family:var(--fh);font-size:20px;margin-bottom:4px;}.rev-modal-sub{font-size:12px;color:var(--t2);margin-bottom:16px;line-height:1.5;}.rev-dropzone{border:2px dashed var(--border2);border-radius:10px;background:var(--surf2);padding:20px;text-align:center;cursor:pointer;font-size:13px;color:var(--t2);transition:all .2s;-webkit-tap-highlight-color:transparent;touch-action:manipulation;margin-bottom:14px;}.rev-dropzone:hover,.rev-dropzone.over{border-color:var(--amber);background:var(--aglow);color:var(--amber);}.rev-file-list{display:flex;flex-direction:column;gap:10px;margin-bottom:14px;}.rev-file-row{background:var(--surf2);border:1px solid var(--border);border-radius:10px;padding:12px;}.rev-file-row-top{display:flex;align-items:center;gap:8px;margin-bottom:6px;}.rev-file-row.is-new{border-color:rgba(100,180,255,.3);}.rev-file-name-input{flex:1;background:var(--bg);border:1.5px solid var(--border2);border-radius:8px;color:var(--text);font-family:var(--fm);font-size:16px!important;padding:9px 12px;outline:none;-webkit-appearance:none;}.rev-file-name-input:focus{border-color:var(--amber);}.rev-file-badge-new{font-size:9px;background:rgba(100,180,255,.1);color:#6ab4ff;border:1px solid rgba(100,180,255,.25);border-radius:4px;padding:2px 6px;white-space:nowrap;}.rev-file-badge-rev{font-size:9px;background:var(--aglow);color:var(--amber);border:1px solid rgba(232,160,32,.25);border-radius:4px;padding:2px 6px;white-space:nowrap;}.rev-file-ref{font-size:10px;color:var(--t3);font-style:italic;margin-bottom:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.rev-file-remove{width:28px;height:28px;border-radius:50%;border:1px solid var(--border2);background:transparent;color:var(--t3);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;-webkit-tap-highlight-color:transparent;}.rev-file-remove:hover{border-color:var(--red);color:var(--red);}.rev-modal-footer{border-top:1px solid var(--border);padding-top:14px;margin-top:4px;display:flex;align-items:center;gap:10px;}.rev-modal-status{font-size:11px;color:var(--t2);flex:1;}
    .rerun-target{font-size:13px;color:var(--t2);margin-bottom:14px;padding:10px 12px;background:var(--surf2);border-radius:8px;}
    /* TONE GRID — color swatches, X on used */
    .tgm-wrap{background:var(--surf3);border:1px solid var(--border2);border-radius:10px;padding:12px;}
    .tgm-axes{display:flex;font-size:9px;color:var(--t3);letter-spacing:.07em;text-transform:uppercase;margin-bottom:8px;align-items:center;}
    .tgm-row-labels{display:flex;flex-direction:column;gap:4px;margin-right:6px;font-size:9px;color:var(--t3);}
    .tgm-row-labels div{height:36px;display:flex;align-items:center;justify-content:flex-end;white-space:nowrap;}
    .tgm-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;flex:1;}
    .tgm-cell{height:36px;border-radius:7px;border-style:solid;cursor:pointer;display:flex;align-items:center;justify-content:center;position:relative;transition:filter .15s;-webkit-tap-highlight-color:transparent;touch-action:manipulation;}
    .tgm-cell:hover:not(:disabled):not(.used){filter:brightness(1.2);}
    .tgm-cell.active{filter:brightness(1.15);}
    .tgm-tip{margin-top:8px;padding:7px 10px;background:var(--surf2);border-radius:7px;min-height:36px;display:flex;flex-direction:column;gap:2px;}
    .tgm-tip-label{font-size:11px;color:var(--amber);font-weight:500;}.tgm-tip-desc{font-size:10px;color:var(--t2);}
    .tgm-set-all{width:100%;margin-top:8px;padding:9px;border-radius:8px;border:1.5px solid var(--border2);background:transparent;color:var(--t2);font-family:var(--fm);font-size:12px;cursor:pointer;-webkit-tap-highlight-color:transparent;}.tgm-set-all:hover{border-color:var(--amber);color:var(--amber);}
    .btn-amber-sm{font-family:var(--fm);font-size:13px;font-weight:500;padding:8px 16px;border-radius:8px;background:var(--amber);color:#000;border:none;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;}.btn-amber-sm:disabled{opacity:.35;pointer-events:none;}
    @media(min-width:640px){.page{padding:16px 24px 120px;}.ps-waveform-bar,.ps-controls-bar,.td-modal-bar{padding-left:24px;padding-right:24px;}}
.td-master-section{padding:8px 16px 4px;border-top:1px solid var(--border);}
.td-master-label{font-size:9px;letter-spacing:.12em;color:var(--amber);font-weight:600;margin-bottom:6px;text-transform:uppercase;}
.td-master-pills{display:flex;flex-wrap:wrap;gap:4px;}
.td-master-pill{background:transparent;border:1px solid var(--border);border-radius:4px;padding:3px 7px;font-size:10px;color:var(--text-muted);cursor:pointer;display:flex;align-items:center;gap:3px;transition:all .15s;}
.td-master-pill:hover{border-color:var(--amber);color:var(--text);}
.td-master-pill.ready{border-color:var(--amber);color:var(--amber);}
.td-master-pill.active{background:var(--amber);border-color:var(--amber);color:#000;font-weight:600;}
.td-master-pill.pending{border-color:var(--text-muted);color:var(--text-muted);opacity:.6;}
.td-master-pill-short{font-family:monospace;font-size:10px;}
.td-master-pill-status{font-size:9px;}
.td-master-clear{margin-top:6px;background:transparent;border:none;color:var(--text-muted);font-size:10px;cursor:pointer;padding:2px 0;}
.td-master-clear:hover{color:var(--amber);}
@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    <div className="topbar"><div style={{display:'flex',alignItems:'center',gap:6,minWidth:0}}><a href="/" className="logo">maastr<em>.</em></a><span style={{color:'var(--border2)',fontSize:14,flexShrink:0}}>/</span><span className="breadcrumb">{project?.title||'…'}</span></div><div style={{display:'flex',alignItems:'center',gap:8}}><a href="/" className="back">← Dashboard</a>{user&&<NotificationCenter user={user}/>}<div style={{position:'relative'}}>
        <div style={{width:32,height:32,borderRadius:'50%',background:'var(--surf3)',border:'1px solid var(--border2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,color:'var(--t2)',cursor:'pointer'}} onClick={()=>setShowMenu(m=>!m)}>{user?.email?.[0]?.toUpperCase()||'?'}</div>
        {showMenu&&(<>
          <div style={{position:'fixed',inset:0,zIndex:99}} onClick={()=>setShowMenu(false)}/>
          <div style={{position:'absolute',top:'calc(100% + 8px)',right:0,background:'var(--surf2)',border:'1px solid var(--border2)',borderRadius:10,minWidth:180,zIndex:100,overflow:'hidden',boxShadow:'0 8px 32px rgba(0,0,0,.4)'}}>
            <div style={{padding:'10px 14px',borderBottom:'1px solid var(--border)',fontSize:11,color:'var(--t3)'}}>{user?.email}</div>
            <div style={{padding:6}}>
              <button style={{width:'100%',textAlign:'left',padding:'8px 10px',borderRadius:6,border:'none',background:'transparent',color:'var(--t2)',fontFamily:'var(--fm)',fontSize:12,cursor:'pointer'}} onClick={()=>{setShowMenu(false);window.location.href='/account';}}>Account Settings</button>
              <button style={{width:'100%',textAlign:'left',padding:'8px 10px',borderRadius:6,border:'none',background:'transparent',color:'var(--t2)',fontFamily:'var(--fm)',fontSize:12,cursor:'pointer'}} onClick={()=>{setShowMenu(false);window.location.href='/pricing';}}>Pricing &amp; Plans</button>
              <button style={{width:'100%',textAlign:'left',padding:'8px 10px',borderRadius:6,border:'none',background:'transparent',color:'var(--t2)',fontFamily:'var(--fm)',fontSize:12,cursor:'pointer'}} onClick={()=>{setShowMenu(false);window.location.href='/help';}}>Help &amp; FAQ</button>
              <button style={{width:'100%',textAlign:'left',padding:'8px 10px',borderRadius:6,border:'none',background:'transparent',color:'var(--t2)',fontFamily:'var(--fm)',fontSize:12,cursor:'pointer'}} onClick={()=>{setShowMenu(false);window.location.href='/blog';}}>Learning Center</button>
              <button style={{width:'100%',textAlign:'left',padding:'8px 10px',borderRadius:6,border:'none',background:'transparent',color:'var(--t2)',fontFamily:'var(--fm)',fontSize:12,cursor:'pointer'}} onClick={()=>{setShowMenu(false);setShowReport(true);}}>Report a Problem</button>
              <div style={{height:1,background:'var(--border)',margin:'4px 0'}}/>
              <button style={{width:'100%',textAlign:'left',padding:'8px 10px',borderRadius:6,border:'none',background:'transparent',color:'#e05050',fontFamily:'var(--fm)',fontSize:12,cursor:'pointer'}} onClick={()=>{setShowMenu(false);sb.auth.signOut().then(()=>window.location.href='/auth');}}>Sign Out</button>
            </div>
          </div>
        </>)}
      </div></div></div>    <div className="ps-waveform-bar">
      {activeTrack?(<><div className="ps-track-info"><span className="ps-track-name">{activeTrack.title}</span>{activeRevision&&<span className="ps-rev-badge">{activeRevision.label||'v1'}</span>}{(activeRevision?.tone_label||activeTrack.tone_label)&&<span className="ps-tone-badge">{activeRevision?.tone_label||activeTrack.tone_label}</span>}</div><div className="ps-waveform"><Waveform peaks={activeTrack.peaks} progress={progress} notes={notes} duration={duration} onSeek={handleSeek}/><div className="ps-time-row"><span>{fmt(currentTime)}</span><span>{fmt(duration)}</span></div></div></>):(<div className="ps-no-track-top">Tap a track to start listening</div>)}
    </div>
    <div className="page">
      <div className="page-header"><div className="proj-title">{project?.title}</div><div className="proj-artist">{project?.artist}</div><div className="top-actions"><button className="btn-upload-rev" onClick={()=>{setRevFiles([]);setRevStatus('');setShowRevModal(true);}}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>Upload Revisions</button>
          {isOwner&&<button className="btn-upload-rev" style={{background:'var(--surf3)',color:'var(--t2)',border:'1px solid var(--border2)'}} onClick={()=>setShowInvite(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
            Invite Client
          </button>}
          {isOwner&&<button className="btn-upload-rev" style={{background:'var(--surf3)',color:downloadEnabled?'var(--amber)':'var(--t2)',border:'1px solid var(--border2)'}} onClick={async()=>{const nd=!downloadEnabled;setDownloadEnabled(nd);await sb.from('projects').update({downloads_enabled:nd}).eq('id',project.id);}}>
            {downloadEnabled?'Downloads On':'Downloads Off'}
          </button>}</div></div>
      {!isOwner&&activeTrack&&<div style={{padding:'8px 16px 0'}}>
        <button onClick={async()=>{const {data:{user:u}}=await sb.auth.getUser();const p=await sb.from('profiles').select('full_name,email').eq('id',u?.id).single();await fetch('/api/notify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({trackId:activeTrack.id,projectId:project.id,clientName:p.data?.full_name,clientEmail:p.data?.email||u?.email})});alert('Engineer notified!');}} style={{padding:'10px 18px',borderRadius:8,border:'none',background:'var(--amber)',color:'#000',fontFamily:'var(--fm)',fontSize:12,fontWeight:600,cursor:'pointer',width:'100%'}}>
          Ready for Review
        </button>
      </div>}
      <div className="tracks-lbl">{tracks.length} {tracks.length===1?'track':'tracks'}</div>
      <div style={{borderRadius:12,overflow:'hidden',border:'1px solid var(--border)'}}>
        {tracks.map((track,idx)=>(<TrackRow key={track.id} track={track} idx={idx} isActive={activeTrackId===track.id} isPlaying={activeTrackId===track.id&&playing} isMastering={!!(track.revisions?.some(r=>r.is_active&&processingMasters[r.id]))} noteCount={track._noteCount||0} onPlay={playTrack} onDetail={openDetail} onRename={renameTrack} onDeleteTrack={t=>setDeleteTrackConfirm(t)} onDeleteRevision={deleteRevision} onRerunRevision={t=>{setRerunTrack(t);setRerunTone(null);setRerunStatus('');}}/>))}
      </div>
    </div>
    <div className="ps-controls-bar">
      <div className="ps-transport">
        <div className="ps-transport-left"><button className="ps-track-btn" onClick={()=>jumpToTrack(activeIdx-1)} disabled={!activeTrack||activeIdx<=0}><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="19,5 9,12 19,19"/><rect x="5" y="5" width="2.5" height="14" rx="1"/></svg></button><button className="ps-skip-btn" onClick={()=>skip(-10)} disabled={!audioUrl}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.95"/></svg><span className="ps-skip-label">10</span></button></div>
        <div className="ps-transport-center"><button className="ps-play-btn" onClick={togglePlay} disabled={!audioUrl}><svg width="16" height="16" viewBox="0 0 16 16" fill="#000">{playing?<><rect x="3" y="1" width="3.5" height="14" rx="1"/><rect x="9.5" y="1" width="3.5" height="14" rx="1"/></>:<polygon points="3,1 15,8 3,15"/>}</svg></button></div>
        <div className="ps-transport-right"><button className="ps-skip-btn" onClick={()=>skip(10)} disabled={!audioUrl}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.49-3.95"/></svg><span className="ps-skip-label">10</span></button>
            <button onClick={()=>setUseWav(w=>!w)} title={useWav?'WAV':'MP3'} style={{fontFamily:'var(--fm)',fontSize:10,fontWeight:600,padding:'4px 9px',borderRadius:6,border:'1px solid '+(useWav?'var(--amber)':'var(--border2)'),background:'transparent',color:useWav?'var(--amber)':'var(--t3)',cursor:'pointer',letterSpacing:'.05em',marginLeft:8}}>
              {useWav?'WAV':'MP3'}
            </button><button className="ps-track-btn" onClick={()=>jumpToTrack(activeIdx+1)} disabled={!activeTrack||activeIdx<0||activeIdx>=tracks.length-1}><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,5 15,12 5,19"/><rect x="16.5" y="5" width="2.5" height="14" rx="1"/></svg></button></div>
      </div>
    </div>
    <TrackDetail open={!!detailTrack} track={detailTrack||activeTrack} activeRevision={activeRevision} notes={notes} currentTime={currentTime} duration={duration} progress={progress} isPlaying={playing} onTogglePlay={togglePlay} onSkip={skip} onPrevTrack={()=>jumpToTrack(activeIdx-1)} onNextTrack={()=>jumpToTrack(activeIdx+1)} canPrev={activeIdx>0} canNext={activeIdx>=0&&activeIdx<tracks.length-1} onSeek={handleSeek} onClose={()=>setDetailTrack(null)} onPost={postNote} onSeekToTime={seekToTime} onRevisionSelect={selectRevisionInDetail} activeMaster={activeMaster} onMasterSelect={setActiveMaster}/>
    <audio ref={audioRef} preload="metadata" onTimeUpdate={e=>{setCurrentTime(e.target.currentTime);if(typeof navigator!=='undefined'&&'mediaSession' in navigator&&activeTrack){navigator.mediaSession.metadata=new MediaMetadata({title:activeTrack.title||'',artist:project?.artist||'',album:project?.title||'',artwork:project?.image_url?[{src:project.image_url,sizes:'512x512',type:'image/jpeg'}]:[]});navigator.mediaSession.setActionHandler('play',()=>audioRef.current?.play());navigator.mediaSession.setActionHandler('pause',()=>audioRef.current?.pause());}}} onDurationChange={e=>{if(e.target.duration&&isFinite(e.target.duration))setDuration(e.target.duration);}} onEnded={()=>setPlaying(false)} onError={()=>{setDuration(0);setPlaying(false);}}/>
    {deleteTrackConfirm&&(<div className="overlay-bg" onClick={()=>setDeleteTrackConfirm(null)}><div className="confirm-box" onClick={e=>e.stopPropagation()}><div className="confirm-box-title">Delete “{deleteTrackConfirm.title}”?</div><div className="confirm-box-sub">Permanently deletes all revisions and notes. Cannot be undone.</div><div className="confirm-box-actions"><button className="btn-confirm-cancel" onClick={()=>setDeleteTrackConfirm(null)}>Keep it</button><button className="btn-confirm-delete" onClick={()=>deleteTrack(deleteTrackConfirm)}>Delete Forever</button></div></div></div>)}
    {rerunTrack&&(<div className="modal-bg" onClick={e=>e.target===e.currentTarget&&!rerunUploading&&setRerunTrack(null)}><div className="modal-scroll-inner"><div className="rev-modal"><div className="rev-modal-title">Remaster</div><div className="rerun-target">Track: <strong>{rerunTrack.title}</strong></div><p style={{fontSize:12,color:'var(--t2)',marginBottom:12,lineHeight:1.5}}>Choose a new tone setting. Same source audio, new mastering.</p><ToneGrid value={rerunTone} usedTones={rerunUsedTones} onChange={setRerunTone}/><div className="rev-modal-footer"><span className="rev-modal-status">{rerunStatus}</span><button className="btn-ghost-sm" disabled={rerunUploading} onClick={()=>setRerunTrack(null)}>Cancel</button><button className="btn-amber-sm" disabled={rerunTone===null||rerunUploading} onClick={submitRerun}>{rerunUploading?'Processing…':'Remaster'}</button></div></div></div></div>)}
    {showRevModal&&(<div className="modal-bg" onClick={e=>e.target===e.currentTarget&&!revUploading&&setShowRevModal(false)}><div className="modal-scroll-inner"><div className="rev-modal"><div className="rev-modal-title">Upload Revisions</div><div className="rev-modal-sub">Drop files. Matched by name — new names become new tracks.</div><div className={'rev-dropzone'+(revDragging?' over':'')} onDragOver={e=>{e.preventDefault();setRevDragging(true);}} onDragLeave={e=>{e.preventDefault();setRevDragging(false);}} onDrop={e=>{e.preventDefault();e.stopPropagation();setRevDragging(false);addRevFiles(e.dataTransfer?.files||[]);}} onClick={()=>document.getElementById('rev-multi-input').click()}><div style={{fontSize:24,marginBottom:6}}>🎵</div><strong>{revFiles.length>0?'Drop more files':'Drop WAV / MP3 files here'}</strong><br/><span style={{fontSize:11,opacity:.6}}>Multiple files OK — or tap to browse</span><input id="rev-multi-input" type="file" accept=".wav,.mp3,.aiff,.aif,.flac,.m4a,audio/*" multiple style={{display:'none'}} onChange={e=>{addRevFiles(e.target.files);e.target.value='';  }}/></div>{revFiles.length>0&&(<div className="rev-file-list">{revFiles.map((entry,i)=>(<div key={i} className={'rev-file-row'+(entry.isNew?' is-new':'')}><div className="rev-file-row-top"><input className="rev-file-name-input" value={entry.name} onChange={e=>{const n=e.target.value;const m=tracks.find(t=>t.title.toLowerCase()===n.toLowerCase());setRevFiles(prev=>prev.map((r,j)=>j===i?{...r,name:n,matchedTrackId:m?.id||null,isNew:!m}:r));}} placeholder="Track name"/><span className={entry.isNew?'rev-file-badge-new':'rev-file-badge-rev'}>{entry.isNew?'new track':'revision'}</span><button className="rev-file-remove" onClick={()=>setRevFiles(prev=>prev.filter((_,j)=>j!==i))}>×</button></div><div className="rev-file-ref">{entry.file.name} — {(entry.file.size/1024/1024).toFixed(1)} MB{entry.peaksComputed?' — waveform ✓':''}</div><div style={{display:'flex',alignItems:'center',gap:8}}><span style={{fontSize:11,color:'var(--t2)',flexShrink:0}}>Tone:</span><div style={{flex:1}}><ToneGrid value={entry.tone} usedTones={entry.matchedTrackId?tracks.find(t=>t.id===entry.matchedTrackId)?.revisions?.map(r=>r.tone_setting).filter(t=>t!=null)||[]:[]} onChange={t=>setRevFiles(prev=>prev.map((r,j)=>j===i?{...r,tone:t}:r))} showSetAll={revFiles.length>1} onSetAll={t=>setRevFiles(prev=>prev.map(r=>({...r,tone:t})))}/></div></div></div>))}</div>)}<div className="rev-modal-footer"><span className="rev-modal-status">{revStatus}</span><button className="btn-ghost-sm" disabled={revUploading} onClick={()=>setShowRevModal(false)}>Cancel</button><button className="btn-amber-sm" disabled={revFiles.length===0||revUploading||revFiles.some(e=>!e.name.trim())} onClick={submitRevisions}>{revUploading?revStatus||'Uploading…':'Upload '+revFiles.length+' file'+(revFiles.length!==1?'s':'')}</button></div></div></div></div>)}
      {showReport&&(<>
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.7)',zIndex:200}} onClick={()=>{setShowReport(false);setReportSent(false);setReportMsg('');}}/>
        <div style={{position:'fixed',top:'50%',left:'50%',transform:'translate(-50%,-50%)',background:'var(--surf)',border:'1px solid var(--border2)',borderRadius:14,padding:28,width:360,maxWidth:'90vw',zIndex:201}}>
          <div style={{fontFamily:'var(--fh)',fontSize:18,marginBottom:8}}>Report a Problem</div>
          <div style={{fontSize:12,color:'var(--t2)',marginBottom:16,lineHeight:1.6}}>Found a bug or something not working? Let us know.</div>
          {reportSent
            ? <div style={{textAlign:'center',padding:'20px 0'}}>
                <div style={{fontSize:24,marginBottom:8}}>✓</div>
                <div style={{fontSize:13,color:'var(--amber)'}}>Thanks — we got it.</div>
                <button onClick={()=>{setShowReport(false);setReportSent(false);setReportMsg('');}} style={{marginTop:16,padding:'8px 20px',borderRadius:8,border:'1px solid var(--border2)',background:'transparent',color:'var(--t2)',fontFamily:'var(--fm)',fontSize:12,cursor:'pointer'}}>Close</button>
              </div>
            : <>
                <textarea value={reportMsg} onChange={e=>setReportMsg(e.target.value)} placeholder="Describe what happened..." rows={4} style={{width:'100%',background:'var(--surf2)',border:'1px solid var(--border2)',borderRadius:8,padding:'10px 12px',color:'var(--text)',fontFamily:'var(--fm)',fontSize:13,outline:'none',marginBottom:16,boxSizing:'border-box',resize:'vertical'}}/>
                <div style={{display:'flex',gap:8}}>
                  <button disabled={!reportMsg.trim()} onClick={async()=>{await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer re_iNpbuq91_7d7zFDeP4tpHVsAQUCxTVnqf'},body:JSON.stringify({from:'maastr <onboarding@resend.dev>',to:['jay@jaymaas.com'],subject:'maastr bug report from '+user?.email,html:'<p>'+reportMsg.replace(/\n/g,'<br>')+'</p><p style="color:#888">From: '+user?.email+'</p>'})});setReportSent(true);}} style={{flex:1,padding:'10px',borderRadius:8,border:'none',background:'var(--amber)',color:'#000',fontFamily:'var(--fm)',fontSize:13,fontWeight:600,cursor:'pointer',opacity:reportMsg.trim()?1:0.4}}>Send Report</button>
                  <button onClick={()=>{setShowReport(false);setReportMsg('');}} style={{padding:'10px 16px',borderRadius:8,border:'1px solid var(--border2)',background:'transparent',color:'var(--t2)',fontFamily:'var(--fm)',fontSize:13,cursor:'pointer'}}>Cancel</button>
                </div>
              </>
          }
        </div>
      </>)}
      {showInvite&&(<>
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.7)',zIndex:200}} onClick={()=>setShowInvite(false)}/>
        <div style={{position:'fixed',top:'50%',left:'50%',transform:'translate(-50%,-50%)',background:'var(--surf)',border:'1px solid var(--border2)',borderRadius:14,padding:28,width:340,maxWidth:'90vw',zIndex:201}}>
          <div style={{fontFamily:'var(--fh)',fontSize:18,marginBottom:16}}>Invite Client</div>
          <div style={{fontSize:11,color:'var(--t3)',marginBottom:6,letterSpacing:'.05em',textTransform:'uppercase'}}>Client Email</div>
          <input value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} placeholder="client@example.com" style={{width:'100%',background:'var(--surf2)',border:'1px solid var(--border2)',borderRadius:8,padding:'10px 12px',color:'var(--text)',fontFamily:'var(--fm)',fontSize:13,outline:'none',marginBottom:12,boxSizing:'border-box'}}/>
          <div style={{fontSize:11,color:'var(--t3)',marginBottom:6,letterSpacing:'.05em',textTransform:'uppercase'}}>Message (optional)</div>
          <textarea value={inviteMsg} onChange={e=>setInviteMsg(e.target.value)} placeholder="Here is the master for your review..." rows={3} style={{width:'100%',background:'var(--surf2)',border:'1px solid var(--border2)',borderRadius:8,padding:'10px 12px',color:'var(--text)',fontFamily:'var(--fm)',fontSize:13,outline:'none',marginBottom:16,boxSizing:'border-box',resize:'vertical'}}/>
          {inviteDone&&<div style={{fontSize:12,color:inviteDone.startsWith('Error')?'#e05050':'var(--amber)',marginBottom:12}}>{inviteDone}</div>}
          <div style={{display:'flex',gap:8}}>
            <button disabled={inviteSending||!inviteEmail} onClick={async()=>{setInviteSending(true);setInviteDone('');const {data:{user:u}}=await sb.auth.getUser();const res=await fetch('/api/invite',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:project.id,invitedEmail:inviteEmail,invitedBy:u.id,message:inviteMsg})});const d=await res.json();setInviteSending(false);if(d.ok){setInviteDone('Invite sent!');setInviteEmail('');setInviteMsg('');}else setInviteDone('Error: '+(d.error||'Unknown'));}} style={{flex:1,padding:'10px',borderRadius:8,border:'none',background:'var(--amber)',color:'#000',fontFamily:'var(--fm)',fontSize:13,fontWeight:600,cursor:'pointer',opacity:inviteSending||!inviteEmail?.includes('@')?0.5:1}}>
              {inviteSending?'Sending...':'Send Invite'}
            </button>
            <button onClick={()=>{setShowInvite(false);setInviteDone('');}} style={{padding:'10px 16px',borderRadius:8,border:'1px solid var(--border2)',background:'transparent',color:'var(--t2)',fontFamily:'var(--fm)',fontSize:13,cursor:'pointer'}}>Cancel</button>
          </div>
        </div>
      </>)}
  </>);}
