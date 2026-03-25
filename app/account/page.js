'use client';
import { useState, useEffect, useRef } from 'react';
import { sb, UPLOAD_WORKER_URL } from '@/lib/supabase';

const TIER_LABELS = {free:'Free',home_studio_wiz:'Home Studio Wiz',studio_expert:'Studio Expert',industry_pro:'Industry Pro'};
const TIER_COLORS = {free:'var(--t3)',home_studio_wiz:'#7ab8f5',studio_expert:'var(--amber)',industry_pro:'#c084fc'};

export default function AccountPage() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [form, setForm] = useState({full_name:'',bio:'',avatar_url:''});
  const [pwForm, setPwForm] = useState({current:'',next:'',confirm:''});
  const [pwMsg, setPwMsg] = useState('');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarRef = useRef(null);

  useEffect(() => {
    sb.auth.getUser().then(({ data }) => {
      if (!data.user) { window.location.href = '/auth'; return; }
      setUser(data.user);
      sb.from('profiles').select('*').eq('id', data.user.id).single().then(({ data: p }) => {
        if (p) {
          setProfile(p);
          setForm({ full_name: p.full_name||'', bio: p.bio||'', avatar_url: p.avatar_url||'' });
        }
        setLoading(false);
      });
    });
  }, []);

  const saveProfile = async () => {
    setSaving(true); setMsg('');
    const { error } = await sb.from('profiles').update({
      full_name: form.full_name,
      bio: form.bio,
      updated_at: new Date().toISOString(),
    }).eq('id', user.id);
    setSaving(false);
    setMsg(error ? 'Error: ' + error.message : 'Profile saved!');
    setTimeout(() => setMsg(''), 3000);
  };

  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch(UPLOAD_WORKER_URL + '?project=avatars&name=' + user.id + '_' + Date.now() + '.' + file.name.split('.').pop(), {
        method: 'POST', body: file,
        headers: { 'Content-Type': file.type }
      });
      const json = await res.json();
      if (json.url) {
        await sb.from('profiles').update({ avatar_url: json.url }).eq('id', user.id);
        setForm(f => ({ ...f, avatar_url: json.url }));
        setMsg('Avatar updated!');
        setTimeout(() => setMsg(''), 3000);
      }
    } catch (err) {
      setMsg('Upload failed: ' + err.message);
    }
    setUploadingAvatar(false);
  };

  const changePassword = async () => {
    setPwMsg('');
    if (pwForm.next !== pwForm.confirm) { setPwMsg('Passwords do not match.'); return; }
    if (pwForm.next.length < 8) { setPwMsg('Password must be at least 8 characters.'); return; }
    const { error } = await sb.auth.updateUser({ password: pwForm.next });
    setPwMsg(error ? 'Error: ' + error.message : 'Password updated!');
    if (!error) setPwForm({ current:'', next:'', confirm:'' });
    setTimeout(() => setPwMsg(''), 4000);
  };

  if (loading) return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',background:'#0a0a0b',color:'#4a4945',fontFamily:'monospace'}}>Loading...</div>;

  const tier = profile?.subscription_tier || 'free';
  const tierColor = TIER_COLORS[tier] || 'var(--t3)';

  return (
    <>
      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        :root{--bg:#0a0a0b;--surf:#111113;--surf2:#16161a;--surf3:#1e1e24;--border:#24242c;--border2:#2e2e38;--amber:#e8a020;--text:#f0ede8;--t2:#8a8780;--t3:#4a4945;--fh:'DM Serif Display',Georgia,serif;--fm:'DM Mono','SF Mono','Menlo',monospace;--radius:12px;}
        html,body{background:var(--bg);color:var(--text);font-family:var(--fm);min-height:100%;}
        .aw{max-width:720px;margin:0 auto;padding:0 24px 80px;}
        .ah{display:flex;align-items:center;justify-content:space-between;padding:20px 0 18px;border-bottom:1px solid var(--border);margin-bottom:40px;}
        .alogo{font-family:var(--fh);font-size:22px;cursor:pointer;color:var(--text);text-decoration:none;}
        .alogo em{color:var(--amber);font-style:normal;}
        .aback{font-size:12px;color:var(--t3);cursor:pointer;-webkit-tap-highlight-color:transparent;}
        .aback:hover{color:var(--t2);}
        .asec{background:var(--surf);border:1px solid var(--border);border-radius:var(--radius);padding:24px;margin-bottom:20px;}
        .asec-title{font-family:var(--fh);font-size:18px;margin-bottom:20px;}
        .arow{display:flex;gap:16px;align-items:flex-start;margin-bottom:16px;}
        .afull{width:100%;margin-bottom:16px;}
        label{font-size:10px;color:var(--t3);letter-spacing:.06em;text-transform:uppercase;display:block;margin-bottom:6px;}
        input,textarea{width:100%;background:var(--surf2);border:1px solid var(--border2);border-radius:8px;padding:10px 12px;color:var(--text);font-family:var(--fm);font-size:13px;outline:none;transition:border-color .15s;}
        input:focus,textarea:focus{border-color:var(--amber);}
        textarea{resize:vertical;min-height:80px;}
        .abtn{padding:10px 20px;border-radius:8px;border:none;background:var(--amber);color:#000;font-family:var(--fm);font-size:12px;font-weight:600;cursor:pointer;transition:opacity .15s;-webkit-tap-highlight-color:transparent;}
        .abtn:hover{opacity:.85;}
        .abtn:disabled{opacity:.5;cursor:not-allowed;}
        .abtn-ghost{background:transparent;border:1px solid var(--border2);color:var(--t2);}
        .abtn-ghost:hover{border-color:var(--amber);color:var(--amber);}
        .amsg{font-size:11px;margin-top:10px;color:var(--amber);}
        .amsg.err{color:#e05050;}
        .aavatar{width:72px;height:72px;border-radius:50%;background:var(--surf3);border:2px solid var(--border2);object-fit:cover;cursor:pointer;transition:border-color .15s;flex-shrink:0;}
        .aavatar:hover{border-color:var(--amber);}
        .avatar-placeholder{width:72px;height:72px;border-radius:50%;background:var(--surf3);border:2px dashed var(--border2);display:flex;align-items:center;justify-content:center;font-size:24px;cursor:pointer;flex-shrink:0;color:var(--t3);transition:border-color .15s;}
        .avatar-placeholder:hover{border-color:var(--amber);color:var(--amber);}
        .tier-badge{display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:20px;background:var(--surf3);border:1px solid var(--border2);font-size:11px;font-weight:500;}
        .tier-dot{width:8px;height:8px;border-radius:50%;background:currentColor;}
        @media(max-width:500px){.arow{flex-direction:column;}}
      `}</style>
      <div className="aw">
        <header className="ah">
          <a className="alogo" href="/">maastr<em>.</em></a>
          <span className="aback" onClick={()=>window.location.href='/'}>← Dashboard</span>
        </header>

        {/* Plan */}
        <div className="asec">
          <div className="asec-title">Your Plan</div>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:12}}>
            <div className="tier-badge" style={{color:tierColor}}>
              <span className="tier-dot"/>
              {TIER_LABELS[tier]||'Free'}
              {profile?.subscription_status==='active'&&<span style={{color:'var(--t3)',fontWeight:400}}> · Active</span>}
            </div>
            <button className="abtn abtn-ghost" onClick={()=>window.location.href='/pricing'}>
              {tier==='free'?'Upgrade Plan':'Manage Plan'}
            </button>
          </div>
          {tier==='free'&&(
            <p style={{fontSize:11,color:'var(--t3)',marginTop:12,lineHeight:1.6}}>
              Upgrade to get full master previews, collaboration, and downloads.
            </p>
          )}
        </div>

        {/* Profile */}
        <div className="asec">
          <div className="asec-title">Profile</div>
          <div className="arow">
            <div>
              <label>Avatar</label>
              {form.avatar_url
                ? <img className="aavatar" src={form.avatar_url} alt="avatar" onClick={()=>avatarRef.current?.click()} />
                : <div className="avatar-placeholder" onClick={()=>avatarRef.current?.click()}>{uploadingAvatar?'..':'+'}</div>}
              <input ref={avatarRef} type="file" accept="image/*" style={{display:'none'}} onChange={handleAvatarChange}/>
              <div style={{fontSize:9,color:'var(--t3)',marginTop:6,textAlign:'center'}}>click to change</div>
            </div>
            <div style={{flex:1}}>
              <div className="afull">
                <label>Display Name</label>
                <input value={form.full_name} onChange={e=>setForm(f=>({...f,full_name:e.target.value}))} placeholder="Your name" />
              </div>
              <div>
                <label>Email</label>
                <input value={user?.email||''} disabled style={{opacity:.5,cursor:'not-allowed'}}/>
              </div>
            </div>
          </div>
          <div className="afull" style={{marginTop:4}}>
            <label>Bio</label>
            <textarea value={form.bio} onChange={e=>setForm(f=>({...f,bio:e.target.value}))} placeholder="A little about you or your studio..." />
          </div>
          <button className="abtn" onClick={saveProfile} disabled={saving}>{saving?'Saving...':'Save Profile'}</button>
          {msg&&<div className={'amsg'+(msg.startsWith('Error')?' err':'')}>{msg}</div>}
        </div>

        {/* Password */}
        <div className="asec">
          <div className="asec-title">Change Password</div>
          <div className="afull">
            <label>New Password</label>
            <input type="password" value={pwForm.next} onChange={e=>setPwForm(f=>({...f,next:e.target.value}))} placeholder="New password (min 8 chars)" />
          </div>
          <div className="afull">
            <label>Confirm Password</label>
            <input type="password" value={pwForm.confirm} onChange={e=>setPwForm(f=>({...f,confirm:e.target.value}))} placeholder="Confirm new password" />
          </div>
          <button className="abtn" onClick={changePassword}>Update Password</button>
          {pwMsg&&<div className={'amsg'+(pwMsg.startsWith('Error')||pwMsg.includes('match')||pwMsg.includes('least')?' err':'')}>{pwMsg}</div>}
        </div>

        {/* Danger */}
        <div className="asec" style={{borderColor:'rgba(224,80,80,0.2)'}}>
          <div className="asec-title" style={{color:'#e05050'}}>Sign Out</div>
          <button className="abtn abtn-ghost" style={{borderColor:'rgba(224,80,80,0.4)',color:'#e05050'}}
            onClick={async()=>{await sb.auth.signOut();window.location.href='/auth';}}>
            Sign Out
          </button>
        </div>
      </div>
    </>
  );
}
