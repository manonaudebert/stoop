'use client'

import Link from 'next/link'

import { Section, SectionHeader, StatCell } from '@/components/MapSidebarParts'

export type SfMapBuilding = {
  mapblklot: string
  address: string | null
  neighborhood: string | null
  // complaints domain
  complaints_present: number
  complaints_risk_level: string | null
  total_complaints: number
  complaints_5yr: number
  severe_complaints_5yr: number
  // violations domain
  violations_present: number
  violations_risk_level: string | null
  total_violations: number
  open_violations: number
}

const RISK_META: Record<string, { label: string; color: string }> = {
  'Very low':  { label: 'Very low',  color: '#525252' },
  'Low':       { label: 'Low',       color: '#525252' },
  'Moderate':  { label: 'Moderate',  color: '#92400E' },
  'High':      { label: 'High',      color: '#BC4B33' },
  'Very high': { label: 'Very high', color: '#7F1D1D' },
}

function riskMeta(level: string | null | undefined) {
  return RISK_META[level ?? ''] ?? { label: 'No data', color: '#525252' }
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

type Props = {
  building: SfMapBuilding
  activeLens: 'complaints' | 'violations'
  onClose: () => void
}

export default function SfBuildingSidebar({ building, activeLens, onClose }: Props) {
  const hasComplaints = building.complaints_present > 0
  const hasViolations = building.violations_present > 0
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
            {building.neighborhood ?? 'San Francisco'}
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

      {/* 311 Complaints */}
      <Section active={activeLens === 'complaints'}>
        <SectionHeader
          title="311 Complaints"
          chip={hasComplaints ? <RiskChip level={building.complaints_risk_level} /> : undefined}
          active={activeLens === 'complaints'}
        />
        {hasComplaints ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <StatCell label="Total"      value={building.total_complaints} />
            <StatCell label="Last 5yr"   value={building.complaints_5yr} />
            <StatCell label="Severe 5yr" value={building.severe_complaints_5yr} />
          </div>
        ) : (
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: '#6B6B6B', margin: 0 }}>
            No 311 complaint records on file.
          </p>
        )}
      </Section>

      {divider}

      {/* DBI Violations */}
      <Section active={activeLens === 'violations'}>
        <SectionHeader
          title="DBI Violations"
          chip={hasViolations ? <RiskChip level={building.violations_risk_level} /> : undefined}
          active={activeLens === 'violations'}
        />
        {hasViolations ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <StatCell label="Total"  value={building.total_violations} />
            <StatCell label="Open"   value={building.open_violations} />
          </div>
        ) : (
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: '#6B6B6B', margin: 0 }}>
            No DBI violation records on file.
          </p>
        )}
      </Section>

      {divider}

      <Link
        href={`/sf/building/${building.mapblklot}`}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          fontSize: 13, fontWeight: 500, color: '#7F1D1D', textDecoration: 'none',
        }}
      >
        <span>View full report</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M5 12h14M13 6l6 6-6 6"/>
        </svg>
      </Link>
    </div>
  )
}
