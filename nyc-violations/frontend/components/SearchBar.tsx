'use client'

import { useState, useRef, useEffect } from 'react'
import { searchBuildings } from '@/lib/api'
import type { BuildingSummary } from '@/lib/types'

const RISK_TIER: Record<string, { color: string }> = {
  'Very high':      { color: '#7F1D1D' },
  'High':           { color: '#7F1D1D' },
  'Emergency':      { color: '#7F1D1D' },
  'Hazardous':      { color: '#7F1D1D' },
  'Moderate':       { color: '#525252' },
  'Non-hazardous':  { color: '#525252' },
  'Low':            { color: '#525252' },
  'Very low':       { color: '#525252' },
  'Resolved':       { color: '#525252' },
  'Insufficient data': { color: '#737373' },
  'Not comparable':    { color: '#737373' },
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBuilding = any

type Props = {
  onSelect: (building: AnyBuilding) => void
  searchUrl?: string   // if omitted, uses the default DOB search endpoint
}

export default function SearchBar({ onSelect, searchUrl }: Props) {
  const [query,   setQuery]   = useState('')
  const [results, setResults] = useState<AnyBuilding[]>([])
  const [open,    setOpen]    = useState(false)
  const [loading, setLoading] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (query.length < 3) { setResults([]); setOpen(false); return }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      setLoading(true)
      try {
        let data: AnyBuilding[]
        if (searchUrl) {
          const res = await fetch(`${searchUrl}?q=${encodeURIComponent(query)}`)
          data = res.ok ? await res.json() : []
        } else {
          data = await searchBuildings(query)
        }
        setResults(data)
        setOpen(true)
      } catch { /* ignore */ }
      finally { setLoading(false) }
    }, 300)
  }, [query, searchUrl])

  function select(b: BuildingSummary) {
    setOpen(false)
    setQuery('')
    onSelect(b)
  }

  return (
    <div className="relative w-full">
      <div
        className="flex items-center px-3"
        style={{ background: '#FFFFFF', borderRadius: 8, height: 40 }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#A3A3A3" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginRight: 8 }}>
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
        </svg>
        <input
          className="flex-1 outline-none bg-transparent"
          style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: '#111111', letterSpacing: '-0.01em' }}
          placeholder="Search by address or BIN…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
        />
        {loading && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#A3A3A3', marginLeft: 8, letterSpacing: '0.05em' }}>
            …
          </span>
        )}
      </div>

      {open && results.length > 0 && (
        <ul
          className="absolute z-50 w-full mt-1 max-h-80 overflow-y-auto"
          style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.08)' }}
        >
          {results.map(b => {
            const tierLabel = b.risk_level ?? b.hpd_risk_tier ?? null
            const tier = RISK_TIER[tierLabel ?? '']
            const count = b.total_complaints ?? b.total_violations ?? 0
            return (
              <li
                key={b.bin}
                className="flex items-center cursor-pointer"
                style={{ padding: '10px 14px', borderBottom: '0.5px solid #E5E5E5', gap: 10 }}
                onMouseEnter={e => (e.currentTarget.style.background = '#FAFAFA')}
                onMouseLeave={e => (e.currentTarget.style.background = '#FFFFFF')}
                onClick={() => select(b)}
              >
                {tierLabel && (
                  <span style={{
                    fontFamily: 'var(--font-mono)', flexShrink: 0,
                    fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase',
                    color: tier?.color ?? '#737373',
                  }}>
                    {tierLabel}
                  </span>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 500, color: '#111111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', margin: 0 }}>
                    {b.address}
                  </p>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#737373', marginTop: 2, letterSpacing: '0.04em', textTransform: 'uppercase', margin: 0 }}>
                    {b.borough} · {b.zip_code}
                  </p>
                </div>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#737373', flexShrink: 0 }}>
                  {count.toLocaleString()}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
