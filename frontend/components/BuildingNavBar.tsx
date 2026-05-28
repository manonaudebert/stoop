'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Map, ChevronLeft } from 'lucide-react'
import SearchBar from './SearchBar'
import type { BuildingSummary } from '@/lib/types'

type Props = { backHref: string; backLabel: string }

export default function BuildingNavBar({ backHref, backLabel }: Props) {
  const router  = useRouter()

  // strip leading arrow/prefix so callers can still pass "← Map", "← Back to map", or "Map"
  const rawLabel = backLabel.replace(/^←\s*(Back to\s*)?/i, '')
  const isMap    = /^map$/i.test(rawLabel)
  const label    = isMap ? 'Map' : rawLabel

  function handleSelect(b: BuildingSummary) {
    router.push(`/building/${b.bin}`)
  }

  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 10, background: '#111111',
      padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        {/* Logo */}
        <div style={{
          fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 500,
          color: '#FFFFFF', letterSpacing: '-0.015em',
        }}>
          stoop
        </div>

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
          <SearchBar onSelect={handleSelect} />
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
          Methodology
        </Link>
      </div>
    </header>
  )
}
