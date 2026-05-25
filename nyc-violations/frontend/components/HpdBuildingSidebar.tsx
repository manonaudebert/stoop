'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

export type HpdSelectedBuilding = {
  bin: string
  address: string | null
  borough: string | null
  zip_code: string | null
  risk_level?: string | null
  hpd_risk_tier?: string | null
  total_complaints: number
  open_complaints: number
  open_emergency_complaints?: number
  priority_a_complaints?: number
  class_b_violations?: number
  rent_impairing_count?: number
}

type ViolationSummary = {
  bin: string
  total_violations: number
  open_violations: number
  rent_impairing_count: number
}

const RISK_LEVEL_META: Record<string, { label: string; color: string }> = {
  'Very low':  { label: 'Very low',  color: '#525252' },
  'Low':       { label: 'Low',       color: '#525252' },
  'Moderate':  { label: 'Moderate',  color: '#92400E' },
  'High':      { label: 'High',      color: '#7F1D1D' },
  'Very high': { label: 'Very high', color: '#7F1D1D' },
}

function getRiskMeta(level: string | null) {
  return RISK_LEVEL_META[level ?? ''] ?? { label: 'No data', color: '#737373' }
}

function StatCell({ label, value }: { label: string; value: number | null }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-start' }}>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 19, fontWeight: 500,
        color: value === null ? '#D4D1C3' : '#111111',
        lineHeight: 1, fontVariantNumeric: 'tabular-nums', marginBottom: 3,
      }}>
        {value === null ? '—' : value.toLocaleString()}
      </div>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.08em',
        textTransform: 'uppercase', color: '#737373',
      }}>
        {label}
      </div>
    </div>
  )
}

type Props = {
  building: HpdSelectedBuilding
  onClose: () => void
}

export default function HpdBuildingSidebar({ building, onClose }: Props) {
  const meta = getRiskMeta(building.risk_level ?? null)
  const [violations, setViolations] = useState<ViolationSummary | null | 'loading'>('loading')

  useEffect(() => {
    setViolations('loading')
    let cancelled = false
    fetch(`/api/proxy/hpd/building/search?q=${encodeURIComponent(building.bin)}`)
      .then(r => r.ok ? r.json() : [])
      .then((results: ViolationSummary[]) => {
        if (cancelled) return
        const match = results.find(r => r.bin === building.bin)
        setViolations(match ?? null)
      })
      .catch(() => { if (!cancelled) setViolations(null) })
    return () => { cancelled = true }
  }, [building.bin])

  const v = violations === 'loading' ? null : violations

  return (
    <div style={{
      background: '#FFFFFF', borderRadius: 12, padding: '16px 18px', width: 240,
      border: '0.5px solid #A3A3A3',
    }}>
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

      <div style={{ borderTop: '0.5px solid #E5E5E5', paddingTop: 12, marginTop: 10 }}>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.12em',
          textTransform: 'uppercase', color: '#A3A3A3', marginBottom: 10,
        }}>
          Reported by tenants
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <StatCell label="Total"       value={building.total_complaints} />
          <StatCell label="Open"        value={building.open_complaints} />
          <StatCell label="Open emergency" value={building.open_emergency_complaints ?? null} />
        </div>
      </div>

      <div style={{ borderTop: '0.5px solid #E5E5E5', paddingTop: 12, marginTop: 12, marginBottom: 12 }}>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.12em',
          textTransform: 'uppercase', color: '#A3A3A3', marginBottom: 10,
        }}>
          Confirmed by inspectors
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <StatCell label="Total"          value={v?.total_violations ?? null} />
          <StatCell label="Open"           value={v?.open_violations ?? null} />
          <StatCell label="Open rent-impairing" value={v?.rent_impairing_count ?? null} />
        </div>
      </div>

      <Link
        href={`/hpd/building/${building.bin}`}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          fontSize: 13, fontWeight: 500, color: '#7F1D1D',
          paddingTop: 12, borderTop: '0.5px solid #E5E5E5',
          textDecoration: 'none',
        }}
      >
        <span>View full record</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M5 12h14M13 6l6 6-6 6"/>
        </svg>
      </Link>
    </div>
  )
}
