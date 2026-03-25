'use client';
import { useState, useEffect } from 'react';
import { sb } from '@/lib/supabase';

const TIERS = [
  {
    id: 'home_studio_wiz',
    name: 'Home Studio Wiz',
    price: 90,
    desc: 'Perfect for solo artists and home recordists who want pro-quality masters fast.',
    features: ['Full master previews','Project collaboration','Paid WAV downloads','Limited tone & dynamic settings'],
    highlight: false,
    cta: 'Get Started',
  },
  {
    id: 'studio_expert',
    name: 'Studio Expert',
    price: 180,
    desc: 'For working engineers who master for clients and need full control.',
    features: ['Full master previews','Project collaboration','Free MP3 downloads','Paid WAV downloads','Full tone & dynamic settings'],
    highlight: true,
    cta: 'Most Popular',
  },
  {
    id: 'industry_pro',
    name: 'Industry Pro',
    price: 450,
    desc: 'For studios and power users who need everything, now.',
    features: ['Full master previews','Project collaboration','Free WAV downloads','Early access to new features','Full tone & dynamic settings'],
    highlight: false,
    cta: 'Go Pro',
  },
];

const TIER_LABELS = {free:'Free',home_studio_wiz:'Home Studio Wiz',studio_expert:'Studio Expert',industry_pro:'Industry Pro'};

export default function PricingPage() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    sb.auth.getUser().then(({ data }) => {
      setUser(data.user);
      if (data.user) {
        sb.from('profiles').select('subscription_tier,subscription_status').eq('id', data.user.id).single()
          .then(({ data: p }) => setProfile(p));
      }
    });
  }, []);

  const handleSelect = (tierId) => {
    if (!user) { window.location.href = '/auth?next=/pricing'; return; }
    alert('Stripe checkout coming soon — selected: ' + tierId);
  };

  return (
    <>
      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        :root{--bg:#0a0a0b;--surf:#111113;--surf2:#16161a;--surf3:#1e1e24;--border:#24242c;--border2:#2e2e38;--amber:#e8a020;--text:#f0ede8;--t2:#8a8780;--t3:#4a4945;--fh:'DM Serif Display',Georgia,serif;--fm:'DM Mono','SF Mono','Menlo',monospace;}
        html,body{background:var(--bg);color:var(--text);font-family:var(--fm);min-height:100%;}
        .pw{max-width:1100px;margin:0 auto;padding:0 24px;}
        .ph{display:flex;align-items:center;justify-content:space-between;padding:20px 0 18px;border-bottom:1px solid var(--border);}
        .plogo{font-family:var(--fh);font-size:22px;cursor:pointer;color:var(--text);text-decoration:none;}
        .plogo em{color:var(--amber);font-style:normal;}
        .phero{padding:64px 0 48px;text-align:center;}
        .phero h1{font-family:var(--fh);font-size:clamp(36px,5vw,56px);line-height:1.05;letter-spacing:-.02em;margin-bottom:16px;}
        .phero h1 em{font-style:italic;color:var(--amber);}
        .phero p{font-size:14px;color:var(--t2);max-width:480px;margin:0 auto;line-height:1.7;}
        .pcards{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px;padding-bottom:80px;}
        .pcard{background:var(--surf);border:1px solid var(--border);border-radius:14px;padding:28px 24px;display:flex;flex-direction:column;position:relative;transition:border-color .2s;}
        .pcard.pop{border-color:var(--amber);box-shadow:0 0 32px rgba(232,160,32,0.08);}
        .pcbadge{position:absolute;top:-12px;left:50%;transform:translateX(-50%);background:var(--amber);color:#000;font-size:10px;font-weight:600;letter-spacing:.08em;padding:4px 14px;border-radius:20px;white-space:nowrap;}
        .pcname{font-family:var(--fh);font-size:22px;margin-bottom:8px;}
        .pcprice{font-family:var(--fh);font-size:42px;line-height:1;margin-bottom:4px;}
        .pcprice span{font-size:14px;color:var(--t2);font-family:var(--fm);}
        .pcdesc{font-size:12px;color:var(--t2);line-height:1.6;margin:12px 0 20px;flex:1;}
        .pcfeats{list-style:none;display:flex;flex-direction:column;gap:10px;margin-bottom:28px;}
        .pcfeats li{font-size:12px;display:flex;align-items:flex-start;gap:8px;color:var(--t2);}
        .pcfeats li::before{content:'✓';color:var(--amber);flex-shrink:0;font-weight:600;}
        .pcbtn{padding:12px;border-radius:8px;border:1.5px solid var(--border2);background:transparent;color:var(--text);font-family:var(--fm);font-size:13px;font-weight:500;cursor:pointer;transition:all .15s;-webkit-tap-highlight-color:transparent;width:100%;}
        .pcbtn:hover:not(:disabled){border-color:var(--amber);color:var(--amber);}
        .pcbtn:disabled{opacity:.5;cursor:not-allowed;}
        .pcard.pop .pcbtn{background:var(--amber);color:#000;border-color:var(--amber);}
        .pcard.pop .pcbtn:hover:not(:disabled){opacity:.9;}
        .pccur{text-align:center;font-size:11px;color:var(--amber);margin-top:10px;letter-spacing:.04em;}
        @media(max-width:640px){.phero{padding:40px 0 32px;}.pcards{grid-template-columns:1fr;}}
      `}</style>
      <div className="pw">
        <header className="ph">
          <a className="plogo" href="/">maastr<em>.</em></a>
          {user
            ? <span style={{fontSize:12,color:'var(--t2)',cursor:'pointer'}} onClick={()=>window.location.href='/'}>← Dashboard</span>
            : <button style={{fontSize:12,padding:'8px 16px',borderRadius:6,border:'1px solid var(--border2)',background:'transparent',color:'var(--text)',cursor:'pointer',fontFamily:'var(--fm)'}} onClick={()=>window.location.href='/auth'}>Sign In</button>}
        </header>
        <div className="phero">
          <h1>Simple, <em>transparent</em> pricing.</h1>
          <p>One annual subscription. Cancel anytime. All plans include project collaboration and full master previews.</p>
        </div>
        {profile && (
          <p style={{textAlign:'center',fontSize:12,color:'var(--t2)',marginBottom:32}}>
            You are on the <span style={{color:'var(--amber)'}}>{TIER_LABELS[profile.subscription_tier]||'Free'}</span> plan
            {profile.subscription_status==='active'?' · Active':''}.
          </p>
        )}
        <div className="pcards">
          {TIERS.map(t => {
            const isCurrent = profile?.subscription_tier===t.id;
            return (
              <div key={t.id} className={'pcard'+(t.highlight?' pop':'')}>
                {t.highlight && <div className="pcbadge">MOST POPULAR</div>}
                <div className="pcname">{t.name}</div>
                <div className="pcprice">${t.price}<span>/year</span></div>
                <div className="pcdesc">{t.desc}</div>
                <ul className="pcfeats">{t.features.map((f,i)=><li key={i}>{f}</li>)}</ul>
                <button className="pcbtn" onClick={()=>handleSelect(t.id)} disabled={isCurrent}>
                  {isCurrent?'Current Plan':t.cta}
                </button>
                {isCurrent&&<div className="pccur">✓ Your current plan</div>}
              </div>
            );
          })}
        </div>
        <p style={{textAlign:'center',fontSize:11,color:'var(--t3)',paddingBottom:40}}>
          All prices in USD. Annual billing only. Secure payments via Stripe.
        </p>
      </div>
    </>
  );
}
