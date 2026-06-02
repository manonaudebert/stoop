'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Map, ChevronLeft, Menu, X } from 'lucide-react'
import SearchBar from './SearchBar'
import type { BuildingSummary } from '@/lib/types'

type Props = { backHref: string; backLabel: string; searchUrl?: string; buildingBasePath?: string }

export default function BuildingNavBar({ backHref, backLabel, searchUrl, buildingBasePath = '/building' }: Props) {
  const router  = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)

  // Close the mobile menu on Escape
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

  // strip leading arrow/prefix so callers can still pass "← Map", "← Back to map", or "Map"
  const rawLabel = backLabel.replace(/^←\s*(Back to\s*)?/i, '')
  const isMap    = /^map$/i.test(rawLabel)
  const label    = isMap ? 'Map' : rawLabel

  function handleSelect(b: BuildingSummary) {
    router.push(`${buildingBasePath}/${b.bin}`)
  }

  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 10, background: '#111111',
      padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        {/* Logo */}
        <Link href="/" style={{
          fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 500,
          color: '#FFFFFF', letterSpacing: '-0.015em', textDecoration: 'none',
        }}>
          stoop
        </Link>

        {/* Divider */}
        <div style={{
          width: '0.5px', height: 16, background: '#333333',
          margin: '0 0 0 20px', flexShrink: 0,
        }} />

        {/* Back link */}
        <Link href={backHref} style={{
          display: 'flex', alignItems: 'center', gap: 5,
          fontSize: 13, fontWeight: 400, color: '#A3A3A3',
          textDecoration: 'none', paddingLeft: 20, whiteSpace: 'nowrap',
        }}>
          {isMap
            ? <Map size={13} strokeWidth={1.75} />
            : <ChevronLeft size={13} strokeWidth={1.75} />
          }
          {label}
        </Link>
      </div>

      <div style={{ flex: 1 }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: '0 1 460px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <SearchBar onSelect={handleSelect} searchUrl={searchUrl} />
        </div>
        <Link
          href="/dob/leaderboard"
          className="hidden sm:inline"
          style={{
            fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em',
            textTransform: 'uppercase', color: '#A3A3A3', textDecoration: 'none',
            whiteSpace: 'nowrap', flexShrink: 0,
          }}
        >
          Leaderboard
        </Link>
        <Link
          href="/methodology"
          className="hidden sm:inline"
          style={{
            fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em',
            textTransform: 'uppercase', color: '#A3A3A3', textDecoration: 'none',
            whiteSpace: 'nowrap', flexShrink: 0,
          }}
        >
          About
        </Link>

        {/* Hamburger — mobile only */}
        <button
          type="button"
          onClick={() => setMenuOpen(v => !v)}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          className="flex sm:hidden"
          style={{
            alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            width: 44, height: 44, margin: '-10px -10px -10px 0',
            background: 'none', border: 'none', cursor: 'pointer', color: '#A3A3A3',
          }}
        >
          {menuOpen ? <X size={20} strokeWidth={1.75} /> : <Menu size={20} strokeWidth={1.75} />}
        </button>
      </div>

      {/* Mobile dropdown menu */}
      {menuOpen && (
        <div
          className="sm:hidden"
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0,
            background: '#111111', borderTop: '0.5px solid #333333',
            display: 'flex', flexDirection: 'column', padding: '4px 0',
          }}
        >
          {[
            { href: '/dob/leaderboard', label: 'Leaderboard' },
            { href: '/methodology',     label: 'About' },
          ].map(item => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMenuOpen(false)}
              style={{
                display: 'flex', alignItems: 'center', minHeight: 44, padding: '0 20px',
                fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.08em',
                textTransform: 'uppercase', color: '#A3A3A3', textDecoration: 'none',
              }}
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </header>
  )
}
