'use client'

import Link from 'next/link'
import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import BuildingNavBar from '@/components/BuildingNavBar'
import { beacon } from '@/lib/beacon'

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter()
  const reported = useRef(false)

  useEffect(() => {
    if (reported.current) return
    reported.current = true
    beacon({ kind: 'error', digest: error.digest, route: window.location.pathname })
  }, [error])

  function handleRetry() {
    router.refresh()   // invalidate server component cache
    reset()            // re-render the error boundary
  }

  return (
    <div style={{ minHeight: '100vh', background: '#FAFAFA', display: 'flex', flexDirection: 'column' }}>
      <BuildingNavBar backHref="/" backLabel="Map" />

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', textAlign: 'center' }}>
        <p style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, color: '#525252',
          letterSpacing: '0.12em', textTransform: 'uppercase', margin: '0 0 16px',
        }}>
          500 · Server error
        </p>
        <h1 style={{
          fontFamily: 'var(--font-serif)', fontSize: 32, fontWeight: 500, color: '#111111',
          letterSpacing: '-0.02em', lineHeight: 1.15, margin: '0 0 12px',
        }}>
          Something went wrong
        </h1>
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: 14, color: '#525252', lineHeight: 1.6, margin: '0 0 32px', maxWidth: 400 }}>
          We ran into an unexpected problem. Please try again, or go back to the map.
        </p>
        {error.digest && (
          // The digest is the only handle tying this screen to a server log
          // line, so show it — a bug report that quotes it is diagnosable.
          <p style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, color: '#8A8A8A',
            letterSpacing: '0.06em', margin: '-20px 0 32px',
          }}>
            Reference: {error.digest}
          </p>
        )}
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={handleRetry}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500, letterSpacing: '0.08em',
              textTransform: 'uppercase', padding: '0 18px', minHeight: 44, cursor: 'pointer',
              background: '#111111', color: '#FFFFFF', border: 'none', borderRadius: 8,
            }}
          >
            Try again
          </button>
          <Link href="/" style={{
            fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500, letterSpacing: '0.08em',
            textTransform: 'uppercase', padding: '0 18px', minHeight: 44,
            display: 'inline-flex', alignItems: 'center',
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
