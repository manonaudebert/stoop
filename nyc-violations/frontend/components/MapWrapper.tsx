'use client'

import dynamic from 'next/dynamic'
import { useState, useMemo, useEffect } from 'react'
import Link from 'next/link'
import SearchBar from './SearchBar'
import BuildingSidebar, { type SelectedBuilding } from './BuildingSidebar'
import type { BuildingSummary } from '@/lib/types'

const Map = dynamic(() => import('./Map'), { ssr: false })

const LEGEND = [
  { tier: 'very-low',       color: '#D4F5CB', label: 'Very low'       },
  { tier: 'low',            color: '#A8E5A0', label: 'Low'            },
  { tier: 'moderate',       color: '#FFD930', label: 'Moderate'       },
  { tier: 'high',           color: '#F5A047', label: 'High'           },
  { tier: 'very-high',      color: '#EF4637', label: 'Very high'      },
  { tier: 'not-comparable', color: '#D4D1C3', label: 'Not comparable' },
]

type FlyTarget = { lng: number; lat: number; id: number }
type NtaItem   = { code: string; name: string }

export default function MapWrapper() {
  const [selected,       setSelected]       = useState<SelectedBuilding | null>(null)
  const [flyTarget,      setFlyTarget]      = useState<FlyTarget | null>(null)
  const [visibleTiers,   setVisibleTiers]   = useState<Set<string>>(() => new Set(LEGEND.map(l => l.tier)))
  const [showNtaBorders,   setShowNtaBorders]   = useState(false)
  const [legendCollapsed,  setLegendCollapsed]  = useState(false)
  const [selectedNtas,     setSelectedNtas]     = useState<Set<string>>(new Set())
  const [ntaList,        setNtaList]        = useState<NtaItem[]>([])
  const [ntaSearch,      setNtaSearch]      = useState('')

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

  // Clear NTA filter when borders are hidden
  useEffect(() => {
    if (!showNtaBorders) { setSelectedNtas(new Set()); setNtaSearch('') }
  }, [showNtaBorders])

  function handleSearchSelect(b: BuildingSummary) {
    setSelected({
      bin: b.bin,
      address: b.address,
      borough: b.borough,
      zip_code: b.zip_code,
      total_complaints: b.total_complaints,
      open_complaints: b.open_complaints,
      priority_a_complaints: b.priority_a_complaints,
      risk_level: b.risk_level ?? null,
    })
    if (b.latitude != null && b.longitude != null) {
      setFlyTarget(prev => ({ lat: b.latitude!, lng: b.longitude!, id: (prev?.id ?? 0) + 1 }))
    }
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

  function handleNtaMapSelect(nta: NtaItem | null) {
    if (nta) toggleNta(nta.code)
  }

  const Checkbox = ({ active, color }: { active: boolean; color: string }) => (
    <div style={{
      width: 13, height: 13, borderRadius: 3, flexShrink: 0,
      background: active ? color : 'transparent',
      border: `1.5px solid ${active ? color : '#444444'}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'background 0.1s, border-color 0.1s',
    }}>
      {active && (
        <svg width="7" height="5" viewBox="0 0 7 5" fill="none">
          <path d="M1 2.5l1.8 1.8L6 1" stroke="#111111" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
    </div>
  )

  return (
    <div className="relative w-full h-full">
      <Map
        onBuildingSelect={setSelected}
        flyTarget={flyTarget}
        selectedBin={selected?.bin ?? null}
        visibleTiers={visibleTiersArray}
        showNtaBorders={showNtaBorders}
        selectedNtas={selectedNtasArray}
        onNtaSelect={handleNtaMapSelect}
        onNtaListLoad={setNtaList}
      />

      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-10 pointer-events-none">
        <div
          style={{ background: '#0601B4', padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 12 }}
          className="pointer-events-auto"
        >
          <h1 style={{ fontSize: 14, fontWeight: 500, color: '#FFFFFF', letterSpacing: '-0.01em', margin: 0, whiteSpace: 'nowrap', flexShrink: 0 }}>
            NYC Building Complaints
          </h1>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: '0 1 460px' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <SearchBar onSelect={handleSearchSelect} />
            </div>
            <Link
              href="/leaderboard"
              className="hidden sm:inline"
              style={{ fontSize: 13, fontWeight: 500, color: '#B5B3F5', textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              Leaderboard
            </Link>
          </div>
        </div>
      </div>

      {/* Left column — legend + building panel */}
      <div
        className="absolute left-4 z-10"
        style={{ top: 74, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 'calc(100vh - 82px)', overflowY: 'auto' }}
      >

      {/* Legend */}
      <div style={{ background: '#111111', borderRadius: 8, padding: '12px 14px', width: 200 }}>

        {/* Mobile collapse toggle — hidden on sm+ */}
        <div
          className="flex sm:hidden"
          onClick={() => setLegendCollapsed(v => !v)}
          style={{
            alignItems: 'center', justifyContent: 'space-between',
            cursor: 'pointer', userSelect: 'none',
            marginBottom: legendCollapsed ? 0 : 10,
          }}
        >
          <span style={{ fontSize: 10, fontWeight: 500, color: '#D1C9C5', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            Legend
          </span>
          <svg
            width="12" height="12" viewBox="0 0 12 12" fill="none"
            style={{ transform: legendCollapsed ? 'rotate(0deg)' : 'rotate(180deg)', transition: 'transform 0.2s' }}
          >
            <path d="M2 4.5l4 4 4-4" stroke="#D1C9C5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>

        {/* Legend body — always visible on sm+, collapsible on mobile */}
        <div className={legendCollapsed ? 'hidden sm:block' : ''}>

        {/* Risk level header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <p style={{ fontSize: 10, fontWeight: 500, color: '#D1C9C5', letterSpacing: '0.12em', textTransform: 'uppercase', margin: 0 }}>
            Risk level
          </p>
          {visibleTiers.size < LEGEND.length && (
            <button
              onClick={() => setVisibleTiers(new Set(LEGEND.map(l => l.tier)))}
              style={{ fontSize: 10, color: '#B5B3F5', background: 'none', border: 'none', cursor: 'pointer', padding: 0, letterSpacing: '0.05em' }}
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
              <span style={{ fontSize: 12, color: active ? '#FFFFFF' : '#D1C9C5', flex: 1, transition: 'color 0.1s' }}>
                {label}
              </span>
            </div>
          )
        })}

        <div
          onClick={() => setShowNtaBorders(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}
        >
          <Checkbox active={showNtaBorders} color="#6B75F5" />
          <span style={{ fontSize: 12, color: showNtaBorders ? '#FFFFFF' : '#D1C9C5', transition: 'color 0.1s' }}>
            Neighborhoods (NTAs)
          </span>
        </div>

        {/* NTA filter list — shown when NTA borders are on */}
        {showNtaBorders && ntaList.length > 0 && (
          <div style={{ marginTop: 10, borderTop: '0.5px solid #2A2A2A', paddingTop: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
              <p style={{ fontSize: 10, fontWeight: 500, color: '#D1C9C5', letterSpacing: '0.12em', textTransform: 'uppercase', margin: 0 }}>
                Filter by NTA
              </p>
              {selectedNtas.size > 0 && (
                <button
                  onClick={() => setSelectedNtas(new Set())}
                  style={{ fontSize: 10, color: '#B5B3F5', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                >
                  Clear all
                </button>
              )}
            </div>
            <input
              value={ntaSearch}
              onChange={e => setNtaSearch(e.target.value)}
              placeholder="Search…"
              style={{
                width: '100%', boxSizing: 'border-box',
                background: '#1A1A1A', border: '1px solid #333', borderRadius: 4,
                color: '#FFFFFF', fontSize: 11, padding: '4px 7px', marginBottom: 6,
                outline: 'none',
              }}
            />
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
                      <Checkbox active={active} color="#6B75F5" />
                    </div>
                    <span style={{ fontSize: 11, color: active ? '#FFFFFF' : '#888888', lineHeight: 1.3, transition: 'color 0.1s' }}>
                      {nta.name}
                    </span>
                  </div>
                )
              })}
              {filteredNtaList.length === 0 && (
                <p style={{ fontSize: 11, color: '#555555', margin: 0 }}>No results</p>
              )}
            </div>
          </div>
        )}
        </div>
        {/* Legend body end */}
      </div>
      {/* Legend end */}

      {selected && (
        <BuildingSidebar building={selected} onClose={() => setSelected(null)} />
      )}

      </div>
      {/* Left column end */}

    </div>
  )
}
