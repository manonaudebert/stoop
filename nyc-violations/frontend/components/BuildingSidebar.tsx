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
  'Very low':          { label: 'Very low risk',    bg: '#D4F5CB', titleText: '#1F4012' },
  'Low':               { label: 'Low risk',         bg: '#A8E5A0', titleText: '#1F4012' },
  'Moderate':          { label: 'Moderate risk',    bg: '#FFD930', titleText: '#5C4A0A' },
  'High':              { label: 'High risk',        bg: '#F5A047', titleText: '#5C3A0A' },
  'Very high':         { label: 'Very high risk',   bg: '#EF4637', titleText: '#FFFFFF' },
  'Insufficient data': { label: 'Few complaints',   bg: '#D4F5CB', titleText: '#1F4012' },
  'Not comparable':    { label: 'Not comparable',   bg: '#D4D1C3', titleText: '#6B6B65' },
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
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        width: 320,
        height: '100vh',
        background: '#FFFFFF',
        borderLeft: '0.5px solid #E5E3DA',
        zIndex: 20,
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
      }}
    >
      {/* Header */}
      <div style={{ padding: '14px 16px 0', borderBottom: '0.5px solid #E5E3DA', paddingBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{
              display: 'inline-block',
              fontSize: 10, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase',
              padding: '2px 8px', borderRadius: 4,
              background: tier.bg, color: tier.titleText,
              marginBottom: 8,
            }}>
              {tier.label}
            </span>
            <p style={{ fontSize: 16, fontWeight: 500, color: '#111111', letterSpacing: '-0.01em', lineHeight: 1.3, margin: 0 }}>
              {building.address ?? 'Unknown address'}
            </p>
            <p style={{ fontSize: 12, color: '#6B6B65', marginTop: 4 }}>
              {building.borough}{building.zip_code ? ` · ${building.zip_code}` : ''}
            </p>
            {building.bin && (
              <p style={{ fontSize: 11, color: '#6B6B65', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
                BIN {building.bin}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              flexShrink: 0,
              width: 28, height: 28,
              border: '0.5px solid #E5E3DA',
              borderRadius: 6,
              background: '#FAFAF7',
              cursor: 'pointer',
              fontSize: 16, color: '#6B6B65',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              lineHeight: 1,
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>
      </div>

      {/* Risk level */}
      <div style={{ padding: '16px' }}>
        <div style={{
          background: tier.bg,
          borderRadius: 10,
          padding: '14px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 18, fontWeight: 500, color: tier.titleText, letterSpacing: '-0.02em', lineHeight: 1 }}>
            {tier.label}
          </span>
          <span style={{
            fontSize: 10, fontWeight: 500, color: tier.titleText, opacity: 0.7,
            letterSpacing: '0.1em', textTransform: 'uppercase',
          }}>
            Risk level
          </span>
        </div>
      </div>

      {/* Stats */}
      <div style={{ padding: '0 16px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        {[
          { label: 'Total',    value: building.total_complaints },
          { label: 'Active',   value: building.open_complaints },
          { label: 'Priority A', value: building.priority_a_complaints },
        ].map(({ label, value }) => (
          <div key={label} style={{ background: '#FAFAF7', border: '0.5px solid #E5E3DA', borderRadius: 8, padding: '10px 10px' }}>
            <p style={{ fontSize: 10, fontWeight: 500, color: '#6B6B65', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              {label}
            </p>
            <p style={{ fontSize: 24, fontWeight: 500, color: '#0601B4', letterSpacing: '-0.02em', lineHeight: 1, marginTop: 4 }}>
              {value.toLocaleString()}
            </p>
          </div>
        ))}
      </div>

      {/* CTA */}
      <div style={{ padding: '16px', marginTop: 'auto' }}>
        <Link
          href={`/building/${building.bin}`}
          style={{
            display: 'block',
            textAlign: 'center',
            fontSize: 13, fontWeight: 500,
            padding: '11px 18px',
            borderRadius: 8,
            background: '#0601B4',
            color: '#FFFFFF',
            textDecoration: 'none',
            letterSpacing: '-0.01em',
          }}
        >
          See full report →
        </Link>
      </div>
    </div>
  )
}
