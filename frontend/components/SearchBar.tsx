'use client'

import { useState, useRef, useEffect } from 'react'
import { ApiError, reportDegraded, searchBuildings } from '@/lib/api'
import type { BuildingSummary } from '@/lib/types'

const RISK_TIER: Record<string, { color: string }> = {
  'Emergency':         { color: '#7F1D1D' },
  'Very high':         { color: '#7F1D1D' },
  'Hazardous':         { color: '#BC4B33' },
  'High':              { color: '#BC4B33' },
  'Moderate':          { color: '#C77F0A' },
  'Non-hazardous':     { color: '#688F72' },
  'Low':               { color: '#688F72' },
  'Very low':          { color: '#A8CFAC' },
  'Resolved':          { color: '#A8CFAC' },
  'Insufficient data': { color: '#A8CFAC' },
  'Not comparable':    { color: '#A8CFAC' },
}

const RISK_RANK: Record<string, number> = {
  'Emergency': 9, 'Very high': 8, 'Hazardous': 7, 'High': 6, 'Moderate': 5,
  'Non-hazardous': 4, 'Low': 3, 'Very low': 2, 'Resolved': 1,
  'Insufficient data': 0, 'Not comparable': 0,
}

const mostSevere = (...levels: (string | null | undefined)[]): string | null =>
  levels.filter(Boolean).sort((a, b) => (RISK_RANK[b as string] ?? -1) - (RISK_RANK[a as string] ?? -1))[0] ?? null

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
  const [failed,   setFailed]   = useState(false)   // the lookup itself broke
  const [active,   setActive]   = useState(-1)       // highlighted result index for keyboard nav
  const timer      = useRef<ReturnType<typeof setTimeout> | null>(null)
  const controller = useRef<AbortController | null>(null)
  const activeRef  = useRef<HTMLLIElement | null>(null)

  useEffect(() => {
    if (query.length < 3) {
      controller.current?.abort()
      if (timer.current) clearTimeout(timer.current)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset to reflect cleared input
      setResults([]); setOpen(false); setSearched(false); setFailed(false); setActive(-1)
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
          if (!res.ok) throw new ApiError(res.status, searchUrl, res.headers.get('x-request-id') ?? undefined)
          data = await res.json()
        } else {
          data = await searchBuildings(query, ctrl.signal)
        }
        setResults(data)
        setSearched(true)
        setFailed(false)
        setActive(-1)
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return   // superseded by a newer query
        reportDegraded('search', err)
        setResults([]); setSearched(true); setFailed(true)
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
    setSearched(false); setFailed(false)
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
  const showFailed  = showDropdown && !loading && failed
  const showEmpty   = showDropdown && !loading && searched && !failed && results.length === 0
  const showLoading = showDropdown && loading && results.length === 0

  return (
    <div className="relative w-full">
      <div
        className="search-field flex items-center px-3"
        style={{ background: '#FFFFFF', borderRadius: 12, height: 36, border: '0.5px solid #6B6B6B', overflow: 'hidden' }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6B6B6B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginRight: 8 }}>
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
        </svg>
        <input
          className="flex-1 outline-none bg-transparent"
          style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: '#111111', letterSpacing: '-0.01em', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
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

      {showDropdown && (results.length > 0 || showEmpty || showFailed || showLoading) && (
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
          ) : showFailed ? (
            <li style={{ padding: '12px 14px', fontSize: 13, color: '#92400E' }}>
              Search is unavailable right now.
            </li>
          ) : showEmpty ? (
            <li style={{ padding: '12px 14px', fontSize: 13, color: '#525252' }}>
              No buildings found for "{query}"
            </li>
          ) : (
            results.map((b, i) => {
              const locationText = [b.borough, b.zip_code].filter(Boolean).join(' · ') || b.neighborhood || ''
              const tierLabel =
                (b.dob_risk_level != null || b.hpd_risk_level != null)
                  ? mostSevere(b.dob_risk_level, b.hpd_risk_level)
                : (b.complaints_risk_level != null || b.violations_risk_level != null)
                  ? mostSevere(b.complaints_risk_level, b.violations_risk_level)
                  : (b.risk_level ?? b.hpd_risk_tier ?? null)
              const tier = RISK_TIER[tierLabel ?? '']
              const isSf     = b.mapblklot != null
              const noRecords = isSf && !tierLabel && (b.total_complaints ?? 0) === 0 && (b.total_violations ?? 0) === 0
              const pillLabel = tierLabel ?? (noRecords ? 'No records' : null)
              const pillColor = tierLabel ? (tier?.color ?? '#737373') : '#6B6B6B'
              const isActive = i === active
              return (
                <li
                  key={b.bin ?? b.mapblklot ?? b.address}
                  id={`search-result-${i}`}
                  ref={isActive ? activeRef : null}
                  role="option"
                  aria-selected={isActive}
                  className="flex items-center cursor-pointer"
                  style={{ padding: '10px 14px', borderBottom: '0.5px solid #E5E5E5', gap: 10, background: isActive ? '#FAFAFA' : '#FFFFFF' }}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => select(b)}
                >
                  {pillLabel && (
                    <span className="hidden sm:inline-block" style={{
                      fontFamily: 'var(--font-mono)', flexShrink: 0,
                      fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase',
                      color: pillColor,
                    }}>
                      {pillLabel}
                    </span>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 500, color: '#111111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', margin: 0 }}>
                      {b.address}
                    </p>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#525252', marginTop: 2, letterSpacing: '0.04em', textTransform: 'uppercase', margin: 0 }}>
                      {locationText}
                    </p>
                  </div>
                  {pillLabel && (
                    <span
                      className="sm:hidden"
                      style={{ flexShrink: 0, width: 7, height: 7, borderRadius: '50%', background: pillColor }}
                    />
                  )}
                </li>
              )
            })
          )}
        </ul>
      )}
    </div>
  )
}
