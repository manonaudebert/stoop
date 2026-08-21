'use client'

// Presentational pieces shared by the two map sidebars — `CombinedBuildingSidebar`
// (NYC: HPD / DOB lenses) and `SfBuildingSidebar` (SF: complaints / violations).
//
// Both sidebars are the same card with a different pair of datasets behind it,
// and every piece here was byte-identical in the two files before it moved. The
// LENS MODELS are not shared and should not be: NYC fetches a violation summary
// on open and SF does not, and their lens keys differ ('HPD' | 'DOB' vs
// 'complaints' | 'violations'). Forcing those together is the risky half of the
// reuse; this is the half that is provably safe.
//
// `RiskChip` reads one `RISK_META` for both cities. The tables used to disagree
// about "High" — SF #BC4B33, NYC #7F1D1D — and NYC's sidebar was the outlier:
// #BC4B33 is the High color in both map dot palettes, both legends, SearchBar
// and all three leaderboards, and NYC's #7F1D1D is what it also uses for "Very
// high", so its chip collapsed two levels the legend beside it distinguishes.
// Resolved to #BC4B33 app-wide. The two NYC-only levels are harmless to SF,
// which never produces them.

import Link from 'next/link'
import type { ReactNode } from 'react'

const RISK_META: Record<string, { label: string; color: string }> = {
  'Very low':          { label: 'Very low',       color: '#525252' },
  'Low':               { label: 'Low',            color: '#525252' },
  'Moderate':          { label: 'Moderate',       color: '#92400E' },
  'High':              { label: 'High',           color: '#BC4B33' },
  'Very high':         { label: 'Very high',      color: '#7F1D1D' },
  // NYC only: percentile tiers that are not risk levels.
  'Insufficient data': { label: 'Very low',       color: '#525252' },
  'Not comparable':    { label: 'Not comparable', color: '#525252' },
}

function riskMeta(level: string | null | undefined) {
  return RISK_META[level ?? ''] ?? { label: 'No data', color: '#525252' }
}

export const RiskChip = ({ level }: { level: string | null | undefined }) => {
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

// One number and its caption. `loading` shows a skeleton in its place, for the
// NYC sidebar's violation counts, which arrive after the panel opens.
export function StatCell({ label, value, loading }: { label: string; value: number | null; loading?: boolean }) {
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

// Marks the section whose risk currently drives the map colors, so a tenant
// reading a green/red dot knows which of the two dimensions they're looking at.
export const OnMapBadge = () => (
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

export const SectionHeader = ({ title, level, active }: { title: string; level?: string | null; active?: boolean }) => (
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
export const Section = ({ active, children }: { active: boolean; children: ReactNode }) => (
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

// The "view the full record" link at the foot of a section. NYC had it as a
// component and SF as the same markup inline, down to the arrow path.
export const RecordLink = ({ href, children }: { href: string; children: ReactNode }) => (
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
