'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter()

  function handleRetry() {
    router.refresh()   // invalidate server component cache
    reset()            // re-render the error boundary
  }

  return (
    <div style={{ minHeight: '100vh', background: '#FAFAF7', display: 'flex', flexDirection: 'column' }}>
      <header style={{ background: '#0601B4', padding: '0 24px', height: 44, display: 'flex', alignItems: 'center' }}>
        <span style={{ fontSize: 14, fontWeight: 500, color: '#FFFFFF', letterSpacing: '-0.01em' }}>
          NYC Building Complaints
        </span>
      </header>

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', textAlign: 'center' }}>
        <p style={{ fontSize: 11, fontWeight: 500, color: '#6B6B65', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 16 }}>
          500 · Server error
        </p>
        <h1 style={{ fontSize: 32, fontWeight: 500, color: '#111111', letterSpacing: '-0.02em', margin: 0, marginBottom: 12 }}>
          Something went wrong
        </h1>
        <p style={{ fontSize: 14, color: '#6B6B65', marginBottom: 32, maxWidth: 400 }}>
          We ran into an unexpected problem. Please try again, or go back to the map.
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={handleRetry}
            style={{
              fontSize: 13, fontWeight: 500, padding: '10px 20px',
              background: '#0601B4', color: '#FFFFFF',
              border: 'none', borderRadius: 8, cursor: 'pointer',
            }}
          >
            Try again
          </button>
          <Link href="/" style={{
            fontSize: 13, fontWeight: 500, padding: '10px 20px',
            background: 'transparent', color: '#111111',
            border: '0.5px solid #111111', borderRadius: 8, textDecoration: 'none',
          }}>
            Back to map
          </Link>
        </div>
      </main>
    </div>
  )
}
