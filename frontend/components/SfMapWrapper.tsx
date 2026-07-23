'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useState, useMemo, useEffect } from 'react'
import SearchBar from './SearchBar'
import CityToggle from './CityToggle'
import SfBuildingSidebar, { type SfMapBuilding } from './SfBuildingSidebar'
import type { SfLens } from './SfMap'
import type { SfBuildingSummary } from '@/lib/types'

const SfMap = dynamic(() => import('./SfMap'), { ssr: false })

type FlyTarget = { lng: number; lat: number; id: number }
type NhoodItem = { name: string }

const SF_SEARCH_URL = '/api/proxy/sf/building/search'

const LEGEND = [
  { tier: 'very-low',  color: '#A8CFAC', label: 'Very low'  },
  { tier: 'low',       color: '#688F72', label: 'Low'       },
  { tier: 'moderate',  color: '#C77F0A', label: 'Moderate'  },
  { tier: 'high',      color: '#BC4B33', label: 'High'      },
  { tier: 'very-high', color: '#7F1D1D', label: 'Very high' },
]
const ALL_TIERS = new Set(LEGEND.map(l => l.tier))
const ACCENT_COLOR = '#7F1D1D'

const LENS_CONFIG: Record<SfLens, { label: string; subtitle: string; explainer: string }> = {
  complaints: {
    label:    'Housing Complaints',
    subtitle: 'Coloring buildings by San Francisco 311 residential building complaint activity',
    explainer:
      'San Francisco residents can file 311 complaints about building conditions — heat, pests, mold, fire hazards, and more. ' +
      'The risk level for each parcel is based on the weighted complaint density relative to the building\'s estimated floor area, ' +
      'compared to other buildings in the same neighborhood.',
  },
  violations: {
    label:    'DBI Violations',
    subtitle: 'Coloring buildings by active Notices of Violation issued by SF\'s Department of Building Inspection (DBI)',
    explainer:
      'DBI Notices of Violation (NOVs) are issued when an inspector finds conditions that violate the SF Housing or Building Code. ' +
      'Open violations (status: active) indicate unresolved issues. The risk level is based on violation density relative to building size, ' +
      'weighted by severity category and recency.',
  },
}

export default function SfMapWrapper() {
  const [lens,             setLens]             = useState<SfLens>('complaints')
  const [selected,         setSelected]         = useState<SfMapBuilding | null>(null)
  const [flyTarget,        setFlyTarget]        = useState<FlyTarget | null>(null)
  const [visibleTiers,     setVisibleTiers]     = useState<Set<string>>(new Set(ALL_TIERS))
  const [mobileSheet,      setMobileSheet]      = useState<'legend' | 'dataset' | null>(null)
  const [isMobile,         setIsMobile]         = useState(false)
  const [explainerExpanded, setExplainerExpanded] = useState(false)
  const [navMenuOpen,       setNavMenuOpen]       = useState(false)
  const [showWelcome,       setShowWelcome]       = useState(false)
  const [showNeighborhoods,     setShowNeighborhoods]     = useState(false)
  const [selectedNeighborhoods, setSelectedNeighborhoods] = useState<Set<string>>(new Set())
  const [neighborhoodList,      setNeighborhoodList]      = useState<NhoodItem[]>([])
  const [neighborhoodSearch,    setNeighborhoodSearch]    = useState('')
  const [neighborhoodListExpanded, setNeighborhoodListExpanded] = useState(true)

  useEffect(() => {
    if (!localStorage.getItem('sf_welcome_dismissed')) setShowWelcome(true)
  }, [])

  useEffect(() => {
    if (!navMenuOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setNavMenuOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navMenuOpen])

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639.98px)')
    const update = () => setIsMobile(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (selected) setExplainerExpanded(false)
  }, [selected])

  // Reset the neighborhood filter whenever the borders are hidden
  useEffect(() => {
    if (!showNeighborhoods) { setSelectedNeighborhoods(new Set()); setNeighborhoodSearch(''); setNeighborhoodListExpanded(true) }
  }, [showNeighborhoods])

  function toggleNeighborhood(name: string) {
    setSelectedNeighborhoods(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name); else next.add(name)
      return next
    })
  }

  function switchLens(l: SfLens) {
    if (l === lens) return
    setLens(l)
    setVisibleTiers(new Set(ALL_TIERS))
    setExplainerExpanded(false)
  }

  function toggleTier(tier: string) {
    setVisibleTiers(prev => {
      const next = new Set(prev)
      if (next.has(tier)) next.delete(tier); else next.add(tier)
      return next
    })
  }

  function handleSearchSelect(b: SfBuildingSummary) {
    if (b.latitude != null && b.longitude != null) {
      setFlyTarget(prev => ({ lat: b.latitude!, lng: b.longitude!, id: (prev?.id ?? 0) + 1 }))
    }
    setSelected({
      mapblklot:             b.mapblklot,
      address:               b.address,
      neighborhood:          b.neighborhood,
      complaints_present:    b.total_complaints > 0 ? 1 : 0,
      complaints_risk_level: b.complaints_risk_level,
      total_complaints:      b.total_complaints,
      complaints_5yr:        b.recent_complaint_count + b.prior_complaint_count,
      severe_complaints_5yr: b.severe_complaints_5yr,
      violations_present:    b.total_violations > 0 ? 1 : 0,
      violations_risk_level: b.violations_risk_level,
      total_violations:      b.total_violations,
      open_violations:       b.open_violations,
    })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function handleMapSelect(raw: any) {
    if (!raw) { setSelected(null); return }
    setSelected({
      mapblklot:             raw.mapblklot,
      address:               raw.address ?? null,
      neighborhood:          raw.neighborhood ?? null,
      complaints_present:    raw.complaints_present ?? 0,
      complaints_risk_level: raw.complaints_risk_level ?? null,
      total_complaints:      raw.total_complaints ?? 0,
      complaints_5yr:        raw.complaints_5yr ?? 0,
      severe_complaints_5yr: raw.severe_complaints_5yr ?? 0,
      violations_present:    raw.violations_present ?? 0,
      violations_risk_level: raw.violations_risk_level ?? null,
      total_violations:      raw.total_violations ?? 0,
      open_violations:       raw.open_violations ?? 0,
    })
  }

  const config            = LENS_CONFIG[lens]
  const visibleTiersArray = useMemo(() => [...visibleTiers], [visibleTiers])
  const selectedNeighborhoodsArray = useMemo(() => [...selectedNeighborhoods], [selectedNeighborhoods])
  const selectedId        = selected?.mapblklot ?? null

  const filteredNeighborhoodList = useMemo(() => {
    const base = neighborhoodSearch
      ? neighborhoodList.filter(n => n.name.toLowerCase().includes(neighborhoodSearch.toLowerCase()))
      : neighborhoodList
    if (selectedNeighborhoods.size === 0) return base
    return [
      ...base.filter(n =>  selectedNeighborhoods.has(n.name)),
      ...base.filter(n => !selectedNeighborhoods.has(n.name)),
    ]
  }, [neighborhoodList, neighborhoodSearch, selectedNeighborhoods])

  const Checkbox = ({ active, color }: { active: boolean; color: string }) => (
    <div style={{
      width: 13, height: 13, borderRadius: 3, flexShrink: 0,
      background: active ? color : 'transparent',
      border: `1.5px solid ${active ? color : '#6B6B6B'}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'background 0.1s, border-color 0.1s',
    }}>
      {active && (
        <svg width="7" height="5" viewBox="0 0 7 5" fill="none">
          <path d="M1 2.5l1.8 1.8L6 1" stroke="#FFFFFF" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
    </div>
  )

  // ── Shared overlay content ────────────────────────────────────────────────────

  const datasetInner = (
    <>
      <div style={{ padding: '8px 12px 0' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#525252' }}>
          Color by
        </span>
      </div>
      <div style={{ padding: 4, display: 'flex', gap: 3 }}>
        {(['complaints', 'violations'] as SfLens[]).map(l => (
          <button
            key={l}
            onClick={() => switchLens(l)}
            style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
              padding: '4px 8px', borderRadius: 7, border: 'none', cursor: 'pointer',
              background: lens === l ? '#111111' : 'transparent',
              transition: 'background 0.15s', gap: 3,
            }}
          >
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em',
              textTransform: 'uppercase', fontWeight: 600,
              color: lens === l ? '#FFFFFF' : '#525252',
              transition: 'color 0.15s',
            }}>
              {LENS_CONFIG[l].label}
            </span>
          </button>
        ))}
      </div>

      <div style={{ borderTop: '0.5px solid #E5E5E5', padding: '7px 12px' }}>
        <p style={{ width: 0, minWidth: '100%', fontSize: 11, color: '#525252', lineHeight: 1.5, margin: 0, fontFamily: 'var(--font-sans)' }}>
          {config.subtitle}
        </p>
      </div>

      <div style={{ borderTop: '0.5px solid #E5E5E5', padding: '7px 12px' }}>
        <div
          onClick={() => setExplainerExpanded(v => !v)}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none' }}
        >
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#525252' }}>
            Learn more
          </span>
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" style={{ transform: explainerExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s', flexShrink: 0 }}>
            <path d="M2 4.5l4 4 4-4" stroke="#6B6B6B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        {explainerExpanded && (
          <p style={{ width: 0, minWidth: '100%', fontSize: 10, color: '#525252', lineHeight: 1.55, margin: '8px 0 0', fontFamily: 'var(--font-sans)' }}>
            {config.explainer}
          </p>
        )}
      </div>
    </>
  )

  const legendInner = (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#525252', margin: 0 }}>
            Risk level
          </p>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#111111', margin: '3px 0 0' }}>
            {lens === 'complaints' ? 'Housing complaints' : 'DBI violations'}
          </p>
        </div>
        {visibleTiers.size < LEGEND.length && (
          <button
            onClick={() => setVisibleTiers(new Set(ALL_TIERS))}
            style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: ACCENT_COLOR, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            Reset
          </button>
        )}
      </div>

      {LEGEND.map(({ tier, color, label }) => {
        const active = visibleTiers.has(tier)
        return (
          <div
            key={tier}
            onClick={() => toggleTier(tier)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7, cursor: 'pointer', userSelect: 'none' }}
          >
            <Checkbox active={active} color={color} />
            <span style={{ fontSize: 12, color: active ? '#111111' : '#6B6B6B', flex: 1, transition: 'color 0.1s' }}>
              {label}
            </span>
          </div>
        )
      })}

      <div style={{ height: '0.5px', background: '#E5E5E5', margin: '10px 0' }} />

      {/* Neighborhood border toggle */}
      <div
        onClick={() => setShowNeighborhoods(v => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}
      >
        <Checkbox active={showNeighborhoods} color="#525252" />
        <span style={{ fontSize: 12, color: showNeighborhoods ? '#111111' : '#525252', transition: 'color 0.1s' }}>
          Neighborhoods
        </span>
      </div>

      {/* Neighborhood filter list */}
      {showNeighborhoods && neighborhoodList.length > 0 && (
        <div style={{ marginTop: 10, borderTop: '0.5px solid #E5E5E5', paddingTop: 10 }}>
          <div
            onClick={() => setNeighborhoodListExpanded(v => !v)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: neighborhoodListExpanded ? 7 : 0, cursor: 'pointer', userSelect: 'none' }}
          >
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#525252', margin: 0 }}>
              Filter{selectedNeighborhoods.size > 0 ? ` (${selectedNeighborhoods.size})` : ''}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {selectedNeighborhoods.size > 0 && (
                <button
                  onClick={e => { e.stopPropagation(); setSelectedNeighborhoods(new Set()) }}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: ACCENT_COLOR, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                >
                  Clear
                </button>
              )}
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" style={{ transform: neighborhoodListExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s', flexShrink: 0 }}>
                <path d="M2 4.5l4 4 4-4" stroke="#6B6B6B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          </div>
          {neighborhoodListExpanded && (
            <>
              <div className="search-field" style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#FFFFFF', border: '0.5px solid #6B6B6B', borderRadius: 6, padding: '5px 8px', marginBottom: 6 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6B6B6B" strokeWidth="2">
                  <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
                </svg>
                <input
                  value={neighborhoodSearch}
                  onChange={e => setNeighborhoodSearch(e.target.value)}
                  placeholder="Search…"
                  style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: '#111111', fontSize: 11, fontFamily: 'var(--font-sans)' }}
                />
              </div>
              <div style={{ maxHeight: 180, overflowY: 'auto' }}>
                {filteredNeighborhoodList.map(nhood => {
                  const active = selectedNeighborhoods.has(nhood.name)
                  return (
                    <div
                      key={nhood.name}
                      onClick={() => toggleNeighborhood(nhood.name)}
                      style={{ display: 'flex', alignItems: 'flex-start', gap: 7, marginBottom: 5, cursor: 'pointer', userSelect: 'none' }}
                    >
                      <div style={{ marginTop: 1, flexShrink: 0 }}>
                        <Checkbox active={active} color="#525252" />
                      </div>
                      <span style={{ fontSize: 11, color: active ? '#111111' : '#525252', lineHeight: 1.3, transition: 'color 0.1s' }}>
                        {nhood.name}
                      </span>
                    </div>
                  )
                })}
                {filteredNeighborhoodList.length === 0 && (
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#6B6B6B', margin: 0 }}>No results</p>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </>
  )

  const sidebar = selected
    ? <SfBuildingSidebar building={selected} activeLens={lens} onClose={() => setSelected(null)} />
    : null

  const sheetChevron = (open: boolean) => (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s', flexShrink: 0 }}>
      <path d="M2 4.5l4 4 4-4" stroke="#737373" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )

  function dismissWelcome() {
    localStorage.setItem('sf_welcome_dismissed', '1')
    setShowWelcome(false)
  }

  return (
    <div className="relative w-full h-full">
      <SfMap
        onBuildingSelect={handleMapSelect}
        flyTarget={flyTarget}
        selectedId={selectedId}
        lens={lens}
        visibleTiers={visibleTiersArray}
        showNeighborhoods={showNeighborhoods}
        selectedNeighborhoods={selectedNeighborhoodsArray}
        onNeighborhoodSelect={nhood => nhood && toggleNeighborhood(nhood.name)}
        onNeighborhoodListLoad={setNeighborhoodList}
        isMobile={isMobile}
      />

      {/* Nav bar */}
      <div className="absolute top-0 left-0 right-0 z-20 pointer-events-none">
        <div
          style={{ background: '#111111', padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 14, position: 'relative' }}
          className="pointer-events-auto"
        >
          <Link href="/" style={{ fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 500, color: '#FFFFFF', letterSpacing: '-0.015em', flexShrink: 0, textDecoration: 'none' }}>
            stoop
          </Link>

          <div style={{ width: '0.5px', height: 16, background: '#333333', flexShrink: 0 }} />

          <CityToggle current="SF" variant="dark" nycHref="/" sfHref="/sf/map" />

          <span className="hidden md:inline" style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.06em', color: '#A3A3A3', whiteSpace: 'nowrap', flexShrink: 0 }}>
            Building and housing data for San Francisco renters
          </span>

          <div className="hidden sm:block" style={{ flex: 1 }} />

          <div className="flex-1 sm:flex-initial sm:basis-[420px]" style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <SearchBar
                onSelect={handleSearchSelect as never}
                searchUrl={SF_SEARCH_URL}
              />
            </div>
            <Link
              href="/sf/leaderboard"
              className="hidden sm:inline"
              style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#A3A3A3', textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              Leaderboard
            </Link>
            <Link
              href="/sf/methodology"
              className="hidden sm:inline"
              style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#A3A3A3', textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              About
            </Link>
          </div>

          <button
            type="button"
            onClick={() => setNavMenuOpen(v => !v)}
            aria-label={navMenuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={navMenuOpen}
            className="flex sm:hidden"
            style={{
              alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              width: 44, height: 44, marginTop: -10, marginBottom: -10, marginRight: -10,
              background: 'none', border: 'none', cursor: 'pointer', color: '#A3A3A3',
            }}
          >
            {navMenuOpen ? (
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M2 2l14 14M16 2L2 16" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M2 4.5h14M2 9h14M2 13.5h14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
              </svg>
            )}
          </button>

          {navMenuOpen && (
            <div
              className="sm:hidden"
              style={{
                position: 'absolute', top: '100%', left: 0, right: 0,
                background: '#111111', borderTop: '0.5px solid #333333',
                display: 'flex', flexDirection: 'column', padding: '4px 0',
              }}
            >
              <Link
                href="/sf/leaderboard"
                onClick={() => setNavMenuOpen(false)}
                style={{ display: 'flex', alignItems: 'center', minHeight: 44, padding: '0 20px', fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#A3A3A3', textDecoration: 'none' }}
              >
                Leaderboard
              </Link>
              <Link
                href="/sf/methodology"
                onClick={() => setNavMenuOpen(false)}
                style={{ display: 'flex', alignItems: 'center', minHeight: 44, padding: '0 20px', fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#A3A3A3', textDecoration: 'none' }}
              >
                About
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Desktop overlays */}
      {!isMobile && (
        <>
          <div
            className="absolute left-4 z-10"
            style={{ top: 74, width: 240, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 'calc(100vh - 82px)', overflowY: 'auto' }}
          >
            <div style={{ background: '#FFFFFF', borderRadius: 12, border: '0.5px solid #6B6B6B', display: 'flex', flexDirection: 'column', width: '100%' }}>
              {datasetInner}
            </div>
            {sidebar}
          </div>

          <div className="absolute right-4 z-10" style={{ top: 74, width: 210 }}>
            <div style={{ background: '#FFFFFF', borderRadius: 12, padding: '14px 16px', width: '100%', border: '0.5px solid #6B6B6B' }}>
              {legendInner}
            </div>
          </div>
        </>
      )}

      {/* Mobile bottom sheets */}
      {isMobile && (
        <div
          className="absolute left-0 right-0 bottom-0 z-10"
          style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, maxHeight: '78dvh', pointerEvents: 'none' }}
        >
          {selected ? (
            <div style={{ pointerEvents: 'auto', minHeight: 0, overflowY: 'auto' }}>
              {sidebar}
            </div>
          ) : (
            <div style={{ pointerEvents: 'auto', background: '#FFFFFF', borderRadius: 12, border: '0.5px solid #6B6B6B', overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <button
                type="button"
                onClick={() => setMobileSheet(s => s === 'legend' ? null : 'legend')}
                aria-expanded={mobileSheet === 'legend'}
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, padding: '0 16px', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, color: '#525252', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Legend</span>
                {sheetChevron(mobileSheet === 'legend')}
              </button>
              {mobileSheet === 'legend' && (
                <div style={{ padding: '0 16px 14px', overflowY: 'auto', minHeight: 0 }}>{legendInner}</div>
              )}
            </div>
          )}

          <div style={{ pointerEvents: 'auto', background: '#FFFFFF', borderRadius: 12, border: '0.5px solid #6B6B6B', overflow: 'hidden', flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => setMobileSheet(s => s === 'dataset' ? null : 'dataset')}
              aria-expanded={mobileSheet === 'dataset'}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, padding: '0 16px', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, color: '#111111', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                {lens === 'complaints' ? 'Housing Complaints' : 'DBI Violations'}
              </span>
              {sheetChevron(mobileSheet === 'dataset')}
            </button>
            {mobileSheet === 'dataset' && (
              <div style={{ borderTop: '0.5px solid #E5E5E5' }}>{datasetInner}</div>
            )}
          </div>
        </div>
      )}

      {/* Welcome modal */}
      {showWelcome && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.45)' }}
          onClick={dismissWelcome}
        >
          <div
            style={{ background: '#FFFFFF', borderRadius: 14, border: '0.5px solid #E5E5E5', padding: '28px 28px 24px', maxWidth: 420, width: 'calc(100vw - 3rem)', position: 'relative', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={dismissWelcome}
              style={{ position: 'absolute', top: 14, right: 14, background: 'none', border: 'none', cursor: 'pointer', padding: 4, lineHeight: 1, color: '#6B6B6B' }}
              aria-label="Close"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#525252', margin: '0 0 10px' }}>
              San Francisco
            </p>
            <p style={{ fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 500, color: '#111111', lineHeight: 1.4, letterSpacing: '-0.01em', margin: '0 0 14px' }}>
              SF building complaint and violation data for renters.
            </p>
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: '#525252', lineHeight: 1.6, margin: '0 0 22px' }}>
              Search any SF address to see 311 complaint history, DBI Notices of Violation, and how a building compares to others in its neighborhood.
            </p>
            <button
              onClick={dismissWelcome}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', background: '#111111', color: '#FFFFFF', border: 'none', borderRadius: 8, padding: '0 18px', minHeight: 44, cursor: 'pointer' }}
            >
              Explore SF
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
