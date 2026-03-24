'use client';
import { useEffect, useState, useRef } from 'react';
import { sb, UPLOAD_WORKER_URL } from '@/lib/supabase';

function fmt(s){if(!s||isNaN(s))return'0:00';return Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0');}

const TONES=[
  {label:'Dark + Loud',short:'D+L',desc:'Heavy low end, maximum punch.'},
  {label:'Neutral + Loud',short:'N+L',desc:'Balanced but loud and competitive.'},
  {label:'Bright + Loud',short:'B+L',desc:'Aggressive and forward.'},
  {label:'Dark + Normal',short:'D+N',desc:'Warm, rich and cinematic.'},
  {label:'Neutral + Normal',short:'N+N',desc:'Balanced master for all genres.'},
  {label:'Bright + Normal',short:'B+N',desc:'Clear and present.'},
  {label:'Dark + Gentle',short:'D+G',desc:'Warm and intimate.'},
  {label:'Neutral + Gentle',short:'N+G',desc:'Natural dynamics, no hype.'},
  {label:'Bright + Gentle',short:'B+G',desc:'Airy and delicate.'},
];
const DEFAULT_TONE=4;

function getToneMemory(trackName){try{const v=localStorage.getItem('mt_'+trackName.toLowerCase().replace(/\s+/g,'_'));return v!=null?parseInt(v):DEFAULT_TONE;}catch{return DEFAULT_TONE;}}
function setToneMemory(trackName,idx){try{localStorage.setItem('mt_'+trackName.toLowerCase().replace(/\s+/g,'_'),idx);}catch{}}

const FALLBACK_PEAKS=(()=>{const p=[];let s=0x12345678;for(let i=0;i<200;i++){s^=s<<13;s^=s>>17;s^=s<<5;s>>>=0;const env=Math.sin(i/200*Math.PI)*0.6+0.35;p.push(Math.max(0.05,Math.min(0.95,env*(0.45+s/0xFFFFFFFF*0.55))));}return p;})();

function Waveform({peaks,progress,notes,duration,onSeek}){
  const canvasRef=useRef(null),rafRef=useRef(null),progressRef=useRef(progress);
  useEffect(()=>{progressRef.current=progress;},[progress]);
  const stablePeaks=useRef(FALLBACK_PEAKS);
  if(peaks&&peaks.length>4)stablePeaks.current=peaks;
  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return;
    const dpr=window.devicePixelRatio||1,W=canvas.parentElement?.offsetWidth||800,H=96;
    canvas.width=W*dpr;canvas.height=H*dpr;canvas.style.width=W+'px';canvas.style.height=H+'px';
    const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);
    const data=stablePeaks.current,BAR=2,GAP=1,STEP=BAR+GAP,numBars=Math.floor(W/STEP),cy=H/2;
    const heights=new Float32Array(numBars);
    for(let i=0;i<numBars;i++){const pi=Math.floor(i/numBars*data.length);heights[i]=Math.max(2,data[Math.min(pi,data.length-1)]*(cy-6));}
    const nc=document.createElement('canvas');nc.width=W;nc.height=H;
    const nctx=nc.getContext('2d');
    if(notes&&notes.length&&duration>0){notes.forEach(n=>{if(n.timestamp_sec==null||n.timestamp_sec>duration)return;const x=(n.timestamp_sec/duration)*W;nctx.save();nctx.strokeStyle='rgba(255,255,255,0.3)';nctx.lineWidth=1;nctx.setLineDash([2,3]);nctx.beginPath();nctx.moveTo(x,4);nctx.lineTo(x,H-4);nctx.stroke();nctx.restore();nctx.fillStyle='#e8a020';nctx.beginPath();nctx.arc(x,5,3.5,0,Math.PI*2);nctx.fill();nctx.beginPath();nctx.arc(x,H-5,3.5,0,Math.PI*2);nctx.fill();});}
    let lastPlayX=-999;
    function draw(){
      const prog=Math.max(0,Math.min(1,progressRef.current||0)),playX=prog*W;
      if(Math.abs(playX-lastPlayX)>=0.5){
        lastPlayX=playX;const cutBar=Math.floor(prog*numBars);
        ctx.clearRect(0,0,W,H);
        for(let i=0;i<numBars;i++){const h=heights[i];ctx.fillStyle=i<cutBar?'rgba(232,160,32,0.88)':'rgba(255,255,255,0.16)';ctx.fillRect(i*STEP,cy-h,BAR,h*2);}
        ctx.drawImage(nc,0,0);
        if(prog>0.001){const px=Math.round(playX);ctx.save();ctx.shadowColor='rgba(232,160,32,0.9)';ctx.shadowBlur=10;ctx.fillStyle='#ffffff';ctx.fillRect(px-1,0,2,H);ctx.fillStyle='#ffcc44';ctx.beginPath();ctx.arc(px,3,5,0,Math.PI*2);ctx.fill();ctx.restore();}
      }
      rafRef.current=requestAnimationFrame(draw);
    }
    draw();
    return()=>{if(rafRef.current)cancelAnimationFrame(rafRef.current);};
  },[notes,duration]);
  return(<div onClick={e=>{if(!onSeek)return;const rect=e.currentTarget.getBoundingClientRect();onSeek(Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width)));}} style={{width:'100%',height:96,cursor:'crosshair',userSelect:'none'}}><canvas ref={canvasRef} style={{display:'block',width:'100%',height:96}}/></div>);
}

// Mini tone grid for revision upload modal
function ToneGridMini({value,onChange}){
  const [hovered,setHovered]=useState(null);
  const tip=hovered!=null?TONES[hovered]:TONES[value];
  return(
    <div className="tgm-wrap">
      <div className="tgm-axes"><span>← Darker</span><span style={{margin:'0 auto',color:'var(--amber)',fontWeight:500}}>TONE GRID</span><span>Brighter →</span></div>
      <div style={{display:'flex',gap:6,alignItems:'flex-start'}}>
        <div className="tgm-row-labels"><div>Louder</div><div>Normal</div><div>Gentler</div></div>
        <div className="tgm-grid">
          {TONES.map((t,i)=>(
            <button key={i} className={`tgm-cell ${i===value?'active':''} ${i===4?'center':''}`}
              onMouseEnter={()=>setHovered(i)} onMouseLeave={()=>setHovered(null)}
              onClick={()=>onChange(i)} title={t.label}>
              {t.short}
            </button>
          ))}
        </div>
      </div>
      <div className="tgm-tip"><span className="tgm-tip-label">{tip.label}</span><span className="tgm-tip-desc">{tip.desc}</span></div>
    </div>
  );
}

export default function Player(){
  const [user,setUser]=useState(null);
  const [project,setProject]=useState(null);
  const [tracks,setTracks]=useState([]);
  const [activeTrack,setActiveTrack]=useState(null);
  const [activeRevision,setActiveRevision]=useState(null);
  const [notes,setNotes]=useState([]);
  const [noteText,setNoteText]=useState('');
  const [playing,setPlaying]=useState(false);
  const [currentTime,setCurrentTime]=useState(0);
  const [duration,setDuration]=useState(0);
  const [pinnedTime,setPinnedTime]=useState(0);
  const audioRef=useRef(null);
  // Revision upload modal
  const [showRevModal,setShowRevModal]=useState(false);
  const [revFile,setRevFile]=useState(null);
  const [revTrackId,setRevTrackId]=useState('');
  const [revTone,setRevTone]=useState(DEFAULT_TONE);
  const [revDragging,setRevDragging]=useState(false);
  const [revUploading,setRevUploading]=useState(false);
  const [revStatus,setRevStatus]=useState('');
  const [revNameInput,setRevNameInput]=useState('');
  const [revShowSug,setRevShowSug]=useState(false);
  const revSugRef=useRef(null);

  useEffect(()=>{
    sb.auth.getSession().then(({data:{session}})=>{
      if(!session){window.location.href='/auth';return;}
      setUser(session.user);
      const params=new URLSearchParams(window.location.search);
      const pid=params.get('project');
      if(!pid){window.location.href='/';return;}
      loadProject(pid);
    });
  },[]);

  async function loadProject(pid){
    const {data:proj}=await sb.from('projects').select('*').eq('id',pid).single();
    if(!proj){window.location.href='/';return;}
    setProject(proj);
    const {data:tr}=await sb.from('tracks').select('*,revisions(*)').eq('project_id',pid).order('position');
    const trackList=tr||[];
    setTracks(trackList);
    if(trackList.length>0){
      const first=trackList[0];
      setActiveTrack(first);
      const rev=first.revisions?.find(r=>r.is_active)||first.revisions?.[first.revisions.length-1]||null;
      setActiveRevision(rev);
      loadNotes(first.id,rev?.id);
    }
  }

  async function loadNotes(trackId,revId){
    let q=sb.from('notes').select('*').eq('track_id',trackId);
    if(revId) q=q.eq('revision_id',revId);
    const {data}=await q.order('timestamp_sec');
    setNotes(data||[]);
  }

  function selectTrack(t){
    setActiveTrack(t);setPlaying(false);setCurrentTime(0);setPinnedTime(0);
    if(audioRef.current)audioRef.current.pause();
    const rev=t.revisions?.find(r=>r.is_active)||t.revisions?.[t.revisions.length-1]||null;
    setActiveRevision(rev);loadNotes(t.id,rev?.id);
  }

  function selectRevision(rev){
    setActiveRevision(rev);setPlaying(false);setCurrentTime(0);setPinnedTime(0);
    if(audioRef.current)audioRef.current.pause();
    if(activeTrack)loadNotes(activeTrack.id,rev?.id);
  }

  function togglePlay(){
    if(!audioRef.current)return;
    if(playing){audioRef.current.pause();setPlaying(false);}
    else{audioRef.current.play();setPlaying(true);}
  }

  function getAudioUrl(){
    if(activeRevision)return activeRevision.mp3_url||activeRevision.audio_url;
    if(activeTrack)return activeTrack.mp3_url||activeTrack.audio_url;
    return null;
  }

  function handleSeek(pct){
    if(!audioRef.current||!duration)return;
    const t=pct*duration;audioRef.current.currentTime=t;setCurrentTime(t);setPinnedTime(t);
  }

  async function postNote(){
    if(!noteText.trim()||!activeTrack)return;
    await sb.from('notes').insert({
      track_id:activeTrack.id,project_id:project.id,revision_id:activeRevision?.id||null,
      author_name:user?.email?.split('@')[0]||'You',
      timestamp_sec:pinnedTime,timestamp_label:fmt(pinnedTime),body:noteText.trim()
    });
    setNoteText('');loadNotes(activeTrack.id,activeRevision?.id);
  }

  // Revision upload
  function openRevModal(){
    setRevFile(null);setRevTrackId('');setRevTone(DEFAULT_TONE);
    setRevNameInput('');setRevStatus('');setShowRevModal(true);
  }

  function pickRevTrack(t){
    setRevTrackId(t.id);setRevNameInput(t.title);
    setRevTone(getToneMemory(t.title));setRevShowSug(false);
  }

  function handleRevNameChange(val){
    setRevNameInput(val);
    const match=tracks.find(t=>t.title.toLowerCase()===val.toLowerCase());
    if(match){setRevTrackId(match.id);setRevTone(getToneMemory(match.title));}
    else setRevTrackId('');
    setRevShowSug(true);
  }

  function handleRevDrop(e){e.preventDefault();e.stopPropagation();setRevDragging(false);const f=e.dataTransfer?.files?.[0];if(f)setRevFile(f);}

  async function uploadRevision(){
    if(!revFile||!revTrackId)return;
    setRevUploading(true);
    try{
      const safeName='rev_'+Date.now()+'_'+revFile.name.replace(/[^a-zA-Z0-9._-]/g,'_');
      setRevStatus('Uploading audio…');
      const r=await fetch(UPLOAD_WORKER_URL,{method:'POST',headers:{'X-File-Name':safeName,'X-Project-Id':project.id,'Content-Type':revFile.type||'audio/wav'},body:revFile});
      const result=await r.json();
      if(!result.url)throw new Error('Upload failed');
      const {data:existing}=await sb.from('revisions').select('version_number').eq('track_id',revTrackId).order('version_number',{ascending:false}).limit(1);
      const nextVer=(existing?.[0]?.version_number||1)+1;
      setRevStatus('Saving revision…');
      await sb.from('revisions').update({is_active:false}).eq('track_id',revTrackId);
      const tone=TONES[revTone];
      await sb.from('revisions').insert({track_id:revTrackId,project_id:project.id,version_number:nextVer,label:'v'+nextVer,audio_url:result.url,mp3_url:result.url,tone_setting:revTone,tone_label:tone.label,is_active:true});
      if(revNameInput.trim())setToneMemory(revNameInput.trim(),revTone);
      setShowRevModal(false);
      await loadProject(project.id);
    }catch(e){setRevStatus('Error: '+e.message);}
    setRevUploading(false);
  }

  const audioUrl=getAudioUrl();
  const progress=duration?currentTime/duration:0;
  const revisions=activeTrack?.revisions||[];
  const activeToneLabel=(activeRevision?.tone_label)||(activeTrack?.tone_label);
  const revSuggestions=revNameInput?tracks.filter(t=>t.title.toLowerCase().includes(revNameInput.toLowerCase())):tracks;

  return(
    <>
      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        :root{--bg:#0a0a0b;--surf:#111113;--surf2:#16161a;--surf3:#1e1e24;--border:#24242c;--border2:#2e2e38;--amber:#e8a020;--aglow:rgba(232,160,32,0.08);--aglow2:rgba(232,160,32,0.15);--text:#f0ede8;--t2:#8a8780;--t3:#4a4945;--fh:'DM Serif Display',Georgia,serif;--fm:'DM Mono','SF Mono','Menlo',monospace;}
        html,body{background:var(--bg);color:var(--text);font-family:var(--fm);}
        .topbar{height:52px;display:flex;align-items:center;justify-content:space-between;padding:0 20px;background:var(--surf);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:10;}
        .logo{font-family:var(--fh);font-size:18px;color:var(--text);text-decoration:none;} .logo em{color:var(--amber);font-style:normal;}
        .breadcrumb{font-size:13px;color:var(--t2);font-style:italic;margin-left:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px;}
        .back{font-size:11px;color:var(--t2);text-decoration:none;white-space:nowrap;} .back:hover{color:var(--text);}
        .layout{display:flex;min-height:calc(100vh - 52px);}
        .left{flex:1;overflow-y:auto;padding:24px 28px;border-right:1px solid var(--border);}
        .right{width:320px;flex-shrink:0;display:flex;flex-direction:column;background:var(--surf);}
        .proj-title{font-family:var(--fh);font-size:26px;letter-spacing:-.02em;margin-bottom:4px;}
        .proj-artist{font-size:12px;color:var(--t2);margin-bottom:18px;}
        .tabs-row{display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;align-items:center;}
        .tabs-label{font-size:10px;color:var(--t3);letter-spacing:.1em;text-transform:uppercase;margin-right:4px;}
        .tab-btn{padding:5px 11px;font-family:var(--fm);font-size:11px;cursor:pointer;border-radius:8px;border:1.5px solid var(--border2);background:transparent;color:var(--t2);transition:all .15s;max-width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;-webkit-tap-highlight-color:transparent;touch-action:manipulation;}
        .tab-btn:hover,.tab-btn:active{color:var(--text);border-color:var(--t2);} .tab-btn.active{background:var(--aglow);border-color:var(--amber);color:var(--amber);}
        .tone-label-badge{font-size:10px;padding:3px 9px;border-radius:5px;border:1px solid rgba(232,160,32,.25);background:var(--aglow);color:var(--amber);white-space:nowrap;}
        .player-box{background:var(--surf);border:1px solid var(--border);border-radius:12px;padding:18px;margin-bottom:18px;}
        .waveform-wrap{background:var(--surf2);border-radius:8px;padding:12px 12px 6px;margin-bottom:14px;}
        .time-row{display:flex;justify-content:space-between;margin-top:6px;}
        .time-label{font-size:10px;color:var(--t3);font-variant-numeric:tabular-nums;}
        .transport{display:flex;align-items:center;gap:14px;}
        .play-btn{width:44px;height:44px;border-radius:50%;background:var(--amber);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;-webkit-tap-highlight-color:transparent;touch-action:manipulation;} .play-btn:disabled{opacity:.3;pointer-events:none;}
        .time-display{font-size:14px;color:var(--t2);font-variant-numeric:tabular-nums;} .time-cur{color:var(--text);font-weight:500;}
        .rev-badge{margin-left:auto;font-size:9px;padding:3px 9px;border-radius:4px;background:var(--aglow);border:1px solid rgba(232,160,32,.2);color:var(--amber);letter-spacing:.06em;text-transform:uppercase;}
        .note-bar{background:var(--surf);border:1px solid var(--border2);border-radius:12px;padding:16px;margin-bottom:20px;}
        .note-bar-top{display:flex;align-items:center;gap:8px;margin-bottom:10px;font-size:11px;color:var(--t2);}
        .ts-badge{padding:3px 10px;background:var(--aglow);border:1px solid rgba(232,160,32,.25);border-radius:6px;font-size:11px;color:var(--amber);font-weight:500;}
        textarea{width:100%;background:var(--bg);border:1.5px solid var(--border2);border-radius:8px;padding:10px 12px;color:var(--text);font-family:var(--fm);font-size:12px;resize:none;outline:none;min-height:64px;-webkit-appearance:none;} textarea:focus{border-color:var(--amber);}
        .note-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:10px;}
        .btn-ghost{font-family:var(--fm);font-size:11px;padding:7px 14px;border-radius:8px;border:1.5px solid var(--border2);background:transparent;color:var(--t2);cursor:pointer;-webkit-tap-highlight-color:transparent;}
        .btn-amber{font-family:var(--fm);font-size:11px;font-weight:500;padding:7px 16px;border-radius:8px;background:var(--amber);color:#000;border:none;cursor:pointer;-webkit-tap-highlight-color:transparent;} .btn-amber:disabled{opacity:.35;pointer-events:none;}
        .upload-rev-btn{display:flex;align-items:center;gap:6px;font-family:var(--fm);font-size:11px;padding:7px 13px;border-radius:8px;border:1.5px solid var(--border2);background:transparent;color:var(--t2);cursor:pointer;transition:all .15s;-webkit-tap-highlight-color:transparent;touch-action:manipulation;margin-bottom:18px;} .upload-rev-btn:hover{border-color:var(--amber);color:var(--amber);}
        .panel-header{padding:14px 16px;border-bottom:1px solid var(--border);}
        .panel-title{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--amber);font-weight:500;}
        .panel-body{flex:1;overflow-y:auto;}
        .note-item{padding:12px 16px;border-bottom:1px solid var(--border);} .note-item:last-child{border-bottom:none;}
        .note-header{display:flex;align-items:center;gap:8px;margin-bottom:6px;}
        .note-author{font-size:11px;color:var(--text);font-weight:500;}
        .note-ts{font-size:10px;padding:2px 8px;background:var(--aglow);border:1px solid rgba(232,160,32,.2);color:var(--amber);border-radius:4px;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;}
        .note-date{font-size:10px;color:var(--t3);margin-left:auto;}
        .note-body{font-size:12px;color:var(--t2);line-height:1.6;}
        .empty-notes{text-align:center;padding:48px 16px;color:var(--t3);font-size:11px;line-height:1.8;}
        /* Revision upload modal */
        .modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.85);backdrop-filter:blur(8px);z-index:100;display:flex;align-items:flex-start;justify-content:center;padding:32px 16px;overflow-y:auto;}
        .rev-modal{background:var(--surf);border:1px solid var(--border2);border-radius:16px;width:100%;max-width:540px;padding:28px;margin:auto;}
        .rev-modal-title{font-family:var(--fh);font-size:22px;margin-bottom:20px;}
        .rm-field{margin-bottom:14px;}
        .rm-label{display:block;font-size:11px;color:var(--t2);letter-spacing:.07em;text-transform:uppercase;margin-bottom:7px;}
        .rm-input{width:100%;background:var(--surf2);border:1.5px solid var(--border2);border-radius:10px;color:var(--text);font-family:var(--fm);font-size:14px;padding:12px 14px;outline:none;-webkit-appearance:none;} .rm-input:focus{border-color:var(--amber);}
        .rm-suggestions{background:var(--surf2);border:1px solid var(--border2);border-radius:10px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.5);}
        .rm-sug-item{width:100%;padding:11px 14px;display:flex;align-items:center;justify-content:space-between;background:transparent;border:none;color:var(--text);font-family:var(--fm);font-size:13px;cursor:pointer;text-align:left;-webkit-tap-highlight-color:transparent;} .rm-sug-item:hover,.rm-sug-item:active{background:var(--surf3);}
        .rm-sug-tone{font-size:10px;color:var(--amber);background:var(--aglow);padding:2px 7px;border-radius:4px;}
        .rm-dropzone{border:2px dashed var(--border2);border-radius:12px;background:var(--surf2);padding:24px;text-align:center;cursor:pointer;font-size:12px;color:var(--t2);transition:all .2s;-webkit-tap-highlight-color:transparent;touch-action:manipulation;} .rm-dropzone:hover,.rm-dropzone.over{border-color:var(--amber);background:var(--aglow);color:var(--amber);}
        .rm-dropzone.has-file{border-color:var(--amber);border-style:solid;background:var(--aglow);}
        .rm-footer{display:flex;justify-content:flex-end;align-items:center;gap:10px;margin-top:20px;border-top:1px solid var(--border);padding-top:18px;}
        .rm-status{font-size:11px;color:var(--t2);margin-right:auto;}
        .btn-rm-cancel{font-family:var(--fm);font-size:13px;padding:11px 18px;border-radius:9px;border:1.5px solid var(--border2);background:transparent;color:var(--t2);cursor:pointer;-webkit-tap-highlight-color:transparent;}
        .btn-rm-create{font-family:var(--fm);font-size:13px;font-weight:500;padding:11px 22px;border-radius:9px;background:var(--amber);color:#000;border:none;cursor:pointer;-webkit-tap-highlight-color:transparent;} .btn-rm-create:disabled{opacity:.4;pointer-events:none;}
        /* Tone grid mini */
        .tgm-wrap{background:var(--surf3);border:1px solid var(--border2);border-radius:10px;padding:12px;margin-top:4px;}
        .tgm-axes{display:flex;font-size:9px;color:var(--t3);letter-spacing:.07em;text-transform:uppercase;margin-bottom:8px;align-items:center;}
        .tgm-row-labels{display:flex;flex-direction:column;gap:4px;margin-right:6px;font-size:9px;color:var(--t3);letter-spacing:.05em;text-transform:uppercase;}
        .tgm-row-labels div{height:38px;display:flex;align-items:center;justify-content:flex-end;white-space:nowrap;}
        .tgm-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;flex:1;}
        .tgm-cell{height:38px;border-radius:6px;border:1.5px solid var(--border2);background:var(--surf2);color:var(--t2);cursor:pointer;display:flex;align-items:center;justify-content:center;font-family:var(--fm);font-size:10px;font-weight:600;transition:all .15s;-webkit-tap-highlight-color:transparent;touch-action:manipulation;}
        .tgm-cell:hover{border-color:var(--amber);color:var(--text);background:var(--aglow);} .tgm-cell.active{border-color:var(--amber);background:rgba(232,160,32,.18);color:var(--amber);} .tgm-cell.center{border-color:rgba(232,160,32,.3);}
        .tgm-tip{margin-top:8px;padding:7px 10px;background:var(--surf2);border-radius:7px;display:flex;flex-direction:column;gap:2px;}
        .tgm-tip-label{font-size:11px;color:var(--amber);font-weight:500;} .tgm-tip-desc{font-size:10px;color:var(--t2);}
        @media(max-width:640px){
          html,body{overflow-y:auto;}
          .layout{flex-direction:column;}
          .left{border-right:none;padding:16px;}
          .right{width:100%;border-top:1px solid var(--border);min-height:300px;}
          .panel-body{max-height:400px;overflow-y:auto;}
          .proj-title{font-size:22px;}
          .breadcrumb{max-width:120px;}
        }
      `}</style>

      <div className="topbar">
        <div style={{display:'flex',alignItems:'center',gap:8,minWidth:0}}>
          <a href="/" className="logo">maastr<em>.</em></a>
          <span style={{color:'var(--border2)',fontSize:16,flexShrink:0}}>/</span>
          <span className="breadcrumb">{project?.title||'Loading…'}</span>
        </div>
        <a href="/" className="back">← Dashboard</a>
      </div>

      <div className="layout">
        <div className="left">
          <div className="proj-title">{project?.title}</div>
          <div className="proj-artist">{project?.artist}</div>

          {tracks.length>1&&(
            <div className="tabs-row" style={{marginBottom:16}}>
              <span className="tabs-label">Track</span>
              {tracks.map(t=>(
                <button key={t.id} className={`tab-btn ${activeTrack?.id===t.id?'active':''}`} title={t.title} onClick={()=>selectTrack(t)}>{t.title}</button>
              ))}
            </div>
          )}

          {revisions.length>1&&(
            <div className="tabs-row" style={{marginBottom:10}}>
              <span className="tabs-label">Version</span>
              {revisions.map((rev,i)=>(
                <button key={rev.id} className={`tab-btn ${activeRevision?.id===rev.id?'active':''}`} onClick={()=>selectRevision(rev)}>
                  {rev.label||`v${rev.version_number||i+1}`}
                </button>
              ))}
            </div>
          )}

          {/* Tone label for active track/revision */}
          {activeToneLabel&&(
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:18}}>
              <span style={{fontSize:10,color:'var(--t3)'}}>Mastering:</span>
              <span className="tone-label-badge">{activeToneLabel}</span>
            </div>
          )}

          {/* Upload revision button */}
          <button className="upload-rev-btn" onClick={openRevModal}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Upload Revision
          </button>

          <div className="player-box">
            <div className="waveform-wrap">
              <Waveform peaks={activeTrack?.peaks} progress={progress} notes={notes} duration={duration} onSeek={handleSeek}/>
              <div className="time-row">
                <span className="time-label">{fmt(currentTime)}</span>
                <span className="time-label">{notes.length>0?notes.length+(notes.length===1?' note':' notes'):''}</span>
                <span className="time-label">{fmt(duration)}</span>
              </div>
            </div>
            <div className="transport">
              <button className="play-btn" onClick={togglePlay} disabled={!audioUrl}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="#000">
                  {playing?<><rect x="3" y="1" width="3.5" height="14" rx="1"/><rect x="9.5" y="1" width="3.5" height="14" rx="1"/></>:<polygon points="3,1 15,8 3,15"/>}
                </svg>
              </button>
              <div className="time-display"><span className="time-cur">{fmt(currentTime)}</span><span> / {fmt(duration)}</span></div>
              {activeRevision&&<span className="rev-badge">{activeRevision.label||`v${activeRevision.version_number||1}`}</span>}
            </div>
          </div>

          <div className="note-bar">
            <div className="note-bar-top">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              Note at <span className="ts-badge">{fmt(pinnedTime)}</span>
              <span style={{fontSize:10,color:'var(--t3)'}}>live</span>
            </div>
            <textarea value={noteText} onChange={e=>setNoteText(e.target.value)} placeholder="Add a timestamped note…"/>
            <div className="note-actions">
              <button className="btn-ghost" onClick={()=>setNoteText('')}>Clear</button>
              <button className="btn-amber" onClick={postNote} disabled={!noteText.trim()}>Post Note</button>
            </div>
          </div>
        </div>

        <div className="right">
          <div className="panel-header"><div className="panel-title">Notes ({notes.length}){activeRevision&&<span style={{marginLeft:6,color:'var(--t3)',fontWeight:'normal',textTransform:'none',letterSpacing:'normal'}}>— {activeRevision.label||'v1'}</span>}</div></div>
          <div className="panel-body">
            {notes.length===0?(
              <div className="empty-notes"><div style={{fontSize:28,marginBottom:8,opacity:.4}}>♪</div>No notes yet.<br/>Hit play and leave feedback.</div>
            ):notes.map(n=>(
              <div key={n.id} className="note-item">
                <div className="note-header">
                  <span className="note-author">{n.author_name||'Anonymous'}</span>
                  {n.timestamp_sec!=null&&(<span className="note-ts" onClick={()=>{if(audioRef.current&&duration){audioRef.current.currentTime=n.timestamp_sec;setCurrentTime(n.timestamp_sec);setPinnedTime(n.timestamp_sec);}}}>{n.timestamp_label||fmt(n.timestamp_sec)}</span>)}
                  <span className="note-date">{new Date(n.created_at).toLocaleDateString()}</span>
                </div>
                <div className="note-body">{n.body}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {audioUrl&&(<audio ref={audioRef} src={audioUrl} preload="metadata"
        onTimeUpdate={e=>{setCurrentTime(e.target.currentTime);setPinnedTime(e.target.currentTime);}}
        onDurationChange={e=>setDuration(e.target.duration)} onEnded={()=>setPlaying(false)}/>)}

      {/* Revision Upload Modal */}
      {showRevModal&&(
        <div className="modal-bg" onClick={e=>e.target===e.currentTarget&&!revUploading&&setShowRevModal(false)}>
          <div className="rev-modal">
            <div className="rev-modal-title">Upload Revision</div>

            <div className="rm-field">
              <label className="rm-label">Track (which song is this a revision of?)</label>
              <div ref={revSugRef} style={{position:'relative'}}>
                <input className="rm-input" value={revNameInput}
                  placeholder="Type to search or pick from list…"
                  onChange={e=>handleRevNameChange(e.target.value)}
                  onFocus={()=>setRevShowSug(true)}
                  autoFocus/>
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
                onDragOver={e=>{e.preventDefault();setRevDragging(true);}}
                onDragLeave={e=>{e.preventDefault();setRevDragging(false);}}
                onDrop={handleRevDrop}
                onClick={()=>document.getElementById('rev-file-upload').click()}>
                <div style={{fontSize:24,marginBottom:6}}>{revFile?'✓':'🎵'}</div>
                {revFile?<><strong style={{color:'var(--amber)'}}>{revFile.name}</strong><br/><span style={{fontSize:11,opacity:.6}}>{(revFile.size/1024/1024).toFixed(1)} MB</span></>:<><strong>Drop WAV / MP3 here</strong><br/><span style={{fontSize:11,opacity:.6}}>or tap to browse</span></>}
                <input id="rev-file-upload" type="file" accept=".wav,.mp3,.aiff,.aif,.flac,.m4a,audio/*" style={{display:'none'}} onChange={e=>{if(e.target.files[0])setRevFile(e.target.files[0]);e.target.value='';}}/>
              </div>
            </div>

            <div className="rm-field">
              <label className="rm-label">Mastering</label>
              <ToneGridMini value={revTone} onChange={i=>{setRevTone(i);if(revNameInput.trim())setToneMemory(revNameInput.trim(),i);}}/>
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
