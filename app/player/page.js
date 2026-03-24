'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import { sb, UPLOAD_WORKER_URL } from '@/lib/supabase';

function fmt(s){if(!s||isNaN(s))return'0:00';return Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0');}
function sanitize(n){return n.replace(/[^a-zA-Z0-9._-]/g,'_');}

const TONES=[
  {label:'Dark + Loud',short:'D+L',desc:'Heavy low end, maximum punch.'},
  {label:'Neutral + Loud',short:'N+L',desc:'Balanced and loud.'},
  {label:'Bright + Loud',short:'B+L',desc:'Aggressive and forward.'},
  {label:'Dark + Normal',short:'D+N',desc:'Warm, rich and cinematic.'},
  {label:'Neutral + Normal',short:'N+N',desc:'Balanced for all genres.'},
  {label:'Bright + Normal',short:'B+N',desc:'Clear and present.'},
  {label:'Dark + Gentle',short:'D+G',desc:'Warm and intimate.'},
  {label:'Neutral + Gentle',short:'N+G',desc:'Natural dynamics.'},
  {label:'Bright + Gentle',short:'B+G',desc:'Airy and delicate.'},
];
const DEFAULT_TONE=4;
function getToneMemory(n){try{const v=localStorage.getItem('mt_'+n.toLowerCase().replace(/\s+/g,'_'));return v!=null?parseInt(v):DEFAULT_TONE;}catch{return DEFAULT_TONE;}}
function setToneMemory(n,i){try{localStorage.setItem('mt_'+n.toLowerCase().replace(/\s+/g,'_'),i);}catch{}}

const FALLBACK_PEAKS=(()=>{const p=[];let s=0x12345678;for(let i=0;i<200;i++){s^=s<<13;s^=s>>17;s^=s<<5;s>>>=0;const e=Math.sin(i/200*Math.PI)*0.6+0.35;p.push(Math.max(0.05,Math.min(0.95,e*(0.45+s/0xFFFFFFFF*0.55))));}return p;})();

async function computePeaks(file,n=200){
  try{const ab=await file.arrayBuffer();const ac=new(window.AudioContext||window.webkitAudioContext)();const buf=await ac.decodeAudioData(ab);ac.close();const raw=buf.getChannelData(0),bs=Math.floor(raw.length/n),peaks=[];for(let i=0;i<n;i++){let max=0;const s=i*bs;for(let j=0;j<bs;j++){const v=Math.abs(raw[s+j]||0);if(v>max)max=v;}peaks.push(Math.min(1,max));}const mx=Math.max(...peaks)||1;return peaks.map(p=>Math.max(0.04,(p/mx)*0.95));}catch(e){return[];}
}

function Waveform({peaks,progress,notes,duration,onSeek}){
  const canvasRef=useRef(null),rafRef=useRef(null),progressRef=useRef(progress);
  useEffect(()=>{progressRef.current=progress;},[progress]);
  const stablePeaks=useRef(FALLBACK_PEAKS);
  if(peaks&&peaks.length>4)stablePeaks.current=peaks;
  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return;
    const dpr=window.devicePixelRatio||1,W=canvas.parentElement?.offsetWidth||600,H=80;
    canvas.width=W*dpr;canvas.height=H*dpr;canvas.style.width=W+'px';canvas.style.height=H+'px';
    const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);
    const data=stablePeaks.current,BAR=2,GAP=1,STEP=BAR+GAP,numBars=Math.floor(W/STEP),cy=H/2;
    const heights=new Float32Array(numBars);
    for(let i=0;i<numBars;i++){const pi=Math.floor(i/numBars*data.length);heights[i]=Math.max(2,data[Math.min(pi,data.length-1)]*(cy-5));}
    const nc=document.createElement('canvas');nc.width=W;nc.height=H;
    const nctx=nc.getContext('2d');
    if(notes&&notes.length&&duration>0){notes.forEach(n=>{if(n.timestamp_sec==null||n.timestamp_sec>duration)return;const x=(n.timestamp_sec/duration)*W;nctx.save();nctx.strokeStyle='rgba(255,255,255,0.25)';nctx.lineWidth=1;nctx.setLineDash([2,3]);nctx.beginPath();nctx.moveTo(x,4);nctx.lineTo(x,H-4);nctx.stroke();nctx.restore();nctx.fillStyle='#e8a020';nctx.beginPath();nctx.arc(x,4,3,0,Math.PI*2);nctx.fill();});}
    let lastPlayX=-999;
    function draw(){
      const prog=Math.max(0,Math.min(1,progressRef.current||0)),playX=prog*W;
      if(Math.abs(playX-lastPlayX)>=0.5){
        lastPlayX=playX;const cutBar=Math.floor(prog*numBars);ctx.clearRect(0,0,W,H);
        for(let i=0;i<numBars;i++){const h=heights[i];ctx.fillStyle=i<cutBar?'rgba(232,160,32,0.9)':'rgba(255,255,255,0.14)';ctx.fillRect(i*STEP,cy-h,BAR,h*2);}
        ctx.drawImage(nc,0,0);
        if(prog>0.001){const px=Math.round(playX);ctx.save();ctx.shadowColor='rgba(232,160,32,0.8)';ctx.shadowBlur=8;ctx.fillStyle='#fff';ctx.fillRect(px-1,0,2,H);ctx.fillStyle='#ffcc44';ctx.beginPath();ctx.arc(px,3,4,0,Math.PI*2);ctx.fill();ctx.restore();}
      }
      rafRef.current=requestAnimationFrame(draw);
    }
    draw();return()=>{if(rafRef.current)cancelAnimationFrame(rafRef.current);};
  },[notes,duration]);
  return(<div onClick={e=>{if(!onSeek)return;const r=e.currentTarget.getBoundingClientRect();onSeek(Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)));}} style={{width:'100%',height:80,cursor:'crosshair',userSelect:'none'}}><canvas ref={canvasRef} style={{display:'block',width:'100%',height:80}}/></div>);
}

// Tone Grid for Rerun modal — greyed cells for already-used tones
function ToneGridRerun({value,usedTones,onChange}){
  const [hov,setHov]=useState(null);
  const tip=TONES[hov!=null?hov:value!=null?value:DEFAULT_TONE];
  return(
    <div className="tgm-wrap">
      <div className="tgm-axes"><span>← Darker</span><span style={{margin:'0 auto',color:'var(--amber)',fontWeight:500}}>TONE GRID</span><span>Brighter →</span></div>
      <div style={{display:'flex',gap:6,alignItems:'flex-start'}}>
        <div className="tgm-row-labels"><div>Louder</div><div>Normal</div><div>Gentler</div></div>
        <div className="tgm-grid">
          {TONES.map((t,i)=>{
            const used=usedTones.includes(i);
            return(
              <button key={i} className={`tgm-cell ${i===value?'active':''} ${i===4?'center':''} ${used?'used':''}`}
                onMouseEnter={()=>!used&&setHov(i)} onMouseLeave={()=>setHov(null)}
                onClick={()=>!used&&onChange(i)}
                disabled={used} title={used?`Already run: ${t.label}`:t.label}>
                {t.short}
                {used&&<span className="tgm-used-dot">✓</span>}
              </button>
            );
          })}
        </div>
      </div>
      <div className="tgm-tip">
        {tip&&<><span className="tgm-tip-label">{tip.label}</span><span className="tgm-tip-desc">{tip.desc}</span></>}
      </div>
      <div style={{fontSize:10,color:'var(--t3)',marginTop:8}}>Greyed cells have already been mastered for this track. Pick a new setting.</div>
    </div>
  );
}

// Single track accordion card with all actions
function TrackCard({track,idx,totalTracks,isActive,onActivate,onReorder,
  audioRef,playing,currentTime,duration,progress,
  notes,noteText,setNoteText,onPostNote,onSeek,onTogglePlay,
  onRename,onDeleteTrack,onDeleteRevision,onRerunRevision,
  onRevisionSelect,activeRevision,projectId}){
  const [menuOpen,setMenuOpen]=useState(false);
  const [renaming,setRenaming]=useState(false);
  const [renameVal,setRenameVal]=useState(track.title||'');
  const [showRevPicker,setShowRevPicker]=useState(false);
  const menuRef=useRef(null);
  const dragHandleRef=useRef(null);
  const revisions=track.revisions||[];
  const activeTone=(activeRevision?.tone_label)||(track.tone_label);
  // Show latest 4 revisions, rest behind "+N more"
  const MAX_VISIBLE=4;
  const sortedRevs=[...revisions].sort((a,b)=>(b.version_number||0)-(a.version_number||0));
  const visibleRevs=sortedRevs.slice(0,MAX_VISIBLE);
  const hiddenCount=sortedRevs.length-MAX_VISIBLE;

  useEffect(()=>{
    if(!menuOpen)return;
    const h=(e)=>{if(menuRef.current&&!menuRef.current.contains(e.target))setMenuOpen(false);};
    document.addEventListener('mousedown',h);document.addEventListener('touchstart',h);
    return()=>{document.removeEventListener('mousedown',h);document.removeEventListener('touchstart',h);};
  },[menuOpen]);

  async function saveRename(){
    const v=renameVal.trim();
    if(!v||v===track.title){setRenaming(false);return;}
    await onRename(track.id,v);
    setRenaming(false);
  }

  // Touch drag for reordering
  const touchState=useRef({startY:0,startIdx:idx,dragging:false});
  function onTouchStart(e){
    touchState.current={startY:e.touches[0].clientY,startIdx:idx,dragging:true};
  }
  function onTouchMove(e){
    if(!touchState.current.dragging)return;
    const dy=e.touches[0].clientY-touchState.current.startY;
    const cardH=80; // approx card height collapsed
    const delta=Math.round(dy/cardH);
    const newIdx=Math.max(0,Math.min(totalTracks-1,touchState.current.startIdx+delta));
    if(newIdx!==idx) onReorder(idx,newIdx);
  }
  function onTouchEnd(){touchState.current.dragging=false;}

  return(
    <div className={`track-card ${isActive?'active':''}`} data-idx={idx}>
      {/* Collapsed header - always visible */}
      <div className="track-header" onClick={()=>!renaming&&onActivate(track.id)}>
        {/* Drag handle */}
        <div className="drag-handle" ref={dragHandleRef}
          onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
          onClick={e=>e.stopPropagation()}
          draggable onDragStart={e=>{e.dataTransfer.setData('text/plain',idx);}}
          onDragOver={e=>{e.preventDefault();}} onDrop={e=>{e.preventDefault();const from=parseInt(e.dataTransfer.getData('text/plain'));onReorder(from,idx);}}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            <rect x="1" y="2" width="12" height="1.5" rx=".75"/><rect x="1" y="6" width="12" height="1.5" rx=".75"/><rect x="1" y="10" width="12" height="1.5" rx=".75"/>
          </svg>
        </div>
        {/* Track name / rename */}
        <div className="track-header-info" onClick={e=>renaming&&e.stopPropagation()}>
          {renaming?(
            <input className="rename-input" value={renameVal} autoFocus
              onChange={e=>setRenameVal(e.target.value)}
              onKeyDown={e=>{if(e.key==='Enter')saveRename();if(e.key==='Escape'){setRenameVal(track.title||'');setRenaming(false);}}}
              onBlur={saveRename}
              onClick={e=>e.stopPropagation()}/>
          ):(
            <span className="track-name">{track.title}</span>
          )}
          {activeTone&&!renaming&&<span className="track-tone-badge">{activeTone}</span>}
        </div>
        {/* Rev count badge */}
        {revisions.length>0&&!isActive&&(
          <span className="rev-count-badge">{revisions.length}v</span>
        )}
        {/* Menu */}
        <div ref={menuRef} style={{position:'relative',flexShrink:0}} onClick={e=>e.stopPropagation()}>
          <button className="track-menu-btn" onClick={()=>setMenuOpen(o=>!o)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
          </button>
          {menuOpen&&(
            <div className="track-dropdown">
              <button className="tdrop-item" onClick={()=>{setMenuOpen(false);setRenameVal(track.title||'');setRenaming(true);onActivate(track.id);}}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                Rename Track
              </button>
              <button className="tdrop-item" onClick={()=>{setMenuOpen(false);onRerunRevision(track);}}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.95"/></svg>
                Rerun Revision
              </button>
              <div className="tdrop-divider"/>
              <button className="tdrop-item" onClick={()=>{setMenuOpen(false);setShowRevPicker(true);}}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                Delete Revision
              </button>
              <button className="tdrop-item danger" onClick={()=>{setMenuOpen(false);onDeleteTrack(track);}}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                Delete Track
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Delete revision picker */}
      {showRevPicker&&(
        <div className="rev-picker" onClick={e=>e.stopPropagation()}>
          <div style={{fontSize:11,color:'var(--t2)',marginBottom:8}}>Select revision to delete:</div>
          {sortedRevs.map(rev=>(
            <button key={rev.id} className="rev-picker-item"
              onClick={async()=>{await onDeleteRevision(rev,track);setShowRevPicker(false);}}>
              {rev.label||`v${rev.version_number}`}
              {rev.tone_label&&<span style={{fontSize:9,color:'var(--amber)',marginLeft:6}}>{rev.tone_label}</span>}
              {rev.is_active&&<span style={{fontSize:9,color:'#6ab4ff',marginLeft:6}}>active</span>}
            </button>
          ))}
          <button className="rev-picker-cancel" onClick={()=>setShowRevPicker(false)}>Cancel</button>
        </div>
      )}

      {/* Expanded content */}
      {isActive&&(
        <div className="track-expanded">
          {/* Revision pills */}
          {revisions.length>0&&(
            <div className="rev-pills-row">
              {visibleRevs.map(rev=>(
                <button key={rev.id}
                  className={`rev-pill ${activeRevision?.id===rev.id?'active':''}`}
                  onClick={e=>{e.stopPropagation();onRevisionSelect(track,rev);}}>
                  {rev.label||`v${rev.version_number}`}
                  {rev.tone_label&&<span className="rev-pill-tone">{rev.tone_label.split(' ')[0]}</span>}
                </button>
              ))}
              {hiddenCount>0&&(
                <button className="rev-pill-more" onClick={e=>{e.stopPropagation();/* show all revs */}}>
                  +{hiddenCount} more
                </button>
              )}
            </div>
          )}
          {/* Waveform + transport */}
          <div className="player-inner">
            <div className="waveform-wrap-inner">
              <Waveform peaks={track.peaks} progress={progress} notes={notes} duration={duration} onSeek={onSeek}/>
              <div className="time-row-inner">
                <span>{fmt(currentTime)}</span>
                <span>{notes.length>0?notes.length+(notes.length===1?' note':' notes'):''}</span>
                <span>{fmt(duration)}</span>
              </div>
            </div>
            <div className="transport-inner">
              <button className="play-btn-inner" onClick={e=>{e.stopPropagation();onTogglePlay();}} disabled={!track.audio_url&&!activeRevision?.audio_url}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="#000">
                  {playing?<><rect x="3" y="1" width="3.5" height="14" rx="1"/><rect x="9.5" y="1" width="3.5" height="14" rx="1"/></>:<polygon points="3,1 15,8 3,15"/>}
                </svg>
              </button>
              <span className="transport-time"><strong>{fmt(currentTime)}</strong> / {fmt(duration)}</span>
              {activeRevision&&<span className="transport-rev">{activeRevision.label||`v${activeRevision.version_number||1}`}</span>}
              {activeTone&&<span className="transport-tone">{activeTone}</span>}
            </div>
          </div>
          {/* Note input */}
          <div className="note-input-inner" onClick={e=>e.stopPropagation()}>
            <div className="note-input-header">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              <span>Note at</span>
              <span className="note-ts-inner">{fmt(currentTime)}</span>
              <span style={{fontSize:9,color:'var(--t3)'}}>live</span>
            </div>
            <textarea className="note-textarea" value={noteText} onChange={e=>setNoteText(e.target.value)}
              placeholder="Add a timestamped note…" rows={2}/>
            <div style={{display:'flex',justifyContent:'flex-end',gap:8,marginTop:8}}>
              <button className="btn-ghost-sm" onClick={()=>setNoteText('')}>Clear</button>
              <button className="btn-amber-sm" onClick={e=>{e.stopPropagation();onPostNote();}} disabled={!noteText.trim()}>Post Note</button>
            </div>
          </div>
          {/* Notes list */}
          {notes.length>0&&(
            <div className="notes-inline">
              <div className="notes-inline-header">NOTES ({notes.length}){activeRevision&&<span className="notes-rev-tag"> — {activeRevision.label||'v1'}</span>}</div>
              {notes.map(n=>(
                <div key={n.id} className="note-inline-item">
                  <div className="note-inline-header">
                    <span className="note-inline-author">{n.author_name||'You'}</span>
                    {n.timestamp_sec!=null&&(
                      <span className="note-inline-ts" onClick={e=>{e.stopPropagation();onSeek(n.timestamp_sec/duration);}}>{n.timestamp_label||fmt(n.timestamp_sec)}</span>
                    )}
                    <span className="note-inline-date">{new Date(n.created_at).toLocaleDateString()}</span>
                  </div>
                  <div className="note-inline-body">{n.body}</div>
                </div>
              ))}
            </div>
          )}
          {notes.length===0&&(
            <div className="notes-empty-inline">No notes yet — hit play and start writing feedback</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Player(){
  const [user,setUser]=useState(null);
  const [project,setProject]=useState(null);
  const [tracks,setTracks]=useState([]);
  const [activeTrackId,setActiveTrackId]=useState(null);
  const [activeRevision,setActiveRevision]=useState(null);
  const [notes,setNotes]=useState([]);
  const [noteText,setNoteText]=useState('');
  const [playing,setPlaying]=useState(false);
  const [currentTime,setCurrentTime]=useState(0);
  const [duration,setDuration]=useState(0);
  const audioRef=useRef(null);
  // Upload revision modal
  const [showRevModal,setShowRevModal]=useState(false);
  const [revFile,setRevFile]=useState(null);
  const [revTrackId,setRevTrackId]=useState('');
  const [revTone,setRevTone]=useState(DEFAULT_TONE);
  const [revDragging,setRevDragging]=useState(false);
  const [revUploading,setRevUploading]=useState(false);
  const [revStatus,setRevStatus]=useState('');
  const [revNameInput,setRevNameInput]=useState('');
  const [revShowSug,setRevShowSug]=useState(false);
  // Rerun revision modal
  const [rerunTrack,setRerunTrack]=useState(null);
  const [rerunTone,setRerunTone]=useState(null);
  const [rerunUploading,setRerunUploading]=useState(false);
  const [rerunStatus,setRerunStatus]=useState('');
  // Delete track confirm
  const [deleteTrackConfirm,setDeleteTrackConfirm]=useState(null);

  useEffect(()=>{
    sb.auth.getSession().then(({data:{session}})=>{
      if(!session){window.location.href='/auth';return;}
      setUser(session.user);
      const pid=new URLSearchParams(window.location.search).get('project');
      if(!pid){window.location.href='/';return;}
      loadProject(pid);
    });
  },[]);

  async function loadProject(pid){
    const {data:proj}=await sb.from('projects').select('*').eq('id',pid).single();
    if(!proj){window.location.href='/';return;}
    setProject(proj);
    const {data:tr}=await sb.from('tracks').select('*,revisions(*)').eq('project_id',pid).order('position');
    const tl=(tr||[]).map(t=>({...t,revisions:[...(t.revisions||[])].sort((a,b)=>(a.version_number||0)-(b.version_number||0))}));
    setTracks(tl);
    if(tl.length>0&&!activeTrackId){
      const first=tl[0];
      setActiveTrackId(first.id);
      const rev=first.revisions?.find(r=>r.is_active)||first.revisions?.[first.revisions.length-1]||null;
      setActiveRevision(rev);
      loadNotes(first.id,rev?.id);
    }
  }

  async function loadNotes(trackId,revId){
    const {data}=await sb.from('notes').select('*').eq('track_id',trackId).order('timestamp_sec');
    const all=data||[];
    setNotes(revId?all.filter(n=>n.revision_id===revId||n.revision_id===null):all);
  }

  const activeTrack=tracks.find(t=>t.id===activeTrackId)||null;

  function activateTrack(trackId){
    if(trackId===activeTrackId){setActiveTrackId(null);return;}
    setActiveTrackId(trackId);
    const t=tracks.find(tr=>tr.id===trackId);
    if(!t)return;
    const rev=t.revisions?.find(r=>r.is_active)||t.revisions?.[t.revisions.length-1]||null;
    if(activeTrack&&t.id!==activeTrackId){
      if(audioRef.current){audioRef.current.pause();}
      setPlaying(false);setCurrentTime(0);
    }
    setActiveRevision(rev);
    loadNotes(t.id,rev?.id);
  }

  function selectRevision(track,rev){
    setActiveRevision(rev);
    if(audioRef.current){audioRef.current.pause();}
    setPlaying(false);setCurrentTime(0);
    loadNotes(track.id,rev?.id);
  }

  function togglePlay(){
    if(!audioRef.current)return;
    if(playing){audioRef.current.pause();setPlaying(false);}
    else{audioRef.current.play();setPlaying(true);}
  }

  function handleSeek(pct){
    if(!audioRef.current||!duration)return;
    const t=pct*duration;audioRef.current.currentTime=t;setCurrentTime(t);
  }

  async function postNote(){
    if(!noteText.trim()||!activeTrack)return;
    await sb.from('notes').insert({
      track_id:activeTrack.id,project_id:project.id,
      revision_id:activeRevision?.id||null,
      author_name:user?.email?.split('@')[0]||'You',
      timestamp_sec:currentTime,timestamp_label:fmt(currentTime),body:noteText.trim()
    });
    setNoteText('');loadNotes(activeTrack.id,activeRevision?.id);
  }

  // Reorder tracks
  async function reorderTracks(fromIdx,toIdx){
    if(fromIdx===toIdx)return;
    const newTracks=[...tracks];
    const [moved]=newTracks.splice(fromIdx,1);
    newTracks.splice(toIdx,0,moved);
    const updated=newTracks.map((t,i)=>({...t,position:i}));
    setTracks(updated);
    await Promise.all(updated.map(t=>sb.from('tracks').update({position:t.position}).eq('id',t.id)));
  }

  // Rename track
  async function renameTrack(trackId,newTitle){
    await sb.from('tracks').update({title:newTitle}).eq('id',trackId);
    setTracks(prev=>prev.map(t=>t.id===trackId?{...t,title:newTitle}:t));
  }

  // Delete track
  async function deleteTrack(track){
    setDeleteTrackConfirm(null);
    // Delete R2 files
    const urls=new Set();
    (track.revisions||[]).forEach(r=>{if(r.audio_url)urls.add(r.audio_url);if(r.mp3_url&&r.mp3_url!==r.audio_url)urls.add(r.mp3_url);});
    if(track.audio_url)urls.add(track.audio_url);
    await Promise.allSettled([...urls].map(url=>{
      try{const k=decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));return fetch(UPLOAD_WORKER_URL,{method:'DELETE',headers:{'X-File-Key':k}});}catch{return Promise.resolve();}
    }));
    await sb.from('notes').delete().eq('track_id',track.id);
    await sb.from('revisions').delete().eq('track_id',track.id);
    await sb.from('tracks').delete().eq('id',track.id);
    setTracks(prev=>prev.filter(t=>t.id!==track.id));
    if(activeTrackId===track.id){setActiveTrackId(null);setActiveRevision(null);setNotes([]);}
  }

  // Delete revision
  async function deleteRevision(rev,track){
    try{const k=decodeURIComponent(new URL(rev.audio_url||rev.mp3_url).pathname.replace(/^\//,''));await fetch(UPLOAD_WORKER_URL,{method:'DELETE',headers:{'X-File-Key':k}});}catch{}
    await sb.from('notes').delete().eq('revision_id',rev.id);
    await sb.from('revisions').delete().eq('id',rev.id);
    // If deleted the active one, promote the latest remaining
    if(rev.is_active){
      const {data:remaining}=await sb.from('revisions').select('id').eq('track_id',track.id).order('version_number',{ascending:false}).limit(1);
      if(remaining?.[0])await sb.from('revisions').update({is_active:true}).eq('id',remaining[0].id);
    }
    await loadProject(project.id);
  }

  // Rerun revision
  async function submitRerun(){
    if(!rerunTrack||rerunTone===null)return;
    setRerunUploading(true);
    try{
      // Find the active revision's source file to re-upload
      const activeRev=rerunTrack.revisions?.find(r=>r.is_active)||rerunTrack.revisions?.[rerunTrack.revisions.length-1];
      if(!activeRev){throw new Error('No active revision to rerun');}
      setRerunStatus('Copying source audio…');
      // Fetch the existing audio and re-upload with new tone label
      const audioResp=await fetch(activeRev.audio_url||activeRev.mp3_url);
      const blob=await audioResp.blob();
      const fname='rerun_'+Date.now()+'.wav';
      setRerunStatus('Uploading…');
      const r=await fetch(UPLOAD_WORKER_URL,{method:'POST',headers:{'X-File-Name':fname,'X-Project-Id':project.id,'Content-Type':'audio/wav'},body:blob});
      const result=await r.json();
      if(!result.url)throw new Error('Upload failed');
      const {data:existing}=await sb.from('revisions').select('version_number').eq('track_id',rerunTrack.id).order('version_number',{ascending:false}).limit(1);
      const nextVer=(existing?.[0]?.version_number||1)+1;
      await sb.from('revisions').update({is_active:false}).eq('track_id',rerunTrack.id);
      const tone=TONES[rerunTone];
      await sb.from('revisions').insert({track_id:rerunTrack.id,project_id:project.id,version_number:nextVer,label:'v'+nextVer,audio_url:result.url,mp3_url:result.url,tone_setting:rerunTone,tone_label:tone.label,is_active:true});
      if(rerunTrack.title)setToneMemory(rerunTrack.title,rerunTone);
      setRerunTrack(null);setRerunTone(null);setRerunStatus('');
      await loadProject(project.id);
    }catch(e){setRerunStatus('Error: '+e.message);}
    setRerunUploading(false);
  }

  // Upload revision (from Upload Revision button)
  function openRevModal(){setRevFile(null);setRevTrackId('');setRevTone(DEFAULT_TONE);setRevNameInput('');setRevStatus('');setShowRevModal(true);}
  function pickRevTrack(t){setRevTrackId(t.id);setRevNameInput(t.title);setRevTone(getToneMemory(t.title));setRevShowSug(false);}
  function handleRevNameChange(val){setRevNameInput(val);const m=tracks.find(t=>t.title.toLowerCase()===val.toLowerCase());if(m){setRevTrackId(m.id);setRevTone(getToneMemory(m.title));}else setRevTrackId('');setRevShowSug(true);}
  async function uploadRevision(){
    if(!revFile||!revTrackId)return;
    setRevUploading(true);
    try{
      const safeName='rev_'+Date.now()+'_'+sanitize(revFile.name);
      setRevStatus('Uploading…');
      const r=await fetch(UPLOAD_WORKER_URL,{method:'POST',headers:{'X-File-Name':safeName,'X-Project-Id':project.id,'Content-Type':revFile.type||'audio/wav'},body:revFile});
      const result=await r.json();
      if(!result.url)throw new Error('Upload failed');
      const peaks=await computePeaks(revFile);
      const {data:existing}=await sb.from('revisions').select('version_number').eq('track_id',revTrackId).order('version_number',{ascending:false}).limit(1);
      const nextVer=(existing?.[0]?.version_number||1)+1;
      await sb.from('revisions').update({is_active:false}).eq('track_id',revTrackId);
      const tone=TONES[revTone];
      await sb.from('revisions').insert({track_id:revTrackId,project_id:project.id,version_number:nextVer,label:'v'+nextVer,audio_url:result.url,mp3_url:result.url,tone_setting:revTone,tone_label:tone.label,is_active:true});
      if(peaks.length>0)await sb.from('tracks').update({peaks,tone_setting:revTone,tone_label:tone.label}).eq('id',revTrackId);
      if(revNameInput.trim())setToneMemory(revNameInput.trim(),revTone);
      setShowRevModal(false);await loadProject(project.id);
    }catch(e){setRevStatus('Error: '+e.message);}
    setRevUploading(false);
  }

  const audioUrl=activeRevision?activeRevision.mp3_url||activeRevision.audio_url:activeTrack?.mp3_url||activeTrack?.audio_url;
  const progress=duration?currentTime/duration:0;
  const revSuggestions=revNameInput?tracks.filter(t=>t.title.toLowerCase().includes(revNameInput.toLowerCase())):tracks;
  const rerunUsedTones=rerunTrack?(rerunTrack.revisions||[]).map(r=>r.tone_setting).filter(t=>t!=null):[];

  return(
    <>
      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        :root{--bg:#0a0a0b;--surf:#111113;--surf2:#16161a;--surf3:#1e1e24;--border:#24242c;--border2:#2e2e38;--amber:#e8a020;--aglow:rgba(232,160,32,0.08);--text:#f0ede8;--t2:#8a8780;--t3:#4a4945;--red:#e05050;--fh:'DM Serif Display',Georgia,serif;--fm:'DM Mono','SF Mono','Menlo',monospace;}
        html,body{background:var(--bg);color:var(--text);font-family:var(--fm);}
        /* Topbar */
        .topbar{height:52px;display:flex;align-items:center;justify-content:space-between;padding:0 16px;background:var(--surf);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:20;}
        .logo{font-family:var(--fh);font-size:18px;color:var(--text);text-decoration:none;} .logo em{color:var(--amber);font-style:normal;}
        .breadcrumb{font-size:12px;color:var(--t2);margin-left:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px;}
        .back{font-size:11px;color:var(--t2);text-decoration:none;padding:5px 10px;border-radius:7px;border:1px solid var(--border2);-webkit-tap-highlight-color:transparent;touch-action:manipulation;} .back:hover{color:var(--text);}
        /* Page */
        .page{max-width:800px;margin:0 auto;padding:16px 16px 48px;}
        .proj-title{font-family:var(--fh);font-size:clamp(22px,5vw,36px);margin-bottom:3px;}
        .proj-artist{font-size:12px;color:var(--t2);margin-bottom:16px;}
        /* Top actions */
        .top-actions{display:flex;gap:10px;align-items:center;margin-bottom:20px;flex-wrap:wrap;}
        .play-all-btn{display:flex;align-items:center;gap:7px;font-family:var(--fm);font-size:12px;font-weight:500;padding:9px 18px;border-radius:8px;background:var(--amber);color:#000;border:none;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;} .play-all-btn:hover{opacity:.9;}
        .upload-rev-top{display:flex;align-items:center;gap:6px;font-family:var(--fm);font-size:12px;padding:9px 14px;border-radius:8px;border:1.5px solid var(--border2);background:transparent;color:var(--t2);cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;} .upload-rev-top:hover{border-color:var(--amber);color:var(--amber);}
        .tracks-label{font-size:10px;color:var(--t3);letter-spacing:.12em;text-transform:uppercase;margin-bottom:10px;}
        /* Track cards */
        .track-card{background:var(--surf);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:8px;transition:border-color .2s;}
        .track-card.active{border-color:var(--amber);}
        .track-card:hover:not(.active){border-color:var(--border2);}
        .track-header{display:flex;align-items:center;gap:8px;padding:14px;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;min-height:52px;}
        /* Drag handle */
        .drag-handle{width:28px;height:28px;display:flex;align-items:center;justify-content:center;color:var(--t3);cursor:grab;flex-shrink:0;border-radius:6px;-webkit-tap-highlight-color:transparent;touch-action:none;}
        .drag-handle:active{cursor:grabbing;color:var(--t2);background:var(--surf2);}
        .drag-handle:hover{color:var(--t2);}
        .track-header-info{flex:1;min-width:0;display:flex;align-items:center;gap:8px;}
        .track-name{font-family:var(--fh);font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .track-tone-badge{font-size:9px;padding:2px 7px;border-radius:4px;background:var(--aglow);border:1px solid rgba(232,160,32,.25);color:var(--amber);white-space:nowrap;flex-shrink:0;}
        .rev-count-badge{font-size:9px;padding:2px 7px;border-radius:4px;background:var(--surf2);border:1px solid var(--border2);color:var(--t3);white-space:nowrap;flex-shrink:0;letter-spacing:.04em;}
        /* Rename input */
        .rename-input{flex:1;background:var(--bg);border:1.5px solid var(--amber);border-radius:7px;color:var(--text);font-family:var(--fh);font-size:15px;padding:6px 10px;outline:none;-webkit-appearance:none;min-width:0;}
        /* Track menu */
        .track-menu-btn{width:32px;height:32px;border-radius:8px;border:1px solid transparent;background:transparent;color:var(--t3);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;-webkit-tap-highlight-color:transparent;touch-action:manipulation;padding:0;} .track-menu-btn:hover{background:var(--surf2);color:var(--t2);}
        .track-dropdown{position:absolute;top:calc(100%+4px);right:0;background:var(--surf2);border:1px solid var(--border2);border-radius:10px;min-width:170px;z-index:50;box-shadow:0 8px 32px rgba(0,0,0,.5);overflow:hidden;}
        .tdrop-item{width:100%;padding:11px 14px;display:flex;align-items:center;gap:9px;font-family:var(--fm);font-size:12px;color:var(--t2);background:transparent;border:none;cursor:pointer;text-align:left;-webkit-tap-highlight-color:transparent;touch-action:manipulation;} .tdrop-item:hover,.tdrop-item:active{background:var(--surf3);color:var(--text);}
        .tdrop-item.danger{color:#e08080;} .tdrop-item.danger:hover,.tdrop-item.danger:active{background:rgba(224,80,80,.1);color:var(--red);}
        .tdrop-divider{height:1px;background:var(--border);margin:2px 0;}
        /* Rev picker */
        .rev-picker{padding:14px;border-top:1px solid var(--border);background:var(--surf2);}
        .rev-picker-item{width:100%;padding:9px 12px;text-align:left;background:transparent;border:1px solid var(--border2);border-radius:7px;color:var(--text);font-family:var(--fm);font-size:12px;cursor:pointer;margin-bottom:6px;display:flex;align-items:center;-webkit-tap-highlight-color:transparent;touch-action:manipulation;} .rev-picker-item:hover{border-color:var(--red);color:var(--red);}
        .rev-picker-cancel{width:100%;padding:9px;background:transparent;border:1.5px solid var(--border2);border-radius:7px;color:var(--t2);font-family:var(--fm);font-size:12px;cursor:pointer;-webkit-tap-highlight-color:transparent;}
        /* Expanded content */
        .track-expanded{padding:0 14px 14px;border-top:1px solid var(--border);}
        /* Revision pills */
        .rev-pills-row{display:flex;gap:6px;padding:12px 0 10px;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;} .rev-pills-row::-webkit-scrollbar{display:none;}
        .rev-pill{padding:6px 12px;border-radius:20px;border:1.5px solid var(--border2);background:transparent;color:var(--t2);font-family:var(--fm);font-size:11px;cursor:pointer;white-space:nowrap;display:flex;align-items:center;gap:5px;flex-shrink:0;-webkit-tap-highlight-color:transparent;touch-action:manipulation;} .rev-pill:hover{border-color:var(--t2);color:var(--text);} .rev-pill.active{border-color:var(--amber);background:var(--aglow);color:var(--amber);}
        .rev-pill-tone{font-size:8px;opacity:.7;}
        .rev-pill-more{padding:6px 12px;border-radius:20px;border:1.5px dashed var(--border2);background:transparent;color:var(--t3);font-family:var(--fm);font-size:11px;cursor:pointer;white-space:nowrap;flex-shrink:0;-webkit-tap-highlight-color:transparent;}
        /* Waveform + transport */
        .player-inner{background:var(--surf2);border-radius:10px;padding:12px;margin-bottom:12px;}
        .waveform-wrap-inner{border-radius:6px;overflow:hidden;margin-bottom:8px;}
        .time-row-inner{display:flex;justify-content:space-between;font-size:10px;color:var(--t3);}
        .transport-inner{display:flex;align-items:center;gap:10px;}
        .play-btn-inner{width:40px;height:40px;border-radius:50%;background:var(--amber);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;-webkit-tap-highlight-color:transparent;touch-action:manipulation;} .play-btn-inner:disabled{opacity:.3;pointer-events:none;}
        .transport-time{font-size:13px;color:var(--t2);font-variant-numeric:tabular-nums;} .transport-time strong{color:var(--text);}
        .transport-rev{margin-left:auto;font-size:9px;padding:2px 8px;border-radius:4px;background:var(--aglow);border:1px solid rgba(232,160,32,.2);color:var(--amber);letter-spacing:.06em;text-transform:uppercase;}
        .transport-tone{font-size:9px;padding:2px 8px;border-radius:4px;background:var(--aglow);border:1px solid rgba(232,160,32,.15);color:var(--amber);opacity:.7;white-space:nowrap;}
        /* Note input */
        .note-input-inner{background:var(--surf3);border-radius:10px;padding:12px;margin-bottom:10px;}
        .note-input-header{display:flex;align-items:center;gap:6px;margin-bottom:8px;font-size:11px;color:var(--t2);}
        .note-ts-inner{padding:2px 8px;background:var(--aglow);border:1px solid rgba(232,160,32,.25);border-radius:5px;font-size:11px;color:var(--amber);font-weight:500;}
        .note-textarea{width:100%;background:var(--bg);border:1.5px solid var(--border2);border-radius:7px;padding:9px 11px;color:var(--text);font-family:var(--fm);font-size:12px;resize:none;outline:none;-webkit-appearance:none;} .note-textarea:focus{border-color:var(--amber);}
        .btn-ghost-sm{font-family:var(--fm);font-size:11px;padding:6px 12px;border-radius:7px;border:1.5px solid var(--border2);background:transparent;color:var(--t2);cursor:pointer;-webkit-tap-highlight-color:transparent;}
        .btn-amber-sm{font-family:var(--fm);font-size:11px;font-weight:500;padding:6px 14px;border-radius:7px;background:var(--amber);color:#000;border:none;cursor:pointer;-webkit-tap-highlight-color:transparent;} .btn-amber-sm:disabled{opacity:.35;pointer-events:none;}
        /* Notes inline */
        .notes-inline{border-top:1px solid var(--border);padding-top:12px;}
        .notes-inline-header{font-size:9px;color:var(--amber);letter-spacing:.12em;text-transform:uppercase;font-weight:500;margin-bottom:10px;}
        .notes-rev-tag{font-size:9px;color:var(--t3);text-transform:none;letter-spacing:normal;font-weight:normal;}
        .note-inline-item{padding:10px 0;border-bottom:1px solid var(--border);} .note-inline-item:last-child{border-bottom:none;}
        .note-inline-header{display:flex;align-items:center;gap:7px;margin-bottom:5px;}
        .note-inline-author{font-size:11px;color:var(--text);font-weight:500;}
        .note-inline-ts{font-size:10px;padding:2px 7px;background:var(--aglow);border:1px solid rgba(232,160,32,.2);color:var(--amber);border-radius:4px;cursor:pointer;-webkit-tap-highlight-color:transparent;}
        .note-inline-date{font-size:10px;color:var(--t3);margin-left:auto;}
        .note-inline-body{font-size:12px;color:var(--t2);line-height:1.6;}
        .notes-empty-inline{font-size:11px;color:var(--t3);padding:10px 0;text-align:center;}
        /* Delete track confirm overlay */
        .delete-confirm-overlay{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:200;display:flex;align-items:center;justify-content:center;padding:20px;}
        .delete-confirm-box{background:var(--surf);border:1px solid var(--red);border-radius:14px;padding:28px;max-width:360px;width:100%;text-align:center;}
        .dcb-title{font-family:var(--fh);font-size:18px;margin-bottom:8px;}
        .dcb-sub{font-size:12px;color:var(--t2);margin-bottom:20px;line-height:1.5;}
        .dcb-actions{display:flex;gap:10px;justify-content:center;}
        .dcb-cancel{font-family:var(--fm);font-size:13px;padding:10px 20px;border-radius:9px;border:1.5px solid var(--border2);background:transparent;color:var(--t2);cursor:pointer;}
        .dcb-delete{font-family:var(--fm);font-size:13px;font-weight:500;padding:10px 20px;border-radius:9px;background:var(--red);color:#fff;border:none;cursor:pointer;}
        /* Rerun modal */
        .modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.85);backdrop-filter:blur(8px);z-index:100;display:flex;align-items:flex-start;justify-content:center;padding:32px 16px;overflow-y:auto;}
        .rev-modal{background:var(--surf);border:1px solid var(--border2);border-radius:16px;width:100%;max-width:540px;padding:24px;margin:auto;}
        .rev-modal-title{font-family:var(--fh);font-size:20px;margin-bottom:16px;}
        .rm-field{margin-bottom:14px;}
        .rm-label{display:block;font-size:11px;color:var(--t2);letter-spacing:.07em;text-transform:uppercase;margin-bottom:7px;}
        .rm-input{width:100%;background:var(--surf2);border:1.5px solid var(--border2);border-radius:10px;color:var(--text);font-family:var(--fm);font-size:14px;padding:11px 13px;outline:none;-webkit-appearance:none;} .rm-input:focus{border-color:var(--amber);}
        .rm-suggestions{background:var(--surf2);border:1px solid var(--border2);border-radius:10px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.5);margin-top:4px;}
        .rm-sug-item{width:100%;padding:10px 13px;display:flex;align-items:center;justify-content:space-between;background:transparent;border:none;color:var(--text);font-family:var(--fm);font-size:13px;cursor:pointer;text-align:left;-webkit-tap-highlight-color:transparent;} .rm-sug-item:hover,.rm-sug-item:active{background:var(--surf3);}
        .rm-sug-tone{font-size:9px;color:var(--amber);background:var(--aglow);padding:2px 7px;border-radius:4px;}
        .rm-dropzone{border:2px dashed var(--border2);border-radius:10px;background:var(--surf2);padding:22px;text-align:center;cursor:pointer;font-size:12px;color:var(--t2);transition:all .2s;-webkit-tap-highlight-color:transparent;touch-action:manipulation;} .rm-dropzone:hover,.rm-dropzone.over{border-color:var(--amber);background:var(--aglow);color:var(--amber);} .rm-dropzone.has-file{border-color:var(--amber);border-style:solid;background:var(--aglow);}
        .rm-footer{display:flex;justify-content:flex-end;align-items:center;gap:10px;margin-top:18px;border-top:1px solid var(--border);padding-top:16px;}
        .rm-status{font-size:11px;color:var(--t2);margin-right:auto;}
        .btn-rm-cancel{font-family:var(--fm);font-size:13px;padding:10px 18px;border-radius:9px;border:1.5px solid var(--border2);background:transparent;color:var(--t2);cursor:pointer;-webkit-tap-highlight-color:transparent;}
        .btn-rm-create{font-family:var(--fm);font-size:13px;font-weight:500;padding:10px 20px;border-radius:9px;background:var(--amber);color:#000;border:none;cursor:pointer;-webkit-tap-highlight-color:transparent;} .btn-rm-create:disabled{opacity:.4;pointer-events:none;}
        /* Tone grid mini */
        .tgm-wrap{background:var(--surf3);border:1px solid var(--border2);border-radius:10px;padding:12px;margin-top:4px;}
        .tgm-axes{display:flex;font-size:9px;color:var(--t3);letter-spacing:.07em;text-transform:uppercase;margin-bottom:8px;align-items:center;}
        .tgm-row-labels{display:flex;flex-direction:column;gap:4px;margin-right:6px;font-size:9px;color:var(--t3);letter-spacing:.05em;text-transform:uppercase;}
        .tgm-row-labels div{height:38px;display:flex;align-items:center;justify-content:flex-end;white-space:nowrap;}
        .tgm-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;flex:1;}
        .tgm-cell{height:38px;border-radius:6px;border:1.5px solid var(--border2);background:var(--surf2);color:var(--t2);cursor:pointer;display:flex;align-items:center;justify-content:center;font-family:var(--fm);font-size:10px;font-weight:600;transition:all .15s;-webkit-tap-highlight-color:transparent;touch-action:manipulation;position:relative;}
        .tgm-cell:hover:not(:disabled){border-color:var(--amber);color:var(--text);background:var(--aglow);} .tgm-cell.active{border-color:var(--amber);background:rgba(232,160,32,.18);color:var(--amber);} .tgm-cell.center{border-color:rgba(232,160,32,.3);}
        .tgm-cell.used{opacity:.35;cursor:not-allowed;background:var(--surf3);}
        .tgm-used-dot{position:absolute;top:2px;right:3px;font-size:8px;color:var(--t3);}
        .tgm-tip{margin-top:8px;padding:7px 10px;background:var(--surf2);border-radius:7px;display:flex;flex-direction:column;gap:2px;min-height:40px;}
        .tgm-tip-label{font-size:11px;color:var(--amber);font-weight:500;} .tgm-tip-desc{font-size:10px;color:var(--t2);}
        @media(min-width:768px){.page{padding:24px 32px 48px;}}
      `}</style>

      <div className="topbar">
        <div style={{display:'flex',alignItems:'center',gap:6,minWidth:0}}>
          <a href="/" className="logo">maastr<em>.</em></a>
          <span style={{color:'var(--border2)',fontSize:14}}>/</span>
          <span className="breadcrumb">{project?.title||'…'}</span>
        </div>
        <a href="/" className="back">← Dashboard</a>
      </div>

      <div className="page">
        <div className="proj-title">{project?.title}</div>
        <div className="proj-artist">{project?.artist}</div>

        <div className="top-actions">
          <button className="upload-rev-top" onClick={openRevModal}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Upload Revision
          </button>
        </div>

        <div className="tracks-label">Tracks ({tracks.length})</div>

        {tracks.map((track,idx)=>(
          <TrackCard key={track.id}
            track={track} idx={idx} totalTracks={tracks.length}
            isActive={activeTrackId===track.id}
            onActivate={activateTrack}
            onReorder={reorderTracks}
            audioRef={audioRef}
            playing={activeTrackId===track.id&&playing}
            currentTime={activeTrackId===track.id?currentTime:0}
            duration={activeTrackId===track.id?duration:0}
            progress={activeTrackId===track.id?progress:0}
            notes={activeTrackId===track.id?notes:[]}
            noteText={activeTrackId===track.id?noteText:''}
            setNoteText={activeTrackId===track.id?setNoteText:()=>{}}
            onPostNote={postNote}
            onSeek={handleSeek}
            onTogglePlay={togglePlay}
            onRename={renameTrack}
            onDeleteTrack={(t)=>setDeleteTrackConfirm(t)}
            onDeleteRevision={deleteRevision}
            onRerunRevision={(t)=>{setRerunTrack(t);setRerunTone(null);setRerunStatus('');}}
            onRevisionSelect={selectRevision}
            activeRevision={activeTrackId===track.id?activeRevision:null}
            projectId={project?.id}
          />
        ))}

        {tracks.length===0&&(
          <div style={{textAlign:'center',padding:'60px 20px',color:'var(--t3)'}}>
            <div style={{fontSize:28,marginBottom:8,opacity:.4}}>♪</div>
            No tracks yet
          </div>
        )}
      </div>

      {/* Invisible audio element */}
      {audioUrl&&(
        <audio ref={audioRef} src={audioUrl} preload="metadata"
          onTimeUpdate={e=>{setCurrentTime(e.target.currentTime);}}
          onDurationChange={e=>setDuration(e.target.duration)}
          onEnded={()=>setPlaying(false)}/>
      )}

      {/* Delete track confirm */}
      {deleteTrackConfirm&&(
        <div className="delete-confirm-overlay" onClick={()=>setDeleteTrackConfirm(null)}>
          <div className="delete-confirm-box" onClick={e=>e.stopPropagation()}>
            <div className="dcb-title">Delete “{deleteTrackConfirm.title}”?</div>
            <div className="dcb-sub">This permanently deletes {deleteTrackConfirm.revisions?.length||0} revision{(deleteTrackConfirm.revisions?.length||0)!==1?'s':''} and all notes. Cannot be undone.</div>
            <div className="dcb-actions">
              <button className="dcb-cancel" onClick={()=>setDeleteTrackConfirm(null)}>Keep it</button>
              <button className="dcb-delete" onClick={()=>deleteTrack(deleteTrackConfirm)}>Delete forever</button>
            </div>
          </div>
        </div>
      )}

      {/* Rerun Revision Modal */}
      {rerunTrack&&(
        <div className="modal-bg" onClick={e=>e.target===e.currentTarget&&!rerunUploading&&setRerunTrack(null)}>
          <div className="rev-modal">
            <div className="rev-modal-title">Rerun: {rerunTrack.title}</div>
            <p style={{fontSize:12,color:'var(--t2)',marginBottom:16,lineHeight:1.5}}>
              Choose a new mastering setting. The same source mix will be re-processed with your new selection.
              Settings already used for this track are greyed out.
            </p>
            <div className="rm-field">
              <label className="rm-label">New Mastering Setting</label>
              <ToneGridRerun value={rerunTone} usedTones={rerunUsedTones} onChange={setRerunTone}/>
            </div>
            <div className="rm-footer">
              <span className="rm-status">{rerunStatus}</span>
              <button className="btn-rm-cancel" disabled={rerunUploading} onClick={()=>setRerunTrack(null)}>Cancel</button>
              <button className="btn-rm-create" disabled={rerunTone===null||rerunUploading} onClick={submitRerun}>
                {rerunUploading?'Processing…':'Rerun Mastering'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload Revision Modal */}
      {showRevModal&&(
        <div className="modal-bg" onClick={e=>e.target===e.currentTarget&&!revUploading&&setShowRevModal(false)}>
          <div className="rev-modal">
            <div className="rev-modal-title">Upload Revision</div>
            <div className="rm-field">
              <label className="rm-label">Track</label>
              <div style={{position:'relative'}}>
                <input className="rm-input" value={revNameInput} placeholder="Type to search or pick from list…"
                  onChange={e=>handleRevNameChange(e.target.value)} onFocus={()=>setRevShowSug(true)} autoFocus/>
                {revShowSug&&revSuggestions.length>0&&(
                  <div className="rm-suggestions">
                    {revSuggestions.map(t=>(
                      <button key={t.id} className="rm-sug-item" onClick={()=>pickRevTrack(t)}>
                        <span>{t.title}</span>
                        {t.tone_label&&<span className="rm-sug-tone">{t.tone_label}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="rm-field">
              <label className="rm-label">Audio File</label>
              <div className={`rm-dropzone ${revDragging?'over':''} ${revFile?'has-file':''}`}
                onDragOver={e=>{e.preventDefault();setRevDragging(true);}} onDragLeave={e=>{e.preventDefault();setRevDragging(false);}}
                onDrop={e=>{e.preventDefault();e.stopPropagation();setRevDragging(false);const f=e.dataTransfer?.files?.[0];if(f)setRevFile(f);}}
                onClick={()=>document.getElementById('rev-file-input').click()}>
                <div style={{fontSize:22,marginBottom:5}}>{revFile?'✓':'🎵'}</div>
                {revFile?<><strong style={{color:'var(--amber)'}}>{revFile.name}</strong><br/><span style={{fontSize:10,opacity:.6}}>{(revFile.size/1024/1024).toFixed(1)} MB</span></>:<><strong>Drop WAV / MP3</strong><br/><span style={{fontSize:10,opacity:.6}}>or tap to browse</span></>}
                <input id="rev-file-input" type="file" accept=".wav,.mp3,.aiff,.aif,.flac,.m4a,audio/*" style={{display:'none'}} onChange={e=>{if(e.target.files[0])setRevFile(e.target.files[0]);e.target.value='';}}/>
              </div>
            </div>
            <div className="rm-field">
              <label className="rm-label">Mastering</label>
              <ToneGridRerun value={revTone} usedTones={[]} onChange={i=>{setRevTone(i);if(revNameInput.trim())setToneMemory(revNameInput.trim(),i);}}/>
            </div>
            <div className="rm-footer">
              <span className="rm-status">{revStatus}</span>
              <button className="btn-rm-cancel" disabled={revUploading} onClick={()=>setShowRevModal(false)}>Cancel</button>
              <button className="btn-rm-create" disabled={!revFile||!revTrackId||revUploading} onClick={uploadRevision}>
                {revUploading?'Uploading…':'Upload Revision'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
            }
