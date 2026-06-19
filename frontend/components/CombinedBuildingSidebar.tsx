'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

// One building across both datasets, as carried by a unified map feature. Any
// field group is null when the building has no record in that dataset.
export type UnifiedBuilding = {
  bin: string
  address: string | null
  borough: string | null
  zip_code: string | null
  // DOB — building safety
  dob_risk_level?: string | null
  dob_total?: number | null
  dob_open?: number | null
  dob_priority_a?: number | null
  // HPD — housing conditions (complaints)
  hpd_risk_level?: string | null
  hpd_total?: number | null
  hpd_open?: number | null
  hpd_open_emergency?: number | null
}

type ViolationSummary = {
  bin: string
  total_violations: number
  open_violations: number
  rent_impairing_count: number
}

const RISK_META: Record<string, { label: string; color: string }> = {
  'Very low':          { label: 'Very low',       color: '#525252' },
  'Low':               { label: 'Low',            color: '#525252' },
  'Moderate':          { label: 'Moderate',       color: '#92400E' },
  'High':              { label: 'High',           color: '#7F1D1D' },
  'Very high':         { label: 'Very high',      color: '#7F1D1D' },
  'Insufficient data': { label: 'Very low',       color: '#525252' },
  'Not comparable':    { label: 'Not comparable', color: '#525252' },
}

function riskMeta(level: string | null | undefined) {
  return RISK_META[level ?? ''] ?? { label: 'No data', color: '#525252' }
}

function StatCell({ label, value, loading }: { label: string; value: number | null; loading?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-start' }}>
      {loading ? (
        <div className="skeleton" style={{ height: 19, width: 32, marginBottom: 6 }} />
      ) : (
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 19, fontWeight: 500,
          color: value === null ? '#D4D1C3' : '#111111',
          lineHeight: 1, fontVariantNumeric: 'tabular-nums', marginBottom: 3,
        }}>
          {value === null ? '—' : value.toLocaleString()}
        </div>
      )}
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.08em',
        textTransform: 'uppercase', color: '#525252',
      }}>
        {label}
      </div>
    </div>
  )
}

const RiskChip = ({ level }: { level: string | null | undefined }) => {
  const meta = riskMeta(level)
  return (
    <span style={{
      fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em',
      textTransform: 'uppercase', color: meta.color,
    }}>
      {meta.label}
    </span>
  )
}

const RecordLink = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <Link
    href={href}
    style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      fontSize: 13, fontWeight: 500, color: '#7F1D1D', textDecoration: 'none',
    }}
  >
    <span>{children}</span>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M5 12h14M13 6l6 6-6 6"/>
    </svg>
  </Link>
)

// Marks the section whose risk currently drives the map colors, so a tenant
// reading a green/red dot knows which of the two dimensions they're looking at.
const OnMapBadge = () => (
  <span style={{
    display: 'inline-flex', alignItems: 'center', gap: 4,
    fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.1em',
    textTransform: 'uppercase', color: '#FFFFFF',
    background: '#111111', borderRadius: 4, padding: '2px 5px',
  }}>
    <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#FFFFFF' }} />
    Map
  </span>
)

const SectionHeader = ({ title, level, active }: { title: string; level?: string | null; active?: boolean }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em',
        textTransform: 'uppercase', color: '#111111', fontWeight: 600,
      }}>
        {title}
      </span>
      {level !== undefined && <RiskChip level={level} />}
    </div>
    {active && <OnMapBadge />}
  </div>
)

// Wraps a dataset section, giving the map-active one a left accent bar and a
// faint tint so it reads as the source of the dot colors on the map.
const Section = ({ active, children }: { active: boolean; children: React.ReactNode }) => (
  <div style={{
    borderLeft: active ? '2px solid #111111' : '2px solid transparent',
    background: active ? '#F5F5F4' : 'transparent',
    borderRadius: active ? '0 6px 6px 0' : 0,
    margin: active ? '0 -6px' : 0,
    padding: active ? '10px 6px 10px 10px' : 0,
  }}>
    {children}
  </div>
)

type Props = {
  building: UnifiedBuilding
  onClose: () => void
  activeLens: 'HPD' | 'DOB'
}

export default function CombinedBuildingSidebar({ building, onClose, activeLens }: Props) {
  const hasHpd = building.hpd_total != null || building.hpd_risk_level != null
  const hasDob = building.dob_total != null || building.dob_risk_level != null

  const [violations, setViolations] = useState<ViolationSummary | null | 'loading'>('loading')

  useEffect(() => {
    if (!hasHpd) { setViolations(null); return }
    setViolations('loading')
    let cancelled = false
    fetch(`/api/proxy/hpd/building/search?q=${encodeURIComponent(building.bin)}`)
      .then(r => r.ok ? r.json() : [])
      .then((results: ViolationSummary[]) => {
        if (cancelled) return
        setViolations(results.find(r => r.bin === building.bin) ?? null)
      })
      .catch(() => { if (!cancelled) setViolations(null) })
    return () => { cancelled = true }
  }, [building.bin, hasHpd])

  const v        = violations === 'loading' ? null : violations
  const vLoading = violations === 'loading'

  const divider = <div style={{ height: '0.5px', background: '#E5E5E5', margin: '14px 0' }} />

  return (
    <div className="w-full sm:w-60" style={{
      background: '#FFFFFF', borderRadius: 12, padding: '16px 18px',
      border: '0.5px solid #6B6B6B',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
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
            cursor: 'pointer', fontSize: 18, color: '#6B6B6B',
            padding: 0, lineHeight: 1, marginTop: -1,
          }}
          aria-label="Close"
        >
          ×
        </button>
      </div>

      {divider}

      {/* ── Housing conditions (HPD) ── */}
      <Section active={activeLens === 'HPD'}>
        <SectionHeader title="Housing conditions" level={hasHpd ? building.hpd_risk_level : undefined} active={activeLens === 'HPD'} />
        {hasHpd ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
              <StatCell label="Total complaints" value={building.hpd_total ?? null} />
              <StatCell label="Total violations" value={v?.total_violations ?? null} loading={vLoading} />
              <StatCell label="Open violations"  value={v?.open_violations ?? null}  loading={vLoading} />
            </div>
            <RecordLink href={`/hpd/building/${building.bin}`}>View housing record</RecordLink>
          </>
        ) : (
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: '#6B6B6B', margin: 0 }}>
            No HPD housing records on file.
          </p>
        )}
      </Section>

      {divider}

      {/* ── Building safety (DOB) ── */}
      <Section active={activeLens === 'DOB'}>
        <SectionHeader title="Building safety" level={hasDob ? building.dob_risk_level : undefined} active={activeLens === 'DOB'} />
        {hasDob ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
              <StatCell label="Total"      value={building.dob_total ?? null} />
              <StatCell label="Open"       value={building.dob_open ?? null} />
              <StatCell label="Priority A" value={building.dob_priority_a ?? null} />
            </div>
            <RecordLink href={`/dob/building/${building.bin}`}>View safety record</RecordLink>
          </>
        ) : (
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: '#6B6B6B', margin: 0 }}>
            No DOB building-safety records on file.
          </p>
        )}
      </Section>
    </div>
  )
}
