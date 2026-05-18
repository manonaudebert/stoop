'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

export type HpdSelectedBuilding = {
  bin: string
  address: string | null
  borough: string | null
  zip_code: string | null
  hpd_risk_tier: string | null
  // Map.tsx emits these under DOB-compatible names
  total_complaints: number    // = total_violations
  open_complaints: number     // = open_violations
  priority_a_complaints: number  // = class_a_violations
  // HPD-specific extras
  class_b_violations?: number
  rent_impairing_count?: number
}

type ComplaintSummary = {
  bin: string
  total_complaints: number
  open_complaints: number
  open_emergency_complaints: number
}

const TIER_META: Record<string, { label: string; color: string }> = {
  'Emergency':     { label: 'Emergency violations',     color: '#7F1D1D' },
  'Hazardous':     { label: 'Hazardous violations',     color: '#7F1D1D' },
  'Non-hazardous': { label: 'Non-hazardous violations', color: '#525252' },
  'Resolved':      { label: 'All violations resolved',  color: '#525252' },
}

function getTierMeta(tier: string | null) {
  return TIER_META[tier ?? ''] ?? { label: 'Unknown', color: '#737373' }
}

function StatCell({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.08em',
        textTransform: 'uppercase', color: '#737373', marginBottom: 3,
      }}>
        {label}
      </div>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 19, fontWeight: 500,
        color: value === null ? '#D4D1C3' : '#111111',
        lineHeight: 1, fontVariantNumeric: 'tabular-nums',
      }}>
        {value === null ? '—' : value.toLocaleString()}
      </div>
    </div>
  )
}

type Props = {
  building: HpdSelectedBuilding
  onClose: () => void
}

export default function HpdBuildingSidebar({ building, onClose }: Props) {
  const meta = getTierMeta(building.hpd_risk_tier)
  const [complaints, setComplaints] = useState<ComplaintSummary | null | 'loading'>('loading')

  useEffect(() => {
    setComplaints('loading')
    let cancelled = false
    fetch(`/api/proxy/hpd-complaints/building/search?q=${encodeURIComponent(building.bin)}`)
      .then(r => r.ok ? r.json() : [])
      .then((results: ComplaintSummary[]) => {
        if (cancelled) return
        const match = results.find(r => r.bin === building.bin)
        setComplaints(match ?? null)
      })
      .catch(() => { if (!cancelled) setComplaints(null) })
    return () => { cancelled = true }
  }, [building.bin])

  const c = complaints === 'loading' ? null : complaints

  return (
    <div style={{
      background: '#FFFFFF', borderRadius: 12, padding: '16px 18px', width: 240,
      border: '0.5px solid #A3A3A3',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{
            display: 'inline-block',
            fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em',
            textTransform: 'uppercase', color: meta.color, marginBottom: 6,
          }}>
            {meta.label}
          </span>
          <p style={{
            fontFamily: 'var(--font-serif)', fontSize: 17, fontWeight: 500,
            color: '#111111', letterSpacing: '-0.01em', lineHeight: 1.15, margin: 0,
          }}>
            {building.address ?? 'Unknown address'}
          </p>
          <p style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, color: '#525252',
            marginTop: 4, marginBottom: 0,
          }}>
            {building.borough}{building.zip_code ? ` · ${building.zip_code}` : ''}
            {building.bin ? ` · BIN ${building.bin}` : ''}
          </p>
        </div>
        <button
          onClick={onClose}
          style={{
            flexShrink: 0, background: 'none', border: 'none',
            cursor: 'pointer', fontSize: 18, color: '#A3A3A3',
            padding: 0, lineHeight: 1, marginTop: -1,
          }}
          aria-label="Close"
        >
          ×
        </button>
      </div>

      {/* Violations — confirmed by inspectors */}
      <div style={{ borderTop: '0.5px solid #E5E5E5', paddingTop: 12, marginTop: 10 }}>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.12em',
          textTransform: 'uppercase', color: '#A3A3A3', marginBottom: 10,
        }}>
          Confirmed by inspectors
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <StatCell label="Total"          value={building.total_complaints} />
          <StatCell label="Open"           value={building.open_complaints} />
          <StatCell label="Open rent-imp." value={building.rent_impairing_count ?? null} />
        </div>
      </div>

      {/* Complaints — reported by tenants */}
      <div style={{ borderTop: '0.5px solid #E5E5E5', paddingTop: 12, marginTop: 12 }}>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.12em',
          textTransform: 'uppercase', color: '#A3A3A3', marginBottom: 10,
        }}>
          Reported by tenants
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <StatCell label="Total"     value={c?.total_complaints ?? null} />
          <StatCell label="Open"      value={c?.open_complaints ?? null} />
          <StatCell label="Open emerg." value={c?.open_emergency_complaints ?? null} />
        </div>
      </div>

      {/* Single CTA */}
      <div style={{ borderTop: '0.5px solid #E5E5E5', paddingTop: 12, marginTop: 12 }}>
        <Link
          href={`/hpd-overview/building/${building.bin}`}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            fontSize: 11, fontWeight: 500, color: '#111111',
            textDecoration: 'none',
          }}
        >
          <span>HPD overview</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 12h14M13 6l6 6-6 6"/>
          </svg>
        </Link>
      </div>
    </div>
  )
}
