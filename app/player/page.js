'use client';
import { useEffect, useState, useRef, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { sb, UPLOAD_WORKER_URL } from '@/lib/supabase';
import { useUpload } from '@/app/context/UploadContext';
import NotificationCenter from '@/app/components/NotificationCenter';

function fmt(s){if(!s||isNaN(s))return'0:00';return Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0');}
function sanitize(n){return n.replace(/[^a-zA-Z0-9._-]/g,'_');}
function fmtDate(d){if(!d)return'';const dt=new Date(d);const m=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];const h=dt.getHours();const min=dt.getMinutes().toString().padStart(2,'0');const ampm=h>=12?'PM':'AM';const h12=h%12||12;return m[dt.getMonth()]+' '+dt.getDate()+', '+h12+':'+min+' '+ampm;}
const TONES=[
  {label:'Warm + Loud',short:'W+L',desc:'Rich low end, maximum punch.'},
  {label:'Neutral + Loud',short:'N+L',desc:'Balanced and loud.'},
  {label:'Bright + Loud',short:'B+L',desc:'Aggressive and forward.'},
  {label:'Warm + Normal',short:'W+N',desc:'Warm, rich and cinematic.'},
  {label:'Neutral + Normal',short:'N+N',desc:'Balanced for all genres.'},
  {label:'Bright + Normal',short:'B+N',desc:'Clear and present.'},
  {label:'Warm + Gentle',short:'W+S',desc:'Warm and intimate.'},
  {label:'Neutral + Gentle',short:'N+S',desc:'Natural dynamics.'},
  {label:'Bright + Gentle',short:'B+S',desc:'Airy and delicate.'}
];
/* Brighter color swatches  warmth (col) x loudness (row opacity) */
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
const MARKER_COLORS = ['#fbbf24','#60a5fa','#a78bfa','#f472b6','#34d399','#fb923c','#38bdf8','#c084fc'];
function getUserColor(name) {
  if (!name) return MARKER_COLORS[0];
  let h = 0;
  for (let i = 0; i < name.length; i++) { h = name.charCodeAt(i) + ((h << 5) - h); h = h & h; }
  return MARKER_COLORS[Math.abs(h) % MARKER_COLORS.length];
}

function Waveform({peaks, progress, notes, duration, onSeek}) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const progressRef = useRef(progress);
  const roRef = useRef(null);

  // Keep progress ref current without re-running full draw
  useEffect(() => { progressRef.current = progress; }, [progress]);

  // Main draw effect  runs on mount and when peaks change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let running = true;

    function draw() {
      if (!running) return;
      const dpr = window.devicePixelRatio || 1;
      const W = canvas.parentElement ? canvas.parentElement.clientWidth : 600;
      const H = 150;
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
      ctx.fillText('Processing audio wont be long', W / 2, H / 2);
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
        const alpha = played ? 1 : 0.5;
        // Upper bar gradient
        const grad = ctx.createLinearGradient(0, cy - h, 0, cy);
        grad.addColorStop(0, played ? 'rgba(232,160,32,'+alpha+')' : 'rgba(200,140,30,'+alpha+')');
        grad.addColorStop(1, played ? 'rgba(220,148,28,'+alpha+')' : 'rgba(195,135,25,'+alpha+')');
        ctx.fillStyle = grad;
        ctx.fillRect(i * STEP, cy - h, BAR, h);
        // Reflection
        const rGrad = ctx.createLinearGradient(0, cy, 0, cy + h * 0.8);
        rGrad.addColorStop(0, 'rgba(232,160,32,'+(alpha*0.75)+')');
        rGrad.addColorStop(1, 'rgba(232,160,32,'+(alpha*0.15)+')');
        ctx.fillStyle = rGrad;
        ctx.fillRect(i * STEP, cy, BAR, h * 0.8);
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

      


      ctx.setTransform(1, 0, 0, 1, 0, 0);
      rafRef.current = requestAnimationFrame(draw);
    }

    draw();

    // ResizeObserver  just let the draw loop handle resize naturally
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
      <canvas ref={canvasRef} style={{display:'block',width:'100%',height:'150px'}}/>
      {notes && duration > 0 && (
        <div style={{position:'absolute',top:0,left:0,right:0,bottom:0,pointerEvents:'none'}}>
          {notes.filter(n => !n.resolved).map(note => {
            if (!note.timestamp_sec) return null;
            const pct = (note.timestamp_sec / duration) * 100;
            const color = getUserColor(note.author_name);
            return (
              <div key={note.id} data-note-id={note.id} data-ts={note.timestamp_sec} style={{position:'absolute',left:pct+'%',top:0,bottom:0,transform:'translateX(-50%)',width:'44px',display:'flex',flexDirection:'column',alignItems:'center',pointerEvents:'auto',cursor:'pointer',paddingTop:'4px'}}>
                <div style={{width:'12px',height:'12px',borderRadius:'50%',background:color,border:'2px solid rgba(0,0,0,0.4)',boxShadow:'0 1px 3px rgba(0,0,0,0.3)',flexShrink:0,zIndex:2}}/>
                <div style={{width:'1.5px',flex:1,background:`linear-gradient(to bottom, ${color} 0%, transparent 100%)`,opacity:0.25,marginTop:'2px'}}/>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FixedDropdown({anchorRef,open,onClose,children}){const [pos,setPos]=useState({top:0,right:0});function recalc(){if(!anchorRef.current)return;const rect=anchorRef.current.getBoundingClientRect();setPos({top:rect.bottom+4,right:window.innerWidth-rect.right});}useEffect(()=>{if(!open)return;recalc();window.addEventListener('scroll',recalc,true);return()=>{window.removeEventListener('scroll',recalc,true);};},[open]);if(!open)return null;return(<><div style={{position:'fixed',inset:0,zIndex:998,background:'transparent'}} onClick={onClose}/><div style={{position:'fixed',top:pos.top,right:pos.right,zIndex:999,background:'var(--surf2)',border:'1px solid var(--border2)',borderRadius:10,minWidth:176,boxShadow:'0 8px 40px rgba(0,0,0,.6)',overflow:'hidden'}}>{children}</div></>);}

/* ToneGrid  bright color swatches, no text in cells, X through used (color kept) */
function ToneGrid({value,usedTones=[],onChange,onSetAll,showSetAll}){
  const [hov,setHov]=useState(null);
  const tip=TONES[hov!=null?hov:value!=null?value:DEFAULT_TONE];
  return(<div className="tgm-wrap">
    <div className="tgm-axes"><span> Warmer</span><span style={{margin:'0 auto',color:'var(--amber)',fontWeight:500,fontSize:10}}>TONE GRID</span><span>Brighter </span></div>
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
    {usedTones.length>0&&<div style={{fontSize:10,color:'var(--t3)',marginTop:6}}> Already mastered  crossed cells unavailable</div>}
    {showSetAll&&<button className="tgm-set-all" onClick={()=>onSetAll&&onSetAll(value)}>Apply to all tracks</button>}
  </div>);}

function TrackDetail({open,track,notes,currentTime,duration,progress,isPlaying,onTogglePlay,onSkip,onPrevTrack,onNextTrack,canPrev,canNext,onSeek,onClose,onPost,onSeekToTime,activeMaster,...rest}){
  const [noteText,setNoteText]=useState('');const [posting,setPosting]=useState(false);const [composing,setComposing]=useState(typeof window!=='undefined'&&window.innerWidth>768);const [lockedTime,setLockedTime]=useState(currentTime);const inputRef=useRef(null);const autoPausedRef=useRef(false);
  useEffect(()=>{setLockedTime(currentTime);},[currentTime,composing,isPlaying]);
  async function handlePost(){if(!noteText.trim()||posting)return;setPosting(true);await onPost(noteText.trim(),lockedTime);setNoteText('');setComposing(typeof window!=='undefined'&&window.innerWidth>768);setPosting(false);if(autoPausedRef.current){autoPausedRef.current=false;onTogglePlay();}}
  function startCompose(){setLockedTime(currentTime);if(isPlaying){onTogglePlay();autoPausedRef.current=true;}setComposing(true);setTimeout(()=>inputRef.current?.focus(),80);}
  if(!open)return null;
  return(<>
    <div className={'td-backdrop'+(open?' td-open':'')} onClick={onClose}/>
    <div className={'td-modal'+(open?' td-open':'')}>
      <div className="td-header">
        <button className="td-close" onClick={onClose}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        <div className="td-track-name">{track?.title}</div>
        {notes.length>0&&<span className="td-count">{notes.length} comment{notes.length!==1?'s':''}</span>}
      </div>
      <div className="td-wave-section"><Waveform peaks={activeMaster?.peaks||track?.peaks} progress={progress} notes={notes} duration={duration} onSeek={onSeek}/><div className="td-time-row"><span>{fmt(currentTime)}</span><span>{fmt(duration)}</span></div></div>
      <div className="td-compose">
        {composing?(<div className="td-compose-active">
          <textarea ref={inputRef} className="td-compose-textarea" value={noteText} onChange={e=>setNoteText(e.target.value)} placeholder={"Comment at "+fmt(lockedTime)} rows={2} autoFocus onKeyDown={e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey))handlePost();}}/>
          <div className="td-compose-bar"><div className="td-compose-left"><button className="td-mini-btn" onClick={e=>{e.stopPropagation();onSkip(-10);setLockedTime(prev=>Math.max(0,prev-10));}}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg></button><button className={"td-mini-btn"+(isPlaying?" td-mini-play-active":"")} onClick={e=>{e.stopPropagation();onTogglePlay();}}>{isPlaying?<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>:<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,3 20,12 6,21"/></svg>}</button><div className="td-compose-ts"><svg width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="none" stroke="currentColor" strokeWidth="1.5"/><line x1="5" y1="3" x2="5" y2="5.5" stroke="currentColor" strokeWidth="1.2"/><line x1="5" y1="5.5" x2="6.5" y2="5.5" stroke="currentColor" strokeWidth="1.2"/></svg>{fmt(lockedTime)}</div></div><div style={{display:'flex',gap:8}}><button className="td-btn-cancel" onClick={()=>{setNoteText('');setComposing(false);if(autoPausedRef.current){autoPausedRef.current=false;onTogglePlay();}}}>Cancel</button><button className="td-btn-post" onClick={handlePost} disabled={posting}>{posting?'Posting...':'Post'}</button></div></div>
        </div>):(<button className="td-compose-trigger" onClick={startCompose}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Add comment at {fmt(currentTime)}</button>)}
      </div>
      <div className="td-comments-scroll">
        {notes.length>0?notes.map(n=>(<div key={n.id} className="td-comment-card" onClick={()=>n.timestamp_sec!=null&&onSeekToTime(n.timestamp_sec)}>
          <div className="td-comment-meta"><div className="td-comment-avatar">{(n.author_name||'Y')[0].toUpperCase()}</div><span className="td-comment-name">{n.author_name||'You'}</span>{n.timestamp_sec!=null&&<span className="td-comment-ts">{n.timestamp_label||fmt(n.timestamp_sec)}</span>}<span className="td-comment-date">{new Date(n.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</span></div>
          <div className="td-comment-text">{n.body}</div>
        </div>)):(<div className="td-empty"><div className="td-empty-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div><div className="td-empty-title">No comments yet</div><div className="td-empty-sub">Play the track and leave feedback at any moment</div></div>)}
      </div>
      <div className="td-transport"><button className="td-tbtn" onClick={onPrevTrack} disabled={!canPrev}><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="19,20 9,12 19,4"/><rect x="5" y="4" width="3" height="16"/></svg></button><button className="td-tbtn" onClick={()=>onSkip(-10)}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg><span className="td-skip-num">10</span></button><button className="td-play-btn" onClick={onTogglePlay}>{isPlaying?<svg width="22" height="22" viewBox="0 0 24 24" fill="#000"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>:<svg width="22" height="22" viewBox="0 0 24 24" fill="#000"><polygon points="6,3 20,12 6,21"/></svg>}</button><button className="td-tbtn" onClick={()=>onSkip(10)}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10"/></svg><span className="td-skip-num">10</span></button><button className="td-tbtn" onClick={onNextTrack} disabled={!canNext}><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,4 15,12 5,20"/><rect x="16" y="4" width="3" height="16"/></svg></button></div>
    </div>
  </>);}

function RevisionPill({revisions,activeRevisionId,onSwitchRevision}){
  const activeRev=revisions.find(r=>r.id===activeRevisionId)||revisions[0];
  const btnRef=useRef(null);
  const [open,setOpen]=useState(false);
  return(<div style={{position:'relative',display:'flex',alignItems:'center'}}>
    <button ref={btnRef} onClick={e=>{e.stopPropagation();setOpen(o=>!o);}}
      style={{height:44,padding:'0 8px',border:'none',background:'transparent',color:'var(--t2)',fontFamily:'var(--fm)',fontSize:11,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',gap:3,flexShrink:0,WebkitTapHighlightColor:'transparent',letterSpacing:'0.03em'}}>
      {activeRev?.label||'v1'}
      <svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor" style={{opacity:.5}}><path d="M1 3l4 4 4-4"/></svg>
    </button>
    <FixedDropdown anchorRef={btnRef} open={open} onClose={()=>setOpen(false)}>
      {revisions.map(rev=>(
        <button key={rev.id} className={'tdrop-item'+(rev.id===activeRev?.id?' tdrop-item-active':'')}
          onClick={()=>{onSwitchRevision(rev);setOpen(false);}}>
          <span style={{fontWeight:600,minWidth:24}}>{rev.label||('v'+(rev.version_number||'?'))}</span>
          <span style={{opacity:.5,fontSize:10,marginLeft:4}}>{fmtDate(rev.created_at)}</span>
        </button>
      ))}
    </FixedDropdown>
  </div>);}
function TrackRow({track,idx,isActive,isPlaying,noteCount,onPlay,onDetail,onRename,onDeleteTrack,onDeleteRevision,onRerunRevision,isMastering,activeTone,onOpenToneModal,onSwitchRevision,activeRevisionId}){
  const [menuOpen,setMenuOpen]=useState(false);const [renaming,setRenaming]=useState(false);const [renameVal,setRenameVal]=useState(track.title||'');const menuBtnRef=useRef(null);
  const revisions=[...(track.revisions||[])].sort((a,b)=>(b.version_number||0)-(a.version_number||0));const revCount=revisions.length;
  const [revDeleteOpen,setRevDeleteOpen]=useState(false);const [deleteRevStep,setDeleteRevStep]=useState(0);const [deleteRevTarget,setDeleteRevTarget]=useState(null);
  async function saveRename(){const v=renameVal.trim();if(v&&v!==track.title)await onRename(track.id,v);setRenaming(false);}
  function cancelRename(){setRenameVal(track.title||'');setRenaming(false);}
  if(!track.hls_url){return(<div className="tr-row" style={{opacity:.45,cursor:'default',pointerEvents:'none'}}><div className="tr-play-zone"><div className="tr-num-play">{idx+1}</div><div className="tr-info"><span className="tr-name">{track.title||'Track '+(idx+1)}</span><span style={{fontSize:'10px',color:'rgba(255,255,255,.35)',display:'flex',alignItems:'center',gap:4}}><span style={{width:5,height:5,borderRadius:'50%',background:'rgba(255,255,255,.3)',display:'inline-block',animation:'pulse 1.2s ease-in-out infinite'}}/>Encoding audio</span></div></div></div>);}
return(<div className={'tr-row'+(isActive?' tr-active':'')}>
    {renaming?(<div className="tr-rename" onClick={e=>e.stopPropagation()}><input className="tr-rename-input" value={renameVal} autoFocus onChange={e=>setRenameVal(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')saveRename();if(e.key==='Escape')cancelRename();}}/><button className="tr-rename-save" onClick={saveRename}>Save</button><button className="tr-rename-cancel" onClick={cancelRename}>Cancel</button></div>):(<>
      <div className="tr-play-zone" onClick={()=>!isMastering&&onPlay(track.id)} style={{cursor:isMastering?'default':undefined}}>
        <div className="tr-num-play">{isPlaying?(<svg className="tr-playing-icon" width="14" height="14" viewBox="0 0 14 14" fill="var(--amber)"><rect x="1" y="1" width="4" height="12" rx="1"/><rect x="9" y="1" width="4" height="12" rx="1"/></svg>):(<span className="tr-idx">{idx+1}</span>)}</div>
        <div className="tr-info"><span className="tr-name">{track.title}</span><div className="tr-meta">{isMastering&&<span style={{display:'flex',alignItems:'center',gap:4,fontSize:11,color:'var(--gold)',fontWeight:600,letterSpacing:'0.02em'}}><svg style={{animation:'spin 1s linear infinite',flexShrink:0}} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>Mastering</span>}{revisions.length>0&&(()=>{const _ar=revisions.find(r=>r.id===activeRevisionId)||revisions[0];return _ar?.created_at?<span className="tr-rev">{fmtDate(_ar.created_at)}</span>:null;})()}</div></div>
      </div>
      <div className="tr-actions">
        <button className="tr-comment-btn" onClick={e=>{e.stopPropagation();onDetail(track);}}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>{noteCount>0&&<span className="tr-note-count">{noteCount}</span>}</button>
        {revisions.length>1&&onSwitchRevision&&<RevisionPill revisions={revisions} activeRevisionId={activeRevisionId} onSwitchRevision={onSwitchRevision}/>}
        {onOpenToneModal&&activeTone&&<button onClick={e=>{e.stopPropagation();onOpenToneModal(track);}} title="Mastering settings" style={{width:40,height:44,borderRadius:9,border:'none',background:'transparent',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',WebkitTapHighlightColor:'transparent',padding:4,flexShrink:0}}><div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:1.5,width:24,height:24,borderRadius:3,overflow:'hidden',border:'1px solid rgba(255,255,255,0.12)'}}>{TONE_BG.map((bg,i)=><div key={i} style={{background:bg,opacity:TONES[i].short===activeTone?1:0.22}}/>)}</div></button>}<div style={{position:'relative'}}><button ref={menuBtnRef} className="tr-menu-btn" onClick={e=>{e.stopPropagation();setMenuOpen(o=>!o);}}><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg></button>
          <FixedDropdown anchorRef={menuBtnRef} open={menuOpen} onClose={()=>setMenuOpen(false)}>
            <button className="tdrop-item" onClick={()=>{setMenuOpen(false);setRenameVal(track.title||'');setRenaming(true);}}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Rename Track</button>
            
            {revCount>1&&<button className="tdrop-item" onClick={()=>{setMenuOpen(false);setDeleteRevStep(0);setDeleteRevTarget(null);setRevDeleteOpen(true);}}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>Delete a Revision</button>}
            <div className="tdrop-divider"/>
            <button className="tdrop-item danger" onClick={()=>{setMenuOpen(false);onDeleteTrack(track);}}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>Delete Track</button>
          </FixedDropdown>
        </div>
      </div>
    </>)}
    {revDeleteOpen&&(<div className="rev-action-panel" onClick={e=>e.stopPropagation()}>{deleteRevStep===1&&deleteRevTarget?(<div className="rev-del-confirm"><div className="rev-del-confirm-title">Delete {deleteRevTarget.label||('v'+(deleteRevTarget.version_number||'?'))}?</div><div className="rev-del-confirm-sub">Permanently deletes this revision and all its notes.</div><div className="rev-del-actions"><button className="btn-ghost-sm" onClick={()=>{setDeleteRevStep(0);setDeleteRevTarget(null);}}>Cancel</button><button className="btn-delete-sm" onClick={()=>{onDeleteRevision(deleteRevTarget,track);setRevDeleteOpen(false);setDeleteRevTarget(null);setDeleteRevStep(0);}}>Delete Forever</button></div></div>):(<><div className="rev-action-label">Which revision to delete?</div>{revisions.map(rev=>(<button key={rev.id} className="rev-del-row" onClick={()=>{setDeleteRevTarget(rev);setDeleteRevStep(1);}}><span className="rev-del-row-label">{rev.label||('v'+(rev.version_number||'?'))}</span>{rev.tone_label&&<span className="rev-del-row-tone">{rev.tone_label}</span>}<span className="rev-del-row-date">{fmtDate(rev.created_at)}</span>{rev.is_active&&<span className="rev-del-row-active">current</span>}</button>))}<button className="btn-ghost-sm" style={{width:'100%',marginTop:8}} onClick={()=>{setRevDeleteOpen(false);setDeleteRevTarget(null);}}>Cancel</button></>)}</div>)}
  </div>);}
function ToneSwitcher({rerunTrack,rerunTone,setRerunTone,setRerunTrack,activeMaster,project,setActiveMaster,setActiveSource,setPendingAutoActivate}){
  if(!rerunTrack)return null;

  // The active revision for THIS track — the source file that will be processed
  const rev=rerunTrack.revisions?.find(r=>r.is_active)||rerunTrack.revisions?.[rerunTrack.revisions.length-1];
  if(!rev)return null;

  // Which preset is currently active (what the player is on)
  const activePreset=activeMaster?.preset||rev.tone_label||rerunTrack.tone_label;

  // The tone the user has tapped in the grid
  const selTone=TONES.find(t=>t.short===rerunTone);

  // If the selected preset already has a ready master for this revision, we can switch instantly
  const readyMaster=rerunTone?rev.masters?.find(m=>m.preset===rerunTone&&m.status==='ready'):null;

  const btnLabel=!rerunTone?'Select a tone':readyMaster?'Switch to '+(selTone?.label||rerunTone):'Master with '+(selTone?.label||rerunTone);

  function close(){setRerunTrack(null);setRerunTone(null);}

  function handleConfirm(){
    if(!rerunTone)return;
    if(readyMaster){
      // Already processed — instant switch, no NC needed
      setActiveMaster(readyMaster);
      setActiveSource('master');
      close();
      return;
    }
    // New preset — close immediately, open NC, fire mastering in background
    close();
    if(window.nc_openToUploads)window.nc_openToUploads();
    setTimeout(async()=>{
      try{
        const res=await fetch('/api/request-master',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({revisionId:rev.id,projectId:project.id,preset:rerunTone})
        });
        const data=await res.json();
        if(data.masterId){
          if(setPendingAutoActivate)setPendingAutoActivate({preset:rerunTone,revisionId:rev.id});
          if(window.nc_startMaster)window.nc_startMaster(data.masterId,rerunTrack.title,project.id,50*1024*1024);
        }
      }catch(e){console.error('[ToneSwitcher] request-master failed:',e.message);}
    },0);
  }

  return(<>
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.85)',zIndex:200}} onClick={close}/>
    <div style={{position:'fixed',top:'50%',left:'50%',transform:'translate(-50%,-50%)',background:'var(--surf)',border:'1px solid var(--border2)',borderRadius:16,padding:24,width:360,maxWidth:'90vw',zIndex:201}}>
      <div style={{fontFamily:'var(--fh)',fontSize:18,marginBottom:4}}>Mastering</div>
      <div style={{fontSize:11,color:'var(--t3)',marginBottom:16}}>Track: <strong style={{color:'var(--text)'}}>{rerunTrack.title}</strong></div>
      <div style={{fontSize:9,color:'var(--t3)',marginBottom:4}}>Revision: <strong style={{color:'var(--t2)'}}>{rev.label||'v1'}</strong></div>
      <div style={{display:'flex',fontSize:9,color:'var(--t3)',letterSpacing:'.07em',textTransform:'uppercase',marginBottom:8,alignItems:'center'}}>
        <span>Warmer</span><span style={{margin:'0 auto',color:'var(--amber)',fontWeight:500,fontSize:10}}>TONE GRID</span><span>Brighter</span>
      </div>
      <div style={{display:'flex',gap:6,alignItems:'flex-start'}}>
        <div style={{display:'flex',flexDirection:'column',gap:4,marginRight:6,fontSize:9,color:'var(--t3)'}}>
          {['Louder','Normal','Gentler'].map(l=><div key={l} style={{height:44,display:'flex',alignItems:'center',justifyContent:'flex-end',whiteSpace:'nowrap'}}>{l}</div>)}
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:5,flex:1}}>
          {TONES.map((t,i)=>{
            const isCurrent=t.short===activePreset;
            const isReady=rev.masters?.find(m=>m.preset===t.short&&m.status==='ready');
            const isSel=rerunTone===t.short;
            const opacity=isSel?1:isCurrent?1:isReady?0.75:0.32;
            return(<button key={i} onClick={()=>!isCurrent&&setRerunTone(t.short)}
              style={{height:44,borderRadius:8,border:isSel?('2.5px solid '+TONE_BORDER[i]):'1.5px solid rgba(0,0,0,0.2)',background:TONE_BG[i],opacity,cursor:isCurrent?'default':'pointer',position:'relative',display:'flex',alignItems:'center',justifyContent:'center',transition:'opacity .15s',WebkitTapHighlightColor:'transparent'}}>
              {isCurrent&&<div style={{width:8,height:8,borderRadius:'50%',background:'rgba(255,255,255,.95)',boxShadow:'0 0 0 2px rgba(0,0,0,.35)'}}/>}
              {isReady&&!isCurrent&&<svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{position:'absolute'}}><circle cx="8" cy="8" r="7" fill="rgba(0,0,0,.35)"/><polyline points="4,8.5 6.5,11 12,5.5" stroke="rgba(255,255,255,.95)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            </button>);
          })}
        </div>
      </div>
      {selTone&&<div style={{marginTop:10,padding:'8px 10px',background:'var(--surf2)',borderRadius:8}}><div style={{fontSize:11,color:'var(--amber)',fontWeight:500}}>{selTone.label}</div><div style={{fontSize:10,color:'var(--t2)',marginTop:2}}>{selTone.desc}</div></div>}
      <div style={{marginTop:8,fontSize:10,color:'var(--t3)',display:'flex',gap:16}}>
        <span>● current</span>
        <span style={{display:'flex',alignItems:'center',gap:3}}><svg width="11" height="11" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" fill="rgba(255,255,255,.15)"/><polyline points="4,8.5 6.5,11 12,5.5" stroke="rgba(255,255,255,.7)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>already done</span>
      </div>
      <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}}>
        <button onClick={close} style={{padding:'10px 16px',borderRadius:8,border:'1px solid var(--border2)',background:'transparent',color:'var(--t2)',fontFamily:'var(--fm)',fontSize:13,cursor:'pointer'}}>Cancel</button>
        <button disabled={!rerunTone} onClick={handleConfirm} style={{padding:'10px 20px',borderRadius:8,border:'none',background:!rerunTone?'var(--surf3)':'var(--amber)',color:!rerunTone?'var(--t3)':'#000',fontFamily:'var(--fm)',fontSize:13,fontWeight:600,cursor:!rerunTone?'default':'pointer'}}>{btnLabel}</button>
      </div>
    </div>
  </>);
}
function Player(){
  const router = useRouter();
  const searchParams = useSearchParams();
  const teleportedFor = useRef(null);
  const seekVersionRef = useRef(0);
  const [user,setUser]=useState(null);const { startRevisionUploads } = useUpload();
  const [project,setProject]=useState(null);const [tracks,setTracks]=useState([]);
  useEffect(()=>{
    if(tracks.length===0||tracks.every(t=>t.peaks&&t.peaks.length>=4)) return;
    const timer=setInterval(async()=>{
      const {data}=await sb.from('tracks').select('id,peaks,duration').in('id',tracks.map(t=>t.id));
      if(!data) return;
      setTracks(prev=>prev.map(t=>{const f=data.find(d=>d.id===t.id);return f?{...t,peaks:f.peaks,duration:f.duration}:t;}));
      if(data.every(t=>t.peaks&&t.peaks.length>=4)) clearInterval(timer);
    },3000);
    return ()=>clearInterval(timer);
  },[tracks.length]);
  useEffect(()=>{tracks.forEach(t=>{if(t.duration>0||!t.audio_url)return;const a=new Audio();a.preload='metadata';a.src=t.audio_url;a.addEventListener('loadedmetadata',()=>{const dur=Math.round(a.duration);if(dur>0){sb.from('tracks').update({duration:dur}).eq('id',t.id);setTracks(prev=>prev.map(tr=>tr.id===t.id?{...tr,duration:dur}:tr));}});});},[tracks.length]);
  const [activeTrackId,setActiveTrackId]=useState(null);const [activeRevision,setActiveRevision]=useState(null);const [activeMaster,setActiveMaster]=useState(null);const [selectedRevisions,setSelectedRevisions]=useState({});const [notes,setNotes]=useState([]);const [playing,setPlaying]=useState(false);const [currentTime,setCurrentTime]=useState(0);const [duration,setDuration]=useState(0);
  const [pendingSeek,setPendingSeek]=useState(null);const audioRef=useRef(null);
  const [detailTrack,setDetailTrack]=useState(null);const [projEditing,setProjEditing]=useState(false);const [editTitle,setEditTitle]=useState('');const [editArtist,setEditArtist]=useState('');const [collabOpen,setCollabOpen]=useState(false);const [collabInviting,setCollabInviting]=useState(false);const [collabEmail,setCollabEmail]=useState('');const [collabMsg,setCollabMsg]=useState('');const [collabSending,setCollabSending]=useState(false);const [collaborators,setCollaborators]=useState([]);
  const [collabDeleting, setCollabDeleting] = useState(null);
  const [collabMenuOpen, setCollabMenuOpen] = useState(null);
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
  const [activeSource,setActiveSource]=useState('mix');
  const [useWav,setUseWav]=useState(false);
  const [showReport,setShowReport]=useState(false);
  const [pendingAutoActivate,setPendingAutoActivate]=useState(null);
  const [reportMsg,setReportMsg]=useState('');
  const [reportSent,setReportSent]=useState(false);
  useEffect(()=>{sb.auth.getSession().then(({data:{session}})=>{if(!session){window.location.href='/auth';return;}setUser(session.user);const pid=new URLSearchParams(window.location.search).get('project');const _sp=new URLSearchParams(window.location.search);const _trackId=_sp.get('track');const _tSec=_sp.get('t');if(!pid){window.location.href='/';return;}loadProject(pid,_trackId,_tSec);});},[]);

  useEffect(()=>{
    if(!project?.id) return;
    let interval;
    let _prevCount=-1;
    const poll=async()=>{
      const {data}=await sb.from('masters').select('id,status,revision_id').eq('project_id',project.id).in('status',['pending','processing']);
      const count=data?.length||0;
      if(count<_prevCount){await loadProject(project.id);}
      _prevCount=count;
      if(count===0){setProcessingMasters({});return;}
      const map={};data.forEach(m=>{map[m.revision_id]=m.status;});setProcessingMasters(map);
    };
    poll();interval=setInterval(poll,3000);
    return()=>clearInterval(interval);
  },[project?.id]);

  async function loadProject(pid,_trackId,_tSec){const {data:proj}=await sb.from('projects').select('*').eq('id',pid).single();if(!proj){window.location.href='/';return;}setProject(proj);loadCollaborators(pid);
        setIsOwner(!!(user && proj.user_id === user.id));
        setDownloadEnabled(!!proj.downloads_enabled);
        setIsOwner(user && proj.user_id === user.id);
        setDownloadEnabled(!!proj.downloads_enabled);const {data:tr}=await sb.from('tracks').select('*,revisions(*,masters(*))').eq('project_id',pid).order('position');const {data:noteCounts}=await sb.from('notes').select('track_id').eq('project_id',pid);const countMap={};(noteCounts||[]).forEach(n=>{countMap[n.track_id]=(countMap[n.track_id]||0)+1;});const tl=(tr||[]).map(t=>({...t,revisions:[...(t.revisions||[])].sort((a,b)=>(a.version_number||0)-(b.version_number||0)),_noteCount:countMap[t.id]||0}));setTracks(tl);const _initRevs={};tl.forEach(t=>{const newest=[...(t.revisions||[])].sort((a,b)=>(b.version_number||0)-(a.version_number||0))[0];if(newest)_initRevs[t.id]=newest;});setSelectedRevisions(_initRevs);if(tl.length>0){if(!activeTrackId||_trackId){const first=(_trackId&&tl.find(t=>t.id===_trackId))||tl[0];setActiveTrackId(first.id);if(_tSec!=null)setPendingSeek(parseFloat(_tSec));const rev=first.revisions?.find(r=>r.is_active)||first.revisions?.[first.revisions.length-1]||null;setActiveRevision(rev);loadNotes(first.id,rev?.id);const _rm=rev?.masters?.find(m=>m.status==='ready'&&m.hls_url);if(_rm){setActiveMaster(_rm);setActiveSource('master');}}}}
  async function loadNotes(trackId,revId){if(!trackId||!revId){setNotes([]);return;}const {data}=await sb.from('notes').select('*').eq('track_id',trackId).eq('revision_id',revId).order('timestamp_sec');const notes=data||[];setNotes(notes);setTracks(prev=>prev.map(t=>t.id===trackId?{...t,_noteCount:notes.length}:t));}
  const activeTrack=tracks.find(t=>t.id===activeTrackId)||null;
  const activeIdx=tracks.findIndex(t=>t.id===activeTrackId);
  const audioUrl=activeRevision?activeRevision.mp3_url||activeRevision.audio_url:activeTrack?.mp3_url||activeTrack?.audio_url;
 
const readyMaster=activeMaster?.status==='ready'&&activeMaster?.hls_url?activeMaster:activeRevision?.masters?.find(m=>m.status==='ready'&&m.hls_url); useEffect(()=>{
    const el=audioRef.current;
    if(!el||!activeTrackId)return;
    const track=tracks.find(t=>t.id===activeTrackId);
    const rev=activeRevision;
    const hlsUrl=activeSource==='master'&&readyMaster?.hls_url?readyMaster.hls_url:rev?.hls_url||track?.hls_url||null;
    const wavUrl=activeSource==='master'?(activeMaster?.audio_url||rev?.audio_url||track?.audio_url||null):(rev?.audio_url||track?.audio_url||null);
    if(!hlsUrl&&!wavUrl)return;
    // Destroy any existing HLS instance
    if(window.__hlsInst){window.__hlsInst.destroy();window.__hlsInst=null;}
    el.pause();setPlaying(false);
    if(hlsUrl){
      // HLS path  instant start, FLAC quality
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
      // WAV fallback  direct stream
      el.src=wavUrl; el.load();
    }
    return ()=>{
      if(window.__hlsInst){window.__hlsInst.destroy();window.__hlsInst=null;}
    };
  },[activeTrackId,activeRevision,activeMaster,activeSource]);

  // HLS polling  watches for hls_url to appear after encoding completes
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
useEffect(()=>{
  if(!project?.id)return;
  const needsPoll=tracks.length===0||tracks.some(t=>!t.hls_url);
  if(!needsPoll)return;
  const iv=setInterval(async()=>{
    const {data}=await sb.from('tracks').select('*,revisions(*,masters(*))').eq('project_id',project.id).order('position',{ascending:true});
    if(!data)return;
    setTracks(data);
    if(data.length>0&&data.every(t=>t.hls_url))clearInterval(iv);
  },4000);
  return()=>clearInterval(iv);
},[project?.id,tracks.length,tracks.filter(t=>!t.hls_url).length]);
useEffect(()=>{
  if(!activeTrackId||!tracks.length)return;
  const track=tracks.find(t=>t.id===activeTrackId);
  const masterStatus=track?.revisions?.[0]?.masters?.[0]?.status;
  if(masterStatus==='ready'){return;}if(!masterStatus)return;
  const interval=setInterval(async()=>{
    const {data}=await sb.from('tracks').select('*,revisions(*,masters(*))').eq('id',activeTrackId).single();
    if(!data)return;
    setTracks(prev=>prev.map(t=>t.id===activeTrackId?{...t,...data}:t));
    if(data.revisions?.[0]?.masters?.[0]?.status==='ready'){clearInterval(interval);}
  },4000);
  return()=>clearInterval(interval);
},[activeTrackId,tracks]);
useEffect(()=>{
  const _t=tracks.find(t=>t.id===activeTrackId);
  const _rev=_t?.revisions?.find(r=>r.is_active)||_t?.revisions?.[_t.revisions.length-1];
  const _rm=_rev?.masters?.find(m=>m.status==='ready'&&m.hls_url);
  if(_rm){setActiveMaster(_rm);setActiveSource('master');}
  else{setActiveMaster(null);setActiveSource('mix');}
},[activeTrackId]);

  function playTrack(trackId){if(trackId===activeTrackId){if(audioRef.current){if(playing){audioRef.current.pause();setPlaying(false);}else{audioRef.current.play().catch(()=>{});setPlaying(true);}}return;}const _t=tracks.find(tr=>tr.id===trackId);if(!_t)return;const _rev=selectedRevisions[trackId]||_t.revisions?.find(r=>r.is_active)||_t.revisions?.[_t.revisions.length-1]||null;const _ms=processingMasters[_rev?.id];if(_ms==='pending'||_ms==='processing')return;if(audioRef.current)audioRef.current.pause();setPlaying(false);setCurrentTime(0);setDuration(0);setActiveTrackId(trackId);setActiveRevision(_rev);loadNotes(_t.id,_rev?.id);const _rm=_rev?.masters?.find(m=>m.status==='ready'&&m.hls_url);if(_rm){setActiveMaster(_rm);setActiveSource('master');}else{setActiveMaster(null);setActiveSource('mix');}setTimeout(()=>{audioRef.current?.play().catch(()=>{});setPlaying(true);},80);}
  async function saveProjectEdit(){if(!editTitle.trim())return;await sb.from('projects').update({title:editTitle.trim(),artist:editArtist.trim()}).eq('id',project.id);setProject(p=>({...p,title:editTitle.trim(),artist:editArtist.trim()}));setProjEditing(false);}
  function openProjEdit(){setEditTitle(project?.title||'');setEditArtist(project?.artist||'');setProjEditing(true);}
  async function loadCollaborators(pid) {
    try {
      const res = await fetch('/api/project-collaborators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: pid }),
      });
      const data = await res.json();
      setCollaborators(data.collaborators || []);
    } catch (e) { setCollaborators([]); }
  }
  async function sendInvite(){if(!collabEmail.trim()||collabSending)return;setCollabSending(true);try{const res=await fetch('/api/invite',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:project.id,invitedEmail:collabEmail.trim(),invitedBy:user.id,message:collabMsg.trim()})});const data=await res.json();if(data.error)throw new Error(data.error);setCollabEmail('');setCollabMsg('');setCollabInviting(false);loadCollaborators(project.id);}catch(err){alert('Invite failed: '+err.message);}setCollabSending(false);}
  function openDetail(track){if(track.id!==activeTrackId){if(audioRef.current)audioRef.current.pause();setPlaying(false);setCurrentTime(0);setDuration(0);setActiveTrackId(track.id);}const rev=selectedRevisions[track.id]||track.revisions?.find(r=>r.is_active)||track.revisions?.[track.revisions.length-1]||null;setActiveRevision(rev);loadNotes(track.id,rev?.id);setDetailTrack(track);}
  function jumpToTrack(idx){if(idx<0||idx>=tracks.length)return;const t=tracks[idx];if(audioRef.current)audioRef.current.pause();setPlaying(false);setCurrentTime(0);setDuration(0);setActiveTrackId(t.id);const rev=t.revisions?.find(r=>r.is_active)||t.revisions?.[t.revisions.length-1]||null;setActiveRevision(rev);loadNotes(t.id,rev?.id);setDetailTrack(prev=>prev?t:null);setTimeout(()=>{audioRef.current?.play().catch(()=>{});setPlaying(true);},80);}
  function togglePlay(){if(!audioRef.current)return;if(playing){audioRef.current.pause();setPlaying(false);}else{audioRef.current.play().catch(()=>{});setPlaying(true);}}
  function skip(secs){if(!audioRef.current)return;const t=Math.max(0,Math.min(duration||0,audioRef.current.currentTime+secs));audioRef.current.currentTime=t;setCurrentTime(t);}
  function handleSeek(pct){if(!audioRef.current||!duration)return;const t=pct*duration;audioRef.current.currentTime=t;setCurrentTime(t);}
  function seekToTime(sec){if(!audioRef.current)return;audioRef.current.currentTime=sec;setCurrentTime(sec);if(!playing){audioRef.current.play().catch(()=>{});setPlaying(true);}}
  useEffect(() => {
    if (!tracks?.length || !searchParams) return;
    const trackId = searchParams.get('track');
    const revisionId = searchParams.get('revision');
    const time = searchParams.get('time');
    if (!trackId || !revisionId || !time) return;
    const tpKey = trackId + ':' + revisionId + ':' + time;
    if (teleportedFor.current === tpKey) return;
    teleportedFor.current = tpKey;
    const track = tracks.find(t => t.id === trackId);
    if (!track) return;
    const rev = track.revisions?.find(r => r.id === revisionId);
    if (!rev) return;
    if (track.id !== activeTrackId) playTrack(trackId);
    setActiveRevision(rev);
    loadNotes(trackId, revisionId);
    setDetailTrack(track);
    const sec = parseFloat(time);
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    setPlaying(false);
    seekVersionRef.current++;
    const myVer = seekVersionRef.current;
    let seekAttempts = 0;
    const trySeek = () => {
      if (myVer !== seekVersionRef.current) return;
      if (audio.readyState >= 1 && !isNaN(audio.duration) && audio.duration > sec) {
        seekToTime(sec);
        audio.pause();
        setPlaying(false);
        return;
      }
      if (++seekAttempts > 50) return;
      setTimeout(trySeek, 100);
    };
    trySeek();
  }, [searchParams, tracks]);
  async function deleteCollaborator(collab) {
    try {
      const res = await fetch('/api/invite-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collaboratorId: collab.id }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setCollabDeleting(null);
      loadCollaborators(collab.project_id);
    } catch (err) {
      alert('Failed to remove: ' + err.message);
      setCollabDeleting(null);
    }
  }

  async function resendInvite(collab) {
    try {
      const res = await fetch('/api/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: collab.project_id,
          invitedEmail: collab.invited_email,
          invitedBy: user.id,
          role: collab.role || 'client',
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      alert('Invite resent to ' + collab.invited_email);
    } catch (err) {
      alert('Failed to resend: ' + err.message);
    }
  }

  async function postNote(body,timestampSec){if(!body.trim()||!activeTrack||!activeRevision?.id)return;await sb.from('notes').insert({track_id:activeTrack.id,project_id:project.id,revision_id:activeRevision.id,author_name:user?.email?.split('@')[0]||'You',timestamp_sec:timestampSec,timestamp_label:fmt(timestampSec),body:body.trim(),resolved:false});loadNotes(activeTrack.id,activeRevision?.id);}
  function selectRevisionInDetail(rev){setActiveMaster(null);if(audioRef.current)audioRef.current.pause();setPlaying(false);setCurrentTime(0);setDuration(0);setActiveRevision(rev);loadNotes(activeTrack?.id,rev?.id);}
  function selectRevisionForTrack(rev){
    if(!rev?.track_id)return;
    setSelectedRevisions(prev=>({...prev,[rev.track_id]:rev}));
    if(rev.track_id===activeTrackId){selectRevisionInDetail(rev);}
  }
  async function reorderTracks(fromIdx,toIdx){if(fromIdx===toIdx)return;const nt=[...tracks];const [m]=nt.splice(fromIdx,1);nt.splice(toIdx,0,m);const updated=nt.map((t,i)=>({...t,position:i}));setTracks(updated);await Promise.all(updated.map(t=>sb.from('tracks').update({position:t.position}).eq('id',t.id)));}
  async function renameTrack(trackId,newTitle){await sb.from('tracks').update({title:newTitle}).eq('id',trackId);setTracks(prev=>prev.map(t=>t.id===trackId?{...t,title:newTitle}:t));}
  async function deleteTrack(track){setDeleteTrackConfirm(null);const urls=new Set();(track.revisions||[]).forEach(r=>{if(r.audio_url)urls.add(r.audio_url);if(r.mp3_url&&r.mp3_url!==r.audio_url)urls.add(r.mp3_url);});if(track.audio_url)urls.add(track.audio_url);await Promise.allSettled([...urls].map(url=>{try{const k=decodeURIComponent(new URL(url).pathname.replace(/^\//,''));return fetch(UPLOAD_WORKER_URL,{method:'DELETE',headers:{'X-File-Key':k}});}catch{return Promise.resolve();}}));await sb.from('notes').delete().eq('track_id',track.id);await sb.from('revisions').delete().eq('track_id',track.id);await sb.from('tracks').delete().eq('id',track.id);setTracks(prev=>prev.filter(t=>t.id!==track.id));if(activeTrackId===track.id){setActiveTrackId(null);setActiveRevision(null);setNotes([]);}}
  async function deleteRevision(rev,track){try{const k=decodeURIComponent(new URL(rev.audio_url||rev.mp3_url).pathname.replace(/^\//,''));await fetch(UPLOAD_WORKER_URL,{method:'DELETE',headers:{'X-File-Key':k}});}catch{}await sb.from('notes').delete().eq('revision_id',rev.id);await sb.from('revisions').delete().eq('id',rev.id);if(rev.is_active){const {data:rem}=await sb.from('revisions').select('id').eq('track_id',track.id).order('version_number',{ascending:false}).limit(1);if(rem?.[0])await sb.from('revisions').update({is_active:true}).eq('id',rem[0].id);}await loadProject(project.id);}
  
  function autoMatch(filename,trackList){const base=filename.replace(/\.[^.]+$/,'').replace(/[_-]/g,' ').toLowerCase().trim();const exact=trackList.find(t=>t.title.toLowerCase()===base);if(exact)return exact;let bestScore=0,bestTrack=null;for(const t of trackList){const tName=t.title.toLowerCase();let score=0;for(let i=0;i<tName.length;i++)for(let j=i+1;j<=tName.length;j++){const sub=tName.slice(i,j);if(sub.length>score&&base.includes(sub))score=sub.length;}const threshold=Math.max(4,Math.floor(tName.length*0.6));if(score>=threshold&&score>bestScore){bestScore=score;bestTrack=t;}}return bestTrack;}
  function addRevFiles(files){const audio=[...files].filter(f=>f.type.startsWith('audio/')||/\.(wav|mp3|aiff|aif|flac|m4a)$/i.test(f.name));if(!audio.length)return;const newEntries=audio.map(file=>{const matched=autoMatch(file.name,tracks);const tone=matched?getToneMemory(matched.title):DEFAULT_TONE;const entry={file,name:matched?.title||file.name.replace(/\.[^.]+$/,'').replace(/[_-]/g,' ').trim(),tone,peaks:[],peaksComputed:false,matchedTrackId:matched?.id||null,isNew:!matched};computePeaks(file).then(peaks=>{setRevFiles(prev=>prev.map(e=>e.file.name===file.name?{...e,peaks,peaksComputed:peaks.length>0}:e));});return entry;});setRevFiles(prev=>{const ex=new Set(prev.map(e=>e.file.name));return [...prev,...newEntries.filter(e=>!ex.has(e.file.name))];});}
  async function submitRevisions() {
  if (!revFiles.length || !project) return;

  // Capture everything needed before clearing state
  revFiles.forEach(entry => { if (entry.name.trim()) setToneMemory(entry.name.trim(), entry.tone); });
  const ncIds = revFiles.map((_, i) => 'rev-' + Date.now() + '-' + i);
  const trackList = revFiles.map((entry, i) => ({
    file: entry.file,
    name: entry.name.trim() || entry.file.name.replace(/\.[^.]+$/, ''),
    matchedTrackId: entry.matchedTrackId,
    isNew: entry.isNew,
    peaks: entry.peaks ?? [],
    tone_setting: entry.tone,
    tone_label: TONES[entry.tone].short,
    position: tracks.length + i,
  }));
  const projectId = project.id;

  // Close modal immediately — let React render before upload starts
  setShowRevModal(false);
  setRevFiles([]);
  setRevStatus('');
  if (window.nc_openToUploads) window.nc_openToUploads();

  // Defer upload start by one tick so React paints the closed modal first
  setTimeout(async () => {
    try {
      const results = await startRevisionUploads(trackList, projectId, ncIds);
      await loadProject(projectId);
      // Auto-activate master for the current track (or first uploaded)
      const match = results?.find(r => r?.revisionId && r.trackId === activeTrackId)
                 || results?.find(r => r?.revisionId);
      if (match) setPendingAutoActivate({ preset: match.preset, revisionId: match.revisionId });
    } catch(err) {
      console.error('[submitRevisions]', err.message);
    }
  }, 0);
}
  const progress=duration?currentTime/duration:0;
  const rerunUsedTones=rerunTrack?(rerunTrack.revisions||[]).map(r=>r.tone_setting).filter(t=>t!=null):[];
  // Dedicated poller: when a new master is submitted, poll until it's ready then auto-activate
  useEffect(()=>{
    if(!pendingAutoActivate)return;
    const{preset,revisionId}=pendingAutoActivate;
    let attempts=0;
    const iv=setInterval(async()=>{
      attempts++;
      if(attempts>90){setPendingAutoActivate(null);clearInterval(iv);return;}
      try{
        const{data}=await sb.from('masters').select('id,status,hls_url,audio_url,preset,peaks,revision_id').eq('revision_id',revisionId).eq('preset',preset).single();
        if(data?.status==='ready'){
          clearInterval(iv);
          setPendingAutoActivate(null);
          setActiveMaster(data);
          setActiveSource('master');
          // Master ready: track unlocks visually — no auto-play
          setTracks(prev=>prev.map(t=>{
            const rev=t.revisions?.find(r=>r.id===revisionId);
            if(!rev)return t;
            const updatedMasters=[...(rev.masters||[]).filter(m=>m.id!==data.id),data];
            return{...t,revisions:t.revisions.map(r=>r.id===revisionId?{...r,masters:updatedMasters}:r)};
          }));
        }
      }catch(e){}
    },5000);
    return()=>clearInterval(iv);
  },[pendingAutoActivate]);

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
    .ps-waveform-bar{position:sticky;top:0;z-index:5;background:var(--bg);border-bottom:1px solid var(--border);padding:10px 16px 8px;box-shadow:0 2px 20px rgba(0,0,0,.5);}
    .ps-track-info{display:flex;align-items:center;gap:8px;margin-bottom:8px;}.ps-track-name{font-family:var(--fh);font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0;}.ps-rev-badge{font-size:9px;padding:2px 8px;border-radius:4px;background:var(--aglow);border:1px solid rgba(232,160,32,.25);color:var(--amber);white-space:nowrap;flex-shrink:0;}.ps-tone-badge{font-size:9px;padding:2px 7px;border-radius:4px;background:var(--surf2);border:1px solid var(--border2);color:var(--t3);white-space:nowrap;flex-shrink:0;}
    .ps-waveform{padding:4px 0;background:transparent;}.ps-time-row{display:flex;justify-content:space-between;font-size:12px;font-weight:500;color:var(--t2);margin-top:4px;}
    .ps-no-track-top{font-size:12px;color:var(--t3);padding:8px 0;}
    .ps-controls-bar{position:fixed;display:flex;align-items:center;gap:12px;bottom:0;left:0;right:0;z-index:30;background:var(--bg);border-top:1px solid var(--border);box-shadow:0 -4px 24px rgba(0,0,0,.6);padding:8px 16px;padding-bottom:calc(8px + env(safe-area-inset-bottom,0px));}
    
    .ps-art{width:44px;height:44px;border-radius:6px;object-fit:cover;flex-shrink:0;}.ps-transport{position:absolute;left:50%;transform:translateX(-50%);display:grid;grid-template-columns:1fr auto 1fr;align-items:center;}
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
    .td-wave-wrap{padding:0;border:none;background:transparent;flex-shrink:0;}
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
    /* TONE GRID  color swatches, X on used */
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
@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
.ps-sidebar{position:fixed;left:0;top:48px;bottom:64px;width:200px;background:var(--bg);border-right:1px solid var(--border);display:flex;flex-direction:column;z-index:20;overflow-y:auto;}
.ps-sidebar img{width:100%;aspect-ratio:1;object-fit:cover;display:block;}
.ps-sidebar-info{padding:14px 16px;flex:1;}
.ps-sidebar-title{font-family:var(--fh);font-size:15px;font-weight:600;color:var(--t1);margin-bottom:2px;}
.ps-sidebar-artist{font-size:12px;color:var(--t2);margin-bottom:12px;}
.ps-sidebar-meta{font-size:10px;color:var(--t2);letter-spacing:.04em;}
.ps-mobile-hero{display:none;position:relative;overflow:hidden;}
.ps-mobile-hero .mh-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:blur(12px) brightness(0.6);transform:scale(1.2);}
.ps-mobile-hero .mh-over{position:absolute;inset:0;background:rgba(0,0,0,0.4);}
.ps-mobile-hero .mh-content{position:relative;display:flex;align-items:center;gap:12px;padding:12px 16px;}
.ps-mobile-hero .mh-art{width:80px;height:80px;border-radius:6px;object-fit:cover;border:1px solid rgba(255,255,255,0.12);}
.ps-mobile-hero .mh-title{font-family:var(--fh);font-size:16px;font-weight:600;color:#fff;margin:0;}
.ps-mobile-hero .mh-sub{font-size:11px;color:rgba(255,255,255,0.55);margin:2px 0 0;}
@media(max-width:768px){.ps-sidebar{display:none!important;}.ps-mobile-hero{display:flex;align-items:center;gap:14px;padding:12px 16px;border-bottom:1px solid var(--border);}.ps-waveform canvas{height:50px!important;}.ps-art-wrap{display:none!important;}.ps-controls-bar{min-height:64px;}.ps-waveform-bar{padding:6px 12px 4px!important;}.page-header{padding:4px 0 8px!important;}.btn-upload-rev{padding:7px 12px!important;font-size:11px!important;}}
@media(min-width:769px){.ps-mobile-hero{display:none!important;}body:has(.ps-sidebar) .ps-waveform-bar{margin-left:200px;}body:has(.ps-sidebar) .ps-waveform-bar{min-height:200px;}body:has(.ps-sidebar) .page{margin-left:200px;}}
    .td-count{font-size:12px;color:var(--t3);background:var(--surf2);padding:4px 10px;border-radius:12px;flex-shrink:0;font-family:var(--fm);}
    .td-wave-section{padding:12px 20px 6px;border-bottom:1px solid var(--border);flex-shrink:0;}
    .td-compose-active{display:flex;flex-direction:column;gap:8px;}
    .td-compose-bar{display:flex;align-items:center;justify-content:space-between;padding:4px 0 2px;}
    .td-btn-cancel{font-family:var(--fm);font-size:13px;padding:8px 14px;border-radius:9px;border:1.5px solid var(--border2);background:transparent;color:var(--t2);cursor:pointer;}
    .td-btn-post{font-family:var(--fm);font-size:13px;font-weight:600;padding:8px 18px;border-radius:9px;border:none;background:var(--amber);color:#000;cursor:pointer;}.td-btn-post:disabled{opacity:.5;cursor:default;}
    .td-comments-scroll{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:12px 16px;display:flex;flex-direction:column;gap:8px;}
    .td-comment{display:flex;gap:12px;padding:14px 20px;border-bottom:1px solid var(--border);cursor:pointer;-webkit-tap-highlight-color:transparent;}.td-comment:hover{background:var(--surf);}
    .td-comment-avatar{width:28px;height:28px;border-radius:50%;background:var(--surf2);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--t2);font-weight:500;font-family:var(--fm);}
    .td-comment-body{flex:1;min-width:0;}
    .td-comment-meta{display:flex;align-items:center;gap:8px;margin-bottom:3px;flex-wrap:wrap;}
    .td-comment-name{font-size:12px;color:var(--t2);font-weight:500;font-family:var(--fm);}
    .td-comment-ts{font-size:10px;color:var(--amber);background:rgba(232,160,32,.12);padding:2px 7px;border-radius:8px;font-family:var(--fm);font-weight:500;}
    .td-comment-date{font-size:10px;color:var(--t3);font-family:var(--fm);}
    .td-comment-text{font-size:13px;color:#c8c4be;line-height:1.5;}
    .td-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px;flex:1;}
    .td-empty-icon{color:var(--t3);margin-bottom:12px;}
    .td-empty-title{font-size:14px;color:var(--t2);margin-bottom:4px;}
    .td-empty-sub{font-size:12px;color:var(--t3);}
    .td-transport{display:flex;align-items:center;justify-content:center;padding:12px 20px;border-top:1px solid var(--border);gap:18px;flex-shrink:0;padding-bottom:calc(12px + env(safe-area-inset-bottom,0px));}
    .td-tbtn{background:none;border:none;color:var(--t3);cursor:pointer;position:relative;display:flex;align-items:center;justify-content:center;padding:4px;}.td-tbtn:disabled{opacity:.3;cursor:default;}
    .td-skip-num{position:absolute;font-size:7px;font-weight:700;color:var(--t3);font-family:var(--fm);}
    .td-play-btn{width:42px;height:42px;border-radius:50%;background:var(--amber);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;}

    .td-comment-card{background:var(--surf);border-radius:10px;padding:12px 14px;cursor:pointer;-webkit-tap-highlight-color:transparent;}.td-comment-card:hover{background:var(--surf2);}
    @media(max-width:768px){.td-wave-section canvas{height:80px!important;}.td-wave-section{padding:6px 16px 2px;}}
    .td-compose-left{display:flex;align-items:center;gap:10px;}
    .td-mini-btn{width:38px;height:38px;border-radius:50%;background:var(--surf2);border:1px solid var(--border2);display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;color:var(--t2);-webkit-tap-highlight-color:transparent;}.td-mini-btn:active{transform:scale(0.92);}
    .td-mini-play-active{background:var(--amber);border-color:var(--amber);color:#000;}
    .mh-art{width:72px;height:72px;border-radius:12px;object-fit:cover;flex-shrink:0;}
    .mh-info{flex:1;min-width:0;}
    .mh-title{font-family:var(--fh);font-size:16px;font-weight:600;color:var(--t1);margin-bottom:1px;}
    .mh-artist{font-size:12px;color:var(--t2);margin-bottom:6px;}
    .mh-stats{display:flex;gap:12px;font-size:11px;color:var(--t3);}
    .pe-btn{position:absolute;top:8px;right:8px;width:28px;height:28px;border-radius:50%;background:rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.15);display:flex;align-items:center;justify-content:center;cursor:pointer;color:#ccc;-webkit-tap-highlight-color:transparent;z-index:2;}.pe-btn:hover{background:rgba(0,0,0,0.7);color:#fff;}
    .pe-btn-sidebar{top:8px;right:8px;}
    .ps-mobile-hero{position:relative;}
    .pe-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:300;}
    .pe-modal{position:fixed;z-index:301;background:var(--surf);border:1px solid var(--border2);padding:20px;max-width:360px;width:calc(100% - 32px);}
    @media(max-width:768px){.pe-modal{bottom:0;left:0;right:0;max-width:none;width:100%;border-radius:16px 16px 0 0;padding:16px 20px calc(16px + env(safe-area-inset-bottom,0px));}}
    @media(min-width:769px){.pe-modal{top:50%;left:50%;transform:translate(-50%,-50%);border-radius:14px;}}
    .pe-handle{width:32px;height:3px;background:var(--border2);border-radius:2px;margin:0 auto 14px;}
    @media(min-width:769px){.pe-handle{display:none;}}
    .pe-title{font-family:var(--fh);font-size:16px;font-weight:600;color:var(--t1);text-align:center;margin-bottom:16px;}
    .pe-field{margin-bottom:12px;}
    .pe-label{display:block;font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px;font-family:var(--fm);}
    .pe-input{width:100%;background:var(--surf2);border:1px solid var(--border2);border-radius:8px;padding:10px 12px;color:var(--text);font-family:var(--fm);font-size:14px;outline:none;-webkit-appearance:none;}.pe-input:focus{border-color:var(--amber);}
    .pe-actions{display:flex;gap:8px;margin-top:16px;}
    .pe-cancel{flex:1;padding:10px;border-radius:9px;border:1px solid var(--border2);background:transparent;color:var(--t2);font-family:var(--fm);font-size:13px;cursor:pointer;}
    .pe-save{flex:1;padding:10px;border-radius:9px;border:none;background:var(--amber);color:#000;font-family:var(--fm);font-size:13px;font-weight:600;cursor:pointer;}.pe-save:disabled{opacity:0.5;}
    .pe-btn-inline{width:22px;height:22px;border-radius:50%;background:var(--surf2);border:1px solid var(--border2);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;color:var(--t3);flex-shrink:0;-webkit-tap-highlight-color:transparent;padding:0;}.pe-btn-inline:hover{color:var(--t1);border-color:var(--amber);}
    .sc-divider{height:1px;background:var(--border);margin:0 16px;}
    .sc-header{display:flex;align-items:center;padding:10px 16px;cursor:pointer;}.sc-header:hover{background:rgba(255,255,255,0.02);}
    .sc-label{font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:0.06em;flex:1;font-family:var(--fm);}
    .sc-count{font-size:9px;color:var(--t2);background:var(--surf2);padding:1px 6px;border-radius:8px;margin-right:6px;}
    .sc-chevron{color:var(--t3);font-size:10px;transition:transform 0.2s;}.sc-open{transform:rotate(180deg);}
    .sc-body{padding:0 16px 10px;}
    .sc-person{display:flex;align-items:center;gap:8px;padding:6px 0;font-size:11px;cursor:pointer;}.sc-avatar{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;flex-shrink:0;}.sc-person-info{min-width:0;flex:1;}.sc-person-name{font-size:11px;color:#f0ede8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}.sc-status{font-size:9px;}.sc-add{display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;font-size:11px;}.sc-add-icon{width:24px;height:24px;border-radius:50%;border:1px dashed #2e2e38;display:flex;align-items:center;justify-content:center;font-size:12px;color:#4a4945;}.sc-add-text{font-size:11px;color:#e8a020;}.sc-kebab-wrap{position:relative;flex-shrink:0;}.sc-kebab{width:20px;height:20px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;cursor:pointer;border-radius:4px;border:none;background:transparent;padding:0;}.sc-kebab:hover{background:rgba(138,135,128,0.15);}.sc-kebab-dot{width:3px;height:3px;border-radius:50%;background:#8a8780;display:block;}.sc-menu-overlay{position:fixed;top:0;left:0;right:0;bottom:0;z-index:99;}.sc-menu{position:absolute;right:0;bottom:100%;margin-bottom:2px;background:#111113;border:1px solid #2e2e38;border-radius:8px;padding:4px 0;min-width:140px;z-index:100;}.sc-menu-item{display:flex;align-items:center;gap:8px;padding:7px 12px;font-size:11px;font-family:'DM Mono',monospace;cursor:pointer;white-space:nowrap;color:#8a8780;}.sc-menu-item:hover{background:rgba(138,135,128,0.08);color:#f0ede8;}.sc-menu-sep{height:1px;background:#24242c;margin:3px 8px;}.sc-menu-danger{color:#e24b4a;}.sc-menu-danger:hover{background:rgba(226,75,74,0.1);color:#e24b4a;}.sc-confirm-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;}.sc-confirm-card{background:#111113;border:1px solid #24242c;border-radius:16px;padding:24px 20px;max-width:320px;width:90%;text-align:center;}.sc-confirm-card h3{font-family:'DM Serif Display',Georgia,serif;font-size:16px;margin:0 0 8px;color:#f0ede8;}.sc-confirm-card p{font-size:11px;color:#8a8780;line-height:1.6;margin:0 0 16px;}.sc-confirm-email{color:#e8a020;}.sc-confirm-btns{display:flex;gap:8px;}.sc-confirm-btn{flex:1;padding:10px;border-radius:8px;border:1px solid #2e2e38;background:transparent;color:#8a8780;font-family:'DM Mono',monospace;font-size:11px;cursor:pointer;}.sc-confirm-btn:hover{border-color:#f0ede8;color:#f0ede8;}.sc-confirm-btn-danger{background:#e24b4a;border-color:#e24b4a;color:#fff;}.sc-confirm-btn-danger:hover{opacity:0.85;border-color:#e24b4a;color:#fff;}.sc-add:hover{color:var(--amber);}
    .sc-add-icon{width:24px;height:24px;border-radius:50%;border:1px dashed currentColor;display:flex;align-items:center;justify-content:center;font-size:12px;}
    .sc-empty{font-size:9px;color:var(--t3);text-align:center;padding:8px 0;}
    .sc-field{margin-bottom:6px;}.sc-field-label{font-size:8px;color:var(--t3);margin-bottom:3px;text-transform:uppercase;letter-spacing:0.06em;}
    .sc-input{width:100%;background:var(--surf2);border:1px solid var(--border2);border-radius:6px;padding:7px 8px;color:var(--text);font-family:var(--fm);font-size:10px;outline:none;-webkit-appearance:none;}.sc-input:focus{border-color:var(--amber);}
    .sc-textarea{width:100%;background:var(--surf2);border:1px solid var(--border2);border-radius:6px;padding:7px 8px;color:var(--text);font-family:var(--fm);font-size:10px;outline:none;resize:none;-webkit-appearance:none;}.sc-textarea:focus{border-color:var(--amber);}
    .sc-actions{display:flex;gap:6px;margin-top:6px;}
    .sc-cancel{flex:1;padding:7px;border-radius:6px;border:1px solid var(--border2);background:transparent;color:var(--t2);font-family:var(--fm);font-size:9px;cursor:pointer;}
    .sc-send{flex:1;padding:7px;border-radius:6px;border:none;background:var(--amber);color:#000;font-family:var(--fm);font-size:9px;font-weight:600;cursor:pointer;}.sc-send:disabled{opacity:0.5;}`}</style>
    {project?.image_url&&<div className="ps-sidebar"><div style={{position:'relative'}}><img src={project.image_url} alt=""/><button className="pe-btn pe-btn-sidebar" onClick={openProjEdit}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg></button></div><div className="ps-sidebar-info"><div className="ps-sidebar-title">{project.title}</div>{project.artist&&<div className="ps-sidebar-artist">{project.artist}</div>}<div className="ps-sidebar-meta">{tracks.length} {tracks.length===1?'track':'tracks'}</div><div className="ps-sidebar-meta">Album Run Time: {fmt(tracks.reduce((s,t)=>s+(t.duration||0),0))}</div></div><div className="sc-divider"/><div className="sc-header" onClick={()=>setCollabOpen(!collabOpen)}><span className="sc-label">Collaborators</span>{collaborators.length>0&&<span className="sc-count">{collaborators.length}</span>}<span className={"sc-chevron"+(collabOpen?" sc-open":"")}>▾</span></div>{collabOpen&&<div className="sc-body">{collabInviting?(<><div className="sc-field"><div className="sc-field-label">Email</div><input className="sc-input" value={collabEmail} onChange={e=>setCollabEmail(e.target.value)} placeholder="name@band.com" autoFocus onKeyDown={e=>{if(e.key==='Enter')sendInvite();if(e.key==='Escape')setCollabInviting(false);}}/></div><div className="sc-field"><div className="sc-field-label">Message (optional)</div><textarea className="sc-textarea" value={collabMsg} onChange={e=>setCollabMsg(e.target.value)} placeholder="Check out these mixes!" rows={2}/></div><div className="sc-actions"><button className="sc-cancel" onClick={()=>setCollabInviting(false)}>Cancel</button><button className="sc-send" disabled={!collabEmail.trim()||collabSending} onClick={sendInvite}>{collabSending?'Sending...':'Send Invite'}</button></div></>):(<>{collaborators.length===0&&<div className="sc-empty">No one invited yet</div>}{collaborators.map(c=>(<div key={c.id} className="sc-person"><div className="sc-avatar" style={{background:c.status==='accepted'?'#1a2a1a':'#2a2a20',color:c.status==='accepted'?'#6a9a6a':'#c8946a'}}>{(c.invited_email||'?')[0].toUpperCase()}</div><div className="sc-person-info"><div className="sc-person-name">{c.invited_email}</div><div className={"sc-status "+(c.status==='accepted'?"sc-accepted":"sc-pending")}>{c.status}</div></div><div className="sc-kebab-wrap"><button className="sc-kebab" onClick={(e)=>{e.stopPropagation();setCollabMenuOpen(collabMenuOpen===c.id?null:c.id);}}><span className="sc-kebab-dot"></span><span className="sc-kebab-dot"></span><span className="sc-kebab-dot"></span></button>{collabMenuOpen===c.id&&(<><div className="sc-menu-overlay" onClick={()=>setCollabMenuOpen(null)}></div><div className="sc-menu">{c.status==='pending'&&<div className="sc-menu-item" onClick={()=>{resendInvite(c);setCollabMenuOpen(null);}}>Resend invite</div>}{c.status==='pending'&&<div className="sc-menu-sep"></div>}<div className="sc-menu-item sc-menu-danger" onClick={()=>{setCollabDeleting(c);setCollabMenuOpen(null);}}>Remove</div></div></>)}</div></div>))}<div className="sc-add" onClick={()=>setCollabInviting(true)}><div className="sc-add-icon">+</div><span>Invite someone</span></div>
          {collabDeleting && (
            <div className="sc-confirm-overlay" onClick={() => setCollabDeleting(null)}>
              <div className="sc-confirm-card" onClick={(e) => e.stopPropagation()}>
                <h3>Remove collaborator?</h3>
                <p><span className="sc-confirm-email">{collabDeleting.invited_email}</span> will lose access to this project. You can re-invite them later.</p>
                <div className="sc-confirm-btns">
                  <button className="sc-confirm-btn" onClick={() => setCollabDeleting(null)}>Cancel</button>
                  <button className="sc-confirm-btn sc-confirm-btn-danger" onClick={() => deleteCollaborator(collabDeleting)}>Remove</button>
                </div>
              </div>
            </div>
          )}</>)}</div>}</div>}
    <div className="topbar"><div style={{display:'flex',alignItems:'center',gap:6,minWidth:0}}><Link href="/" className="logo">maastr<em>.</em></Link><span style={{color:'var(--border2)',fontSize:14,flexShrink:0}}>/</span>{project?.image_url&&<img src={project.image_url} alt="" style={{width:22,height:22,borderRadius:'50%',objectFit:'cover',flexShrink:0}}/>}<span className="breadcrumb">{project?.title||''}</span></div><div style={{display:'flex',alignItems:'center',gap:8}}>{user&&<NotificationCenter user={user}/>}<div style={{position:'relative'}}>
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
      </div></div></div>    {project?.image_url&&<div className="ps-mobile-hero"><img className="mh-art" src={project.image_url} alt=""/><div className="mh-info"><div style={{display:'flex',alignItems:'center',gap:6}}><div className="mh-title">{project.title}</div><button className="pe-btn-inline" onClick={openProjEdit}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg></button></div>{project.artist&&<div className="mh-artist">{project.artist}</div>}<div className="mh-stats"><span>{tracks.length} tracks</span><span>{fmt(tracks.reduce((s,t)=>s+(t.duration||0),0))}</span></div></div></div>}
    <div className="ps-waveform-bar">
      {activeTrack?(<><div className="ps-waveform"><Waveform peaks={activeSource==='master'&&readyMaster?.peaks?readyMaster.peaks:activeTrack.peaks} progress={progress} notes={[]} duration={duration} onSeek={handleSeek}/><div className="ps-time-row"><span>{fmt(currentTime)}</span><div style={{display:'flex',alignItems:'center',gap:'2px',background:'var(--surf2)',borderRadius:'20px',padding:'3px'}}><button style={{fontSize:'10px',fontWeight:700,letterSpacing:'.06em',padding:'4px 12px',borderRadius:'17px',border:'none',transition:'all .2s',background:activeSource==='mix'?'var(--amber)':'transparent',color:activeSource==='mix'?'#000':'rgba(255,255,255,.4)',cursor:'pointer'}} onClick={()=>setActiveSource('mix')}>MIX</button><button disabled={!readyMaster} style={{fontSize:'10px',fontWeight:700,letterSpacing:'.06em',padding:'4px 12px',borderRadius:'17px',border:'none',transition:'all .2s',background:activeSource==='master'&&readyMaster?'var(--amber)':'transparent',color:readyMaster?(activeSource==='master'?'#000':'rgba(255,255,255,.4)'):'rgba(255,255,255,.18)',cursor:readyMaster?'pointer':'default'}} onClick={()=>{if(readyMaster)setActiveSource('master');}}>MASTER</button></div><span>{fmt(duration)}</span></div></div></>):(<div className="ps-no-track-top">Tap a track to start listening</div>)}
    </div>
    <div className="page">
      <div className="page-header"><div className="top-actions"><button className="btn-upload-rev" onClick={()=>{setRevFiles([]);setRevStatus('');setShowRevModal(true);}}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>Upload Revisions</button>
          {isOwner&&<button className="btn-upload-rev" style={{background:'var(--surf3)',color:'var(--t2)',border:'1px solid var(--border2)'}} onClick={()=>setShowInvite(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
            Invite Client
          </button>}
          {isOwner&&<button className="btn-upload-rev" style={{background:'var(--surf3)',color:downloadEnabled?'var(--amber)':'var(--t2)',border:'1px solid var(--border2)'}} onClick={async()=>{const nd=!downloadEnabled;setDownloadEnabled(nd);await sb.from('projects').update({downloads_enabled:nd}).eq('id',project.id);}}>
            {downloadEnabled?'Downloads On':'Downloads Off'}
          </button>}</div></div>
      
      <div className="tracks-lbl">{tracks.length===0?'Waiting for tracks':`${tracks.length} ${tracks.length===1?'track':'tracks'}`}</div>
      <div style={{borderRadius:12,overflow:'hidden',border:'1px solid var(--border)'}}>
        {tracks.map((track,idx)=>(<TrackRow key={track.id} track={track} idx={idx} isActive={activeTrackId===track.id} isPlaying={activeTrackId===track.id&&playing} isMastering={!!(track.revisions?.some(r=>r.is_active&&(processingMasters[r.id]==='processing'||processingMasters[r.id]==='pending')))} noteCount={track._noteCount||0} onPlay={playTrack} onDetail={openDetail} onRename={renameTrack} onDeleteTrack={t=>setDeleteTrackConfirm(t)} onDeleteRevision={deleteRevision} onSwitchRevision={selectRevisionForTrack} activeRevisionId={selectedRevisions[track.id]?.id||(activeTrackId===track.id?activeRevision?.id:null)} onRerunRevision={t=>{setRerunTrack(t);setRerunTone(null);setRerunStatus('');}} activeTone={(activeMaster?.track_id===track.id?activeMaster?.preset:null)||selectedRevisions[track.id]?.tone_label||(track.revisions?.find(r=>r.is_active)||track.revisions?.[track.revisions.length-1])?.tone_label||track.tone_label} onOpenToneModal={t=>{setRerunTrack(t);setRerunTone(null);setRerunStatus('');}}/>))}
      </div>
    </div>
    <div className="ps-controls-bar">
      {project?.image_url&&<div className="ps-art-wrap" style={{display:"flex",alignItems:"center",gap:10,flexShrink:0,position:"relative",zIndex:1}}><img className="ps-art" src={project.image_url} alt=""/><div style={{display:"flex",flexDirection:"column",gap:1,minWidth:0}}>{project.artist&&<div style={{fontSize:11,color:"var(--t2)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",fontFamily:"var(--fm)"}}>{project.artist}</div>}<div style={{fontSize:13,fontWeight:600,color:"var(--t1)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",fontFamily:"var(--fh)"}}>{activeTrack?.title||project.title}</div></div></div>}
      <div className="ps-transport">
        <div className="ps-transport-left"><button className="ps-track-btn" onClick={()=>jumpToTrack(activeIdx-1)} disabled={!activeTrack||activeIdx<=0}><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="19,5 9,12 19,19"/><rect x="5" y="5" width="2.5" height="14" rx="1"/></svg></button><button className="ps-skip-btn" onClick={()=>skip(-10)} disabled={!audioUrl}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.95"/></svg><span className="ps-skip-label">10</span></button></div>
        <div className="ps-transport-center"><button className="ps-play-btn" onClick={togglePlay} disabled={!audioUrl}><svg width="16" height="16" viewBox="0 0 16 16" fill="#000">{playing?<><rect x="3" y="1" width="3.5" height="14" rx="1"/><rect x="9.5" y="1" width="3.5" height="14" rx="1"/></>:<polygon points="3,1 15,8 3,15"/>}</svg></button></div>
        <div className="ps-transport-right"><button className="ps-skip-btn" onClick={()=>skip(10)} disabled={!audioUrl}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.49-3.95"/></svg><span className="ps-skip-label">10</span></button>
            <button className="ps-track-btn" onClick={()=>jumpToTrack(activeIdx+1)} disabled={!activeTrack||activeIdx<0||activeIdx>=tracks.length-1}><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,5 15,12 5,19"/><rect x="16.5" y="5" width="2.5" height="14" rx="1"/></svg></button></div>
      </div>
      
    </div>
    <TrackDetail open={!!detailTrack} track={detailTrack||activeTrack} activeRevision={activeRevision} notes={notes} currentTime={currentTime} duration={duration} progress={progress} isPlaying={playing} onTogglePlay={togglePlay} onSkip={skip} onPrevTrack={()=>jumpToTrack(activeIdx-1)} onNextTrack={()=>jumpToTrack(activeIdx+1)} canPrev={activeIdx>0} canNext={activeIdx>=0&&activeIdx<tracks.length-1} onSeek={handleSeek} onClose={()=>setDetailTrack(null)} onPost={postNote} onSeekToTime={seekToTime} onRevisionSelect={selectRevisionInDetail} activeMaster={activeMaster} onMasterSelect={setActiveMaster}/>
    {projEditing&&<><div className="pe-overlay" onClick={()=>setProjEditing(false)}/><div className="pe-modal"><div className="pe-handle"/><div className="pe-title">Edit project</div><div className="pe-field"><label className="pe-label">Project name</label><input className="pe-input" value={editTitle} onChange={e=>setEditTitle(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')saveProjectEdit();if(e.key==='Escape')setProjEditing(false);}} autoFocus/></div><div className="pe-field"><label className="pe-label">Artist / Band</label><input className="pe-input" value={editArtist} onChange={e=>setEditArtist(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')saveProjectEdit();if(e.key==='Escape')setProjEditing(false);}}/></div><div className="pe-actions"><button className="pe-cancel" onClick={()=>setProjEditing(false)}>Cancel</button><button className="pe-save" disabled={!editTitle.trim()} onClick={saveProjectEdit}>Save</button></div></div></>}
    <audio ref={audioRef} preload="metadata" onTimeUpdate={e=>{setCurrentTime(e.target.currentTime);if(typeof navigator!=='undefined'&&'mediaSession' in navigator&&activeTrack){navigator.mediaSession.metadata=new MediaMetadata({title:activeTrack.title||'',artist:project?.artist||'',album:project?.title||'',artwork:project?.image_url?[{src:project.image_url,sizes:'512x512',type:'image/jpeg'}]:[]});navigator.mediaSession.setActionHandler('play',()=>audioRef.current?.play());navigator.mediaSession.setActionHandler('pause',()=>audioRef.current?.pause());}}} onDurationChange={e=>{if(e.target.duration&&isFinite(e.target.duration))setDuration(e.target.duration);}} onEnded={()=>setPlaying(false)} onError={()=>{setDuration(0);setPlaying(false);}}/>
    {deleteTrackConfirm&&(<div className="overlay-bg" onClick={()=>setDeleteTrackConfirm(null)}><div className="confirm-box" onClick={e=>e.stopPropagation()}><div className="confirm-box-title">Delete {deleteTrackConfirm.title}?</div><div className="confirm-box-sub">Permanently deletes all revisions and notes. Cannot be undone.</div><div className="confirm-box-actions"><button className="btn-confirm-cancel" onClick={()=>setDeleteTrackConfirm(null)}>Keep it</button><button className="btn-confirm-delete" onClick={()=>deleteTrack(deleteTrackConfirm)}>Delete Forever</button></div></div></div>)}
    <ToneSwitcher rerunTrack={rerunTrack} rerunTone={rerunTone} setRerunTone={setRerunTone} setRerunTrack={setRerunTrack} activeMaster={activeMaster} project={project} setActiveMaster={setActiveMaster} setActiveSource={setActiveSource} setPendingAutoActivate={setPendingAutoActivate}/>
    {showRevModal&&(<div className="modal-bg" onClick={e=>e.target===e.currentTarget&&!revUploading&&setShowRevModal(false)}><div className="modal-scroll-inner"><div className="rev-modal"><div className="rev-modal-title">Upload Revisions</div><div className="rev-modal-sub">Drop files. Matched by name  new names become new tracks.</div><div className={'rev-dropzone'+(revDragging?' over':'')} onDragOver={e=>{e.preventDefault();setRevDragging(true);}} onDragLeave={e=>{e.preventDefault();setRevDragging(false);}} onDrop={e=>{e.preventDefault();e.stopPropagation();setRevDragging(false);addRevFiles(e.dataTransfer?.files||[]);}} onClick={()=>document.getElementById('rev-multi-input').click()}><div style={{fontSize:24,marginBottom:6}}></div><strong>{revFiles.length>0?'Drop more files':'Drop WAV / MP3 files here'}</strong><br/><span style={{fontSize:11,opacity:.6}}>Multiple files OK  or tap to browse</span><input id="rev-multi-input" type="file" accept=".wav,.mp3,.aiff,.aif,.flac,.m4a,audio/*" multiple style={{display:'none'}} onChange={e=>{addRevFiles(e.target.files);e.target.value='';  }}/></div>{revFiles.length>0&&(<div className="rev-file-list">{revFiles.map((entry,i)=>(<div key={i} className={'rev-file-row'+(entry.isNew?' is-new':'')}><div className="rev-file-row-top"><input className="rev-file-name-input" value={entry.name} onChange={e=>{const n=e.target.value;const m=tracks.find(t=>t.title.toLowerCase()===n.toLowerCase());setRevFiles(prev=>prev.map((r,j)=>j===i?{...r,name:n,matchedTrackId:m?.id||null,isNew:!m}:r));}} placeholder="Track name"/><span className={entry.isNew?'rev-file-badge-new':'rev-file-badge-rev'}>{entry.isNew?'new track':'revision'}</span><button className="rev-file-remove" onClick={()=>setRevFiles(prev=>prev.filter((_,j)=>j!==i))}></button></div><div className="rev-file-ref">{entry.file.name}  {(entry.file.size/1024/1024).toFixed(1)} MB{entry.peaksComputed?'  waveform ':''}</div><div style={{display:'flex',alignItems:'center',gap:8}}><span style={{fontSize:11,color:'var(--t2)',flexShrink:0}}>Tone:</span><div style={{flex:1}}><ToneGrid value={entry.tone} usedTones={entry.matchedTrackId?tracks.find(t=>t.id===entry.matchedTrackId)?.revisions?.map(r=>r.tone_setting).filter(t=>t!=null)||[]:[]} onChange={t=>setRevFiles(prev=>prev.map((r,j)=>j===i?{...r,tone:t}:r))} showSetAll={revFiles.length>1} onSetAll={t=>setRevFiles(prev=>prev.map(r=>({...r,tone:t})))}/></div></div></div>))}</div>)}<div className="rev-modal-footer"><span className="rev-modal-status">{revStatus}</span><button className="btn-ghost-sm" disabled={revUploading} onClick={()=>setShowRevModal(false)}>Cancel</button><button className="btn-amber-sm" disabled={revFiles.length===0||revUploading||revFiles.some(e=>!e.name.trim())} onClick={submitRevisions}>{revUploading?revStatus||'Uploading':'Upload '+revFiles.length+' file'+(revFiles.length!==1?'s':'')}</button></div></div></div></div>)}
      {showReport&&(<>
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.7)',zIndex:200}} onClick={()=>{setShowReport(false);setReportSent(false);setReportMsg('');}}/>
        <div style={{position:'fixed',top:'50%',left:'50%',transform:'translate(-50%,-50%)',background:'var(--surf)',border:'1px solid var(--border2)',borderRadius:14,padding:28,width:360,maxWidth:'90vw',zIndex:201}}>
          <div style={{fontFamily:'var(--fh)',fontSize:18,marginBottom:8}}>Report a Problem</div>
          <div style={{fontSize:12,color:'var(--t2)',marginBottom:16,lineHeight:1.6}}>Found a bug or something not working? Let us know.</div>
          {reportSent
            ? <div style={{textAlign:'center',padding:'20px 0'}}>
                <div style={{fontSize:24,marginBottom:8}}></div>
                <div style={{fontSize:13,color:'var(--amber)'}}>Thanks  we got it.</div>
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

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Player />
    </Suspense>
  );
}
