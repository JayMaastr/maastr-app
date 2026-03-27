'use client';
import NotificationCenter from '@/app/components/NotificationCenter';
import { useEffect, useState, useRef } from 'react';
import { sb, UPLOAD_WORKER_URL } from '@/lib/supabase';

const STABLE_PEAKS = (() => {
  const p=[]; let s=0xABCDEF;
  for(let i=0;i<100;i++){s^=s<<13;s^=s>>17;s^=s<<5;s>>>=0;p.push(Math.max(0.04,Math.min(0.96,(0.3+Math.sin(i/100*Math.PI)*0.4)*(0.5+s/0xFFFFFFFF*0.5))));}
  return p;
})();

const TONES = [
  {label:'Warm + Loud',   short:'W+L', desc:'Heavy low end, maximum punch. Metal, hip-hop, EDM.'},
  {label:'Neutral + Loud',short:'N+L', desc:'Balanced but loud and competitive. Pop, rock, mainstream.'},
  {label:'Bright + Loud', short:'B+L', desc:'Aggressive and forward. Pop-punk, K-pop, high-energy.'},
  {label:'Warm + Normal', short:'W+N', desc:'Warm, rich and cinematic. R&B, film scores, neo-soul.'},
  {label:'Neutral + Normal',short:'N+N',desc:'Balanced master for all genres. The safe default.'},
  {label:'Bright + Normal',short:'B+N',desc:'Clear and present. Great for vocals and acoustic.'},
  {label:'Warm + Gentle', short:'W+G', desc:'Warm and intimate. Jazz, classical, acoustic folk.'},
  {label:'Neutral + Gentle',short:'N+G',desc:'Natural dynamics, no hype. Singer-songwriter, lo-fi.'},
  {label:'Bright + Gentle',short:'B+G', desc:'Airy and delicate. Ambient, new age, classical.'},
];
const DEFAULT_TONE = 4;
const TONE_BG=['rgba(232,160,32,0.82)','rgba(190,190,210,0.70)','rgba(60,180,255,0.78)','rgba(232,160,32,0.55)','rgba(160,160,185,0.48)','rgba(60,180,255,0.52)','rgba(232,160,32,0.28)','rgba(130,130,155,0.25)','rgba(60,180,255,0.26)'];
const TONE_BORDER=['#c47800','#7878a0','#0099dd','#c47800','#7878a0','#0099dd','#c47800','#7878a0','#0099dd'];

function getToneMemory(name) {
  try{const v=localStorage.getItem('mt_'+name.toLowerCase().replace(/\s+/g,'_'));return v!=null?parseInt(v):DEFAULT_TONE;}catch{return DEFAULT_TONE;}
}
function setToneMemory(name,idx) {
  try{localStorage.setItem('mt_'+name.toLowerCase().replace(/\s+/g,'_'),idx);}catch{}
}

// Compute waveform peaks from an audio file using Web Audio API
async function computePeaks(file, numPeaks = 100) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    audioCtx.close();
    const rawData = audioBuffer.getChannelData(0);
    const blockSize = Math.floor(rawData.length / numPeaks);
    const peaks = [];
    for (let i = 0; i < numPeaks; i++) {
      let max = 0;
      const start = i * blockSize;
      for (let j = 0; j < blockSize; j++) {
        const val = Math.abs(rawData[start + j] || 0);
        if (val > max) max = val;
      }
      peaks.push(Math.min(1, max));
    }
    // Normalize so loudest peak = 0.95
    const maxPeak = Math.max(...peaks) || 1;
    return peaks.map(p => Math.max(0.04, (p / maxPeak) * 0.95));
  } catch(e) {
    console.warn('Peak computation failed:', e.message);
    return [];
  }
}

function WaveformCanvas({peaks}) {
  const ref=useRef(null);
  useEffect(()=>{
    const canvas=ref.current; if(!canvas) return;
    const data=(peaks&&peaks.length>4)?peaks:STABLE_PEAKS;
    const W=canvas.offsetWidth||268,H=48;
    canvas.width=W*devicePixelRatio;canvas.height=H*devicePixelRatio;
    canvas.style.width=W+'px';canvas.style.height=H+'px';
    const ctx=canvas.getContext('2d');ctx.scale(devicePixelRatio,devicePixelRatio);
    const cy=H/2,BAR=2,GAP=1,STEP=BAR+GAP,numBars=Math.floor(W/STEP);
    for(let i=0;i<numBars;i++){
      const pi=Math.floor(i/numBars*data.length),amp=data[Math.min(pi,data.length-1)];
      const h=Math.max(1.5,amp*(cy-4));
      const g=ctx.createLinearGradient(0,cy-h,0,cy+h);
      g.addColorStop(0,'rgba(232,160,32,.55)');g.addColorStop(.5,'rgba(232,160,32,.25)');g.addColorStop(1,'rgba(232,160,32,.06)');
      ctx.fillStyle=g;ctx.fillRect(i*STEP,cy-h,BAR,h*2);
    }
  },[peaks]);
  return <canvas ref={ref} style={{display:'block',width:'100%',height:'100%'}}/>;
}

function ToneGrid({value,usedTones=[],onChange,onSetAll,showSetAll}){const [hov,setHov]=useState(null);const tip=TONES[hov!=null?hov:value!=null?value:DEFAULT_TONE];return(<div className="tgm-wrap"><div className="tgm-axes"><span>← Warmer</span><span style={{margin:'0 auto',color:'#e8a020',fontWeight:500,fontSize:10}}>TONE GRID</span><span>Brighter →</span></div><div style={{display:'flex',gap:6,alignItems:'flex-start'}}><div className="tgm-row-labels"><div>Louder</div><div>Normal</div><div>Gentler</div></div><div className="tgm-grid">{TONES.map((t,i)=>{const used=usedTones.includes(i);const isActive=i===value;return(<button key={i} className={'tgm-cell'+(isActive?' active':'')+(used?' used':'')} style={{background:TONE_BG[i],borderColor:isActive||i===hov?TONE_BORDER[i]:'rgba(0,0,0,0.2)',borderWidth:isActive?'2.5px':'1.5px',opacity:used?0.55:1,cursor:used?'not-allowed':'pointer'}} onMouseEnter={()=>setHov(i)} onMouseLeave={()=>setHov(null)} onClick={()=>!used&&onChange(i)} disabled={used}>{used&&<svg width="18" height="18" viewBox="0 0 18 18" style={{position:'absolute',pointerEvents:'none'}}><line x1="3" y1="3" x2="15" y2="15" stroke="rgba(255,255,255,0.9)" strokeWidth="2.5" strokeLinecap="round"/><line x1="15" y1="3" x2="3" y2="15" stroke="rgba(255,255,255,0.9)" strokeWidth="2.5" strokeLinecap="round"/></svg>}</button>);})}</div></div><div className="tgm-tip">{tip&&<><span className="tgm-tip-label">{tip.label}</span><span className="tgm-tip-desc">{tip.desc}</span></>}</div>{usedTones.length>0&&<div style={{fontSize:10,color:'#4a4945',marginTop:6}}>✓ Already mastered — crossed cells unavailable</div>}{showSetAll&&<button className="tgm-set-all" onClick={()=>onSetAll&&onSetAll(value)}>Apply to all tracks</button>}</div>);}
function TrackRow({track, idx, onChange, onRemove, existingTracks, showSetAll, onSetAll}) {
  const [showTone,setShowTone]=useState(false);
  const [suggestions,setSuggestions]=useState([]);
  const [showSug,setShowSug]=useState(false);
  const sugRef=useRef(null);
  useEffect(()=>{
    if(!showSug) return;
    const h=(e)=>{if(sugRef.current&&!sugRef.current.contains(e.target))setShowSug(false);};
    document.addEventListener('mousedown',h);
    return()=>document.removeEventListener('mousedown',h);
  },[showSug]);
  function handleNameChange(val) {
    onChange({...track,name:val});
    if(existingTracks&&existingTracks.length){
      const s=val?existingTracks.filter(t=>t.title.toLowerCase().includes(val.toLowerCase())):existingTracks;
      setSuggestions(s);setShowSug(s.length>0);
    }
  }
  function pickSuggestion(t) {
    const tone=getToneMemory(t.title);
    onChange({...track,name:t.title,tone,isRevision:true,existingTrackId:t.id});
    setShowSug(false);
  }
  function handleToneChange(i) {
    onChange({...track,tone:i});
    if(track.name.trim()) setToneMemory(track.name.trim(),i);
  }
  return (
    <div className="track-row-v2">
      <div className="trv2-num">{idx+1}</div>
      <div className="trv2-body">
        <div className="trv2-name-row" ref={sugRef}>
          <div className="trv2-name-wrap">
            <input className="trv2-name-input" value={track.name}
              onChange={e=>handleNameChange(e.target.value)}
              onFocus={()=>{if(existingTracks?.length){setSuggestions(existingTracks);setShowSug(true);}}}
              placeholder={existingTracks?.length?"Type or pick existing track…":"Track name"}
            />
            {showSug&&suggestions.length>0&&(
              <div className="trv2-suggestions">
                {suggestions.map(s=>(
                  <button key={s.id} className="trv2-sug-item" onClick={()=>pickSuggestion(s)}>
                    <span>{s.title}</span>
                    {s.tone_label&&<span className="trv2-sug-tone">{s.tone_label}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:2}}>
              <button className={`tone-btn ${showTone?'active':''}`} onClick={()=>setShowTone(v=>!v)}>TONE GRID</button>
              <span style={{fontSize:9,color:'var(--amber)',letterSpacing:'.04em',whiteSpace:'nowrap',textAlign:'center'}}>{TONES[track.tone]?.label||'Neutral + Normal'}</span>
            </div>
          <button className="trv2-remove" onClick={onRemove}>×</button>
        </div>
        <div className="trv2-filename">
          {track.isRevision&&<span className="revision-badge">revision</span>}
          {track.peaksComputed&&<span className="revision-badge" style={{background:'rgba(80,200,120,.1)',color:'#50c878',borderColor:'rgba(80,200,120,.3)'}}>waveform ✓</span>}
          <em>{track.file.name}</em>
          <span className="trv2-size">{track.file.size<1048576?(track.file.size/1024).toFixed(0)+' KB':(track.file.size/1024/1024).toFixed(1)+' MB'}</span>
        </div>
        {showTone&&<ToneGrid value={track.tone} onChange={handleToneChange} showSetAll={showSetAll} onSetAll={onSetAll}/>}
      </div>
    </div>
  );
}

function sanitizeFilename(name){return name.replace(/[^a-zA-Z0-9._-]/g,'_');}
function urlToKey(url){try{return decodeURIComponent(new URL(url).pathname.replace(/^\//,''));}catch{return null;}}

function ProjectCard({project,idx,onDelete,onSave,unreadCount}){
  const [menuOpen,setMenuOpen]=useState(false);
  const [editing,setEditing]=useState(false);
  const [editTitle,setEditTitle]=useState(project.title||'');
  const [editArtist,setEditArtist]=useState(project.artist||'');
  const [editImageUrl,setEditImageUrl]=useState(project.image_url||'');
  const [cropSrc,setCropSrc]=useState('');
  const [cropImg,setCropImg]=useState(null);
  const [cropX,setCropX]=useState(0);
  const [cropY,setCropY]=useState(0);
  const [cropSize,setCropSize]=useState(200);
  const [cropDragging,setCropDragging]=useState(false);
  const [cropDragStart,setCropDragStart]=useState({x:0,y:0,ox:0,oy:0});
  const [cropUploading,setCropUploading]=useState(false);
  const cropCanvasRef=useRef(null);
  const [saving,setSaving]=useState(false);
  const [confirmDelete,setConfirmDelete]=useState(false);
  const menuRef=useRef(null);
  const tc=(project._pendingTracks||project.tracks)?.length||0;const isPending=!!project._pendingTracks;
  const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const date=new Date(project.updated_at||project.created_at);
  const dateStr=months[date.getMonth()]+' '+date.getDate()+', '+date.getFullYear();
  useEffect(()=>{
    if(!menuOpen)return;
    const h=(e)=>{if(menuRef.current&&!menuRef.current.contains(e.target))setMenuOpen(false);};
    document.addEventListener('mousedown',h);document.addEventListener('touchstart',h);
    return()=>{document.removeEventListener('mousedown',h);document.removeEventListener('touchstart',h);};
  },[menuOpen]);

  const handleArtUpload = e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        const displayW = 260;
        const displayH = Math.round(img.naturalHeight * displayW / img.naturalWidth);
        const sz = Math.min(displayW, displayH);
        setCropImg(img);
        setCropSrc(ev.target.result);
        setCropSize(sz);
        setCropX(Math.round((displayW - sz) / 2));
        setCropY(Math.round((displayH - sz) / 2));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };
  const removeArt = () => setEditImageUrl('');
  const cancelCrop = () => { setCropSrc(''); setCropImg(null); };
  const stopCropDrag = () => setCropDragging(false);
  const startCropDrag = e => { e.preventDefault(); setCropDragging(true); setCropDragStart({x:e.clientX,y:e.clientY,ox:cropX,oy:cropY}); };
  const startCropTouchDrag = e => { const t=e.touches[0]; setCropDragging(true); setCropDragStart({x:t.clientX,y:t.clientY,ox:cropX,oy:cropY}); };
  const handleCropMouseMove = e => {
    if (!cropDragging) return;
    const displayW = 260;
    const displayH = Math.round(cropImg.naturalHeight * displayW / cropImg.naturalWidth);
    const dx = e.clientX - cropDragStart.x;
    const dy = e.clientY - cropDragStart.y;
    setCropX(Math.max(0, Math.min(displayW - cropSize, cropDragStart.ox + dx)));
    setCropY(Math.max(0, Math.min(displayH - cropSize, cropDragStart.oy + dy)));
  };
  const handleCropTouchMove = e => {
    if (!cropDragging) return;
    e.preventDefault();
    const t = e.touches[0];
    const displayW = 260;
    const displayH = Math.round(cropImg.naturalHeight * displayW / cropImg.naturalWidth);
    const dx = t.clientX - cropDragStart.x;
    const dy = t.clientY - cropDragStart.y;
    setCropX(Math.max(0, Math.min(displayW - cropSize, cropDragStart.ox + dx)));
    setCropY(Math.max(0, Math.min(displayH - cropSize, cropDragStart.oy + dy)));
  };
  const handleCropResize = e => {
    const s = parseInt(e.target.value);
    const displayW = 260;
    const displayH = cropImg ? Math.round(cropImg.naturalHeight * displayW / cropImg.naturalWidth) : displayW;
    setCropSize(s);
    setCropX(Math.min(cropX, displayW - s));
    setCropY(Math.min(cropY, displayH - s));
  };
  const doCrop = async () => {
    setCropUploading(true);
    const canvas = document.createElement('canvas');
    canvas.width = 800; canvas.height = 800;
    const ctx = canvas.getContext('2d');
    const displayW = 260;
    const scaleX = cropImg.naturalWidth / displayW;
    const scaleY = cropImg.naturalHeight / (cropImg.naturalHeight * displayW / cropImg.naturalWidth);
    ctx.drawImage(cropImg, cropX * scaleX, cropY * scaleY, cropSize * scaleX, cropSize * scaleY, 0, 0, 800, 800);
    canvas.toBlob(async blob => {
      try {
        const r = await fetch(UPLOAD_WORKER_URL + '?project=covers&name=' + Date.now() + '.jpg', {method:'POST',body:blob,headers:{'Content-Type':'image/jpeg'}});
        const d = await r.json();
        if (d.url) { setEditImageUrl(d.url); setCropSrc(''); setCropImg(null); }
      } catch(err) { alert('Upload failed: ' + err.message); }
      setCropUploading(false);
    }, 'image/jpeg', 0.9);
  };
  async function saveEdit() {
    if(!editTitle.trim())return;
    setSaving(true);
    let finalImageUrl = editImageUrl;
    if(cropSrc && cropImg) {
      finalImageUrl = await new Promise(resolve => {
        const canvas = document.createElement('canvas');
        canvas.width = 800; canvas.height = 800;
        const ctx = canvas.getContext('2d');
        const displayW = 260;
        const scaleX = cropImg.naturalWidth/displayW;
        const scaleY = cropImg.naturalHeight/(cropImg.naturalHeight*displayW/cropImg.naturalWidth);
        ctx.drawImage(cropImg,cropX*scaleX,cropY*scaleY,cropSize*scaleX,cropSize*scaleY,0,0,800,800);
        canvas.toBlob(async blob => {
          try {
            const r = await fetch(UPLOAD_WORKER_URL+'?project=covers&name='+Date.now()+'.jpg',{method:'POST',body:blob,headers:{'Content-Type':'image/jpeg'}});
            const d = await r.json();
            resolve(d.url||editImageUrl||null);
          } catch(e) { resolve(editImageUrl||null); }
        },'image/jpeg',0.9);
      });
      setCropSrc(''); setCropImg(null);
    }
    await sb.from('projects').update({title:editTitle.trim(),artist:editArtist.trim(),image_url:finalImageUrl||null}).eq('id',project.id);
    setSaving(false); setEditing(false);
    onSave(project.id,editTitle.trim(),editArtist.trim(),finalImageUrl||null);
  }

  if(editing)return(
    <div className="card editing" style={{animationDelay:idx*60+'ms'}}>
      <div className="card-edit">
        <div className="edit-label">Project Name</div>
        <input className="edit-input" value={editTitle} onChange={e=>setEditTitle(e.target.value)}
          onKeyDown={e=>{if(e.key==='Enter')saveEdit();if(e.key==='Escape'){setEditTitle(project.title||'');setEditing(false);}}} autoFocus/>
        <div className="edit-label" style={{marginTop:10}}>Artist / Band</div>
        <input className="edit-input" value={editArtist} onChange={e=>setEditArtist(e.target.value)}
          onKeyDown={e=>{if(e.key==='Enter')saveEdit();if(e.key==='Escape'){setEditArtist(project.artist||'');setEditing(false);}}}/>
        <div style={{marginBottom:12}}>
              <div style={{fontSize:10,color:'var(--t3)',letterSpacing:'.06em',textTransform:'uppercase',marginBottom:8}}>Cover Art</div>
              <div style={{display:'flex',gap:10,alignItems:'flex-start'}}>
                <div style={{width:72,height:72,borderRadius:8,background:'var(--surf2)',border:'1px solid var(--border2)',overflow:'hidden',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',fontSize:28,color:'var(--t3)'}}>
                  {editImageUrl
                    ? <img src={editImageUrl} style={{width:'100%',height:'100%',objectFit:'cover'}}/>
                    : (project.title?.[0]?.toUpperCase()||'?')}
                </div>
                <div style={{flex:1}}>
                  <label style={{display:'inline-block',padding:'7px 12px',borderRadius:7,border:'1px solid var(--border2)',background:'var(--surf2)',color:cropUploading?'var(--t3)':'var(--t2)',fontFamily:'var(--fm)',fontSize:11,cursor:'pointer',marginBottom:4}}>
                    {cropUploading?'Uploading...':'Choose Image'}
                    <input type="file" accept="image/jpeg,image/png,image/webp" style={{display:'none'}} onChange={handleArtUpload}/>
                  </label>
                  <div style={{fontSize:10,color:'var(--t3)',lineHeight:1.5}}>JPG, PNG or WebP. Square crops best.</div>
                  {editImageUrl&&<button onClick={removeArt} style={{display:'block',fontSize:10,color:'#e05050',background:'transparent',border:'none',cursor:'pointer',padding:'2px 0',fontFamily:'var(--fm)',marginTop:2}}>Remove art</button>}
                </div>
              </div>
              {cropSrc&&cropImg&&(
                <div style={{marginTop:12,background:'var(--surf2)',borderRadius:10,padding:12,border:'1px solid var(--border2)'}}>
                  <div style={{fontSize:11,color:'var(--t2)',marginBottom:8}}>Drag the square to pick your crop, then tap Crop.</div>
                  <div style={{position:'relative',display:'inline-block',userSelect:'none'}}
                    onMouseMove={handleCropMouseMove}
                    onMouseUp={stopCropDrag}
                    onMouseLeave={stopCropDrag}
                    onTouchMove={handleCropTouchMove}
                    onTouchEnd={stopCropDrag}>
                    <img src={cropSrc} style={{display:'block',width:260,height:'auto',borderRadius:6,opacity:0.5,pointerEvents:'none'}}/>
                    <div
                      onMouseDown={startCropDrag}
                      onTouchStart={startCropTouchDrag}
                      style={{position:'absolute',left:cropX,top:cropY,width:cropSize,height:cropSize,border:'2px solid var(--amber)',boxShadow:'0 0 0 1000px rgba(0,0,0,.4)',cursor:'move',boxSizing:'border-box',touchAction:'none'}}/>
                  </div>
                  <div style={{display:'flex',gap:8,marginTop:10,alignItems:'center'}}>
                    <input type="range" min={60} max={260} value={cropSize} onChange={handleCropResize} style={{flex:1,accentColor:'var(--amber)'}}/>
                    <button disabled={cropUploading} onClick={doCrop} style={{padding:'7px 14px',borderRadius:7,border:'none',background:'var(--amber)',color:'#000',fontFamily:'var(--fm)',fontSize:11,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}>
                      {cropUploading?'Uploading...':'Crop & Save'}
                    </button>
                    <button onClick={cancelCrop} style={{padding:'7px 10px',borderRadius:7,border:'1px solid var(--border2)',background:'transparent',color:'var(--t2)',fontFamily:'var(--fm)',fontSize:11,cursor:'pointer'}}>Cancel</button>
                  </div>
                </div>
              )}            </div>
            <div className="edit-actions">
          <button className="edit-cancel" onClick={()=>{setEditTitle(project.title||'');setEditArtist(project.artist||'');setEditing(false);}}>Cancel</button>
          <button className="edit-save" disabled={!editTitle.trim()||saving} onClick={saveEdit}>{saving?'Saving…':'Save'}</button>
        </div>
      </div>
      <div className="card-wave"><WaveformCanvas peaks={project.peaks}/></div>
      <div className="card-meta" style={{position:'relative'}}>{unreadCount>0&&<span style={{position:'absolute',top:-8,right:0,background:'var(--amber)',color:'#000',borderRadius:99,fontSize:9,fontWeight:700,fontFamily:'var(--fm)',minWidth:16,height:16,display:'flex',alignItems:'center',justifyContent:'center',padding:'0 4px'}}>{unreadCount}</span>}<span>{isPending?tc+' uploading…':tc+' track'+(tc!==1?'s':'')}</span><span>{dateStr}</span></div>
    </div>
  );
  if(confirmDelete)return(
    <div className="card confirming" style={{animationDelay:idx*60+'ms'}}>
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
  return(
    <div className="card" style={{animationDelay:idx*60+'ms'}}
      onClick={e=>{if(menuOpen){setMenuOpen(false);e.stopPropagation();return;}if(!isPending)window.location.href='/player?project='+project.id;}}>
      <div className="card-header" style={{gap:0,flexDirection:'column',alignItems:'stretch',padding:0}}>
        <div className="card-art-full" style={{position:'relative'}}>
            {isPending&&<div style={{position:'absolute',inset:0,background:'rgba(0,0,0,.55)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',zIndex:2,borderRadius:'inherit'}}>
              <div style={{width:28,height:28,border:'3px solid var(--amber)',borderTopColor:'transparent',borderRadius:'50%',animation:'spin 0.8s linear infinite',marginBottom:8}}/>
              <span style={{fontFamily:'var(--fm)',fontSize:10,color:'var(--amber)',letterSpacing:'.06em',textTransform:'uppercase',fontWeight:600}}>Uploading…</span>
            </div>}
          {project.image_url
            ? <img src={project.image_url} alt={project.title}/>
            : <div className="card-art-placeholder">{project.title?.[0]?.toUpperCase()||'♪'}</div>}
        </div>
        <div style={{padding:'12px 14px 0',display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:8}}>
        <div className="card-titles">
          <div className="card-title">{project.title}</div>
          <div className="card-artist">{project.artist}</div>
        </div>
        <div ref={menuRef} style={{position:'relative',flexShrink:0}} onClick={e=>e.stopPropagation()}>
          <button className="menu-btn" onClick={()=>setMenuOpen(o=>!o)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
          </button>
          {menuOpen&&(
            <div className="menu-dropdown">
              <button className="menu-item" onClick={()=>{setMenuOpen(false);setEditing(true);}}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                Edit details
              </button>
              <div className="menu-divider"/>
              <button className="menu-item danger" onClick={()=>{setMenuOpen(false);setConfirmDelete(true);}}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                Delete project
              </button>
            </div>
          )}
        </div>
      </div>
      </div>
        <div className="card-wave"><WaveformCanvas peaks={project.peaks}/></div>
      <div className="card-meta"><span>{tc} track{tc!==1?'s':''}</span><span>{dateStr}</span></div>
    </div>
  );
}

export default function Dashboard(){
  const [user,setUser]=useState(null);
  const [showMenu,setShowMenu]=useState(false);
  const [showReport,setShowReport]=useState(false);
  const [reportMsg,setReportMsg]=useState('');
  const [reportSent,setReportSent]=useState(false);
  const [searchTerm,setSearchTerm]=useState('');
  const [coverArtUrl,setCoverArtUrl]=useState('');
  const [projects,setProjects]=useState([]);
  const [projectNotes,setProjectNotes]=useState({});
  const [loading,setLoading]=useState(true);
  const [showModal,setShowModal]=useState(false);
  const [projName,setProjName]=useState('');
  const [projArtist,setProjArtist]=useState('');
  const [tracks,setTracks]=useState([]);
  const [creating,setCreating]=useState(false);
  const [statusMsg,setStatusMsg]=useState('');
  const [dragging,setDragging]=useState(false);
  const [deleting,setDeleting]=useState(null);

  useEffect(()=>{
    sb.auth.getSession().then(({data:{session}})=>{
      if(!session){window.location.href='/auth';return;}
      setUser(session.user);loadProjects();loadProjectNotes();
    });
  },[]);

  async function loadProjectNotes(){
    if(!user)return;
    const {data}=await sb.from('notes').select('project_id').eq('resolved',false);
    if(data){const counts={};data.forEach(n=>{counts[n.project_id]=(counts[n.project_id]||0)+1;});setProjectNotes(counts);}
  }
  async function loadProjects(){
    setLoading(true);
    const {data,error}=await sb.from('projects').select('*,tracks(id,updated_at,audio_url,mp3_url)').order('updated_at',{ascending:false});
    if(!error)setProjects(data||[]);
    setLoading(false);
  }

  function handleSave(id,title,artist,imageUrl){setProjects(prev=>prev.map(p=>p.id===id?{...p,title,artist,image_url:imageUrl}:p));}

  async function deleteProject(proj){
    setDeleting(proj.id);
    try{
      const audioUrls=new Set();
      (proj.tracks||[]).forEach(t=>{if(t.audio_url)audioUrls.add(t.audio_url);if(t.mp3_url&&t.mp3_url!==t.audio_url)audioUrls.add(t.mp3_url);});
      const {data:revs}=await sb.from('revisions').select('audio_url,mp3_url').eq('project_id',proj.id);
      (revs||[]).forEach(r=>{if(r.audio_url)audioUrls.add(r.audio_url);if(r.mp3_url&&r.mp3_url!==r.audio_url)audioUrls.add(r.mp3_url);});
      await Promise.allSettled([...audioUrls].map(url=>{const k=urlToKey(url);if(!k)return;return fetch(UPLOAD_WORKER_URL,{method:'DELETE',headers:{'X-File-Key':k}});}));
      await sb.from('notes').delete().eq('project_id',proj.id);
      await sb.from('revisions').delete().eq('project_id',proj.id);
      await sb.from('project_collaborators').delete().eq('project_id',proj.id);
      await sb.from('tracks').delete().eq('project_id',proj.id);
      await sb.from('projects').delete().eq('id',proj.id);
      setProjects(prev=>prev.filter(p=>p.id!==proj.id));
    }catch(e){console.error(e);}
    setDeleting(null);
  }

  function addFiles(files){
    const audio=[...files].filter(f=>f.type.startsWith('audio/')||/\.(wav|mp3|aiff|aif|flac|m4a)$/i.test(f.name));
    if(!audio.length)return;
    setTracks(prev=>{
      const existing=new Set(prev.map(t=>t.file.name));
      return [...prev,...audio.filter(f=>!existing.has(f.name)).map(f=>({file:f,name:'',tone:DEFAULT_TONE,peaks:[],peaksComputed:false,isRevision:false,existingTrackId:null}))];
    });
    // Compute peaks for each new file in the background
    audio.forEach(file=>{
      if(!Array.from(prev||[]).find(t=>t.file.name===file.name)) {
        computePeaks(file).then(peaks=>{
          setTracks(prev=>prev.map(t=>t.file.name===file.name?{...t,peaks,peaksComputed:peaks.length>0}:t));
        });
      }
    });
  }

  function addFilesWithPeaks(files) {
    const audio=[...files].filter(f=>f.type.startsWith('audio/')||/\.(wav|mp3|aiff|aif|flac|m4a)$/i.test(f.name));
    if(!audio.length)return;
    setTracks(prev=>{
      const existing=new Set(prev.map(t=>t.file.name));
      const newTracks=audio.filter(f=>!existing.has(f.name)).map(f=>({file:f,name:'',tone:DEFAULT_TONE,peaks:[],peaksComputed:false,isRevision:false,existingTrackId:null}));
      // Compute peaks for each new file asynchronously
      newTracks.forEach(t=>{
        computePeaks(t.file).then(peaks=>{
          setTracks(prev=>prev.map(tr=>tr.file.name===t.file.name?{...tr,peaks,peaksComputed:peaks.length>0}:tr));
        });
      });
      return [...prev,...newTracks];
    });
  }

  function updateTrack(idx,updates){setTracks(prev=>prev.map((t,i)=>i===idx?{...t,...updates}:t));}
  function removeTrack(idx){setTracks(prev=>prev.filter((_,i)=>i!==idx));}
  function setAllTones(idx){setTracks(prev=>prev.map(t=>({...t,tone:idx})));}

  async function createProject(){
    const trackSnapshot=[...tracks];
    if(!projName||trackSnapshot.length===0||trackSnapshot.some(t=>!t.name.trim()))return;
    setCreating(true);
    try{
      // Insert project first
      const {data:proj,error:projErr}=await sb.from('projects').insert({title:projName,artist:projArtist,image_url:coverArtUrl||null,peaks:[],user_id:user.id}).select().single();
      if(projErr)throw projErr;

      // Add project to dashboard immediately with pending tracks (greyed out)
      const pendingTracks=trackSnapshot.map((t,i)=>({id:'pending_'+i,title:t.name,position:i,_pending:true}));
      setProjects(prev=>[{...proj,_pendingTracks:pendingTracks,tracks:pendingTracks},...prev]);

      // Close modal and open NC uploads tab
      setShowModal(false);
      const _ncIds=trackSnapshot.map((_,i)=>'up_'+Date.now()+'_'+i);
      if(window.nc_startUpload){
        trackSnapshot.forEach((t,i)=>window.nc_startUpload(_ncIds[i],t.name||t.file.name,proj.id,projName,100));
      }
      setTimeout(()=>window.nc_openToUploads&&window.nc_openToUploads(),80);

      // Upload all files in PARALLEL using XHR for real byte-level progress
      function xhrUpload(file,url,ncId){
        return new Promise((resolve,reject)=>{
          const xhr=new XMLHttpRequest();
          xhr.open('POST',url);
          xhr.setRequestHeader('Content-Type',file.type||'audio/wav');
          xhr.upload.onprogress=e=>{
            if(e.lengthComputable&&window.nc_updateUpload){
              window.nc_updateUpload(ncId,Math.round(e.loaded/e.total*100),100);
            }
          };
          xhr.onload=()=>{
            try{
              const result=JSON.parse(xhr.responseText);
              if(window.nc_updateUpload)window.nc_updateUpload(ncId,100,100);
              if(window.nc_finishUpload)window.nc_finishUpload(ncId);
              resolve(result);
            }catch(e){reject(new Error('Bad response: '+xhr.responseText.substring(0,100)));}
          };
          xhr.onerror=()=>reject(new Error('Network error uploading '+file.name));
          xhr.send(file);
        });
      }

      const uploadResults=await Promise.all(trackSnapshot.map(async (t,i)=>{
        const safeName=sanitizeFilename(t.file.name);
        const url=UPLOAD_WORKER_URL+'?project='+proj.id+'&name='+encodeURIComponent(safeName);
        try{
          const result=await xhrUpload(t.file,url,_ncIds[i]);
          return result.url?{...t,url:result.url}:null;
        }catch(e){console.error('Upload failed:',t.name,e);return null;}
      }));

      // Insert tracks into DB
      const toneLabels=['W+L','N+L','B+L','W+N','N+N','B+N','W+G','N+G','B+G'];
      for(let i=0;i<trackSnapshot.length;i++){
        const t=trackSnapshot[i];const res=uploadResults[i];if(!res)continue;
        await sb.from('tracks').insert({project_id:proj.id,title:t.name,audio_url:res.url,position:i,tone_setting:t.tone||4,tone_label:toneLabels[t.tone||4],duration:0});
      }

      // Generate peaks in background
      if(uploadResults[0]?.url)makePeaksFromFile(tracks[0].file,p=>sb.from('projects').update({peaks:p}).eq('id',proj.id));

      // Replace pending project in state with real data
      loadProjects();
      setStatusMsg('');
    }catch(e){
      setStatusMsg('Error: '+e.message);
    }
    setDragging(false);setCreating(false);
  }

  function closeModal(){setShowModal(false);setProjName('');setProjArtist('');setCoverArtUrl('');setTracks([]);setStatusMsg('');setDragging(false);setCreating(false);if(window.nc_finishUpload)window.nc_finishUpload(_ncId);}
  function handleDrop(e){e.preventDefault();e.stopPropagation();setDragging(false);addFilesWithPeaks(e.dataTransfer?.files||[]);}
  function handleDragOver(e){e.preventDefault();e.stopPropagation();setDragging(true);}
  function handleDragLeave(e){e.preventDefault();setDragging(false);}
  const allNamed=tracks.length>0&&tracks.every(t=>t.name.trim().length>0);

  return (
    <>
      <style>{` *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;} :root{--bg:#0a0a0b;--surf:#111113;--surf2:#16161a;--surf3:#1e1e24;--border:#24242c;--border2:#2e2e38;--amber:#e8a020;--aglow:rgba(232,160,32,0.08);--red:#e05050;--text:#f0ede8;--t2:#8a8780;--t3:#4a4945;--fh:'DM Serif Display',Georgia,serif;--fm:'DM Mono','SF Mono','Menlo',monospace;--radius:12px;} html,body{background:var(--bg);color:var(--text);font-family:var(--fm);min-height:100%;} .app{max-width:1100px;margin:0 auto;padding:0 24px;min-height:100vh;display:flex;flex-direction:column;} header{display:flex;align-items:center;justify-content:space-between;padding:20px 0 18px;border-bottom:1px solid var(--border);} .logo{font-family:var(--fh);font-size:22px;} .logo em{color:var(--amber);font-style:normal;} .avatar{width:32px;height:32px;border-radius:50%;background:var(--surf3);border:1px solid var(--border2);display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--t2);cursor:pointer;-webkit-tap-highlight-color:transparent;} .avatar:hover{background:var(--surf2);} .hero{padding:52px 0 40px;display:flex;align-items:flex-end;justify-content:space-between;gap:20px;border-bottom:1px solid var(--border);} .hero-title{font-family:var(--fh);font-size:clamp(32px,5vw,52px);line-height:1.05;letter-spacing:-.02em;margin-bottom:10px;} .hero-title em{font-style:italic;color:var(--amber);} .hero-sub{font-size:12px;color:var(--t2);line-height:1.6;max-width:420px;} .hero-stats{display:flex;gap:28px;flex-shrink:0;padding:20px 24px;background:var(--surf);border:1px solid var(--border);border-radius:var(--radius);} .stat{text-align:center;} .stat-num{font-family:var(--fh);font-size:28px;line-height:1;margin-bottom:4px;} .stat-label{font-size:10px;color:var(--t3);letter-spacing:.06em;text-transform:uppercase;} .stat-div{width:1px;background:var(--border);align-self:stretch;} .toolbar{display:flex;align-items:center;justify-content:space-between;padding:24px 0 16px;} .section-title{font-family:var(--fh);font-size:18px;} .create-btn{display:flex;align-items:center;gap:7px;font-family:var(--fm);font-size:12px;font-weight:500;padding:9px 18px;border-radius:8px;background:var(--amber);color:#000;border:none;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;} .create-btn:hover{opacity:.9;} .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:16px;padding-bottom:40px;} .card{background:var(--surf);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;cursor:pointer;transition:border-color .2s,transform .15s,box-shadow .2s;animation:cardIn .3s ease both;-webkit-tap-highlight-color:transparent;} .card:hover{border-color:var(--border2);transform:translateY(-2px);box-shadow:0 12px 40px rgba(0,0,0,.4);} .card.editing{cursor:default;border-color:var(--amber);} .card.confirming{border-color:var(--red);} @keyframes cardIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}} .card-art-full{position:relative;width:100%;padding-bottom:100%;background:var(--surf3);overflow:hidden;flex-shrink:0;} .card-art-full img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;} .card-art-full .card-art-placeholder{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:40px;color:var(--t3);font-family:var(--fh);} .card-header{padding:12px 14px 0;display:flex;align-items:flex-start;justify-content:space-between;gap:8px;} .card-titles{flex:1;min-width:0;} .card-title{font-family:var(--fh);font-size:15px;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;} .card-artist{font-size:11px;color:var(--t2);} .card-wave{height:36px;padding:0 14px;margin-bottom:2px;} .card-meta{padding:9px 14px 13px;display:flex;align-items:center;justify-content:space-between;border-top:1px solid var(--border);font-size:10px;color:var(--t3);} .menu-btn{width:32px;height:32px;border-radius:8px;border:1px solid transparent;background:transparent;color:var(--t3);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;-webkit-tap-highlight-color:transparent;touch-action:manipulation;padding:0;transition:all .15s;} .menu-btn:hover{background:var(--surf2);border-color:var(--border2);color:var(--t2);} .menu-dropdown{position:absolute;top:calc(100% + 4px);right:0;background:var(--surf2);border:1px solid var(--border2);border-radius:10px;min-width:160px;z-index:50;box-shadow:0 8px 32px rgba(0,0,0,.5);overflow:hidden;} .menu-item{width:100%;padding:11px 14px;display:flex;align-items:center;gap:9px;font-family:var(--fm);font-size:12px;color:var(--t2);background:transparent;border:none;cursor:pointer;text-align:left;-webkit-tap-highlight-color:transparent;touch-action:manipulation;} .menu-item:hover,.menu-item:active{background:var(--surf3);color:var(--text);} .menu-item.danger{color:#e08080;} .menu-item.danger:hover,.menu-item.danger:active{background:rgba(224,80,80,.1);color:var(--red);} .menu-divider{height:1px;background:var(--border);margin:2px 0;} .card-edit{padding:14px;} .edit-label{font-size:10px;color:var(--t3);letter-spacing:.07em;text-transform:uppercase;margin-bottom:6px;} .edit-input{width:100%;background:var(--bg);border:1.5px solid var(--border2);border-radius:8px;color:var(--text);font-family:var(--fm);font-size:14px;padding:9px 11px;outline:none;-webkit-appearance:none;} .edit-input:focus{border-color:var(--amber);} .edit-actions{display:flex;gap:8px;margin-top:12px;} .edit-cancel{flex:1;font-family:var(--fm);font-size:12px;padding:9px;border-radius:8px;border:1.5px solid var(--border2);background:transparent;color:var(--t2);cursor:pointer;-webkit-tap-highlight-color:transparent;} .edit-save{flex:1;font-family:var(--fm);font-size:12px;font-weight:500;padding:9px;border-radius:8px;background:var(--amber);color:#000;border:none;cursor:pointer;-webkit-tap-highlight-color:transparent;} .edit-save:disabled{opacity:.4;pointer-events:none;} .confirm-overlay{padding:24px 20px;display:flex;flex-direction:column;align-items:center;gap:10px;min-height:160px;justify-content:center;} .confirm-title{font-family:var(--fh);font-size:15px;text-align:center;} .confirm-sub{font-size:11px;color:var(--t2);text-align:center;line-height:1.5;} .confirm-actions{display:flex;gap:8px;margin-top:4px;} .btn-cancel-sm{font-family:var(--fm);font-size:12px;padding:9px 16px;border-radius:8px;border:1.5px solid var(--border2);background:transparent;color:var(--t2);cursor:pointer;-webkit-tap-highlight-color:transparent;} .btn-delete-confirm{font-family:var(--fm);font-size:12px;font-weight:500;padding:9px 16px;border-radius:8px;background:var(--red);color:#fff;border:none;cursor:pointer;-webkit-tap-highlight-color:transparent;} .empty{grid-column:1/-1;text-align:center;padding:80px 20px;color:var(--t2);} .empty-title{font-family:var(--fh);font-size:22px;margin-bottom:8px;} .modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.85);backdrop-filter:blur(8px);z-index:100;display:flex;align-items:flex-start;justify-content:center;padding:32px 16px 24px;overflow-y:auto;} .modal{background:var(--surf);border:1px solid var(--border2);border-radius:16px;width:100%;max-width:640px;padding:28px;margin:auto;} .modal-title{font-family:var(--fh);font-size:24px;margin-bottom:22px;} .field{margin-bottom:14px;} .field label{display:block;font-size:11px;color:var(--t2);letter-spacing:.07em;text-transform:uppercase;margin-bottom:7px;} .field input{width:100%;background:var(--surf2);border:1.5px solid var(--border2);border-radius:10px;color:var(--text);font-family:var(--fm);font-size:15px;padding:13px 14px;outline:none;-webkit-appearance:none;} .field input:focus{border-color:var(--amber);} .dropzone{border:2px dashed var(--border2);border-radius:12px;background:var(--surf2);padding:24px 16px;text-align:center;cursor:pointer;font-size:12px;color:var(--t2);transition:all .2s;-webkit-tap-highlight-color:transparent;touch-action:manipulation;} .dropzone:hover,.dropzone.over{border-color:var(--amber);background:var(--aglow);color:var(--amber);} .dropzone.has-files{border-color:rgba(232,160,32,.4);background:var(--aglow);} .tracks-list-v2{margin-top:16px;display:flex;flex-direction:column;gap:12px;} .track-row-v2{display:flex;gap:10px;align-items:flex-start;background:var(--surf2);border:1px solid var(--border);border-radius:12px;padding:14px 12px;animation:cardIn .2s ease both;} .trv2-num{font-size:12px;color:var(--t3);min-width:18px;text-align:right;padding-top:14px;} .trv2-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px;} .trv2-name-row{display:flex;gap:8px;align-items:center;position:relative;} .trv2-name-wrap{flex:1;position:relative;} .trv2-name-input{width:100%;background:var(--bg);border:1.5px solid var(--border2);border-radius:9px;color:var(--text);font-family:var(--fm);font-size:14px;padding:11px 14px;outline:none;-webkit-appearance:none;} .trv2-name-input:focus{border-color:var(--amber);} .trv2-suggestions{position:absolute;top:calc(100%+4px);left:0;right:0;background:var(--surf2);border:1px solid var(--border2);border-radius:10px;z-index:20;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.5);} .trv2-sug-item{width:100%;padding:11px 14px;display:flex;align-items:center;justify-content:space-between;gap:8px;background:transparent;border:none;color:var(--text);font-family:var(--fm);font-size:13px;cursor:pointer;text-align:left;-webkit-tap-highlight-color:transparent;} .trv2-sug-item:hover,.trv2-sug-item:active{background:var(--surf3);} .trv2-sug-tone{font-size:10px;color:var(--amber);background:var(--aglow);padding:2px 7px;border-radius:4px;white-space:nowrap;} .trv2-filename{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--t3);flex-wrap:wrap;} .trv2-filename em{font-style:italic;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px;} .trv2-size{white-space:nowrap;} .trv2-remove{width:28px;height:28px;border-radius:50%;border:1px solid var(--border2);background:transparent;color:var(--t3);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;-webkit-tap-highlight-color:transparent;touch-action:manipulation;} .trv2-remove:hover{border-color:var(--red);color:var(--red);} .revision-badge{font-size:9px;background:rgba(100,180,255,.1);color:#6ab4ff;border:1px solid rgba(100,180,255,.25);border-radius:4px;padding:2px 6px;letter-spacing:.05em;text-transform:uppercase;white-space:nowrap;} .tone-btn{display:flex;align-items:center;gap:6px;padding:9px 12px;border-radius:9px;border:1.5px solid var(--border2);background:var(--surf);color:var(--t2);font-family:var(--fm);font-size:12px;cursor:pointer;white-space:nowrap;transition:all .15s;-webkit-tap-highlight-color:transparent;touch-action:manipulation;flex-shrink:0;} .tone-btn:hover,.tone-btn.active{border-color:var(--amber);color:var(--amber);background:var(--aglow);} .tone-badge-sm{font-size:9px;background:rgba(232,160,32,.15);color:var(--amber);border-radius:4px;padding:2px 6px;border:1px solid rgba(232,160,32,.3);} .tone-grid-wrap{background:var(--surf3);border:1px solid var(--border2);border-radius:10px;padding:14px;margin-top:2px;} .tone-axis-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;} .tone-axis-label{font-size:9px;color:var(--t3);letter-spacing:.08em;text-transform:uppercase;} .tone-row-labels{display:flex;flex-direction:column;gap:4px;margin-right:6px;} .tone-row-label{font-size:9px;color:var(--t3);letter-spacing:.06em;text-transform:uppercase;height:44px;display:flex;align-items:center;justify-content:flex-end;white-space:nowrap;} .tone-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;flex:1;} .tone-cell{height:44px;border-radius:7px;border:1.5px solid var(--border2);background:var(--surf2);color:var(--t2);cursor:pointer;display:flex;align-items:center;justify-content:center;font-family:var(--fm);font-size:10px;font-weight:500;transition:all .15s;-webkit-tap-highlight-color:transparent;touch-action:manipulation;} .tone-cell:hover{border-color:var(--amber);color:var(--text);background:var(--aglow);} .tone-cell.active{border-color:var(--amber);background:rgba(232,160,32,.18);color:var(--amber);} .tone-cell.center{border-color:rgba(232,160,32,.3);} .tone-tip{margin-top:10px;padding:8px 12px;background:var(--surf2);border-radius:7px;display:flex;flex-direction:column;gap:3px;} .tone-tip-label{font-size:12px;color:var(--amber);font-weight:500;} .tone-tip-desc{font-size:11px;color:var(--t2);} .set-all-btn{width:100%;margin-top:10px;padding:10px;border-radius:8px;border:1.5px solid var(--border2);background:transparent;color:var(--t2);font-family:var(--fm);font-size:12px;cursor:pointer;transition:all .15s;-webkit-tap-highlight-color:transparent;touch-action:manipulation;} .set-all-btn:hover{border-color:var(--amber);color:var(--amber);} .modal-footer{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:22px;border-top:1px solid var(--border);padding-top:18px;flex-wrap:wrap;} .status-msg{font-size:11px;color:var(--t2);} .btn-cancel{font-family:var(--fm);font-size:13px;padding:12px 20px;border-radius:9px;border:1.5px solid var(--border2);background:transparent;color:var(--t2);cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;} .btn-create{font-family:var(--fm);font-size:13px;font-weight:500;padding:12px 24px;border-radius:9px;background:var(--amber);color:#000;border:none;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;} .btn-create:disabled{opacity:.4;pointer-events:none;} .name-required{font-size:10px;color:#e08080;margin-top:4px;} @media(max-width:640px){.app{padding:0 16px;}.hero{flex-direction:column;align-items:flex-start;padding:32px 0 28px;}.hero-stats{width:100%;}.grid{grid-template-columns:1fr;}.modal-bg{padding:16px 12px 24px;}.modal{padding:20px 16px;}.trv2-filename em{max-width:120px;}.tone-btn span:first-of-type{display:none;}}  .tgm-wrap{background:#1e1e24;border:1px solid #2e2e38;border-radius:10px;padding:12px;} .tgm-axes{display:flex;font-size:9px;color:#4a4945;letter-spacing:.07em;text-transform:uppercase;margin-bottom:8px;align-items:center;} .tgm-row-labels{display:flex;flex-direction:column;gap:4px;margin-right:6px;font-size:9px;color:#4a4945;} .tgm-row-labels div{height:36px;display:flex;align-items:center;justify-content:flex-end;white-space:nowrap;} .tgm-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;flex:1;} .tgm-cell{height:36px;border-radius:7px;border-style:solid;cursor:pointer;display:flex;align-items:center;justify-content:center;position:relative;transition:filter .15s;-webkit-tap-highlight-color:transparent;touch-action:manipulation;} .tgm-cell:hover:not(:disabled):not(.used){filter:brightness(1.2);} .tgm-cell.active{filter:brightness(1.15);} .tgm-cell.used{cursor:not-allowed;} .tgm-tip{margin-top:8px;padding:7px 10px;background:#16161a;border-radius:7px;min-height:36px;display:flex;flex-direction:column;gap:2px;} .tgm-tip-label{font-size:11px;color:#e8a020;font-weight:500;} .tgm-tip-desc{font-size:10px;color:#8a8780;} .tgm-set-all{width:100%;margin-top:8px;padding:9px;border-radius:8px;border:1.5px solid #2e2e38;background:transparent;color:#8a8780;font-family:inherit;font-size:12px;cursor:pointer;-webkit-tap-highlight-color:transparent;} .tgm-set-all:hover{border-color:#e8a020;color:#e8a020;`}</style>

      <div className="app">
        <header>
          <div className="logo">maastr<em>.</em></div>
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <span style={{fontSize:11,color:'var(--t3)'}}>{user?.email}</span>
            <NotificationCenter user={user}/>
            <div style={{position:'relative'}}>
            <div className="avatar" onClick={()=>setShowMenu(m=>!m)}>{user?.email?.[0]?.toUpperCase()||'?'}</div>
            {showMenu&&(<>
              <div style={{position:'fixed',inset:0,zIndex:99}} onClick={()=>setShowMenu(false)}/>
              <div style={{position:'absolute',top:'calc(100% + 8px)',right:0,background:'var(--surf2)',border:'1px solid var(--border2)',borderRadius:10,minWidth:180,zIndex:100,overflow:'hidden',boxShadow:'0 8px 32px rgba(0,0,0,.4)'}}>
                <div style={{padding:'10px 14px',borderBottom:'1px solid var(--border)',fontSize:11,color:'var(--t3)'}}>{user?.email}</div>
                <div style={{padding:6}}>
                  <button style={{width:'100%',textAlign:'left',padding:'8px 10px',borderRadius:6,border:'none',background:'transparent',color:'var(--t2)',fontFamily:'var(--fm)',fontSize:12,cursor:'pointer'}} onClick={()=>{setShowMenu(false);window.location.href='/account';}}>Account Settings</button>
                  <button style={{width:'100%',textAlign:'left',padding:'8px 10px',borderRadius:6,border:'none',background:'transparent',color:'var(--t2)',fontFamily:'var(--fm)',fontSize:12,cursor:'pointer'}} onClick={()=>{setShowMenu(false);window.location.href='/pricing';}}>Pricing & Plans</button>
                  <button style={{width:'100%',textAlign:'left',padding:'8px 10px',borderRadius:6,border:'none',background:'transparent',color:'var(--t2)',fontFamily:'var(--fm)',fontSize:12,cursor:'pointer'}} onClick={()=>{setShowMenu(false);window.location.href='/help';}}>Help & FAQ</button>
                  <button style={{width:'100%',textAlign:'left',padding:'8px 10px',borderRadius:6,border:'none',background:'transparent',color:'var(--t2)',fontFamily:'var(--fm)',fontSize:12,cursor:'pointer'}} onClick={()=>{setShowMenu(false);window.location.href='/blog';}}>Learning Center</button>
                  <button style={{width:'100%',textAlign:'left',padding:'8px 10px',borderRadius:6,border:'none',background:'transparent',color:'var(--t2)',fontFamily:'var(--fm)',fontSize:12,cursor:'pointer'}} onClick={()=>{setShowMenu(false);setShowReport(true);}}>Report a Problem</button>
                  <div style={{height:1,background:'var(--border)',margin:'4px 0'}}/>
                  <button style={{width:'100%',textAlign:'left',padding:'8px 10px',borderRadius:6,border:'none',background:'transparent',color:'#e05050',fontFamily:'var(--fm)',fontSize:12,cursor:'pointer'}} onClick={()=>{setShowMenu(false);sb.auth.signOut().then(()=>window.location.href='/auth');}}>Sign Out</button>
                </div>
              </div>
            </>)}
          </div>
          </div>
        </header>
        <div className="hero">
          <div>
            <div style={{fontSize:10,color:'var(--amber)',letterSpacing:'.12em',textTransform:'uppercase',marginBottom:10}}>Dashboard</div>
            <h1 className="hero-title">Your <em>projects,</em><br/>all in one place.</h1>
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
          {loading?<div className="empty"><div className="empty-title">Loading…</div></div>
          :projects.length===0?(<div className="empty"><div className="empty-title">No projects yet.</div><p style={{fontSize:12,marginBottom:20}}>Create your first mastering project.</p><button className="create-btn" onClick={()=>setShowModal(true)}>New Project</button></div>)
          :projects.filter(p=>{if(!searchTerm.trim())return true;const q=searchTerm.trim().toLowerCase();return(p.title||'').toLowerCase().includes(q)||(p.artist||'').toLowerCase().includes(q);}).map((p,idx)=>(<ProjectCard key={p.id} project={p} idx={idx} onDelete={deleteProject} onSave={handleSave}/>))}
        </div>
      </div>

      {showModal&&(
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
              <label>Tracks {tracks.length>0&&<span style={{color:'var(--t3)',fontWeight:'normal'}}>({tracks.length})</span>}</label>
              <div className={`dropzone ${dragging?'over':''} ${tracks.length>0?'has-files':''}`}
                onDragOver={handleDragOver} onDragEnter={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
                onClick={()=>document.getElementById('file-upload').click()}>
                <div style={{fontSize:28,marginBottom:8}}>🎵</div>
                {tracks.length===0
                  ?<><strong>Drop WAV / MP3 files here</strong><br/><span style={{fontSize:11,opacity:.6}}>or tap to browse — multiple files OK</span></>
                  :<><strong style={{color:'var(--amber)'}}>{tracks.length} file{tracks.length!==1?'s':''} added</strong><br/><span style={{fontSize:11,opacity:.6}}>Drop more or tap to add</span></>}
                <input id="file-upload" type="file" accept=".wav,.mp3,.aiff,.aif,.flac,.m4a,audio/*" multiple style={{display:'none'}} onChange={e=>{addFilesWithPeaks(e.target.files);e.target.value='';}}/>
              </div>
              {tracks.length>0&&(
                <div className="tracks-list-v2">
                  {tracks.map((t,i)=>(
                    <TrackRow key={i} track={t} idx={i}
                      onChange={updates=>updateTrack(i,updates)}
                      onRemove={()=>removeTrack(i)}
                      existingTracks={null}
                      showSetAll={tracks.length>1}
                      onSetAll={setAllTones}/>
                  ))}
                  {!allNamed&&<div className="name-required">⚠ Please name all tracks before creating.</div>}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <span className="status-msg">{statusMsg}</span>
              <div style={{display:'flex',gap:10,flex:1,justifyContent:'flex-end'}}>
                <button className="btn-cancel" disabled={creating} onClick={closeModal}>Cancel</button>
                <button className="btn-create" disabled={!projName||tracks.length===0||!allNamed||creating} onClick={createProject}>
                  {creating?(statusMsg||'Creating…'):`Create (${tracks.length} track${tracks.length!==1?'s':''})`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    
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
    </>
  );
            }
