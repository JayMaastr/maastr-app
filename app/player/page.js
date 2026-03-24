NaN

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

  // Upload Revisions modal (multi-file)
  const [showRevModal,setShowRevModal]=useState(false);
  const [revFiles,setRevFiles]=useState([]);
  const [revDragging,setRevDragging]=useState(false);
  const [revUploading,setRevUploading]=useState(false);
  const [revStatus,setRevStatus]=useState('');

  // Rerun modal
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
    if(tl.length>0){
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
  const audioUrl=activeRevision?activeRevision.mp3_url||activeRevision.audio_url:activeTrack?.mp3_url||activeTrack?.audio_url;

  // THE CRITICAL FIX: drive src imperatively so iOS fires onDurationChange
  // Never use {audioUrl && <audio src={audioUrl}/>} — that creates a new element
  // each time audioUrl changes, and iOS won't fire duration events on fresh mounts.
  useEffect(()=>{
    const el=audioRef.current;
    if(!el)return;
    if(audioUrl){
      if(el.src!==audioUrl){
        el.src=audioUrl;
        el.load();
        setDuration(0);
        setCurrentTime(0);
      }
    }else{
      el.src='';
      el.load();
      setDuration(0);
      setCurrentTime(0);
    }
  },[audioUrl]);

  function activateTrack(trackId){
    if(trackId===activeTrackId){setActiveTrackId(null);return;}
    if(audioRef.current){audioRef.current.pause();}
    setPlaying(false);setCurrentTime(0);setDuration(0);
    setActiveTrackId(trackId);
    const t=tracks.find(tr=>tr.id===trackId);
    if(!t)return;
    const rev=t.revisions?.find(r=>r.is_active)||t.revisions?.[t.revisions.length-1]||null;
    setActiveRevision(rev);
    loadNotes(t.id,rev?.id);
  }

  function selectRevision(track,rev){
    if(audioRef.current){audioRef.current.pause();}
    setPlaying(false);setCurrentTime(0);setDuration(0);
    setActiveRevision(rev);
    loadNotes(track.id,rev?.id);
  }

  function togglePlay(){
    if(!audioRef.current)return;
    if(playing){audioRef.current.pause();setPlaying(false);}
    else{audioRef.current.play().catch(()=>{});setPlaying(true);}
  }

  function handleSeek(pct){
    if(!audioRef.current||!duration)return;
    const t=pct*duration;audioRef.current.currentTime=t;setCurrentTime(t);
  }

  async function postNote(){
    if(!noteText.trim()||!activeTrack)return;
    await sb.from('notes').insert({track_id:activeTrack.id,project_id:project.id,revision_id:activeRevision?.id||null,author_name:user?.email?.split('@')[0]||'You',timestamp_sec:currentTime,timestamp_label:fmt(currentTime),body:noteText.trim()});
    setNoteText('');loadNotes(activeTrack.id,activeRevision?.id);
  }

  async function reorderTracks(fromIdx,toIdx){
    if(fromIdx===toIdx)return;
    const nt=[...tracks];const [m]=nt.splice(fromIdx,1);nt.splice(toIdx,0,m);
    const updated=nt.map((t,i)=>({...t,position:i}));
    setTracks(updated);
    await Promise.all(updated.map(t=>sb.from('tracks').update({position:t.position}).eq('id',t.id)));
  }

  async function renameTrack(trackId,newTitle){
    await sb.from('tracks').update({title:newTitle}).eq('id',trackId);
    setTracks(prev=>prev.map(t=>t.id===trackId?{...t,title:newTitle}:t));
  }

  async function deleteTrack(track){
    setDeleteTrackConfirm(null);
    const urls=new Set();
    (track.revisions||[]).forEach(r=>{if(r.audio_url)urls.add(r.audio_url);if(r.mp3_url&&r.mp3_url!==r.audio_url)urls.add(r.mp3_url);});
    if(track.audio_url)urls.add(track.audio_url);
    await Promise.allSettled([...urls].map(url=>{try{const k=decodeURIComponent(new URL(url).pathname.replace(/^\//,''));return fetch(UPLOAD_WORKER_URL,{method:'DELETE',headers:{'X-File-Key':k}});}catch{return Promise.resolve();}}));
    await sb.from('notes').delete().eq('track_id',track.id);
    await sb.from('revisions').delete().eq('track_id',track.id);
    await sb.from('tracks').delete().eq('id',track.id);
    setTracks(prev=>prev.filter(t=>t.id!==track.id));
    if(activeTrackId===track.id){setActiveTrackId(null);setActiveRevision(null);setNotes([]);}
  }

  async function deleteRevision(rev,track){
    try{const k=decodeURIComponent(new URL(rev.audio_url||rev.mp3_url).pathname.replace(/^\//,''));await fetch(UPLOAD_WORKER_URL,{method:'DELETE',headers:{'X-File-Key':k}});}catch{}
    await sb.from('notes').delete().eq('revision_id',rev.id);
    await sb.from('revisions').delete().eq('id',rev.id);
    if(rev.is_active){const {data:rem}=await sb.from('revisions').select('id').eq('track_id',track.id).order('version_number',{ascending:false}).limit(1);if(rem?.[0])await sb.from('revisions').update({is_active:true}).eq('id',rem[0].id);}
    await loadProject(project.id);
  }

  async function submitRerun(){
    if(!rerunTrack||rerunTone===null)return;
    setRerunUploading(true);
    try{
      const activeRev=rerunTrack.revisions?.find(r=>r.is_active)||rerunTrack.revisions?.[rerunTrack.revisions.length-1];
      if(!activeRev)throw new Error('No revision to rerun');
      setRerunStatus('Fetching source audio…');
      const resp=await fetch(activeRev.audio_url||activeRev.mp3_url);
      const blob=await resp.blob();
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

  function autoMatch(filename,trackList){
    const base=filename.replace(/\.[^.]+$/,'').replace(/[_-]/g,' ').toLowerCase().trim();
    let best=trackList.find(t=>t.title.toLowerCase()===base);
    if(!best){best=trackList.reduce((acc,t)=>{const tl=t.title.toLowerCase();let score=0;for(let i=0;i<base.length;i++)for(let j=i+1;j<=base.length;j++){const sub=base.slice(i,j);if(tl.includes(sub)&&sub.length>score){score=sub.length;}}return score>2&&score>(acc?.score||0)?{...t,score}:acc;},null);}
    return best||null;
  }

  function addRevFiles(files){
    const audio=[...files].filter(f=>f.type.startsWith('audio/')||/\.(wav|mp3|aiff|aif|flac|m4a)$/i.test(f.name));
    if(!audio.length)return;
    const newEntries=audio.map(file=>{
      const matched=autoMatch(file.name,tracks);
      const tone=matched?getToneMemory(matched.title):DEFAULT_TONE;
      const entry={file,name:matched?.title||file.name.replace(/\.[^.]+$/,''),tone,peaks:[],peaksComputed:false,matchedTrackId:matched?.id||null,isNew:!matched};
      computePeaks(file).then(peaks=>{setRevFiles(prev=>prev.map(e=>e.file.name===file.name?{...e,peaks,peaksComputed:peaks.length>0}:e));});
      return entry;
    });
    setRevFiles(prev=>{const ex=new Set(prev.map(e=>e.file.name));return [...prev,...newEntries.filter(e=>!ex.has(e.file.name))];});
  }

  async function submitRevisions(){
    if(!revFiles.length||!project)return;
    setRevUploading(true);
    try{
      for(let i=0;i<revFiles.length;i++){
        const entry=revFiles[i];
        setRevStatus('Uploading '+(i+1)+'/'+revFiles.length+': '+entry.name);
        const safeName=sanitize(entry.file.name);
        const r=await fetch(UPLOAD_WORKER_URL,{method:'POST',headers:{'X-File-Name':safeName,'X-Project-Id':project.id,'Content-Type':entry.file.type||'audio/wav'},body:entry.file});
        const result=await r.json();
        if(!result.url)continue;
        const tone=TONES[entry.tone];
        const peaks=entry.peaks.length>0?entry.peaks:[];
        if(entry.matchedTrackId&&!entry.isNew){
          const {data:existing}=await sb.from('revisions').select('version_number').eq('track_id',entry.matchedTrackId).order('version_number',{ascending:false}).limit(1);
          const nextVer=(existing?.[0]?.version_number||1)+1;
          await sb.from('revisions').update({is_active:false}).eq('track_id',entry.matchedTrackId);
          await sb.from('revisions').insert({track_id:entry.matchedTrackId,project_id:project.id,version_number:nextVer,label:'v'+nextVer,audio_url:result.url,mp3_url:result.url,tone_setting:entry.tone,tone_label:tone.label,is_active:true});
          if(peaks.length>0)await sb.from('tracks').update({peaks,tone_setting:entry.tone,tone_label:tone.label}).eq('id',entry.matchedTrackId);
        }else{
          const newPos=tracks.length+i;
          const {data:newTrack}=await sb.from('tracks').insert({project_id:project.id,title:entry.name,audio_url:result.url,mp3_url:result.url,position:newPos,peaks,tone_setting:entry.tone,tone_label:tone.label}).select().single();
          if(newTrack){await sb.from('revisions').insert({track_id:newTrack.id,project_id:project.id,version_number:1,label:'v1',audio_url:result.url,mp3_url:result.url,tone_setting:entry.tone,tone_label:tone.label,is_active:true});}
        }
        if(entry.name.trim())setToneMemory(entry.name.trim(),entry.tone);
      }
      setShowRevModal(false);setRevFiles([]);setRevStatus('');
      await loadProject(project.id);
    }catch(e){setRevStatus('Error: '+e.message);}
    setRevUploading(false);
  }

  const progress=duration?currentTime/duration:0;
  const rerunUsedTones=rerunTrack?(rerunTrack.revisions||[]).map(r=>r.tone_setting).filter(t=>t!=null):[];

  return(
    <>
      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        :root{--bg:#0a0a0b;--surf:#111113;--surf2:#16161a;--surf3:#1e1e24;--border:#24242c;--border2:#2e2e38;--amber:#e8a020;--aglow:rgba(232,160,32,0.08);--text:#f0ede8;--t2:#8a8780;--t3:#4a4945;--red:#e05050;--fh:'DM Serif Display',Georgia,serif;--fm:'DM Mono','SF Mono','Menlo',monospace;}
        input,textarea,select{font-size:16px!important;-webkit-text-size-adjust:100%;}
        html,body{background:var(--bg);color:var(--text);font-family:var(--fm);-webkit-font-smoothing:antialiased;}
        .player-station{position:sticky;top:0;z-index:30;background:var(--bg);border-bottom:1px solid var(--border);padding:12px 16px;box-shadow:0 2px 20px rgba(0,0,0,.5);}
        .ps-track-info{display:flex;align-items:center;gap:8px;margin-bottom:10px;}
        .ps-track-name{font-family:var(--fh);font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;}
        .ps-rev-badge{font-size:9px;padding:2px 8px;border-radius:4px;background:var(--aglow);border:1px solid rgba(232,160,32,.25);color:var(--amber);white-space:nowrap;}
        .ps-tone-badge{font-size:9px;padding:2px 7px;border-radius:4px;background:var(--surf2);border:1px solid var(--border2);color:var(--t3);white-space:nowrap;}
        .ps-waveform{border-radius:8px;background:var(--surf2);padding:8px 10px 4px;margin-bottom:8px;}
        .ps-time-row{display:flex;justify-content:space-between;font-size:10px;color:var(--t3);margin-top:2px;}
        .ps-transport{display:flex;align-items:center;gap:12px;}
        .ps-play-btn{width:40px;height:40px;border-radius:50%;background:var(--amber);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;-webkit-tap-highlight-color:transparent;touch-action:manipulation;} .ps-play-btn:disabled{opacity:.3;pointer-events:none;}
        .ps-time{font-size:13px;color:var(--t2);font-variant-numeric:tabular-nums;} .ps-time strong{color:var(--text);}
        .ps-no-track{font-size:12px;color:var(--t3);text-align:center;padding:12px;}
        .topbar{height:48px;display:flex;align-items:center;justify-content:space-between;padding:0 16px;background:var(--surf);border-bottom:1px solid var(--border);}
        .logo{font-family:var(--fh);font-size:17px;color:var(--text);text-decoration:none;} .logo em{color:var(--amber);font-style:normal;}
        .breadcrumb{font-size:12px;color:var(--t2);margin-left:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px;}
        .back{font-size:11px;color:var(--t2);text-decoration:none;padding:5px 10px;border-radius:7px;border:1px solid var(--border2);white-space:nowrap;-webkit-tap-highlight-color:transparent;} .back:hover{color:var(--text);}
        .page{padding:12px 12px 120px;}
        .page-header{padding:12px 0 8px;}
        .proj-title{font-family:var(--fh);font-size:clamp(20px,5vw,30px);margin-bottom:2px;}
        .proj-artist{font-size:11px;color:var(--t2);margin-bottom:12px;}
        .top-actions{display:flex;gap:8px;margin-bottom:14px;}
        .btn-upload-rev{display:flex;align-items:center;gap:6px;font-family:var(--fm);font-size:13px;font-weight:500;padding:10px 16px;border-radius:9px;background:var(--amber);color:#000;border:none;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;}
        .tracks-lbl{font-size:10px;color:var(--t3);letter-spacing:.12em;text-transform:uppercase;margin-bottom:8px;}
        .track-card{background:var(--surf);border:1px solid var(--border);border-radius:12px;overflow:visible;margin-bottom:8px;transition:border-color .2s;position:relative;}
        .tc-active{border-color:var(--amber);}
        .tc-header{display:flex;align-items:center;gap:8px;padding:13px 12px;min-height:56px;cursor:pointer;-webkit-tap-highlight-color:transparent;}
        .drag-handle{width:32px;height:32px;display:flex;align-items:center;justify-content:center;color:var(--t3);cursor:grab;flex-shrink:0;border-radius:6px;-webkit-tap-highlight-color:transparent;touch-action:none;} .drag-handle:active{cursor:grabbing;background:var(--surf2);color:var(--t2);}
        .tc-rename-wrap{display:flex;gap:6px;align-items:center;flex:1;}
        .tc-rename-input{flex:1;background:var(--bg);border:2px solid var(--amber);border-radius:8px;color:var(--text);font-family:var(--fh);font-size:16px;padding:7px 11px;outline:none;-webkit-appearance:none;min-width:0;}
        .tc-rename-save{font-family:var(--fm);font-size:12px;font-weight:500;padding:7px 14px;border-radius:7px;background:var(--amber);color:#000;border:none;cursor:pointer;white-space:nowrap;flex-shrink:0;-webkit-tap-highlight-color:transparent;}
        .tc-rename-cancel{font-family:var(--fm);font-size:12px;padding:7px 12px;border-radius:7px;border:1.5px solid var(--border2);background:transparent;color:var(--t2);cursor:pointer;white-space:nowrap;flex-shrink:0;-webkit-tap-highlight-color:transparent;}
        .tc-info{flex:1;min-width:0;display:flex;align-items:center;gap:8px;}
        .tc-name{font-family:var(--fh);font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .tc-tone-badge{font-size:9px;padding:2px 7px;border-radius:4px;background:var(--aglow);border:1px solid rgba(232,160,32,.2);color:var(--amber);white-space:nowrap;flex-shrink:0;}
        .tc-rev-collapsed{display:flex;flex-direction:column;align-items:flex-end;gap:2px;flex-shrink:0;margin-right:4px;}
        .tc-rev-tag{font-size:9px;padding:2px 7px;border-radius:4px;background:var(--surf2);border:1px solid var(--border2);color:var(--t3);}
        .tc-rev-date{font-size:9px;color:var(--t3);}
        .tc-menu-btn{width:36px;height:36px;border-radius:9px;border:1px solid transparent;background:transparent;color:var(--t3);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;-webkit-tap-highlight-color:transparent;touch-action:manipulation;padding:0;} .tc-menu-btn:hover,.tc-menu-btn:active{background:var(--surf2);color:var(--t2);}
        .tdrop-item{width:100%;padding:12px 16px;display:flex;align-items:center;gap:10px;font-family:var(--fm);font-size:14px;color:var(--t2);background:transparent;border:none;cursor:pointer;text-align:left;-webkit-tap-highlight-color:transparent;touch-action:manipulation;} .tdrop-item:hover,.tdrop-item:active{background:var(--surf3);color:var(--text);}
        .tdrop-item.danger{color:#e08080;} .tdrop-item.danger:hover,.tdrop-item.danger:active{background:rgba(224,80,80,.08);color:var(--red);}
        .tdrop-divider{height:1px;background:var(--border);margin:2px 0;}
        .rev-hist-panel{padding:12px;border-top:1px solid var(--border);background:var(--surf2);border-radius:0 0 12px 12px;}
        .rev-del-confirm{padding:4px;}
        .rev-del-confirm-title{font-family:var(--fh);font-size:16px;margin-bottom:6px;}
        .rev-del-confirm-sub{font-size:12px;color:var(--t2);line-height:1.5;}
        .rev-hist-title{font-size:10px;color:var(--t3);letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px;}
        .rev-hist-item{width:100%;padding:10px 12px;text-align:left;background:var(--surf);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:var(--fm);font-size:13px;cursor:pointer;margin-bottom:6px;display:flex;align-items:center;gap:8px;-webkit-tap-highlight-color:transparent;} .rev-hist-item:hover,.rev-hist-item:active{border-color:var(--red);background:rgba(224,80,80,.05);}
        .rev-hist-label{font-weight:500;} .rev-hist-tone{font-size:10px;color:var(--amber);} .rev-hist-active{font-size:9px;color:#6ab4ff;} .rev-hist-date{font-size:10px;color:var(--t3);margin-left:auto;} .rev-hist-del-arrow{font-size:10px;color:var(--red);white-space:nowrap;}
        .tc-expanded{padding:0 12px 12px;border-top:1px solid var(--border);}
        .tc-rev-bar{display:flex;align-items:center;gap:8px;padding:10px 0 8px;flex-wrap:wrap;}
        .tc-rev-active-label{font-size:12px;color:var(--amber);font-weight:500;}
        .tc-rev-active-tone{font-size:10px;padding:2px 7px;border-radius:4px;background:var(--aglow);border:1px solid rgba(232,160,32,.2);color:var(--amber);}
        .tc-rev-active-date{font-size:10px;color:var(--t3);}
        .tc-rev-hist-btn{font-family:var(--fm);font-size:11px;padding:4px 10px;border-radius:6px;border:1px solid var(--border2);background:transparent;color:var(--t2);cursor:pointer;margin-left:auto;-webkit-tap-highlight-color:transparent;touch-action:manipulation;} .tc-rev-hist-btn:hover{border-color:var(--amber);color:var(--amber);}
        .tc-rev-hist-list{background:var(--surf2);border-radius:8px;overflow:hidden;margin-bottom:10px;border:1px solid var(--border2);}
        .tc-rev-hist-row{width:100%;padding:10px 12px;display:flex;align-items:center;gap:8px;background:transparent;border:none;color:var(--t2);font-family:var(--fm);font-size:12px;cursor:pointer;text-align:left;border-bottom:1px solid var(--border);-webkit-tap-highlight-color:transparent;} .tc-rev-hist-row:last-child{border-bottom:none;} .tc-rev-hist-row:hover,.tc-rev-hist-row:active,.tc-rev-hist-row.current{background:var(--surf3);color:var(--text);}
        .tc-rev-hist-tone{font-size:9px;color:var(--amber);} .tc-rev-hist-date{font-size:9px;color:var(--t3);margin-left:auto;} .tc-rev-hist-current-dot{font-size:9px;color:var(--amber);}
        .tc-note-input{background:var(--surf2);border-radius:10px;padding:12px;margin-bottom:10px;}
        .tc-note-hdr{display:flex;align-items:center;gap:6px;margin-bottom:8px;font-size:12px;color:var(--t2);}
        .tc-note-ts{padding:2px 8px;background:var(--aglow);border:1px solid rgba(232,160,32,.25);border-radius:5px;font-size:12px;color:var(--amber);font-weight:500;}
        .tc-note-live{font-size:9px;color:var(--t3);}
        .tc-note-textarea{width:100%;background:var(--bg);border:1.5px solid var(--border2);border-radius:8px;padding:10px 12px;color:var(--text);font-family:var(--fm);font-size:16px!important;resize:none;outline:none;-webkit-appearance:none;line-height:1.4;} .tc-note-textarea:focus{border-color:var(--amber);}
        .tc-note-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:8px;}
        .btn-ghost-sm{font-family:var(--fm);font-size:13px;padding:8px 14px;border-radius:8px;border:1.5px solid var(--border2);background:transparent;color:var(--t2);cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;}
        .btn-amber-sm{font-family:var(--fm);font-size:13px;font-weight:500;padding:8px 16px;border-radius:8px;background:var(--amber);color:#000;border:none;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;} .btn-amber-sm:disabled{opacity:.35;pointer-events:none;}
        .btn-delete-sm{font-family:var(--fm);font-size:13px;font-weight:500;padding:8px 16px;border-radius:8px;background:var(--red);color:#fff;border:none;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;}
        .tc-notes-list{border-top:1px solid var(--border);padding-top:10px;}
        .tc-notes-hdr{font-size:9px;color:var(--amber);letter-spacing:.12em;text-transform:uppercase;font-weight:500;margin-bottom:8px;}
        .tc-notes-rev{color:var(--t3);text-transform:none;letter-spacing:normal;font-weight:normal;}
        .tc-note-item{padding:9px 0;border-bottom:1px solid var(--border);} .tc-note-item:last-child{border-bottom:none;}
        .tc-note-meta{display:flex;align-items:center;gap:7px;margin-bottom:5px;}
        .tc-note-author{font-size:11px;color:var(--text);font-weight:500;}
        .tc-note-ts-pill{font-size:10px;padding:2px 7px;background:var(--aglow);border:1px solid rgba(232,160,32,.2);color:var(--amber);border-radius:4px;cursor:pointer;-webkit-tap-highlight-color:transparent;}
        .tc-note-date{font-size:10px;color:var(--t3);margin-left:auto;}
        .tc-note-body{font-size:13px;color:var(--t2);line-height:1.6;}
        .tc-notes-empty{font-size:11px;color:var(--t3);padding:8px 0;text-align:center;}
        .overlay-bg{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:200;display:flex;align-items:center;justify-content:center;padding:20px;}
        .confirm-box{background:var(--surf);border:1px solid var(--red);border-radius:14px;padding:28px 24px;max-width:340px;width:100%;text-align:center;}
        .confirm-box-title{font-family:var(--fh);font-size:18px;margin-bottom:8px;}
        .confirm-box-sub{font-size:13px;color:var(--t2);margin-bottom:20px;line-height:1.5;}
        .confirm-box-actions{display:flex;gap:10px;justify-content:center;}
        .btn-confirm-cancel{font-family:var(--fm);font-size:13px;padding:11px 20px;border-radius:9px;border:1.5px solid var(--border2);background:transparent;color:var(--t2);cursor:pointer;-webkit-tap-highlight-color:transparent;}
        .btn-confirm-delete{font-family:var(--fm);font-size:13px;font-weight:500;padding:11px 20px;border-radius:9px;background:var(--red);color:#fff;border:none;cursor:pointer;-webkit-tap-highlight-color:transparent;}
        .modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.88);backdrop-filter:blur(10px);z-index:100;overflow-y:auto;-webkit-overflow-scrolling:touch;padding-bottom:env(safe-area-inset-bottom,24px);}
        .modal-scroll-inner{min-height:100%;display:flex;align-items:flex-start;justify-content:center;padding:20px 12px 32px;}
        .rev-modal{background:var(--surf);border:1px solid var(--border2);border-radius:16px;width:100%;max-width:560px;padding:20px;}
        .rev-modal-title{font-family:var(--fh);font-size:20px;margin-bottom:4px;}
        .rev-modal-sub{font-size:12px;color:var(--t2);margin-bottom:16px;line-height:1.5;}
        .rev-dropzone{border:2px dashed var(--border2);border-radius:10px;background:var(--surf2);padding:20px;text-align:center;cursor:pointer;font-size:13px;color:var(--t2);transition:all .2s;-webkit-tap-highlight-color:transparent;touch-action:manipulation;margin-bottom:14px;} .rev-dropzone:hover,.rev-dropzone.over{border-color:var(--amber);background:var(--aglow);color:var(--amber);}
        .rev-file-list{display:flex;flex-direction:column;gap:10px;margin-bottom:14px;}
        .rev-file-row{background:var(--surf2);border:1px solid var(--border);border-radius:10px;padding:12px;}
        .rev-file-row-top{display:flex;align-items:center;gap:8px;margin-bottom:6px;}
        .rev-file-row.is-new{border-color:rgba(100,180,255,.3);}
        .rev-file-name-input{flex:1;background:var(--bg);border:1.5px solid var(--border2);border-radius:8px;color:var(--text);font-family:var(--fm);font-size:16px!important;padding:9px 12px;outline:none;-webkit-appearance:none;} .rev-file-name-input:focus{border-color:var(--amber);}
        .rev-file-badge-new{font-size:9px;background:rgba(100,180,255,.1);color:#6ab4ff;border:1px solid rgba(100,180,255,.25);border-radius:4px;padding:2px 6px;white-space:nowrap;}
        .rev-file-badge-rev{font-size:9px;background:var(--aglow);color:var(--amber);border:1px solid rgba(232,160,32,.25);border-radius:4px;padding:2px 6px;white-space:nowrap;}
        .rev-file-ref{font-size:10px;color:var(--t3);font-style:italic;margin-bottom:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .rev-file-tone-row{display:flex;align-items:center;justify-content:space-between;gap:8px;}
        .rev-file-tone-label{font-size:11px;color:var(--t2);}
        .rev-file-remove{width:28px;height:28px;border-radius:50%;border:1px solid var(--border2);background:transparent;color:var(--t3);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;-webkit-tap-highlight-color:transparent;} .rev-file-remove:hover{border-color:var(--red);color:var(--red);}
        .rev-modal-footer{border-top:1px solid var(--border);padding-top:14px;margin-top:4px;display:flex;align-items:center;gap:10px;}
        .rev-modal-status{font-size:11px;color:var(--t2);flex:1;}
        .rerun-target{font-size:13px;color:var(--t2);margin-bottom:14px;padding:10px 12px;background:var(--surf2);border-radius:8px;}
        .tgm-wrap{background:var(--surf3);border:1px solid var(--border2);border-radius:10px;padding:12px;}
        .tgm-axes{display:flex;font-size:9px;color:var(--t3);letter-spacing:.07em;text-transform:uppercase;margin-bottom:8px;align-items:center;}
        .tgm-row-labels{display:flex;flex-direction:column;gap:4px;margin-right:6px;font-size:9px;color:var(--t3);letter-spacing:.05em;text-transform:uppercase;}
        .tgm-row-labels div{height:40px;display:flex;align-items:center;justify-content:flex-end;white-space:nowrap;}
        .tgm-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;flex:1;}
        .tgm-cell{height:40px;border-radius:6px;border:1.5px solid var(--border2);background:var(--surf2);color:var(--t2);cursor:pointer;display:flex;align-items:center;justify-content:center;font-family:var(--fm);font-size:10px;font-weight:600;transition:all .15s;-webkit-tap-highlight-color:transparent;touch-action:manipulation;position:relative;}
        .tgm-cell:hover:not(:disabled){border-color:var(--amber);color:var(--text);background:var(--aglow);} .tgm-cell.active{border-color:var(--amber);background:rgba(232,160,32,.18);color:var(--amber);} .tgm-cell.center{border-color:rgba(232,160,32,.3);} .tgm-cell.used{opacity:.3;cursor:not-allowed;background:var(--surf3);}
        .tgm-used-dot{position:absolute;top:2px;right:3px;font-size:8px;color:var(--t3);}
        .tgm-tip{margin-top:8px;padding:7px 10px;background:var(--surf2);border-radius:7px;min-height:36px;display:flex;flex-direction:column;gap:2px;}
        .tgm-tip-label{font-size:11px;color:var(--amber);font-weight:500;} .tgm-tip-desc{font-size:10px;color:var(--t2);}
        .tgm-set-all{width:100%;margin-top:8px;padding:9px;border-radius:8px;border:1.5px solid var(--border2);background:transparent;color:var(--t2);font-family:var(--fm);font-size:12px;cursor:pointer;-webkit-tap-highlight-color:transparent;} .tgm-set-all:hover{border-color:var(--amber);color:var(--amber);}
        @media(min-width:640px){.page{padding:16px 24px 80px;}.player-station{padding:14px 24px;}}
      `}</style>

      <div className="topbar">
        <div style={{display:'flex',alignItems:'center',gap:6,minWidth:0}}>
          <a href="/" className="logo">maastr<em>.</em></a>
          <span style={{color:'var(--border2)',fontSize:14,flexShrink:0}}>/</span>
          <span className="breadcrumb">{project?.title||'…'}</span>
        </div>
        <a href="/" className="back">← Dashboard</a>
      </div>

      <div className="player-station">
        {activeTrack?(
          <>
            <div className="ps-track-info">
              <span className="ps-track-name">{activeTrack.title}</span>
              {activeRevision&&<span className="ps-rev-badge">{activeRevision.label||'v1'}</span>}
              {(activeRevision?.tone_label||activeTrack.tone_label)&&<span className="ps-tone-badge">{activeRevision?.tone_label||activeTrack.tone_label}</span>}
            </div>
            <div className="ps-waveform">
              <Waveform peaks={activeTrack.peaks} progress={progress} notes={notes} duration={duration} onSeek={handleSeek}/>
              <div className="ps-time-row">
                <span>{fmt(currentTime)}</span>
                <span>{notes.length>0?notes.length+(notes.length===1?' note':' notes'):''}</span>
                <span>{fmt(duration)}</span>
              </div>
            </div>
            <div className="ps-transport">
              <button className="ps-play-btn" onClick={togglePlay} disabled={!audioUrl}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="#000">
                  {playing?<><rect x="3" y="1" width="3.5" height="14" rx="1"/><rect x="9.5" y="1" width="3.5" height="14" rx="1"/></>:<polygon points="3,1 15,8 3,15"/>}
                </svg>
              </button>
              <span className="ps-time"><strong>{fmt(currentTime)}</strong> / {fmt(duration)}</span>
            </div>
          </>
        ):(
          <div className="ps-no-track">Tap a track to start listening</div>
        )}
      </div>

      <div className="page">
        <div className="page-header">
          <div className="proj-title">{project?.title}</div>
          <div className="proj-artist">{project?.artist}</div>
          <div className="top-actions">
            <button className="btn-upload-rev" onClick={()=>{setRevFiles([]);setRevStatus('');setShowRevModal(true);}}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Upload Revisions
            </button>
          </div>
        </div>
        <div className="tracks-lbl">Tracks ({tracks.length}) — drag to reorder</div>
        {tracks.map((track,idx)=>(
          <TrackCard key={track.id} track={track} idx={idx} totalTracks={tracks.length}
            isActive={activeTrackId===track.id}
            onActivate={activateTrack} onReorder={reorderTracks}
            playing={activeTrackId===track.id&&playing}
            currentTime={activeTrackId===track.id?currentTime:0}
            duration={activeTrackId===track.id?duration:0}
            notes={activeTrackId===track.id?notes:[]}
            noteText={activeTrackId===track.id?noteText:''}
            setNoteText={activeTrackId===track.id?setNoteText:()=>{}}
            onPostNote={postNote} onTogglePlay={togglePlay}
            onRename={renameTrack} onDeleteTrack={t=>setDeleteTrackConfirm(t)}
            onDeleteRevision={deleteRevision} onRerunRevision={t=>{setRerunTrack(t);setRerunTone(null);setRerunStatus('');}}
            onRevisionSelect={selectRevision}
            activeRevision={activeTrackId===track.id?activeRevision:null}
            projectId={project?.id}/>
        ))}
      </div>

      {/* ALWAYS MOUNTED — no conditional, no src prop. src driven by useEffect above. */}
      <audio ref={audioRef} preload="metadata"
        onTimeUpdate={e=>setCurrentTime(e.target.currentTime)}
        onDurationChange={e=>{if(e.target.duration&&isFinite(e.target.duration))setDuration(e.target.duration);}}
        onEnded={()=>setPlaying(false)}
        onError={()=>{setDuration(0);setPlaying(false);}}/>

      {deleteTrackConfirm&&(
        <div className="overlay-bg" onClick={()=>setDeleteTrackConfirm(null)}>
          <div className="confirm-box" onClick={e=>e.stopPropagation()}>
            <div className="confirm-box-title">Delete “{deleteTrackConfirm.title}”?</div>
            <div className="confirm-box-sub">Permanently deletes {deleteTrackConfirm.revisions?.length||0} revision{(deleteTrackConfirm.revisions?.length||0)!==1?'s':''} and all notes. Cannot be undone.</div>
            <div className="confirm-box-actions">
              <button className="btn-confirm-cancel" onClick={()=>setDeleteTrackConfirm(null)}>Keep it</button>
              <button className="btn-confirm-delete" onClick={()=>deleteTrack(deleteTrackConfirm)}>Delete Forever</button>
            </div>
          </div>
        </div>
      )}

      {rerunTrack&&(
        <div className="modal-bg" onClick={e=>e.target===e.currentTarget&&!rerunUploading&&setRerunTrack(null)}>
          <div className="modal-scroll-inner">
            <div className="rev-modal">
              <div className="rev-modal-title">Rerun Mastering</div>
              <div className="rerun-target">Track: <strong>{rerunTrack.title}</strong> — {(rerunTrack.revisions||[]).length} revision{(rerunTrack.revisions||[]).length!==1?'s':''} so far</div>
              <p style={{fontSize:12,color:'var(--t2)',marginBottom:12,lineHeight:1.5}}>Choose a new setting. Same source audio, new mastering. Already-used settings are greyed.</p>
              <ToneGrid value={rerunTone} usedTones={rerunUsedTones} onChange={setRerunTone}/>
              <div className="rev-modal-footer">
                <span className="rev-modal-status">{rerunStatus}</span>
                <button className="btn-ghost-sm" disabled={rerunUploading} onClick={()=>setRerunTrack(null)}>Cancel</button>
                <button className="btn-amber-sm" disabled={rerunTone===null||rerunUploading} onClick={submitRerun}>{rerunUploading?'Processing…':'Rerun Mastering'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showRevModal&&(
        <div className="modal-bg" onClick={e=>e.target===e.currentTarget&&!revUploading&&setShowRevModal(false)}>
          <div className="modal-scroll-inner">
            <div className="rev-modal">
              <div className="rev-modal-title">Upload Revisions</div>
              <div className="rev-modal-sub">Drop one or more files. We’ll auto-match by name — matched files become revisions, new names become new tracks.</div>
              <div className={`rev-dropzone ${revDragging?'over':''}`}
                onDragOver={e=>{e.preventDefault();setRevDragging(true);}} onDragLeave={e=>{e.preventDefault();setRevDragging(false);}}
                onDrop={e=>{e.preventDefault();e.stopPropagation();setRevDragging(false);addRevFiles(e.dataTransfer?.files||[]);}}
                onClick={()=>document.getElementById('rev-multi-input').click()}>
                <div style={{fontSize:24,marginBottom:6}}>🎵</div>
                <strong>{revFiles.length>0?'Drop more files to add':'Drop WAV / MP3 files here'}</strong>
                <br/><span style={{fontSize:11,opacity:.6}}>Multiple files OK — or tap to browse</span>
                <input id="rev-multi-input" type="file" accept=".wav,.mp3,.aiff,.aif,.flac,.m4a,audio/*" multiple style={{display:'none'}} onChange={e=>{addRevFiles(e.target.files);e.target.value='';}}/>
              </div>
              {revFiles.length>0&&(
                <div className="rev-file-list">
                  {revFiles.map((entry,i)=>(
                    <div key={i} className={`rev-file-row ${entry.isNew?'is-new':''}`}>
                      <div className="rev-file-row-top">
                        <input className="rev-file-name-input" value={entry.name}
                          onChange={e=>{const n=e.target.value;const m=tracks.find(t=>t.title.toLowerCase()===n.toLowerCase());setRevFiles(prev=>prev.map((r,j)=>j===i?{...r,name:n,matchedTrackId:m?.id||null,isNew:!m}:r));}}
                          placeholder="Track name"
                          onFocus={e=>setTimeout(()=>e.target.scrollIntoView({behavior:'smooth',block:'center'}),300)}/>
                        <span className={entry.isNew?'rev-file-badge-new':'rev-file-badge-rev'}>{entry.isNew?'new track':'revision'}</span>
                        <button className="rev-file-remove" onClick={()=>setRevFiles(prev=>prev.filter((_,j)=>j!==i))}>×</button>
                      </div>
                      <div className="rev-file-ref">{entry.file.name} — {(entry.file.size/1024/1024).toFixed(1)} MB{entry.peaksComputed?' — waveform ✓':''}</div>
                      <div className="rev-file-tone-row">
                        <span className="rev-file-tone-label">Mastering:</span>
                        <div style={{flex:1}}>
                          <ToneGrid value={entry.tone}
                            usedTones={entry.matchedTrackId?tracks.find(t=>t.id===entry.matchedTrackId)?.revisions?.map(r=>r.tone_setting).filter(t=>t!=null)||[]:[]}
                            onChange={t=>setRevFiles(prev=>prev.map((r,j)=>j===i?{...r,tone:t}:r))}
                            showSetAll={revFiles.length>1}
                            onSetAll={t=>setRevFiles(prev=>prev.map(r=>({...r,tone:t})))}/>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="rev-modal-footer">
                <span className="rev-modal-status">{revStatus}</span>
                <button className="btn-ghost-sm" disabled={revUploading} onClick={()=>setShowRevModal(false)}>Cancel</button>
                <button className="btn-amber-sm" disabled={revFiles.length===0||revUploading||revFiles.some(e=>!e.name.trim())} onClick={submitRevisions}>
                  {revUploading?revStatus||'Uploading…':'Upload '+revFiles.length+' file'+(revFiles.length!==1?'s':'')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
