'use client'

import Link from 'next/link'

export type SelectedBuilding = {
  bin: string
  address: string | null
  borough: string | null
  zip_code: string | null
  total_complaints: number
  open_complaints: number
  priority_a_complaints: number
  risk_level: string | null
}

const RISK_TIER_MAP: Record<string, { label: string; color: string }> = {
  'Very low':          { label: 'Very low',  color: '#525252' },
  'Low':               { label: 'Low',       color: '#525252' },
  'Moderate':          { label: 'Moderate',  color: '#525252' },
  'High':              { label: 'High',  color: '#7F1D1D' },
  'Very high':         { label: 'Very high', color: '#7F1D1D' },
  'Insufficient data': { label: 'Very low', color: '#737373' },
  'Not comparable':    { label: 'Not comparable', color: '#737373' },
}

function getRiskTier(riskLevel: string | null) {
  return RISK_TIER_MAP[riskLevel ?? ''] ?? { label: 'Unknown', color: '#737373' }
}

type Props = {
  building: SelectedBuilding
  onClose: () => void
}

export default function BuildingSidebar({ building, onClose }: Props) {
  const tier = getRiskTier(building.risk_level)

  return (
    <div style={{
      background: '#FFFFFF', borderRadius: 12, padding: '16px 18px', width: 220,
      border: '0.5px solid #A3A3A3',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{
            display: 'inline-block',
            fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em',
            textTransform: 'uppercase', color: tier.color, marginBottom: 6,
          }}>
            {tier.label}
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

      <div style={{ height: '0.5px', background: '#E5E5E5', margin: '10px 0' }} />

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
        {[
          { label: 'Total',      value: building.total_complaints },
          { label: 'Open',       value: building.open_complaints },
          { label: 'Priority A', value: building.priority_a_complaints },
        ].map(({ label, value }) => (
          <div key={label} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-start' }}>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: 19, fontWeight: 500,
              color: '#111111', lineHeight: 1, fontVariantNumeric: 'tabular-nums', marginBottom: 3,
            }}>
              {value.toLocaleString()}
            </div>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.08em',
              textTransform: 'uppercase', color: '#737373',
            }}>
              {label}
            </div>
          </div>
        ))}
      </div>

      <Link
        href={`/dob/building/${building.bin}`}
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
