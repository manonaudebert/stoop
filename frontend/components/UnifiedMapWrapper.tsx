'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import SearchBar from './SearchBar'
import BuildingSidebar, { type SelectedBuilding } from './BuildingSidebar'
import HpdBuildingSidebar, { type HpdSelectedBuilding } from './HpdBuildingSidebar'
import type { BuildingSummary, HpdComplaintBuildingSummary } from '@/lib/types'

const Map = dynamic(() => import('./Map'), { ssr: false })

type Dataset = 'HPD' | 'DOB'

type FlyTarget = { lng: number; lat: number; id: number }
type NtaItem   = { code: string; name: string }

type UnifiedSelected =
  | { dataset: 'DOB'; building: SelectedBuilding }
  | { dataset: 'HPD'; building: HpdSelectedBuilding }

const DOB_LEGEND = [
  { tier: 'very-low',  color: '#C5E0C8', label: 'Very low'  },
  { tier: 'low',       color: '#84A98C', label: 'Low'       },
  { tier: 'moderate',  color: '#E4A11B', label: 'Moderate'  },
  { tier: 'high',      color: '#BC4B33', label: 'High'      },
  { tier: 'very-high', color: '#7F1D1D', label: 'Very high' },
]

const HPD_LEGEND = [
  { tier: 'very-low',  color: '#C5E0C8', label: 'Very low'  },
  { tier: 'low',       color: '#84A98C', label: 'Low'       },
  { tier: 'moderate',  color: '#E4A11B', label: 'Moderate'  },
  { tier: 'high',      color: '#BC4B33', label: 'High'      },
  { tier: 'very-high', color: '#7F1D1D', label: 'Very high' },
]

const ALL_TIERS = new Set(['very-low', 'low', 'moderate', 'high', 'very-high'])

const DATASET_CONFIG = {
  DOB: {
    clustersUrl:  '/api/proxy/map/clusters',
    searchUrl:    '/api/proxy/building/search',
    subtitle:     'Construction activity, building safety, and code enforcement reported to the Department of Buildings (DOB)',
    legendLabel:  'Complaint level',
    legend:       DOB_LEGEND,
    accentColor:  '#7F1D1D',
    explainer:    'The DOB oversees construction, building safety, and code enforcement across NYC. Complaints may relate to unsafe construction, structural concerns, illegal work, or building code violations reported by residents, inspectors, or 311.',
  },
  HPD: {
    clustersUrl:  '/api/proxy/hpd-complaints/map/clusters',
    searchUrl:    '/api/proxy/hpd-complaints/building/search',
    subtitle:     'Housing conditions, tenant complaints, and maintenance violations reported to NYC Housing Preservation & Development (HPD)',
    legendLabel:  'Complaint level',
    legend:       HPD_LEGEND,
    accentColor:  '#7F1D1D',
    explainer:    'HPD tracks housing conditions that impact tenant safety and quality of life. Complaints are reports submitted by tenants, residents, or 311, while violations are issued after HPD inspectors verify that a building condition violates NYC housing law.',
  },
}

export default function UnifiedMapWrapper({ initialMode = 'HPD' }: { initialMode?: Dataset }) {
  const router = useRouter()
  const [dataset,         setDataset]         = useState<Dataset>(initialMode)
  const [selected,        setSelected]        = useState<UnifiedSelected | null>(null)
  const [flyTarget,       setFlyTarget]       = useState<FlyTarget | null>(null)
  const [visibleTiers,    setVisibleTiers]    = useState<Set<string>>(new Set(ALL_TIERS))
  const [showNtaBorders,   setShowNtaBorders]   = useState(false)
  const [legendCollapsed,  setLegendCollapsed]  = useState(false)
  const [selectedNtas,     setSelectedNtas]     = useState<Set<string>>(new Set())
  const [ntaList,          setNtaList]          = useState<NtaItem[]>([])
  const [ntaSearch,        setNtaSearch]        = useState('')
  const [ntaListExpanded,  setNtaListExpanded]  = useState(true)
  const [explainerExpanded, setExplainerExpanded] = useState(false)
  const [showWelcome,       setShowWelcome]       = useState(false)

  useEffect(() => {
    if (!localStorage.getItem('stoop_welcome_dismissed')) setShowWelcome(true)
  }, [])

  function dismissWelcome() {
    localStorage.setItem('stoop_welcome_dismissed', '1')
    setShowWelcome(false)
  }

  const config            = DATASET_CONFIG[dataset]
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

  function switchDataset(d: Dataset) {
    if (d === dataset) return
    setDataset(d)
    setSelected(null)
    setVisibleTiers(new Set(ALL_TIERS))
    setExplainerExpanded(false)
    router.replace(d === 'DOB' ? '/?mode=dob' : '/', { scroll: false })
  }

  function handleDobSearchSelect(b: BuildingSummary) {
    setSelected({
      dataset: 'DOB',
      building: {
        bin: b.bin,
        address: b.address,
        borough: b.borough,
        zip_code: b.zip_code,
        total_complaints: b.total_complaints,
        open_complaints: b.open_complaints,
        priority_a_complaints: b.priority_a_complaints,
        risk_level: b.risk_level ?? null,
      },
    })
    if (b.latitude != null && b.longitude != null) {
      setFlyTarget(prev => ({ lat: b.latitude!, lng: b.longitude!, id: (prev?.id ?? 0) + 1 }))
    }
  }

  function handleHpdSearchSelect(b: HpdComplaintBuildingSummary) {
    setSelected({
      dataset: 'HPD',
      building: {
        bin: b.bin,
        address: b.address,
        borough: b.borough,
        zip_code: b.zip_code,
        risk_level: b.risk_level ?? null,
        total_complaints: b.total_complaints,
        open_complaints: b.open_complaints,
        open_emergency_complaints: b.open_emergency_complaints,
      },
    })
    if (b.latitude != null && b.longitude != null) {
      setFlyTarget(prev => ({ lat: b.latitude!, lng: b.longitude!, id: (prev?.id ?? 0) + 1 }))
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function handleMapSelect(raw: any) {
    if (!raw) { setSelected(null); return }
    if (dataset === 'DOB') {
      setSelected({
        dataset: 'DOB',
        building: {
          bin:                    raw.bin,
          address:                raw.address ?? null,
          borough:                raw.borough ?? null,
          zip_code:               raw.zip_code ?? null,
          total_complaints:       raw.total_complaints ?? 0,
          open_complaints:        raw.open_complaints ?? 0,
          priority_a_complaints:  raw.priority_a_complaints ?? 0,
          risk_level:             raw.risk_level ?? null,
        },
      })
    } else {
      setSelected({
        dataset: 'HPD',
        building: {
          bin:                        raw.bin,
          address:                    raw.address ?? null,
          borough:                    raw.borough ?? null,
          zip_code:                   raw.zip_code ?? null,
          risk_level:                 raw.risk_level ?? null,
          total_complaints:           raw.total_complaints ?? 0,
          open_complaints:            raw.open_complaints ?? 0,
          open_emergency_complaints:  raw.open_emergency_complaints ?? 0,
        },
      })
    }
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

  const selectedBin = selected?.building.bin ?? null

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
        clustersUrl={config.clustersUrl}
      />

      {/* Nav bar */}
      <div className="absolute top-0 left-0 right-0 z-20 pointer-events-none">
        <div
          style={{ background: '#111111', padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 14 }}
          className="pointer-events-auto"
        >
          <Link href="/" style={{ fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 500, color: '#FFFFFF', letterSpacing: '-0.015em', flexShrink: 0, textDecoration: 'none' }}>
            stoop
          </Link>

          <div style={{ width: '0.5px', height: 16, background: '#333333', flexShrink: 0 }} />

          <span className="hidden sm:inline" style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.06em', color: '#737373', whiteSpace: 'nowrap', flexShrink: 0 }}>
            Building and housing data for NYC tenants
          </span>

          <div style={{ flex: 1 }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0, flex: '0 1 420px' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {dataset === 'DOB' ? (
                <SearchBar
                  onSelect={handleDobSearchSelect}
                  searchUrl={config.searchUrl}
                />
              ) : (
                <SearchBar
                  onSelect={handleHpdSearchSelect as Parameters<typeof SearchBar>[0]['onSelect']}
                  searchUrl={config.searchUrl}
                />
              )}
            </div>
            <Link
              href={dataset === 'HPD' ? '/hpd/leaderboard' : '/dob/leaderboard'}
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
        </div>
      </div>

      {/* Floating dataset toggle */}
      <div
        className="absolute right-4 z-10"
        style={{ top: 74, maxWidth: 'min(260px, calc(100vw - 2rem))' }}
      >
        <div style={{
          background: '#FFFFFF', borderRadius: 12, border: '0.5px solid #6B6B6B',
          display: 'flex', flexDirection: 'column', width: '100%',
        }}>
          {/* Toggle row */}
          <div style={{ padding: 4, display: 'flex', gap: 3 }}>
            {(['HPD', 'DOB'] as Dataset[]).map(d => (
              <button
                key={d}
                onClick={() => switchDataset(d)}
                style={{
                  flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                  padding: '5px 10px', borderRadius: 9, border: 'none', cursor: 'pointer',
                  background: dataset === d ? '#111111' : 'transparent',
                  transition: 'background 0.15s',
                  gap: 3,
                }}
              >
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.08em',
                  textTransform: 'uppercase', fontWeight: 600,
                  color: dataset === d ? '#FFFFFF' : '#525252',
                  transition: 'color 0.15s',
                }}>
                  {d === 'HPD' ? 'Housing Conditions' : 'Building Safety'}
                </span>
              </button>
            ))}
          </div>

          {/* One-liner description — always visible */}
          <div style={{ borderTop: '0.5px solid #E5E5E5', padding: '7px 12px' }}>
            <p style={{ width: 0, minWidth: '100%', fontSize: 10, color: '#737373', lineHeight: 1.5, margin: 0, fontFamily: 'var(--font-sans)' }}>
              {config.subtitle}
            </p>
          </div>

          {/* Learn more accordion */}
          <div style={{ borderTop: '0.5px solid #E5E5E5', padding: '7px 12px' }}>
            <div
              onClick={() => setExplainerExpanded(v => !v)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none' }}
            >
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#525252' }}>
                Learn more
              </span>
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" style={{ transform: explainerExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s', flexShrink: 0 }}>
                <path d="M2 4.5l4 4 4-4" stroke="#6B6B6B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            {explainerExpanded && (
              <p style={{ width: 0, minWidth: '100%', fontSize: 10, color: '#737373', lineHeight: 1.55, margin: '8px 0 0 0', fontFamily: 'var(--font-sans)' }}>
                {config.explainer}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Left panel — legend + sidebar */}
      <div
        className="absolute left-4 z-10"
        style={{ top: 74, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 'calc(100vh - 82px)', overflowY: 'auto' }}
      >
        {/* Legend card */}
        <div style={{ background: '#FFFFFF', borderRadius: 12, padding: '14px 16px', width: 210, border: '0.5px solid #6B6B6B' }}>

          {/* Mobile collapse toggle */}
          <div
            className="flex sm:hidden"
            onClick={() => setLegendCollapsed(v => !v)}
            style={{ alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none', marginBottom: legendCollapsed ? 0 : 10 }}
          >
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, color: '#525252', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              Legend
            </span>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: legendCollapsed ? 'rotate(0deg)' : 'rotate(180deg)', transition: 'transform 0.2s' }}>
              <path d="M2 4.5l4 4 4-4" stroke="#737373" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>

          <div className={legendCollapsed ? 'hidden sm:block' : ''}>

            {/* Risk level */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#525252', margin: 0 }}>
                {config.legendLabel}
              </p>
              {visibleTiers.size < config.legend.length && (
                <button
                  onClick={() => setVisibleTiers(new Set(ALL_TIERS))}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: config.accentColor, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                >
                  Reset
                </button>
              )}
            </div>

            {config.legend.map(({ tier, color, label }) => {
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
              <span style={{ fontSize: 12, color: showNtaBorders ? '#111111' : '#737373', transition: 'color 0.1s' }}>
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
                        style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: config.accentColor, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
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
                            <span style={{ fontSize: 11, color: active ? '#111111' : '#737373', lineHeight: 1.3, transition: 'color 0.1s' }}>
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


          </div>
        </div>

        {/* Building sidebar */}
        {selected?.dataset === 'DOB' && (
          <BuildingSidebar building={selected.building} onClose={() => setSelected(null)} />
        )}
        {selected?.dataset === 'HPD' && (
          <HpdBuildingSidebar building={selected.building} onClose={() => setSelected(null)} />
        )}
      </div>

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

            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#737373', margin: '0 0 10px' }}>
              About
            </p>
            <p style={{ fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 500, color: '#111111', lineHeight: 1.4, letterSpacing: '-0.01em', margin: '0 0 14px' }}>
              Stoop surfaces the complaint and violation history of NYC residential buildings, sourced from public city records and ranked against buildings in the same neighborhood.
            </p>
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: '#525252', lineHeight: 1.6, margin: '0 0 22px' }}>
              Search an address to see open violations, complaint trends, and how a building compares before you sign a lease.
            </p>
            <button
              onClick={dismissWelcome}
              style={{
                fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em',
                textTransform: 'uppercase', background: '#111111', color: '#FFFFFF',
                border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer',
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
