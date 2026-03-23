export default function Pricing() {
  const plans = [
    {
      name: 'Starter',
      price: '0',
      period: 'free forever',
      desc: 'For artists just getting started.',
      features: ['1 active project','2 tracks per project','Timestamped notes','Share with 1 collaborator'],
      cta: 'Get Started Free',
      href: '/auth',
      highlight: false,
    },
    {
      name: 'Pro',
      price: '29',
      period: 'per month',
      desc: 'For working musicians and small studios.',
      features: ['Unlimited projects','Unlimited tracks','Revision history','Up to 10 collaborators','Priority R2 storage','Download masters'],
      cta: 'Start Pro Trial',
      href: '/auth',
      highlight: true,
    },
    {
      name: 'Studio',
      price: '99',
      period: 'per month',
      desc: 'For labels, producers, and busy studios.',
      features: ['Everything in Pro','Unlimited collaborators','White-label share links','API access','Dedicated support','Custom integrations'],
      cta: 'Contact Us',
      href: 'mailto:hello@maastr.io',
      highlight: false,
    },
  ];

  return (
    <>
      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        :root{
          --bg:#0a0a0b;--surf:#111113;--surf2:#16161a;--surf3:#1e1e24;
          --border:#24242c;--border2:#2e2e38;
          --amber:#e8a020;--aglow:rgba(232,160,32,0.08);--aglow2:rgba(232,160,32,0.15);
          --text:#f0ede8;--t2:#8a8780;--t3:#4a4945;
          --fh:'DM Serif Display',Georgia,serif;
          --fm:'DM Mono','SF Mono','Menlo',monospace;
        }
        html,body{background:var(--bg);color:var(--text);font-family:var(--fm);}
        nav{display:flex;align-items:center;justify-content:space-between;padding:20px 40px;border-bottom:1px solid var(--border);position:sticky;top:0;background:rgba(10,10,11,.92);backdrop-filter:blur(12px);z-index:50;}
        .nav-logo{font-family:var(--fh);font-size:20px;color:var(--text);text-decoration:none;}
        .nav-logo em{color:var(--amber);font-style:normal;}
        .nav-links{display:flex;align-items:center;gap:28px;}
        .nav-link{font-size:12px;color:var(--t2);text-decoration:none;transition:color .15s;letter-spacing:.04em;}
        .nav-link:hover{color:var(--text);}
        .nav-cta{font-size:12px;padding:8px 18px;border-radius:8px;background:var(--amber);color:#000;font-family:var(--fm);font-weight:500;text-decoration:none;transition:opacity .15s;}
        .nav-cta:hover{opacity:.88;}
        .hero{text-align:center;padding:100px 24px 80px;max-width:680px;margin:0 auto;}
        .hero-tag{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--amber);margin-bottom:20px;}
        .hero-title{font-family:var(--fh);font-size:clamp(40px,6vw,68px);line-height:1.04;letter-spacing:-.03em;margin-bottom:20px;}
        .hero-title em{font-style:italic;color:var(--amber);}
        .hero-sub{font-size:14px;color:var(--t2);line-height:1.7;max-width:480px;margin:0 auto;}
        .plans{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px;max-width:1000px;margin:0 auto 100px;padding:0 24px;}
        .plan{background:var(--surf);border:1px solid var(--border);border-radius:16px;padding:32px;display:flex;flex-direction:column;transition:border-color .2s,transform .2s;}
        .plan:hover{border-color:var(--border2);transform:translateY(-3px);}
        .plan.highlight{border-color:var(--amber);background:var(--surf);position:relative;overflow:hidden;}
        .plan.highlight::before{content:'Most Popular';position:absolute;top:16px;right:-28px;background:var(--amber);color:#000;font-size:9px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;padding:4px 40px;transform:rotate(45deg);transform-origin:center;}
        .plan-name{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--t2);margin-bottom:12px;}
        .plan-price{font-family:var(--fh);font-size:52px;line-height:1;margin-bottom:4px;letter-spacing:-.02em;}
        .plan-price sup{font-size:22px;vertical-align:top;margin-top:10px;margin-right:2px;font-family:var(--fm);font-weight:400;}
        .plan-period{font-size:11px;color:var(--t3);margin-bottom:14px;}
        .plan-desc{font-size:12px;color:var(--t2);margin-bottom:28px;line-height:1.6;min-height:36px;}
        .plan-divider{height:1px;background:var(--border);margin-bottom:24px;}
        .plan-features{list-style:none;flex:1;margin-bottom:32px;}
        .plan-features li{font-size:12px;color:var(--t2);padding:7px 0;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--border);}
        .plan-features li:last-child{border-bottom:none;}
        .plan-features li::before{content:'';width:5px;height:5px;border-radius:50%;background:var(--amber);flex-shrink:0;opacity:.7;}
        .plan-btn{display:block;text-align:center;padding:13px;border-radius:10px;font-family:var(--fm);font-size:13px;font-weight:500;text-decoration:none;transition:opacity .15s,background .15s;}
        .plan-btn.primary{background:var(--amber);color:#000;}
        .plan-btn.primary:hover{opacity:.88;}
        .plan-btn.secondary{background:transparent;border:1.5px solid var(--border2);color:var(--t2);}
        .plan-btn.secondary:hover{border-color:var(--t2);color:var(--text);}
        .features-section{max-width:1000px;margin:0 auto 100px;padding:0 24px;}
        .features-title{font-family:var(--fh);font-size:32px;text-align:center;margin-bottom:48px;letter-spacing:-.02em;}
        .features-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:24px;}
        .feature-card{background:var(--surf);border:1px solid var(--border);border-radius:12px;padding:24px;}
        .feature-icon{font-size:24px;margin-bottom:14px;}
        .feature-name{font-family:var(--fh);font-size:16px;margin-bottom:8px;}
        .feature-desc{font-size:12px;color:var(--t2);line-height:1.6;}
        .faq-section{max-width:680px;margin:0 auto 100px;padding:0 24px;}
        .faq-title{font-family:var(--fh);font-size:32px;text-align:center;margin-bottom:48px;}
        .faq-item{border-bottom:1px solid var(--border);padding:20px 0;}
        .faq-q{font-size:14px;color:var(--text);margin-bottom:10px;font-weight:500;}
        .faq-a{font-size:12px;color:var(--t2);line-height:1.7;}
        .cta-section{text-align:center;padding:80px 24px 120px;border-top:1px solid var(--border);}
        .cta-title{font-family:var(--fh);font-size:clamp(28px,4vw,48px);margin-bottom:16px;letter-spacing:-.02em;}
        .cta-title em{font-style:italic;color:var(--amber);}
        .cta-sub{font-size:13px;color:var(--t2);margin-bottom:32px;}
        .cta-btn{display:inline-block;padding:15px 36px;border-radius:10px;background:var(--amber);color:#000;font-family:var(--fm);font-size:14px;font-weight:500;text-decoration:none;transition:opacity .15s;}
        .cta-btn:hover{opacity:.88;}
        footer{border-top:1px solid var(--border);padding:32px 40px;display:flex;align-items:center;justify-content:space-between;}
        .footer-logo{font-family:var(--fh);font-size:16px;}
        .footer-logo em{color:var(--amber);font-style:normal;}
        .footer-copy{font-size:11px;color:var(--t3);}
        @media(max-width:600px){nav{padding:16px 20px;}.nav-links{gap:16px;}.hero{padding:60px 20px 50px;}.plans{grid-template-columns:1fr;}.plan.highlight::before{display:none;}footer{flex-direction:column;gap:12px;text-align:center;}}
      `}</style>

      <nav>
        <a href="/" className="nav-logo">maastr<em>.</em></a>
        <div className="nav-links">
          <a href="/pricing" className="nav-link" style={{ color:'var(--text)' }}>Pricing</a>
          <a href="/auth" className="nav-cta">Sign In</a>
        </div>
      </nav>

      <div className="hero">
        <div className="hero-tag">Pricing</div>
        <h1 className="hero-title">Simple pricing for<br /><em>serious music.</em></h1>
        <p className="hero-sub">Start free, upgrade when you need more. No hidden fees, no per-track charges, no surprises.</p>
      </div>

      <div className="plans">
        {plans.map(p => (
          <div key={p.name} className={`plan ${p.highlight ? 'highlight' : ''}`}>
            <div className="plan-name">{p.name}</div>
            <div className="plan-price">
              {p.price === '0' ? (
                <span style={{ fontFamily:'var(--fh)' }}>Free</span>
              ) : (
                <><sup>$</sup>{p.price}</>
              )}
            </div>
            <div className="plan-period">{p.period}</div>
            <div className="plan-desc">{p.desc}</div>
            <div className="plan-divider" />
            <ul className="plan-features">
              {p.features.map(f => <li key={f}>{f}</li>)}
            </ul>
            <a href={p.href} className={`plan-btn ${p.highlight ? 'primary' : 'secondary'}`}>
              {p.cta}
            </a>
          </div>
        ))}
      </div>

      <div className="features-section">
        <h2 className="features-title">Everything you need to master better</h2>
        <div className="features-grid">
          {[
            { icon:'🎚', name:'Real Waveform Playback', desc:'See your audio as you hear it. Peaks-based waveform rendering so every edit is visual.' },
            { icon:'🕐', name:'Timestamped Notes', desc:'Leave feedback at exact timestamps. Click any note to jump straight to that moment.' },
            { icon:'🔄', name:'Revision History', desc:'Compare v1 vs v2 vs final. Every revision is stored and switchable in one click.' },
            { icon:'👥', name:'Collaboration', desc:'Invite clients, engineers, or A&Rs. Everyone hears the same version at the same moment.' },
            { icon:'☁️', name:'R2 Cloud Storage', desc:'Files live on Cloudflare R2 — globally distributed, fast loading, no expiry.' },
            { icon:'📱', name:'Works Everywhere', desc:'Desktop, tablet, mobile. Share a link and anyone can listen and leave notes.' },
          ].map(f => (
            <div key={f.name} className="feature-card">
              <div className="feature-icon">{f.icon}</div>
              <div className="feature-name">{f.name}</div>
              <div className="feature-desc">{f.desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="faq-section">
        <h2 className="faq-title">Frequently asked</h2>
        {[
          { q:'Can I cancel anytime?', a:'Yes. No contracts, no lock-in. Cancel from your account settings and you keep access until the end of your billing period.' },
          { q:'What audio formats are supported?', a:'WAV, MP3, and AIFF. We store the original file and stream it directly from our CDN — no re-encoding, no quality loss.' },
          { q:'How does collaboration work?', a:'Invite anyone by email. They get a link to listen, leave timestamped notes, and see all revisions. You control who can add notes vs who can only listen.' },
          { q:'Is this different from maastr.io?', a:'This is the next generation of maastr. Same brand, rebuilt from scratch on a modern stack with better performance, mobile support, and a cleaner workflow.' },
          { q:'When will DawDreamer AI mastering be available?', a:'The AI mastering engine is in development. Pro and Studio subscribers will get early access when it launches.' },
        ].map(f => (
          <div key={f.q} className="faq-item">
            <div className="faq-q">{f.q}</div>
            <div className="faq-a">{f.a}</div>
          </div>
        ))}
      </div>

      <div className="cta-section">
        <h2 className="cta-title">Ready to <em>master better?</em></h2>
        <p className="cta-sub">Join musicians and studios already using maastr.</p>
        <a href="/auth" className="cta-btn">Get Started Free →</a>
      </div>

      <footer>
        <div className="footer-logo">maastr<em>.</em></div>
        <div className="footer-copy">© 2026 maastr. All rights reserved.</div>
      </footer>
    </>
  );
}
