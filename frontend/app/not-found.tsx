import Link from 'next/link'
import BuildingNavBar from '@/components/BuildingNavBar'

export default function NotFound() {
  return (
    <div style={{ minHeight: '100vh', background: '#FAFAFA', display: 'flex', flexDirection: 'column' }}>
      <BuildingNavBar backHref="/" backLabel="Map" />

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', textAlign: 'center' }}>
        <p style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, color: '#525252',
          letterSpacing: '0.12em', textTransform: 'uppercase', margin: '0 0 16px',
        }}>
          404 · Not found
        </p>
        <h1 style={{
          fontFamily: 'var(--font-serif)', fontSize: 32, fontWeight: 500, color: '#111111',
          letterSpacing: '-0.02em', lineHeight: 1.15, margin: '0 0 12px',
        }}>
          We couldn&apos;t find that page
        </h1>
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: 14, color: '#525252', lineHeight: 1.6, margin: '0 0 32px', maxWidth: 400 }}>
          The building or page you&apos;re looking for doesn&apos;t exist or may have been removed.
        </p>
        <Link href="/" style={{
          fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500, letterSpacing: '0.08em',
          textTransform: 'uppercase', padding: '0 18px', minHeight: 44,
          display: 'inline-flex', alignItems: 'center',
          background: '#111111', color: '#FFFFFF', borderRadius: 8, textDecoration: 'none',
        }}>
          Back to map
        </Link>
      </main>
    </div>
  )
}
