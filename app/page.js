export default function Home() {
  return (
    <main style={{
      minHeight: '100vh',
      background: '#0a0a0b',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'DM Mono', monospace",
      color: '#f0ede8'
    }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{
          fontFamily: "'DM Serif Display', Georgia, serif",
          fontSize: '52px',
          letterSpacing: '-0.02em',
          marginBottom: '16px'
        }}>
          maastr<span style={{ color: '#e8a020' }}>.</span>
        </h1>
        <p style={{ color: '#8a8780', fontSize: '13px' }}>
          AI-powered music mastering — coming soon
        </p>
      </div>
    </main>
  );
}
