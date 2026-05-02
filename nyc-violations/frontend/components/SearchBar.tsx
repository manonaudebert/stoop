'use client'

import { useState, useRef, useEffect } from 'react'
import { searchBuildings } from '@/lib/api'
import type { BuildingSummary } from '@/lib/types'

const RISK_BG: Record<string, string> = {
  'Very low':          '#D4F5CB',
  'Low':               '#A8E5A0',
  'Moderate':          '#FFD930',
  'High':              '#F5A047',
  'Very high':         '#EF4637',
  'Insufficient data': '#D4F5CB',
  'Not comparable':    '#D4D1C3',
}
const RISK_TEXT: Record<string, string> = {
  'Very high': '#FFFFFF',
}
function riskBg(level: string | null)   { return RISK_BG[level ?? '']   ?? '#F5F3EA' }
function riskText(level: string | null) { return RISK_TEXT[level ?? ''] ?? '#111111' }

type Props = {
  onSelect: (building: BuildingSummary) => void
}

export default function SearchBar({ onSelect }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<BuildingSummary[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (query.length < 3) { setResults([]); setOpen(false); return }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      setLoading(true)
      try {
        const data = await searchBuildings(query)
        setResults(data)
        setOpen(true)
      } catch { /* ignore */ }
      finally { setLoading(false) }
    }, 300)
  }, [query])

  function select(b: BuildingSummary) {
    setOpen(false)
    setQuery('')
    onSelect(b)
  }

  return (
    <div className="relative w-full">
      {/* Input — white on blue */}
      <div
        className="flex items-center px-4"
        style={{ background: '#FFFFFF', borderRadius: 8, height: 44 }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6B6B65" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginRight: 10 }}>
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
        </svg>
        <input
          className="flex-1 outline-none bg-transparent"
          style={{ fontSize: 14, color: '#111111', letterSpacing: '-0.01em' }}
          placeholder="Search by address or BIN…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
        />
        {loading && (
          <span style={{ fontSize: 11, color: '#6B6B65', marginLeft: 8, letterSpacing: '0.05em' }}>
            Searching…
          </span>
        )}
      </div>

      {/* Results dropdown */}
      {open && results.length > 0 && (
        <ul
          className="absolute z-50 w-full mt-1 max-h-80 overflow-y-auto"
          style={{ background: '#FFFFFF', border: '0.5px solid #E5E3DA', borderRadius: 8, boxShadow: '0 4px 24px rgba(6,1,180,0.10)' }}
        >
          {results.map(b => (
            <li
              key={b.bin}
              className="flex items-center cursor-pointer"
              style={{ padding: '10px 14px', borderBottom: '0.5px solid #E5E3DA', gap: 12 }}
              onMouseEnter={e => (e.currentTarget.style.background = '#FAFAF7')}
              onMouseLeave={e => (e.currentTarget.style.background = '#FFFFFF')}
              onClick={() => select(b)}
            >
              {/* Risk level pill */}
              {b.risk_level && (
                <span style={{
                  flexShrink: 0,
                  fontSize: 11, fontWeight: 500,
                  padding: '3px 8px', borderRadius: 4,
                  background: riskBg(b.risk_level),
                  color: riskText(b.risk_level),
                  whiteSpace: 'nowrap',
                }}>
                  {b.risk_level}
                </span>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 500, color: '#111111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {b.address}
                </p>
                <p style={{ fontSize: 11, color: '#6B6B65', marginTop: 2, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                  {b.borough} · {b.zip_code}
                </p>
              </div>
              <span style={{ fontSize: 11, color: '#6B6B65', flexShrink: 0 }}>
                {b.total_complaints.toLocaleString()} complaints
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
