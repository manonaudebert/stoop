'use client'

import Link from 'next/link'

export type HpdComplaintSelectedBuilding = {
  bin: string
  address: string | null
  borough: string | null
  zip_code: string | null
  complaint_risk_tier: string | null
  total_complaints: number
  open_complaints: number
  open_emergency_complaints: number
}

const TIER_META: Record<string, { label: string; color: string }> = {
  'Emergency': { label: 'Emergency complaints', color: '#7F1D1D' },
  'Active':    { label: 'Active complaints',    color: '#92400E' },
  'Resolved':  { label: 'All complaints closed', color: '#525252' },
}

function getTierMeta(tier: string | null) {
  return TIER_META[tier ?? ''] ?? { label: 'Unknown', color: '#737373' }
}

type Props = {
  building: HpdComplaintSelectedBuilding
  onClose: () => void
}

export default function HpdComplaintsSidebar({ building, onClose }: Props) {
  const meta = getTierMeta(building.complaint_risk_tier)

  return (
    <div style={{
      background: '#FFFFFF', borderRadius: 12, padding: '16px 18px', width: 220,
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

      <div style={{ height: '0.5px', background: '#E5E5E5', margin: '10px 0' }} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
        {[
          { label: 'Total',     value: building.total_complaints },
          { label: 'Open',      value: building.open_complaints },
          { label: 'Emergency', value: building.open_emergency_complaints },
        ].map(({ label, value }) => (
          <div key={label}>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.08em',
              textTransform: 'uppercase', color: '#737373', marginBottom: 3,
            }}>
              {label}
            </div>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: 19, fontWeight: 500,
              color: '#111111', lineHeight: 1, fontVariantNumeric: 'tabular-nums',
            }}>
              {value.toLocaleString()}
            </div>
          </div>
        ))}
      </div>

      <Link
        href={`/hpd-complaints/building/${building.bin}`}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          fontSize: 13, fontWeight: 500, color: '#92400E',
          paddingTop: 12, borderTop: '0.5px solid #E5E5E5',
          textDecoration: 'none',
        }}
      >
        <span>View complaints</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M5 12h14M13 6l6 6-6 6"/>
        </svg>
      </Link>
    </div>
  )
}
