'use client';

const SECTIONS = [
  {
    title: 'Getting Started',
    icon: '🎛',
    items: [
      { q: 'What is maastr?', a: 'maastr is a music mastering review platform. Engineers upload masters, clients listen and leave timestamped notes, and everyone stays in sync.' },
      { q: 'How do I create my first project?', a: 'From the dashboard, click "New Project". Give it a title and artist name, then drag and drop your WAV or MP3 files. Each file becomes a track in the project.' },
      { q: 'What audio formats are supported?', a: 'WAV, MP3, AIFF, FLAC, and M4A files are all supported. For best quality, upload WAV files at 24-bit / 44.1kHz or higher.' },
    ],
  },
  {
    title: 'Inviting Clients',
    icon: '🤝',
    items: [
      { q: 'How do I invite a client to review?', a: 'Open a project in the player, then click "Invite Client" in the top bar. Enter their email and an optional message. They will receive a branded email with a link directly to the project.' },
      { q: 'Does my client need an account?', a: 'Yes — a free maastr account is required to access projects. When a client clicks your invite link, they will be prompted to sign up for free before accepting the invite.' },
      { q: 'How long do invite links last?', a: 'Invite links expire after 7 days. If a link expires, simply send a new invite from the same project.' },
    ],
  },
  {
    title: 'Leaving Notes',
    icon: '📝',
    items: [
      { q: 'How do I leave a note at a specific moment?', a: 'While listening in the player, tap or click anywhere on the waveform to set the playhead, then click the note icon. A note is created at the exact timestamp.' },
      { q: 'Can the engineer resolve notes?', a: 'Yes. Engineers can mark individual notes as resolved by clicking the checkmark next to each note. Clients will see the resolved status.' },
      { q: 'How does "Ready for Review" work?', a: 'When a client has finished listening to a track, they can tap "Ready for Review" to send the engineer an email notification. This is a signal that feedback is complete and the track is approved.' },
    ],
  },
  {
    title: 'Revisions',
    icon: '🔄',
    items: [
      { q: 'How do I upload a new revision?', a: 'In the player, click "Upload Revisions" in the project header. Select your updated file. A new revision will be added, keeping all previous versions accessible.' },
      { q: 'Can clients see revision history?', a: 'Yes. The revision history panel in the player shows all versions of each track. Anyone with access to the project can switch between revisions.' },
      { q: 'Are notes tied to a specific revision?', a: 'Notes are attached to the revision they were created on. When you upload a new revision, existing notes remain on the old version for reference.' },
    ],
  },
  {
    title: 'Tone & Sound Settings',
    icon: '🎚',
    items: [
      { q: 'What is the tone grid?', a: 'The tone grid lets you dial in the character of a master using two axes: warmth (Warm / Neutral / Bright) and loudness (Loud / Normal / Gentle). Select a cell to set the target tone for any track.' },
      { q: 'Can I change the tone after mastering?', a: 'Yes. The tone setting is non-destructive metadata — you can update it at any time. If you change it, consider uploading a new revision to match.' },
    ],
  },
  {
    title: 'Downloads',
    icon: '⬇️',
    items: [
      { q: 'How do I enable downloads for a project?', a: 'In the player, the project owner can toggle "Downloads On" in the top bar. This enables collaborators to download the master files.' },
      { q: 'What download formats are available?', a: 'Depending on your subscription plan: Free WAV downloads (Industry Pro), Free MP3 downloads (Studio Expert and above), or paid WAV downloads (Home Studio Wiz).' },
    ],
  },
  {
    title: 'Account & Billing',
    icon: '💳',
    items: [
      { q: 'How do I upgrade my plan?', a: 'Click your avatar in the top-right corner of the dashboard or player, then select "Pricing & Plans". Choose a plan and complete checkout via Stripe.' },
      { q: 'Can I cancel my subscription?', a: 'Yes. You can cancel at any time from your account settings. Your plan remains active until the end of the billing period.' },
      { q: 'Is there a free plan?', a: 'maastr is free to use as a collaborator (client). Engineers need a paid plan to create projects and invite clients.' },
    ],
  },
];

export default function HelpPage() {
  return (
    <>
      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        :root{--bg:#0a0a0b;--surf:#111113;--surf2:#16161a;--border:#24242c;--border2:#2e2e38;--amber:#e8a020;--text:#f0ede8;--t2:#8a8780;--t3:#4a4945;--fh:'DM Serif Display',Georgia,serif;--fm:'DM Mono','SF Mono','Menlo',monospace;}
        html,body{background:var(--bg);color:var(--text);font-family:var(--fm);min-height:100%;}
        .hw{max-width:760px;margin:0 auto;padding:0 24px 80px;}
        .hh{display:flex;align-items:center;justify-content:space-between;padding:20px 0 18px;border-bottom:1px solid var(--border);margin-bottom:48px;}
        .hlogo{font-family:var(--fh);font-size:22px;cursor:pointer;color:var(--text);text-decoration:none;}
        .hlogo em{color:var(--amber);font-style:normal;}
        .hhero{text-align:center;margin-bottom:56px;}
        .hhero h1{font-family:var(--fh);font-size:clamp(32px,5vw,48px);line-height:1.05;letter-spacing:-.02em;margin-bottom:12px;}
        .hhero p{font-size:13px;color:var(--t2);line-height:1.7;}
        .hsec{margin-bottom:40px;}
        .hsec-title{display:flex;align-items:center;gap:10px;font-family:var(--fh);font-size:22px;margin-bottom:20px;padding-bottom:12px;border-bottom:1px solid var(--border);}
        .hitem{background:var(--surf);border:1px solid var(--border);border-radius:10px;margin-bottom:8px;overflow:hidden;}
        .hq{padding:16px 18px;font-size:13px;font-weight:500;color:var(--text);cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:12;user-select:none;-webkit-tap-highlight-color:transparent;}
        .hq:hover{color:var(--amber);}
        .ha{padding:0 18px 16px;font-size:12px;color:var(--t2);line-height:1.8;}
        .hcta{background:var(--surf);border:1px solid var(--border);border-radius:12px;padding:28px;text-align:center;margin-top:48px;}
        .hcta h3{font-family:var(--fh);font-size:20px;margin-bottom:8px;}
        .hcta p{font-size:12px;color:var(--t2);margin-bottom:20px;}
        .hcta-btn{display:inline-block;padding:10px 24px;border-radius:8px;border:1px solid var(--border2);background:transparent;color:var(--t2);font-family:var(--fm);font-size:12px;cursor:pointer;text-decoration:none;transition:all .15s;}
        .hcta-btn:hover{border-color:var(--amber);color:var(--amber);}
      `}</style>
      <div className="hw">
        <header className="hh">
          <a className="hlogo" href="/">maastr<em>.</em></a>
          <a href="/" style={{fontSize:12,color:'var(--t3)',textDecoration:'none',cursor:'pointer'}} onMouseOver={e=>e.target.style.color='var(--t2)'} onMouseOut={e=>e.target.style.color='var(--t3)'}>← Dashboard</a>
        </header>
        <div className="hhero">
          <h1>How can we help?</h1>
          <p>Everything you need to know about using maastr.</p>
        </div>
        {SECTIONS.map((sec, si) => (
          <div key={si} className="hsec">
            <div className="hsec-title"><span>{sec.icon}</span>{sec.title}</div>
            {sec.items.map((item, ii) => (
              <details key={ii} className="hitem">
                <summary className="hq">{item.q}<span style={{color:'var(--t3)',fontSize:10,flexShrink:0}}>▼</span></summary>
                <div className="ha">{item.a}</div>
              </details>
            ))}
          </div>
        ))}
        <div className="hcta">
          <h3>Still have questions?</h3>
          <p>Reach out and we will get back to you as soon as possible.</p>
          <a href="mailto:support@maastr.io" className="hcta-btn">Contact Support</a>
        </div>
      </div>
    </>
  );
}
