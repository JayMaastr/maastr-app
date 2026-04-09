'use client';
import { useState, useEffect } from 'react';
import { sb } from '@/lib/supabase';

export default function Auth() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState('signin');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const next = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('next') || '/' : '/';

  useEffect(() => {
    sb.auth.getSession().then(({ data: { session } }) => {
      if (session) window.location.href = next;
    });
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true); setMsg('');
    try {
      if (mode === 'signin') {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        window.location.href = next;
      } else if (mode === 'signup') {
        const { error } = await sb.auth.signUp({ email, password });
        if (error) throw error;
        setMsg('Check your email to confirm your account.');
      } else {
        const { error } = await sb.auth.signInWithOtp({ email });
        if (error) throw error;
        setMsg('Magic link sent — check your email.');
      }
    } catch (err) { setMsg(err.message); }
    setLoading(false);
  }

  async function googleSignIn() {
    await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + next }
    });
  }

  return (
    <>
      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        body{background:#0a0a0b;color:#f0ede8;font-family:'DM Mono','SF Mono','Menlo',monospace;min-height:100vh;display:flex;align-items:center;justify-content:center;}
        .card{width:100%;max-width:400px;padding:40px;background:#111113;border:1px solid #24242c;border-radius:16px;}
        .logo{font-family:'DM Serif Display',Georgia,serif;font-size:28px;text-align:center;margin-bottom:8px;}
        .logo em{color:#e8a020;font-style:normal;}
        .sub{text-align:center;font-size:12px;color:#8a8780;margin-bottom:32px;}
        .google-btn{width:100%;padding:12px;border-radius:10px;border:1.5px solid #2e2e38;background:transparent;color:#f0ede8;font-family:'DM Mono',monospace;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:20px;transition:background .15s;}
        .google-btn:hover{background:#16161a;}
        .divider{display:flex;align-items:center;gap:12px;margin-bottom:20px;color:#4a4945;font-size:11px;}
        .divider::before,.divider::after{content:'';flex:1;height:1px;background:#24242c;}
        .field{margin-bottom:14px;}
        .field label{display:block;font-size:11px;color:#8a8780;letter-spacing:.07em;text-transform:uppercase;margin-bottom:8px;}
        .field input{width:100%;background:#16161a;border:1.5px solid #2e2e38;border-radius:10px;color:#f0ede8;font-family:'DM Mono',monospace;font-size:14px;padding:11px 14px;outline:none;transition:border-color .15s;}
        .field input:focus{border-color:#e8a020;}
        .submit{width:100%;padding:13px;border-radius:10px;background:#e8a020;color:#000;font-family:'DM Mono',monospace;font-size:14px;font-weight:500;border:none;cursor:pointer;margin-top:8px;transition:opacity .15s;}
        .submit:hover{opacity:.9;}
        .submit:disabled{opacity:.5;pointer-events:none;}
        .tabs{display:flex;gap:0;margin-bottom:20px;background:#16161a;border-radius:10px;padding:3px;}
        .tab{flex:1;padding:8px;text-align:center;font-size:11px;letter-spacing:.05em;text-transform:uppercase;cursor:pointer;border-radius:8px;border:none;background:transparent;color:#4a4945;font-family:'DM Mono',monospace;transition:all .15s;}
        .tab.active{background:#1e1e24;color:#f0ede8;}
        .msg{margin-top:14px;font-size:12px;text-align:center;color:#e8a020;line-height:1.5;}
        .msg.error{color:#f05050;}
      `}</style>
      <div className="card">
        <div className="logo">maastr<em>.</em></div>
        <div className="sub">AI-powered music mastering</div>
        <button className="google-btn" onClick={googleSignIn}>
          <svg width="16" height="16" viewBox="0 0 24 24">
            <path fill="#4285f4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34a853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#fbbc05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
            <path fill="#ea4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Continue with Google
        </button>
        <div className="divider">or</div>
        <div className="tabs">
          {['signin','signup','magic'].map(m => (
            <button key={m} className={`tab ${mode===m?'active':''}`}
              onClick={() => { setMode(m); setMsg(''); }}>
              {m === 'signin' ? 'Sign In' : m === 'signup' ? 'Sign Up' : 'Magic Link'}
            </button>
          ))}
        </div>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com" required />
          </div>
          {mode !== 'magic' && (
            <div className="field">
              <label>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••" required />
            </div>
          )}
          <button className="submit" type="submit" disabled={loading}>
            {loading ? 'Loading…' : mode === 'signin' ? 'Sign In' : mode === 'signup' ? 'Create Account' : 'Send Magic Link'}
          </button>
        </form>
        {msg && <div className={`msg ${msg.startsWith('Error') ? 'error' : ''}`}>{msg}</div>}
      </div>
    </>
  );
}
