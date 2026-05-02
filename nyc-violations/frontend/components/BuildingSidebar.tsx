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

type RiskTier = { label: string; bg: string; titleText: string }

const RISK_TIER_MAP: Record<string, RiskTier> = {
  'Very low':          { label: 'Very low risk',  bg: '#D4F5CB', titleText: '#1F4012' },
  'Low':               { label: 'Low risk',       bg: '#A8E5A0', titleText: '#1F4012' },
  'Moderate':          { label: 'Moderate risk',  bg: '#FFD930', titleText: '#5C4A0A' },
  'High':              { label: 'High risk',      bg: '#F5A047', titleText: '#5C3A0A' },
  'Very high':         { label: 'Very high risk', bg: '#EF4637', titleText: '#FFFFFF' },
  'Insufficient data': { label: 'Few complaints', bg: '#D4F5CB', titleText: '#1F4012' },
  'Not comparable':    { label: 'Not comparable', bg: '#D4D1C3', titleText: '#6B6B65' },
}

function getRiskTier(riskLevel: string | null): RiskTier {
  return RISK_TIER_MAP[riskLevel ?? ''] ?? { label: 'Unknown', bg: '#F5F3EA', titleText: '#6B6B65' }
}

type Props = {
  building: SelectedBuilding
  onClose: () => void
}

export default function BuildingSidebar({ building, onClose }: Props) {
  const tier = getRiskTier(building.risk_level)

  return (
    <div style={{
      background: '#FFFFFF', borderRadius: 8, padding: '12px 14px', width: 200,
      border: '0.5px solid #E5E3DA',
      boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{
            display: 'inline-block',
            fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase',
            padding: '2px 6px', borderRadius: 3,
            background: tier.bg, color: tier.titleText,
            marginBottom: 6,
          }}>
            {tier.label}
          </span>
          <p style={{ fontSize: 13, fontWeight: 500, color: '#111111', letterSpacing: '-0.01em', lineHeight: 1.3, margin: 0 }}>
            {building.address ?? 'Unknown address'}
          </p>
          <p style={{ fontSize: 11, color: '#6B6B65', marginTop: 3, marginBottom: 0 }}>
            {building.borough}{building.zip_code ? ` · ${building.zip_code}` : ''}
          </p>
          {building.bin && (
            <p style={{ fontSize: 10, color: '#A5A39A', marginTop: 2, marginBottom: 0, fontFamily: 'var(--font-geist-mono)' }}>
              BIN {building.bin}
            </p>
          )}
        </div>
        <button
          onClick={onClose}
          style={{
            flexShrink: 0, background: 'none', border: 'none',
            cursor: 'pointer', fontSize: 18, color: '#A5A39A',
            padding: 0, lineHeight: 1, marginTop: -1,
          }}
          aria-label="Close"
        >
          ×
        </button>
      </div>

      <div style={{ borderTop: '0.5px solid #E5E3DA', marginBottom: 10 }} />

      {/* Stats */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
        {[
          { label: 'Total complaints', value: building.total_complaints },
          { label: 'Open',             value: building.open_complaints },
          { label: 'Priority A',       value: building.priority_a_complaints },
        ].map(({ label, value }) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: '#6B6B65' }}>{label}</span>
            <span style={{ fontSize: 13, fontWeight: 500, color: '#0601B4', letterSpacing: '-0.01em' }}>
              {value.toLocaleString()}
            </span>
          </div>
        ))}
      </div>

      <Link
        href={`/building/${building.bin}`}
        style={{
          display: 'block', textAlign: 'center',
          fontSize: 12, fontWeight: 500,
          padding: '8px 12px', borderRadius: 6,
          background: '#0601B4', color: '#FFFFFF',
          textDecoration: 'none', letterSpacing: '-0.01em',
        }}
      >
        See full report →
      </Link>
    </div>
  )
}
