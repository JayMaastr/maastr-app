'use client';
import { useState } from 'react';

const POSTS = [
  {
    slug: 'what-is-mastering',
    title: 'What Is Mastering, and Why Does It Matter?',
    date: 'June 2025',
    readTime: '5 min read',
    tag: 'Fundamentals',
    excerpt: 'Mastering is the final step in music production — the bridge between a finished mix and a released record. Here is what actually happens in that process.',
    body: [
      { type: 'p', text: 'If you have ever sent a song to a streaming platform and noticed it sounds quieter or thinner than commercial releases, you have experienced the gap that mastering fills. Mastering is not magic, but it is specialized — and understanding what it does helps you communicate better with your engineer.' },
      { type: 'h2', text: 'What mastering actually does' },
      { type: 'p', text: 'A mastering engineer receives the final stereo mix and applies a controlled chain of processing: equalization to balance the tonal spectrum, compression and limiting to control dynamics and achieve loudness targets, stereo width adjustment, and sometimes harmonic enhancement. The goal is not to fix the mix — that ship has sailed — but to optimize it for playback on any speaker, at any volume, on any platform.' },
      { type: 'h2', text: 'Loudness targets and streaming' },
      { type: 'p', text: 'Every major streaming platform normalizes audio to a target loudness level (typically around -14 LUFS on Spotify, -16 LUFS on Apple Music). Pushing your master louder than the target does not make it sound louder on streaming — it just gets turned down. A good mastering engineer knows these targets and masters to them, so your track sounds as intended without being penalized.' },
      { type: 'h2', text: 'Why it helps to listen before approving' },
      { type: 'p', text: 'This is where maastr comes in. Traditionally, an engineer sends a file, the client downloads it, listens in whatever environment they have, and replies with feedback by email. That feedback is disconnected from the audio itself. With maastr, notes are pinned to exact timestamps, revisions are version-controlled, and the engineer sees exactly what the client heard and where they were when they had a thought.' },
    ],
  },
  {
    slug: 'how-to-give-feedback-on-a-master',
    title: 'How to Give Useful Feedback on a Master',
    date: 'June 2025',
    readTime: '4 min read',
    tag: 'Workflow',
    excerpt: 'Telling your engineer a song sounds "too dark" is a start, but it often leads to back-and-forth that wastes time. Here is how to give feedback that gets results faster.',
    body: [
      { type: 'p', text: 'The most common feedback an engineer receives is vague: "can we make it punchier," "it feels a bit flat," "the bass is off." These are feelings, not instructions. Translating feelings into actionable notes is a skill — and it makes the whole revision process faster for everyone.' },
      { type: 'h2', text: 'Use timestamps, not descriptions' },
      { type: 'p', text: 'Instead of "the chorus lacks energy," try noting the exact moment the chorus hits and writing "2:14 — chorus feels thin, would like more presence in the 3-5kHz range." Specificity gives the engineer something concrete to respond to. maastr makes this easy by letting you drop a note at any point in the waveform.' },
      { type: 'h2', text: 'Reference tracks are your friend' },
      { type: 'p', text: 'If you have a commercial track that captures the feeling you are going for, say so. A specific reference is far more actionable than a vague description. Reference tracks give the engineer a shared target to aim for.' },
      { type: 'h2', text: 'Separate mix notes from mastering notes' },
      { type: 'p', text: 'Mastering cannot fix a bad mix. If your vocal is buried, that is a mixing issue. If the master feels too compressed, that is a mastering note. Knowing the difference saves everyone time and prevents scope creep.' },
      { type: 'h2', text: 'When to approve' },
      { type: 'p', text: 'A master is ready when it translates well on multiple playback systems: earbuds, car speakers, a Bluetooth speaker, and headphones. The goal is not perfection on any single system — it is consistency across all of them.' },
    ],
  },
  {
    slug: 'tone-warm-neutral-bright',
    title: 'Warm, Neutral, Bright: Understanding Tone in Mastering',
    date: 'May 2025',
    readTime: '3 min read',
    tag: 'Sound',
    excerpt: 'The tonal character of a master shapes how a listener feels before they consciously process a single note. Here is how to think about it.',
    body: [
      { type: 'p', text: 'When engineers talk about a warm master, they mean one where the low-mids and bass frequencies are given weight — there is body, roundness, and a slightly rolled-off high end. When they say bright, they mean the opposite: more presence in the upper mids and highs, more air, more edge. Neutral sits in between, making no particular tonal statement.' },
      { type: 'h2', text: 'Which tone suits your genre?' },
      { type: 'p', text: 'There are no rules, but there are tendencies. Lo-fi hip hop and soul tend toward warmth. Electronic and pop tend toward brightness. Singer-songwriter and jazz often sit neutral. The genre is a starting point, not a destination — the right tone is the one that serves the song.' },
      { type: 'h2', text: 'How maastr handles tone' },
      { type: 'p', text: 'The maastr tone grid lets you set a target tone for each track using two axes: warmth (Warm / Neutral / Bright) and energy (Loud / Normal / Gentle). Selecting a cell tells your engineer what you are going for before they even press play. It reduces revision cycles and gets everyone aligned on intention from the start.' },
    ],
  },
];

export default function BlogPage() {
  const [activePost, setActivePost] = useState(null);
  const post = activePost ? POSTS.find(p => p.slug === activePost) : null;

  return (
    <>
      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        :root{--bg:#0a0a0b;--surf:#111113;--border:#24242c;--border2:#2e2e38;--amber:#e8a020;--text:#f0ede8;--t2:#8a8780;--t3:#4a4945;--fh:'DM Serif Display',Georgia,serif;--fm:'DM Mono','SF Mono','Menlo',monospace;}
        html,body{background:var(--bg);color:var(--text);font-family:var(--fm);min-height:100%;}
        .bw{max-width:720px;margin:0 auto;padding:0 24px 80px;}
        .bh{display:flex;align-items:center;justify-content:space-between;padding:20px 0 18px;border-bottom:1px solid var(--border);margin-bottom:48px;}
        .blogo{font-family:var(--fh);font-size:22px;cursor:pointer;color:var(--text);text-decoration:none;}
        .blogo em{color:var(--amber);font-style:normal;}
        .bhero{margin-bottom:48px;}
        .bhero h1{font-family:var(--fh);font-size:clamp(28px,5vw,42px);line-height:1.1;margin-bottom:10px;}
        .bhero p{font-size:13px;color:var(--t2);line-height:1.7;}
        .bcard{background:var(--surf);border:1px solid var(--border);border-radius:12px;padding:24px;margin-bottom:16px;cursor:pointer;transition:border-color .15s;}
        .bcard:hover{border-color:var(--amber);}
        .btag{display:inline-block;font-size:10px;color:var(--amber);background:rgba(232,160,32,0.1);border:1px solid rgba(232,160,32,0.2);border-radius:20px;padding:3px 10px;margin-bottom:12px;letter-spacing:.04em;}
        .bcard h2{font-family:var(--fh);font-size:20px;margin-bottom:8px;line-height:1.2;}
        .bcard p{font-size:12px;color:var(--t2);line-height:1.7;margin-bottom:12px;}
        .bmeta{font-size:11px;color:var(--t3);}
        .barticle-title{font-family:var(--fh);font-size:clamp(26px,5vw,38px);line-height:1.1;margin-bottom:16px;}
        .barticle-meta{font-size:11px;color:var(--t3);margin-bottom:32px;padding-bottom:24px;border-bottom:1px solid var(--border);}
        .barticle p{font-size:14px;color:var(--t2);line-height:1.9;margin-bottom:20px;}
        .barticle h2{font-family:var(--fh);font-size:22px;color:var(--text);margin:32px 0 12px;}
        .back-btn{font-size:12px;color:var(--t3);cursor:pointer;-webkit-tap-highlight-color:transparent;}
        .back-btn:hover{color:var(--t2);}
      `}</style>
      <div className="bw">
        <header className="bh">
          <a className="blogo" href="/">maastr<em>.</em></a>
          {post
            ? <span className="back-btn" onClick={()=>setActivePost(null)}>← All Posts</span>
            : <a href="/" className="back-btn" style={{textDecoration:'none'}}>← Dashboard</a>}
        </header>

        {!post && (<>
          <div className="bhero">
            <h1>Learning Center</h1>
            <p>Mastering, workflow, and sound — written for engineers and the artists they work with.</p>
          </div>
          {POSTS.map(p => (
            <div key={p.slug} className="bcard" onClick={()=>setActivePost(p.slug)}>
              <span className="btag">{p.tag}</span>
              <h2>{p.title}</h2>
              <p>{p.excerpt}</p>
              <div className="bmeta">{p.date} &middot; {p.readTime}</div>
            </div>
          ))}
        </>)}

        {post && (
          <article>
            <span className="btag">{post.tag}</span>
            <h1 className="barticle-title">{post.title}</h1>
            <div className="barticle-meta">{post.date} &middot; {post.readTime}</div>
            <div className="barticle">
              {post.body.map((block, i) =>
                block.type === 'h2'
                  ? <h2 key={i}>{block.text}</h2>
                  : <p key={i}>{block.text}</p>
              )}
            </div>
          </article>
        )}
      </div>
    </>
  );
}
