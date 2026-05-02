'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import SearchBar from './SearchBar'
import type { BuildingSummary } from '@/lib/types'

type Props = { backHref: string; backLabel: string }

export default function BuildingNavBar({ backHref, backLabel }: Props) {
  const router = useRouter()

  function handleSelect(b: BuildingSummary) {
    router.push(`/building/${b.bin}`)
  }

  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 10, background: '#0601B4',
      padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 16,
    }}>
      <Link href="/" style={{
        fontSize: 14, fontWeight: 500, color: '#FFFFFF', textDecoration: 'none',
        letterSpacing: '-0.01em', whiteSpace: 'nowrap', flexShrink: 0,
      }}>
        NYC Building Complaints
      </Link>
      <div style={{ flex: 1, maxWidth: 560 }}>
        <SearchBar onSelect={handleSelect} />
      </div>
      <Link href={backHref} style={{
        fontSize: 13, fontWeight: 500, color: '#0601B4', textDecoration: 'none',
        background: '#FFFFFF', borderRadius: 6, padding: '6px 12px',
        whiteSpace: 'nowrap', flexShrink: 0,
      }}>
        {backLabel}
      </Link>
      <Link href="/leaderboard" style={{
        fontSize: 13, fontWeight: 500, color: '#B5B3F5', textDecoration: 'none',
        whiteSpace: 'nowrap', flexShrink: 0,
      }}>
        Leaderboard
      </Link>
    </header>
  )
}
