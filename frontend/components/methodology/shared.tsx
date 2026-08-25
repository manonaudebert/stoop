import React from 'react'
import CityToggle from '@/components/CityToggle'

// ── design tokens ─────────────────────────────────────────────────────────────

export const CARD: React.CSSProperties = {
  background: '#FFFFFF',
  border: '0.5px solid #E5E5E5',
  borderRadius: 12,
  padding: 20,
}

export const SECTION_HEADER: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  letterSpacing: '0.12em',
  textTransform: 'uppercase' as const,
  color: '#525252',
  marginBottom: 12,
  marginTop: 0,
}

export const PROSE: React.CSSProperties = {
  fontSize: 14,
  color: '#525252',
  lineHeight: 1.7,
  margin: 0,
}

// ── shared data (identical across cities) ─────────────────────────────────────

export const RECENCY_TIERS = [
  { label: '≤ 2 years',   weight: '1.0×', desc: 'Full weight' },
  { label: '2 – 5 years', weight: '0.5×', desc: 'Half weight' },
  { label: '5 – 10 years',weight: '0.25×',desc: 'Quarter weight' },
  { label: '> 10 years',  weight: '0',    desc: 'Excluded' },
]

export const RISK_LEVELS = [
  { label: 'Very low',  range: '< 15th percentile', dot: '#84A98C',
    desc: 'Lower weighted activity per unit of scale than ~85% of neighborhood peers.' },
  { label: 'Low',       range: '15th – 39th',        dot: '#84A98C',
    desc: 'Below the neighborhood median.' },
  { label: 'Moderate',  range: '40th – 69th',        dot: '#E4A11B',
    desc: 'Near or above the neighborhood median.' },
  { label: 'High',      range: '70th – 89th',        dot: '#C45C3A',
    desc: 'Higher weighted activity than most neighborhood peers.' },
  { label: 'Very high', range: '≥ 90th percentile',  dot: '#7F1D1D',
    desc: 'Among the buildings with the highest weighted activity in the neighborhood.' },
]

export type SeverityItem = {
  key: string
  badge: string
  name: string
  weight: number
  color: string
  textColor: string
  border?: string
  examples: string
}

// ── sub-components ────────────────────────────────────────────────────────────

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{
      fontFamily: 'var(--font-serif)',
      fontSize: 22,
      fontWeight: 500,
      color: '#111111',
      letterSpacing: '-0.02em',
      margin: '0 0 16px',
    }}>
      {children}
    </h2>
  )
}

export function DataSourceCard({
  id,
  title,
  agency,
  description,
  href,
}: {
  id: string
  title: string
  agency: string
  description: string
  href: string
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{ ...CARD, display: 'block', textDecoration: 'none', transition: 'border-color 0.15s' }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
        <div>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#525252', margin: '0 0 4px' }}>
            {agency}
          </p>
          <p style={{ fontFamily: 'var(--font-serif)', fontSize: 16, fontWeight: 500, color: '#111111', margin: 0 }}>
            {title}
          </p>
        </div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6B6B6B" strokeWidth="2" style={{ flexShrink: 0, marginTop: 2 }}>
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
          <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
        </svg>
      </div>
      <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#6B6B6B', margin: '0 0 8px', letterSpacing: '0.04em' }}>
        dataset: {id}
      </p>
      <p style={{ ...PROSE, fontSize: 13 }}>{description}</p>
    </a>
  )
}

/** Stacked severity/priority tier cards. Shared by every classification section. */
export function SeverityList({ items, badgeFontSize = 15 }: { items: SeverityItem[]; badgeFontSize?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map(t => (
        <div key={t.key} style={{
          ...CARD, padding: '14px 18px',
          display: 'flex', alignItems: 'flex-start', gap: 16,
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 6, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: t.color, border: t.border ?? 'none',
          }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: badgeFontSize, fontWeight: 500, color: t.textColor }}>
              {t.badge}
            </span>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 3 }}>
              <span style={{ fontFamily: 'var(--font-serif)', fontSize: 15, fontWeight: 500, color: '#111111' }}>
                {t.name}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#525252', letterSpacing: '0.04em' }}>
                weight {t.weight}
              </span>
            </div>
            <p style={{ ...PROSE, fontSize: 13 }}>{t.examples}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

/** Recency-decay multiplier card. `note` is the city-specific footnote. */
export function RecencyCard({ note }: { note: React.ReactNode }) {
  return (
    <div style={CARD}>
      <p style={SECTION_HEADER}>Recency multiplier</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {RECENCY_TIERS.map(r => (
          <div key={r.label} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '7px 10px', borderRadius: 6, background: '#FAFAFA', border: '0.5px solid #E5E5E5',
          }}>
            <div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: '#111111' }}>
                {r.label}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#525252', marginLeft: 8 }}>
                {r.desc}
              </span>
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 500, color: r.weight === '0' ? '#6B6B6B' : '#111111' }}>
              {r.weight}
            </span>
          </div>
        ))}
      </div>
      <p style={{ ...PROSE, fontSize: 12, marginTop: 10 }}>
        {note}
      </p>
    </div>
  )
}

/** Neighborhood percentile → risk-level label table (identical thresholds per city). */
export function RiskLevelTable() {
  return (
    <div style={{ ...CARD, padding: 0, overflow: 'hidden' }}>
      {RISK_LEVELS.map((r, i) => (
        <div key={r.label} style={{
          display: 'flex', alignItems: 'center', gap: 16,
          padding: '12px 18px',
          borderBottom: i < RISK_LEVELS.length - 1 ? '0.5px solid #E5E5E5' : 'none',
        }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: r.dot, flexShrink: 0 }} />
          <span style={{ fontFamily: 'var(--font-serif)', fontSize: 14, fontWeight: 500, color: '#111111', width: 76, flexShrink: 0 }}>
            {r.label}
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#525252', letterSpacing: '0.04em', width: 120, flexShrink: 0 }}>
            {r.range}
          </span>
          <p style={{ ...PROSE, fontSize: 13, margin: 0 }}>{r.desc}</p>
        </div>
      ))}
    </div>
  )
}

/**
 * Generic mission block — identical on every city's methodology page. Describes
 * what Stoop is without naming a single city's agencies (those live in the
 * per-city Methodology section below this).
 */
export function MethodologyAbout() {
  return (
    <div style={{ background: '#FFFFFF', borderBottom: '0.5px solid #E5E5E5', padding: '3rem 1.5rem' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        <p style={SECTION_HEADER}>About</p>
        <p style={{
          fontFamily: 'var(--font-serif)', fontSize: 24, fontWeight: 500,
          color: '#111111', letterSpacing: '-0.01em', lineHeight: 1.4,
          maxWidth: 620, margin: '0 0 20px',
        }}>
          Stoop makes the housing data cities already collect useful to the tenants it affects most.
        </p>
        <p style={{ ...PROSE, maxWidth: 620 }}>
          Stoop is a tool for renters that turns public city records into plain-language building
          profiles. Search any address with a complaint history to see its open violations, trends
          over time, and how it ranks against other buildings in the same neighborhood. Stoop
          currently covers New York City and San Francisco &mdash; switch cities from the map or the
          leaderboard. In every city, Stoop pairs what tenants <em>report</em> (housing complaints)
          with what inspectors formally <em>cite</em> (violations); the methodology below explains
          how each city&apos;s raw data becomes the numbers you see.
        </p>
      </div>
    </div>
  )
}

/**
 * Methodology section header: the NYC | SF city switcher, the "Methodology"
 * eyebrow, the "How it works" heading, and the city-specific intro prose
 * (passed as children).
 */
export function MethodologyIntro({
  city,
  children,
}: {
  city: 'NYC' | 'SF'
  children: React.ReactNode
}) {
  return (
    <div style={{ background: '#FAFAFA', padding: '2rem 1.5rem' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        <div style={{ marginBottom: 16 }}>
          <CityToggle current={city} nycHref="/methodology" sfHref="/sf/methodology" />
        </div>
        <p style={SECTION_HEADER}>Methodology</p>
        <h2 style={{
          fontFamily: 'var(--font-serif)', fontSize: 32, fontWeight: 500,
          color: '#111111', letterSpacing: '-0.02em', margin: '0 0 16px', lineHeight: 1.1,
        }}>
          How it works
        </h2>
        {children}
      </div>
    </div>
  )
}
