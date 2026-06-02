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
  const [query,    setQuery]    = useState('')
  const [results,  setResults]  = useState<AnyBuilding[]>([])
  const [open,     setOpen]     = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [searched, setSearched] = useState(false)   // a query has resolved for the current input
  const [active,   setActive]   = useState(-1)       // highlighted result index for keyboard nav
  const timer      = useRef<ReturnType<typeof setTimeout> | null>(null)
  const controller = useRef<AbortController | null>(null)
  const activeRef  = useRef<HTMLLIElement | null>(null)

  useEffect(() => {
    if (query.length < 3) {
      controller.current?.abort()
      if (timer.current) clearTimeout(timer.current)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset to reflect cleared input
      setResults([]); setOpen(false); setSearched(false); setActive(-1)
      return
    }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      controller.current?.abort()
      const ctrl = new AbortController()
      controller.current = ctrl
      setLoading(true)
      setOpen(true)
      try {
        let data: AnyBuilding[]
        if (searchUrl) {
          const res = await fetch(`${searchUrl}?q=${encodeURIComponent(query)}`, { signal: ctrl.signal })
          data = res.ok ? await res.json() : []
        } else {
          data = await searchBuildings(query, ctrl.signal)
        }
        setResults(data)
        setSearched(true)
        setActive(-1)
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return   // superseded by a newer query
        setResults([]); setSearched(true)
      } finally {
        if (controller.current === ctrl) setLoading(false)
      }
    }, 300)
  }, [query, searchUrl])

  // Keep the keyboard-highlighted row scrolled into view.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function select(b: BuildingSummary) {
    controller.current?.abort()
    setOpen(false)
    setQuery('')
    setResults([])
    setSearched(false)
    setActive(-1)
    onSelect(b)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') { setOpen(false); setActive(-1); return }
    if (!open) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive(i => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      if (active >= 0 && active < results.length) {
        e.preventDefault()
        select(results[active])
      }
    }
  }

  const showDropdown = open && query.length >= 3
  const showEmpty   = showDropdown && !loading && searched && results.length === 0
  const showLoading = showDropdown && loading && results.length === 0

  return (
    <div className="relative w-full">
      <div
        className="search-field flex items-center px-3"
        style={{ background: '#FFFFFF', borderRadius: 12, height: 36, border: '0.5px solid #6B6B6B' }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6B6B6B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginRight: 8 }}>
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
        </svg>
        <input
          className="flex-1 outline-none bg-transparent"
          style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: '#111111', letterSpacing: '-0.01em' }}
          placeholder="Search by address"
          value={query}
          role="combobox"
          aria-controls="search-results"
          aria-expanded={showDropdown}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `search-result-${active}` : undefined}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => (results.length > 0 || searched) && setOpen(true)}
        />
        {loading && (
          <svg className="spinner" width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ marginLeft: 8, flexShrink: 0 }}>
            <circle cx="6" cy="6" r="4.5" stroke="#D4D4D4" strokeWidth="1.5" />
            <path d="M6 1.5A4.5 4.5 0 0 1 10.5 6" stroke="#6B6B6B" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        )}
      </div>

      {showDropdown && (results.length > 0 || showEmpty || showLoading) && (
        <ul
          id="search-results"
          className="absolute z-50 w-full mt-1 max-h-80 overflow-y-auto"
          role="listbox"
          style={{ background: '#FFFFFF', border: '0.5px solid #6B6B6B', borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.08)' }}
        >
          {showLoading ? (
            <li style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div className="skeleton" style={{ height: 12, width: '70%' }} />
              <div className="skeleton" style={{ height: 9, width: '35%' }} />
            </li>
          ) : showEmpty ? (
            <li style={{ padding: '12px 14px', fontSize: 13, color: '#737373' }}>
              No buildings found for "{query}"
            </li>
          ) : (
            results.map((b, i) => {
              const tierLabel = b.risk_level ?? b.hpd_risk_tier ?? null
              const tier = RISK_TIER[tierLabel ?? '']
              const isActive = i === active
              return (
                <li
                  key={b.bin}
                  id={`search-result-${i}`}
                  ref={isActive ? activeRef : null}
                  role="option"
                  aria-selected={isActive}
                  className="flex items-center cursor-pointer"
                  style={{ padding: '10px 14px', borderBottom: '0.5px solid #E5E5E5', gap: 10, background: isActive ? '#FAFAFA' : '#FFFFFF' }}
                  onMouseEnter={() => setActive(i)}
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
                </li>
              )
            })
          )}
        </ul>
      )}
    </div>
  )
}
