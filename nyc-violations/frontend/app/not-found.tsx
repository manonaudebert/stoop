import Link from 'next/link'

export default function NotFound() {
  return (
    <div style={{ minHeight: '100vh', background: '#FAFAF7', display: 'flex', flexDirection: 'column' }}>
      <header style={{ background: '#0601B4', padding: '0 24px', height: 44, display: 'flex', alignItems: 'center' }}>
        <span style={{ fontSize: 14, fontWeight: 500, color: '#FFFFFF', letterSpacing: '-0.01em' }}>
          NYC Building Complaints
        </span>
      </header>

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', textAlign: 'center' }}>
        <p style={{ fontSize: 11, fontWeight: 500, color: '#6B6B65', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 16 }}>
          404 · Not found
        </p>
        <h1 style={{ fontSize: 32, fontWeight: 500, color: '#111111', letterSpacing: '-0.02em', margin: 0, marginBottom: 12 }}>
          We couldn&apos;t find that page
        </h1>
        <p style={{ fontSize: 14, color: '#6B6B65', marginBottom: 32, maxWidth: 400 }}>
          The building or page you&apos;re looking for doesn&apos;t exist or may have been removed.
        </p>
        <Link href="/" style={{
          fontSize: 13, fontWeight: 500, padding: '10px 20px',
          background: '#0601B4', color: '#FFFFFF',
          borderRadius: 8, textDecoration: 'none',
        }}>
          Back to map
        </Link>
      </main>
    </div>
  )
}
