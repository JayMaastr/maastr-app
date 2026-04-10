'use client';
import { useState, useEffect } from 'react';
import { sb } from '@/lib/supabase';

export default function InvitePage({ params }) {
  const { token } = params;
  const [state, setState] = useState('loading'); // loading | logged-out | wrong-account | confirm | accepting | done | error | expired
  const [user, setUser] = useState(null);
  const [invite, setInvite] = useState(null);
  const [project, setProject] = useState(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    async function load() {
      // Look up invite via API (bypasses RLS)
    const lookupRes = await fetch('/api/invite-lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const lookupData = await lookupRes.json();

    if (lookupData.error === 'expired') { setState('expired'); return; }
    if (lookupData.error === 'already_accepted') {
      window.location.href = '/player?project=' + lookupData.project_id;
      return;
    }
    if (lookupData.error || !lookupData.project) {
      setState('error');
      setMsg(lookupData.error || 'Invite not found.');
      return;
    }

    setInvite(lookupData);
    setProject(lookupData.project);

    // Check if user is logged in and matches invited email
    const { data: { user: u } } = await sb.auth.getUser();
    setUser(u);

    if (!u) {
      setState('logged-out');
    } else if (u.email && lookupData.invited_email && u.email.toLowerCase() !== lookupData.invited_email.toLowerCase()) {
      setState('wrong-account');
    } else {
      setState('confirm');
    }
    }
    load();
  }, [token]);

  const accept = async () => {
    setState('accepting');
    try {
      const res = await fetch('/api/invite-accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, userId: user?.id || null }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setState('done');
      localStorage.removeItem('maastr_pending_invite');
      setTimeout(() => {
        window.location.href = '/player?project=' + (invite.project_id || invite.project?.id);
      }, 1500);
    } catch (err) {
      setState('error');
      setMsg(err.message);
    }
  };

  const signOut = async () => {
    localStorage.setItem('maastr_pending_invite', token);
    await sb.auth.signOut();
    window.location.href = '/auth?next=/invite/' + token;
  };

  const goSignup = () => {
    localStorage.setItem('maastr_pending_invite', token);
    window.location.href = '/auth?next=/invite/' + token;
  };

  return (
    <>
      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        :root{--bg:#0a0a0b;--surf:#111113;--border:#24242c;--border2:#2e2e38;--amber:#e8a020;--text:#f0ede8;--t2:#8a8780;--t3:#4a4945;--fh:'DM Serif Display',Georgia,serif;--fm:'DM Mono','SF Mono','Menlo',monospace;}
        html,body{background:var(--bg);color:var(--text);font-family:var(--fm);min-height:100%;display:flex;align-items:center;justify-content:center;}
        .wrap{max-width:420px;width:100%;margin:0 auto;padding:40px 24px;text-align:center;}
        .logo{font-family:var(--fh);font-size:24px;margin-bottom:40px;}
        .logo em{color:var(--amber);font-style:normal;}
        .card{background:var(--surf);border:1px solid var(--border);border-radius:16px;padding:32px 24px;}
        .project-img{width:72px;height:72px;border-radius:10px;object-fit:cover;margin:0 auto 16px;display:block;background:var(--border);}
        .project-title{font-family:var(--fh);font-size:22px;margin-bottom:4px;}
        .project-artist{font-size:12px;color:var(--t2);margin-bottom:20px;}
        .invite-msg{font-size:12px;color:var(--t2);line-height:1.7;padding:12px;background:rgba(232,160,32,0.08);border:1px solid rgba(232,160,32,0.2);border-radius:8px;margin-bottom:20px;text-align:left;}
        .btn{display:block;width:100%;padding:14px;border-radius:8px;border:none;background:var(--amber);color:#000;font-family:var(--fm);font-size:13px;font-weight:600;cursor:pointer;transition:opacity .15s;margin-bottom:10px;}
        .btn:hover{opacity:.85;}
        .btn:disabled{opacity:.5;cursor:not-allowed;}
        .btn-ghost{background:transparent;border:1px solid var(--border2);color:var(--t2);}
        .btn-ghost:hover{border-color:var(--amber);color:var(--amber);}
        h2{font-family:var(--fh);font-size:20px;margin-bottom:12px;}
        p{font-size:13px;color:var(--t2);line-height:1.7;margin-bottom:20px;}
        .check{font-size:40px;margin-bottom:12px;}
      `}</style>
      <div className="wrap">
        <div className="logo">maastr<em>.</em></div>

        {state === 'loading' && (
          <div style={{color:'var(--t3)',fontSize:13}}>Loading invite...</div>
        )}

        {state === 'expired' && (
          <div className="card">
            <div className="check">⏰</div>
            <h2>Invite Expired</h2>
            <p>This invite link has expired. Ask your engineer to send a new one.</p>
          </div>
        )}

        {state === 'error' && (
          <div className="card">
            <div className="check">⚠️</div>
            <h2>Something went wrong</h2>
            <p>{msg || 'This invite link is invalid or has already been used.'}</p>
          </div>
        )}

        {state === 'logged-out' && project && (
          <div className="card">
            <div className="project-title">{project.title}</div>
            {project.artist && <div className="project-artist">{project.artist}</div>}
            {invite?.message && <div className="invite-msg">{invite.message}</div>}
            <p>You've been invited to review this project on maastr. Sign in or create a free account to get started.</p>
            <button className="btn" onClick={goSignup}>Sign In / Create Account</button>
            <p style={{fontSize:11,color:'var(--t3)',marginBottom:0}}>Free account required to access the project.</p>
          </div>
        )}

        {state === 'confirm' && project && (
          <div className="card">
            {project.image_url && <img className="project-img" src={project.image_url} alt={project.title} />}
            <div className="project-title">{project.title}</div>
            {project.artist && <div className="project-artist">{project.artist}</div>}
            {invite?.message && <div className="invite-msg">{invite.message}</div>}
            <p>Accept this invite to access the project and leave feedback.</p>
            <button className="btn" onClick={accept}>Accept & Open Project</button>
            <button className="btn btn-ghost" onClick={()=>window.location.href='/'}>Go to Dashboard</button>
          </div>
        )}

        {state === 'wrong-account' && project && (
            <div className="card">
              <div className="project-title">{project.title}</div>
              {project.artist && <div className="project-artist">{project.artist}</div>}
              <p>You're signed in as <strong style={{color:'var(--text)'}}>{user?.email}</strong>, but this invite was sent to <strong style={{color:'var(--amber)'}}>{invite?.invited_email}</strong>.</p>
              <button className="btn" onClick={signOut}>Sign Out & Continue</button>
              <p style={{fontSize:11,color:'var(--t3)',marginBottom:0}}>You'll be redirected to create an account or sign in with the correct email.</p>
            </div>
          )}
          {state === 'accepting' && (
          <div className="card">
            <div className="check">⏳</div>
            <h2>Accepting...</h2>
          </div>
        )}

        {state === 'done' && (
          <div className="card">
            <div className="check">✓</div>
            <h2>You're in!</h2>
            <p>Redirecting to the project...</p>
          </div>
        )}
      </div>
    </>
  );
}
