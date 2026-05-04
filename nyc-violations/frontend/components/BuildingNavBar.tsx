'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'
import SearchBar from './SearchBar'
import type { BuildingSummary } from '@/lib/types'

type Props = { backHref: string; backLabel: string }

export default function BuildingNavBar({ backHref, backLabel }: Props) {
  const router  = useRouter()
  const { data: session } = useSession()

  function handleSelect(b: BuildingSummary) {
    router.push(`/building/${b.bin}`)
  }

  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 10, background: '#0601B4',
      padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <Link href={backHref} style={{
        fontSize: 13, fontWeight: 500, color: '#0601B4', textDecoration: 'none',
        background: '#FFFFFF', borderRadius: 6, padding: '6px 12px',
        whiteSpace: 'nowrap', flexShrink: 0,
      }}>
        {backLabel}
      </Link>
      <div style={{ flex: 1 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: '0 1 460px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <SearchBar onSelect={handleSelect} />
        </div>
        <Link
          href="/leaderboard"
          className="hidden sm:inline"
          style={{ fontSize: 13, fontWeight: 500, color: '#B5B3F5', textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          Leaderboard
        </Link>
        {session && (
          <button
            onClick={() => signOut({ callbackUrl: '/' })}
            className="hidden sm:inline"
            style={{ fontSize: 13, fontWeight: 500, color: '#B5B3F5', background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, padding: 0 }}
          >
            Sign out
          </button>
        )}
      </div>
    </header>
  )
}
