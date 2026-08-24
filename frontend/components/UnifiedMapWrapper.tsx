'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useIsMobile, useEscapeKey, useWelcomeBanner } from '@/lib/mapChrome'
import { reportDegraded } from '@/lib/api'
import { useRouter } from 'next/navigation'
import SearchBar from './SearchBar'
import CityToggle from './CityToggle'
import CombinedBuildingSidebar, { type UnifiedBuilding } from './CombinedBuildingSidebar'
import type { Lens } from './Map'
import type { BuildingSummary, HpdComplaintBuildingSummary } from '@/lib/types'

const Map = dynamic(() => import('./Map'), { ssr: false })

type FlyTarget = { lng: number; lat: number; id: number }
type NtaItem   = { code: string; name: string }

// One endpoint, one search index — the map shows every building from both
// datasets and the lens only changes which risk drives the colors.
const CLUSTERS_URL = '/api/proxy/map/unified/clusters'
const SEARCH_URL   = '/api/proxy/building/search'

const LEGEND = [
  { tier: 'very-low',  color: '#A8CFAC', label: 'Very low'  },
  { tier: 'low',       color: '#688F72', label: 'Low'       },
  { tier: 'moderate',  color: '#C77F0A', label: 'Moderate'  },
  { tier: 'high',      color: '#BC4B33', label: 'High'      },
  { tier: 'very-high', color: '#7F1D1D', label: 'Very high' },
]

const ALL_TIERS = new Set(['very-low', 'low', 'moderate', 'high', 'very-high'])

// The lens never changes which points show — only the color dimension and the
// surrounding explainer copy.
const LENS_CONFIG: Record<Lens, { subtitle: string; explainer: string }> = {
  DOB: {
    subtitle:  'Coloring buildings by construction, building safety, and code enforcement reported to the Department of Buildings (DOB)',
    explainer: 'The DOB oversees construction, building safety, and code enforcement across NYC. Complaints may relate to unsafe construction, structural concerns, illegal work, or building code violations reported by residents, inspectors, or 311.',
  },
  HPD: {
    subtitle:  'Coloring buildings by housing conditions, tenant complaints, and maintenance violations reported to NYC Housing Preservation & Development (HPD)',
    explainer: 'HPD tracks housing conditions that impact tenant safety and quality of life. Complaints are reports submitted by tenants, residents, or 311, while violations are issued after HPD inspectors verify that a building condition violates NYC housing law.',
  },
}

const ACCENT_COLOR = '#7F1D1D'

export default function UnifiedMapWrapper({ initialMode = 'HPD' }: { initialMode?: Lens }) {
  const router = useRouter()
  const [lens,            setLens]            = useState<Lens>(initialMode)
  const [selected,        setSelected]        = useState<UnifiedBuilding | null>(null)
  const [flyTarget,       setFlyTarget]       = useState<FlyTarget | null>(null)
  const [visibleTiers,    setVisibleTiers]    = useState<Set<string>>(new Set(ALL_TIERS))
  const [showNtaBorders,   setShowNtaBorders]   = useState(false)
  const [mobileSheet,      setMobileSheet]      = useState<'legend' | 'dataset' | null>(null)
  const [selectedNtas,     setSelectedNtas]     = useState<Set<string>>(new Set())
  const [ntaList,          setNtaList]          = useState<NtaItem[]>([])
  const [ntaSearch,        setNtaSearch]        = useState('')
  const [ntaListExpanded,  setNtaListExpanded]  = useState(true)
  const [explainerExpanded, setExplainerExpanded] = useState(false)
  const [navMenuOpen,       setNavMenuOpen]       = useState(false)
  const closeNavMenu = useCallback(() => setNavMenuOpen(false), [])

  const isMobile = useIsMobile()
  const { showWelcome, dismissWelcome } = useWelcomeBanner('stoop_welcome_dismissed')
  useEscapeKey(navMenuOpen, closeNavMenu)

  const config            = LENS_CONFIG[lens]
  const visibleTiersArray = useMemo(() => [...visibleTiers], [visibleTiers])
  const selectedNtasArray = useMemo(() => [...selectedNtas], [selectedNtas])

  const filteredNtaList = useMemo(() => {
    const base = ntaSearch
      ? ntaList.filter(n => n.name.toLowerCase().includes(ntaSearch.toLowerCase()))
      : ntaList
    if (selectedNtas.size === 0) return base
    return [
      ...base.filter(n =>  selectedNtas.has(n.code)),
      ...base.filter(n => !selectedNtas.has(n.code)),
    ]
  }, [ntaList, ntaSearch, selectedNtas])

  useEffect(() => {
    if (!showNtaBorders) { setSelectedNtas(new Set()); setNtaSearch(''); setNtaListExpanded(true) }
  }, [showNtaBorders])

  useEffect(() => {
    if (selected) setExplainerExpanded(false)
  }, [selected])

  function switchLens(d: Lens) {
    if (d === lens) return
    setLens(d)
    // The selection stays — the combined sidebar shows both datasets regardless
    // of the active color lens.
    setVisibleTiers(new Set(ALL_TIERS))
    setExplainerExpanded(false)
    router.replace(d === 'DOB' ? '/?mode=dob' : '/', { scroll: false })
  }

  // Search hits the DOB building index (broad residential coverage) for the
  // DOB half, then fetches the HPD complaint summary so the combined sidebar
  // can render both halves. Either half may legitimately have no record.
  async function handleSearchSelect(b: BuildingSummary) {
    if (b.latitude != null && b.longitude != null) {
      setFlyTarget(prev => ({ lat: b.latitude!, lng: b.longitude!, id: (prev?.id ?? 0) + 1 }))
    }
    const base: UnifiedBuilding = {
      bin:            b.bin,
      address:        b.address,
      borough:        b.borough,
      zip_code:       b.zip_code,
      dob_risk_level: b.risk_level ?? null,
      dob_total:      b.total_complaints,
      dob_open:       b.open_complaints,
      dob_priority_a: b.priority_a_complaints,
    }
    setSelected(base)
    try {
      const res = await fetch(`/api/proxy/hpd-complaints/building/search?q=${encodeURIComponent(b.bin)}`)
      if (!res.ok) throw new Error(`hpd-complaints search ${res.status}`)
      const results: HpdComplaintBuildingSummary[] = await res.json()
      const h = results.find(r => r.bin === b.bin)
      setSelected(prev => prev && prev.bin === b.bin ? {
        ...prev,
        hpd_risk_level:     h?.risk_level ?? null,
        hpd_total:          h?.total_complaints ?? null,
        hpd_open:           h?.open_complaints ?? null,
        hpd_open_emergency: h?.open_emergency_complaints ?? null,
      } : prev)
    } catch (err) {
      // Leaves the HPD half unresolved, which the sidebar renders as its own
      // failure state rather than as "No HPD records".
      reportDegraded('map sidebar hpd complaints', err)
    }
  }

  // Map clicks carry the full union feature: both datasets in one object.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function handleMapSelect(raw: any) {
    if (!raw) { setSelected(null); return }
    setSelected({
      bin:                raw.bin,
      address:            raw.address ?? null,
      borough:            raw.borough ?? null,
      zip_code:           raw.zip_code ?? null,
      dob_risk_level:     raw.dob_risk_level ?? null,
      dob_total:          raw.dob_total ?? null,
      dob_open:           raw.dob_open ?? null,
      dob_priority_a:     raw.dob_priority_a ?? null,
      hpd_risk_level:     raw.hpd_risk_level ?? null,
      hpd_total:          raw.hpd_total ?? null,
      hpd_open:           raw.hpd_open ?? null,
      hpd_open_emergency: raw.hpd_open_emergency ?? null,
    })
  }

  function toggleTier(tier: string) {
    setVisibleTiers(prev => {
      const next = new Set(prev)
      if (next.has(tier)) next.delete(tier); else next.add(tier)
      return next
    })
  }

  function toggleNta(code: string) {
    setSelectedNtas(prev => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code); else next.add(code)
      return next
    })
  }

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

  const selectedBin = selected?.bin ?? null

  // ── Shared overlay content (rendered in floating cards on desktop, bottom sheets on mobile) ──

  const datasetInner = (
    <>
      {/* Color-by label */}
      <div style={{ padding: '8px 12px 0' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#525252' }}>
          Color by
        </span>
      </div>
      {/* Toggle row */}
      <div style={{ padding: 4, display: 'flex', gap: 3 }}>
        {(['HPD', 'DOB'] as Lens[]).map(d => (
          <button
            key={d}
            onClick={() => switchLens(d)}
            style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
              padding: '4px 8px', borderRadius: 7, border: 'none', cursor: 'pointer',
              background: lens === d ? '#111111' : 'transparent',
              transition: 'background 0.15s',
              gap: 3,
            }}
          >
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em',
              textTransform: 'uppercase', fontWeight: 600,
              color: lens === d ? '#FFFFFF' : '#525252',
              transition: 'color 0.15s',
            }}>
              {d === 'HPD' ? 'Housing Conditions' : 'Building Safety'}
            </span>
          </button>
        ))}
      </div>

      {/* One-liner description — always visible */}
      <div style={{ borderTop: '0.5px solid #E5E5E5', padding: '7px 12px' }}>
        <p style={{ width: 0, minWidth: '100%', fontSize: 11, color: '#525252', lineHeight: 1.5, margin: 0, fontFamily: 'var(--font-sans)' }}>
          {config.subtitle}
        </p>
      </div>

      {/* Learn more accordion */}
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
          <p style={{ width: 0, minWidth: '100%', fontSize: 10, color: '#525252', lineHeight: 1.55, margin: '8px 0 0 0', fontFamily: 'var(--font-sans)' }}>
            {config.explainer}
          </p>
        )}
      </div>
    </>
  )

  const legendInner = (
    <>
      {/* Risk level */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#525252', margin: 0 }}>
            Risk level
          </p>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#111111', margin: '3px 0 0' }}>
            {lens === 'HPD' ? 'Housing conditions' : 'Building safety'}
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

      {/* NTA toggle */}
      <div
        onClick={() => setShowNtaBorders(v => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}
      >
        <Checkbox active={showNtaBorders} color="#525252" />
        <span style={{ fontSize: 12, color: showNtaBorders ? '#111111' : '#525252', transition: 'color 0.1s' }}>
          Neighborhoods
        </span>
      </div>

      {/* NTA filter list */}
      {showNtaBorders && ntaList.length > 0 && (
        <div style={{ marginTop: 10, borderTop: '0.5px solid #E5E5E5', paddingTop: 10 }}>
          <div
            onClick={() => setNtaListExpanded(v => !v)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: ntaListExpanded ? 7 : 0, cursor: 'pointer', userSelect: 'none' }}
          >
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#525252', margin: 0 }}>
              Filter by NTA{selectedNtas.size > 0 ? ` (${selectedNtas.size})` : ''}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {selectedNtas.size > 0 && (
                <button
                  onClick={e => { e.stopPropagation(); setSelectedNtas(new Set()) }}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: ACCENT_COLOR, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                >
                  Clear
                </button>
              )}
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" style={{ transform: ntaListExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s', flexShrink: 0 }}>
                <path d="M2 4.5l4 4 4-4" stroke="#6B6B6B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          </div>
          {ntaListExpanded && (
            <>
              <div className="search-field" style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#FFFFFF', border: '0.5px solid #6B6B6B', borderRadius: 6, padding: '5px 8px', marginBottom: 6 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6B6B6B" strokeWidth="2">
                  <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
                </svg>
                <input
                  value={ntaSearch}
                  onChange={e => setNtaSearch(e.target.value)}
                  placeholder="Search…"
                  style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: '#111111', fontSize: 11, fontFamily: 'var(--font-sans)' }}
                />
              </div>
              <div style={{ maxHeight: 180, overflowY: 'auto' }}>
                {filteredNtaList.map(nta => {
                  const active = selectedNtas.has(nta.code)
                  return (
                    <div
                      key={nta.code}
                      onClick={() => toggleNta(nta.code)}
                      style={{ display: 'flex', alignItems: 'flex-start', gap: 7, marginBottom: 5, cursor: 'pointer', userSelect: 'none' }}
                    >
                      <div style={{ marginTop: 1, flexShrink: 0 }}>
                        <Checkbox active={active} color="#525252" />
                      </div>
                      <span style={{ fontSize: 11, color: active ? '#111111' : '#525252', lineHeight: 1.3, transition: 'color 0.1s' }}>
                        {nta.name}
                      </span>
                    </div>
                  )
                })}
                {filteredNtaList.length === 0 && (
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
    ? <CombinedBuildingSidebar building={selected} onClose={() => setSelected(null)} activeLens={lens} />
    : null

  const sheetChevron = (open: boolean) => (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s', flexShrink: 0 }}>
      <path d="M2 4.5l4 4 4-4" stroke="#737373" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )

  return (
    <div className="relative w-full h-full">
      <Map
        onBuildingSelect={handleMapSelect as any}
        flyTarget={flyTarget}
        selectedBin={selectedBin}
        visibleTiers={visibleTiersArray}
        showNtaBorders={showNtaBorders}
        selectedNtas={selectedNtasArray}
        onNtaSelect={nta => nta && toggleNta(nta.code)}
        onNtaListLoad={setNtaList}
        clustersUrl={CLUSTERS_URL}
        lens={lens}
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

          <CityToggle current="NYC" variant="dark" nycHref="/" sfHref="/sf/map" />

          <span className="hidden md:inline" style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.06em', color: '#A3A3A3', whiteSpace: 'nowrap', flexShrink: 0 }}>
            Building and housing data for NYC tenants
          </span>

          {/* Desktop spacer — pushes search to the right on desktop; collapses on mobile so search fills the row */}
          <div className="hidden sm:block" style={{ flex: 1 }} />

          {/* Search + desktop links — fills the row between logo and hamburger on mobile */}
          <div className="flex-1 sm:flex-initial sm:basis-[420px]" style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <SearchBar
                onSelect={handleSearchSelect}
                searchUrl={SEARCH_URL}
              />
            </div>
            <Link
              href={lens === 'HPD' ? '/hpd/leaderboard' : '/dob/leaderboard'}
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
          </div>

          {/* Hamburger — mobile only, sits at the far right of the row */}
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

          {/* Mobile dropdown menu */}
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
                href={lens === 'HPD' ? '/hpd/leaderboard' : '/dob/leaderboard'}
                onClick={() => setNavMenuOpen(false)}
                style={{
                  display: 'flex', alignItems: 'center', minHeight: 44, padding: '0 20px',
                  fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.08em',
                  textTransform: 'uppercase', color: '#A3A3A3', textDecoration: 'none',
                }}
              >
                Leaderboard
              </Link>
              <Link
                href="/methodology"
                onClick={() => setNavMenuOpen(false)}
                style={{
                  display: 'flex', alignItems: 'center', minHeight: 44, padding: '0 20px',
                  fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.08em',
                  textTransform: 'uppercase', color: '#A3A3A3', textDecoration: 'none',
                }}
              >
                About
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* ───────── Desktop: color-by + sidebar on the left, legend on the right ───────── */}
      {!isMobile && (
        <>
          <div
            className="absolute left-4 z-10"
            style={{ top: 74, width: 240, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 'calc(100vh - 82px)', overflowY: 'auto' }}
          >
            {/* Color-by toggle sits beside the building sidebar it describes. */}
            <div style={{
              background: '#FFFFFF', borderRadius: 12, border: '0.5px solid #6B6B6B',
              display: 'flex', flexDirection: 'column', width: '100%',
            }}>
              {datasetInner}
            </div>
            {sidebar}
          </div>

          {/* Risk-level legend, top-right */}
          <div
            className="absolute right-4 z-10"
            style={{ top: 74, width: 210 }}
          >
            <div style={{ background: '#FFFFFF', borderRadius: 12, padding: '14px 16px', width: '100%', border: '0.5px solid #6B6B6B' }}>
              {legendInner}
            </div>
          </div>
        </>
      )}

      {/* ───────── Mobile: bottom sheets ───────── */}
      {isMobile && (
        <div
          className="absolute left-0 right-0 bottom-0 z-10"
          style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, maxHeight: '78dvh', pointerEvents: 'none' }}
        >
          {/* A selected building takes over the legend slot (one sheet at a time) */}
          {selected ? (
            <div style={{ pointerEvents: 'auto', minHeight: 0, overflowY: 'auto' }}>
              {sidebar}
            </div>
          ) : (
            <div style={{ pointerEvents: 'auto', background: '#FFFFFF', borderRadius: 12, border: '0.5px solid #6B6B6B', overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <button
                type="button"
                onClick={() => setMobileSheet(s => (s === 'legend' ? null : 'legend'))}
                aria-expanded={mobileSheet === 'legend'}
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, padding: '0 16px', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, color: '#525252', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                  Legend
                </span>
                {sheetChevron(mobileSheet === 'legend')}
              </button>
              {mobileSheet === 'legend' && (
                <div style={{ padding: '0 16px 14px', overflowY: 'auto', minHeight: 0 }}>
                  {legendInner}
                </div>
              )}
            </div>
          )}

          {/* Dataset toggle sheet */}
          <div style={{ pointerEvents: 'auto', background: '#FFFFFF', borderRadius: 12, border: '0.5px solid #6B6B6B', overflow: 'hidden', flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => setMobileSheet(s => (s === 'dataset' ? null : 'dataset'))}
              aria-expanded={mobileSheet === 'dataset'}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, padding: '0 16px', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, color: '#111111', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                {lens === 'HPD' ? 'Housing Conditions' : 'Building Safety'}
              </span>
              {sheetChevron(mobileSheet === 'dataset')}
            </button>
            {mobileSheet === 'dataset' && (
              <div style={{ borderTop: '0.5px solid #E5E5E5' }}>
                {datasetInner}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Welcome popup */}
      {showWelcome && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.45)' }}
          onClick={dismissWelcome}
        >
          <div
            style={{
              background: '#FFFFFF',
              borderRadius: 14,
              border: '0.5px solid #E5E5E5',
              padding: '28px 28px 24px',
              maxWidth: 420,
              width: 'calc(100vw - 3rem)',
              position: 'relative',
              boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={dismissWelcome}
              style={{
                position: 'absolute', top: 14, right: 14,
                background: 'none', border: 'none', cursor: 'pointer',
                padding: 4, lineHeight: 1, color: '#6B6B6B',
              }}
              aria-label="Close"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>

            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#525252', margin: '0 0 10px' }}>
              About
            </p>
            <p style={{ fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 500, color: '#111111', lineHeight: 1.4, letterSpacing: '-0.01em', margin: '0 0 14px' }}>
              The city collects complaint and violation data on residential buildings in NYC. Stoop makes it actually useful. 
            </p>
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: '#525252', lineHeight: 1.6, margin: '0 0 22px' }}>
              Before you sign a lease, search any address to see open violations, complaint trends, and how a building stacks up in its neighborhood.
            </p>
            <button
              onClick={dismissWelcome}
              style={{
                fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em',
                textTransform: 'uppercase', background: '#111111', color: '#FFFFFF',
                border: 'none', borderRadius: 8, padding: '0 18px', minHeight: 44, cursor: 'pointer',
              }}
            >
              Get started
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
