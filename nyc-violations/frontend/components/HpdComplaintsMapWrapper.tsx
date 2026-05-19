'use client'

import dynamic from 'next/dynamic'
import { useState, useMemo, useEffect } from 'react'
import Link from 'next/link'
import SearchBar from './SearchBar'
import HpdComplaintsSidebar, { type HpdComplaintSelectedBuilding } from './HpdComplaintsSidebar'
import type { HpdComplaintBuildingSummary } from '@/lib/types'

const Map = dynamic(() => import('./Map'), { ssr: false })

const HPD_COMPLAINTS_CLUSTERS_URL = '/api/proxy/hpd-complaints/map/clusters'

const LEGEND = [
  { tier: 'very-high', color: '#EF4637', label: 'Emergency'  },
  { tier: 'moderate',  color: '#F5A047', label: 'Active'     },
  { tier: 'low',       color: '#A8E5A0', label: 'Resolved'   },
]

type FlyTarget = { lng: number; lat: number; id: number }
type NtaItem   = { code: string; name: string }

export default function HpdComplaintsMapWrapper() {
  const [selected,        setSelected]        = useState<HpdComplaintSelectedBuilding | null>(null)
  const [flyTarget,       setFlyTarget]       = useState<FlyTarget | null>(null)
  const [visibleTiers,    setVisibleTiers]    = useState<Set<string>>(() => new Set(LEGEND.map(l => l.tier)))
  const [showNtaBorders,  setShowNtaBorders]  = useState(false)
  const [legendCollapsed, setLegendCollapsed] = useState(false)
  const [selectedNtas,    setSelectedNtas]    = useState<Set<string>>(new Set())
  const [ntaList,         setNtaList]         = useState<NtaItem[]>([])
  const [ntaSearch,       setNtaSearch]       = useState('')

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
    if (!showNtaBorders) { setSelectedNtas(new Set()); setNtaSearch('') }
  }, [showNtaBorders])

  function handleSearchSelect(b: HpdComplaintBuildingSummary) {
    setSelected({
      bin: b.bin,
      address: b.address,
      borough: b.borough,
      zip_code: b.zip_code,
      complaint_risk_tier: b.complaint_risk_tier ?? null,
      total_complaints: b.total_complaints,
      open_complaints: b.open_complaints,
      open_emergency_complaints: b.open_emergency_complaints,
    })
    if (b.latitude != null && b.longitude != null) {
      setFlyTarget(prev => ({ lat: b.latitude!, lng: b.longitude!, id: (prev?.id ?? 0) + 1 }))
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function handleMapSelect(raw: any) {
    if (!raw) { setSelected(null); return }
    setSelected({
      bin: raw.bin,
      address: raw.address ?? null,
      borough: raw.borough ?? null,
      zip_code: raw.zip_code ?? null,
      complaint_risk_tier: raw.complaint_risk_tier ?? null,
      total_complaints: raw.total_complaints ?? 0,
      open_complaints: raw.open_complaints ?? 0,
      open_emergency_complaints: raw.open_emergency_complaints ?? 0,
    })
  }

  function toggleTier(tier: string) {
    setVisibleTiers(prev => {
      const next = new Set(prev)
      if (next.has(tier)) next.delete(tier)
      else next.add(tier)
      return next
    })
  }

  function toggleNta(code: string) {
    setSelectedNtas(prev => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  const Checkbox = ({ active, color }: { active: boolean; color: string }) => (
    <div style={{
      width: 13, height: 13, borderRadius: 3, flexShrink: 0,
      background: active ? color : 'transparent',
      border: `1.5px solid ${active ? color : '#A3A3A3'}`,
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

  return (
    <div className="relative w-full h-full">
      <Map
        onBuildingSelect={handleMapSelect as Parameters<typeof Map>[0]['onBuildingSelect']}
        flyTarget={flyTarget}
        selectedBin={selected?.bin ?? null}
        visibleTiers={visibleTiersArray}
        showNtaBorders={showNtaBorders}
        selectedNtas={selectedNtasArray}
        onNtaSelect={nta => nta && toggleNta(nta.code)}
        onNtaListLoad={setNtaList}
        clustersUrl={HPD_COMPLAINTS_CLUSTERS_URL}
      />

      {/* Nav bar */}
      <div className="absolute top-0 left-0 right-0 z-10 pointer-events-none">
        <div
          style={{ background: '#111111', padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 14 }}
          className="pointer-events-auto"
        >
          <span style={{ fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 500, color: '#FFFFFF', letterSpacing: '-0.015em', flexShrink: 0 }}>
            stoop
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#737373', flexShrink: 0 }}>
            HPD complaints
          </span>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0, flex: '0 1 460px' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <SearchBar
                onSelect={handleSearchSelect as Parameters<typeof SearchBar>[0]['onSelect']}
                searchUrl="/api/proxy/hpd-complaints/building/search"
              />
            </div>
            <Link
              href="/hpd"
              className="hidden sm:inline"
              style={{
                fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em',
                textTransform: 'uppercase', color: '#A3A3A3', textDecoration: 'none',
                whiteSpace: 'nowrap', flexShrink: 0,
              }}
            >
              HPD violations
            </Link>
            <Link
              href="/"
              className="hidden sm:inline"
              style={{
                fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em',
                textTransform: 'uppercase', color: '#A3A3A3', textDecoration: 'none',
                whiteSpace: 'nowrap', flexShrink: 0,
              }}
            >
              DOB complaints
            </Link>
          </div>
        </div>
      </div>

      {/* Left column — legend + building card */}
      <div
        className="absolute left-4 z-10"
        style={{ top: 74, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 'calc(100vh - 82px)', overflowY: 'auto' }}
      >
        {/* Legend */}
        <div style={{ background: '#FFFFFF', borderRadius: 12, padding: '14px 16px', width: 210, border: '0.5px solid #A3A3A3' }}>

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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#525252', margin: 0 }}>
                Complaint status
              </p>
              {visibleTiers.size < LEGEND.length && (
                <button
                  onClick={() => setVisibleTiers(new Set(LEGEND.map(l => l.tier)))}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#92400E', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
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
                  <span style={{ fontSize: 12, color: active ? '#111111' : '#A3A3A3', flex: 1, transition: 'color 0.1s' }}>
                    {label}
                  </span>
                </div>
              )
            })}

            <div style={{ height: '0.5px', background: '#E5E5E5', margin: '10px 0' }} />

            <div
              onClick={() => setShowNtaBorders(v => !v)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}
            >
              <Checkbox active={showNtaBorders} color="#525252" />
              <span style={{ fontSize: 12, color: showNtaBorders ? '#111111' : '#737373', transition: 'color 0.1s' }}>
                Neighborhoods
              </span>
            </div>

            {showNtaBorders && ntaList.length > 0 && (
              <div style={{ marginTop: 10, borderTop: '0.5px solid #E5E5E5', paddingTop: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#525252', margin: 0 }}>
                    Filter by NTA
                  </p>
                  {selectedNtas.size > 0 && (
                    <button
                      onClick={() => setSelectedNtas(new Set())}
                      style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#92400E', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#FFFFFF', border: '0.5px solid #A3A3A3', borderRadius: 6, padding: '5px 8px', marginBottom: 6 }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#A3A3A3" strokeWidth="2">
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
                        <div style={{ marginTop: 1, flexShrink: 0 }}><Checkbox active={active} color="#525252" /></div>
                        <span style={{ fontSize: 11, color: active ? '#111111' : '#737373', lineHeight: 1.3, transition: 'color 0.1s' }}>
                          {nta.name}
                        </span>
                      </div>
                    )
                  })}
                  {filteredNtaList.length === 0 && (
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#A3A3A3', margin: 0 }}>No results</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {selected && (
          <HpdComplaintsSidebar building={selected} onClose={() => setSelected(null)} />
        )}
      </div>
    </div>
  )
}
