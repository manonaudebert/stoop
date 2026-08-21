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
// `RiskChip` is deliberately NOT here. It reads a per-city `RISK_META`, and the
// two disagree: SF renders "High" as #BC4B33, NYC as #7F1D1D, and NYC carries
// two levels SF has no equivalent for. That is a product decision about what a
// risk color means, not a duplication to collapse, so `SectionHeader` takes the
// rendered chip as a node and each sidebar keeps its own.

import type { ReactNode } from 'react'

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

// `chip` is the city's own risk chip, already rendered. See the note above.
export const SectionHeader = ({ title, chip, active }: { title: string; chip?: ReactNode; active?: boolean }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em',
        textTransform: 'uppercase', color: '#111111', fontWeight: 600,
      }}>
        {title}
      </span>
      {chip}
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
