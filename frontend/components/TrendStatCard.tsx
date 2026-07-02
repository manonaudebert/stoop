import type { TimelinePoint } from '@/lib/types'

// A "total since <year>" KPI card with a derived per-year average and a 2-year
// trend line. The noun (e.g. "violations", "complaints") is interpolated into
// the title so the same card serves any dataset and any city.
type Props = {
  noun: string
  total: number
  timeline: TimelinePoint[]
}

export default function TrendStatCard({ noun, total, timeline }: Props) {
  const now = new Date()
  const firstYear = timeline.length > 0 ? parseInt(timeline[0].month.slice(0, 4)) : now.getFullYear()
  const yearsSpanned = now.getFullYear() - firstYear + 1
  const avgPerYearRaw = yearsSpanned > 0 ? total / yearsSpanned : 0
  const avgPerYear = Math.round(avgPerYearRaw)
  const avgPerYearDisplay = avgPerYearRaw > 0 && avgPerYearRaw < 1 ? '<1' : avgPerYear.toLocaleString()

  const twoYearsAgo  = `${now.getFullYear() - 2}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const fourYearsAgo = `${now.getFullYear() - 4}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const recent = timeline.filter(p => p.month >= twoYearsAgo).reduce((s, p) => s + p.count, 0)
  const prior  = timeline.filter(p => p.month >= fourYearsAgo && p.month < twoYearsAgo).reduce((s, p) => s + p.count, 0)

  let trendLabel: string
  let trendColor: string
  if (avgPerYear < 2) {
    trendLabel = '— Not enough history to determine trend'
    trendColor = '#6B6B6B'
  } else if (prior === 0) {
    trendLabel = recent > 0 ? '↑ Rising — no prior history' : '— No trend data'
    trendColor = recent > 0 ? '#92400E' : '#6B6B6B'
  } else {
    const pct = Math.round(((recent - prior) / prior) * 100)
    const counts = `(${recent.toLocaleString()} vs ${prior.toLocaleString()} prior 2 yrs)`
    if (pct >= 10)       { trendLabel = `↑ Up ${pct}% in the last 2 years ${counts}`;             trendColor = '#7F1D1D' }
    else if (pct <= -10) { trendLabel = `↓ Down ${Math.abs(pct)}% in the last 2 years ${counts}`; trendColor = '#166534' }
    else                 { trendLabel = '→ Stable in the last 2 years';                            trendColor = '#737373' }
  }

  return (
    <div style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 12, padding: '18px 20px' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#525252', marginBottom: 8 }}>
        Total {noun} since {firstYear}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 32, fontWeight: 500, color: '#111111', lineHeight: 1, fontVariantNumeric: 'tabular-nums', marginBottom: 14 }}>
        {total.toLocaleString()}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#525252' }}>
          {avgPerYearDisplay} per year avg.
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: trendColor }}>
          {trendLabel}
        </span>
      </div>
    </div>
  )
}
