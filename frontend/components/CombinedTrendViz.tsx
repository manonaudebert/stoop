import type { TimelinePoint } from '@/lib/types'

// Two-series sparkline over the last 5 years. Series A renders as a solid line,
// series B as a dashed line. Labels and accent colors are configurable so the
// same chart works for any pair of datasets (e.g. NYC HPD violations vs.
// complaints, or SF DBI violations vs. 311 complaints).
//
// By default it buckets by calendar year and needs ≥2 distinct years to draw.
// `adaptiveBuckets` adds a monthly fallback: when fewer than 2 years of data
// exist but the activity still spans multiple months, it plots a month-level
// line instead of giving up. This matters for SF DBI data, which is filed in
// bursts (many NOV line-items on a handful of dates within a single year), so
// year-bucketing would otherwise report "not enough history" for a building
// that clearly has plottable recent activity.
type Props = {
  seriesA: TimelinePoint[]
  seriesB: TimelinePoint[]
  labelA?: string
  labelB?: string
  colorA?: string
  colorB?: string
  adaptiveBuckets?: boolean
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function Legend({ labelA, labelB, colorA, colorB }: { labelA: string; labelB: string; colorA: string; colorB: string }) {
  // labelA swatch (0–10) + gap, its text from x=13, then a gap before labelB's
  // swatch. ~5px per monospace char at 8px keeps the two items from overlapping.
  const legendBX = 13 + labelA.length * 5 + 14
  return (
    <>
      <line x1="0" y1="68" x2="10" y2="68" stroke={colorA} strokeWidth="1.5" />
      <text x="13" y="71" fontFamily="'JetBrains Mono'" fontSize="8" fill="#525252">{labelA}</text>
      <line x1={legendBX} y1="68" x2={legendBX + 10} y2="68" stroke={colorB} strokeWidth="1.5" strokeDasharray="4 2" />
      <text x={legendBX + 13} y="71" fontFamily="'JetBrains Mono'" fontSize="8" fill="#525252">{labelB}</text>
    </>
  )
}

function NotEnoughHistory() {
  return (
    <svg viewBox="0 0 220 76" style={{ width: '100%', height: 'auto', display: 'block' }}>
      <line x1="0" y1="48" x2="220" y2="48" stroke="#E5E5E5" strokeWidth="0.5" />
      <text x="110" y="30" textAnchor="middle" fontFamily="'JetBrains Mono'" fontSize="9" fill="#737373">not enough history</text>
    </svg>
  )
}

export default function CombinedTrendViz({
  seriesA,
  seriesB,
  labelA = 'Violations',
  labelB = 'Complaints',
  colorA = '#7F1D1D',
  colorB = '#1D4ED8',
  adaptiveBuckets = false,
}: Props) {
  const cutoffYear = new Date().getFullYear() - 5

  // ── bucket by year (default) ───────────────────────────────────────────────
  const aByYear: Record<string, number> = {}
  const bByYear: Record<string, number> = {}
  for (const pt of seriesA) {
    const y = pt.month.slice(0, 4)
    if (parseInt(y) >= cutoffYear) aByYear[y] = (aByYear[y] ?? 0) + pt.count
  }
  for (const pt of seriesB) {
    const y = pt.month.slice(0, 4)
    if (parseInt(y) >= cutoffYear) bByYear[y] = (bByYear[y] ?? 0) + pt.count
  }
  const years = Array.from(new Set([...Object.keys(aByYear), ...Object.keys(bByYear)])).sort()

  // Choose the bucket granularity: years when we have ≥2, else fall back to
  // months if the caller opted in and there are ≥2 distinct months.
  let keys: string[]
  let aMap: Record<string, number>
  let bMap: Record<string, number>
  let firstLabel: string
  let lastLabel: string

  const monthLabel = (m: string) => `${MONTH_ABBR[parseInt(m.slice(5, 7)) - 1]} '${m.slice(2, 4)}`

  if (years.length >= 2) {
    keys = years
    aMap = aByYear
    bMap = bByYear
    firstLabel = `'${years[0].slice(2)}`
    lastLabel  = `'${years[years.length - 1].slice(2)}`
  } else if (adaptiveBuckets) {
    const cutoffMonth = `${cutoffYear}-01`
    const aByMonth: Record<string, number> = {}
    const bByMonth: Record<string, number> = {}
    for (const pt of seriesA) if (pt.month >= cutoffMonth) aByMonth[pt.month] = (aByMonth[pt.month] ?? 0) + pt.count
    for (const pt of seriesB) if (pt.month >= cutoffMonth) bByMonth[pt.month] = (bByMonth[pt.month] ?? 0) + pt.count
    const months = Array.from(new Set([...Object.keys(aByMonth), ...Object.keys(bByMonth)])).sort()
    if (months.length === 0) return <NotEnoughHistory />
    keys = months
    aMap = aByMonth
    bMap = bByMonth
    firstLabel = monthLabel(months[0])
    lastLabel  = monthLabel(months[months.length - 1])
  } else {
    return <NotEnoughHistory />
  }

  const aVals = keys.map(k => aMap[k] ?? 0)
  const bVals = keys.map(k => bMap[k] ?? 0)
  const maxVal = Math.max(...aVals, ...bVals, 1)
  const baseY = 50
  const padX = 8
  const legend = <Legend labelA={labelA} labelB={labelB} colorA={colorA} colorB={colorB} />

  // ── single bucket: all activity in one period → no line to draw, so mark each
  // non-zero series with a dot + its count at one centered point. Common for SF,
  // where a whole inspection's NOVs are filed on a single date.
  if (keys.length === 1) {
    const cx = 110
    const yFor = (v: number) => baseY - Math.round((v / maxVal) * (baseY - 10))
    const markers = [
      { v: aVals[0], color: colorA },
      { v: bVals[0], color: colorB },
    ].filter(m => m.v > 0)
    return (
      <svg viewBox="0 0 220 76" style={{ width: '100%', height: 'auto', display: 'block' }}>
        <line x1="0" y1={baseY} x2="220" y2={baseY} stroke="#E5E5E5" strokeWidth="0.5" />
        {markers.map((m, i) => (
          <g key={i}>
            <line x1={cx} y1={baseY} x2={cx} y2={yFor(m.v)} stroke={m.color} strokeWidth="1" opacity="0.4" />
            <circle cx={cx} cy={yFor(m.v)} r="3" fill={m.color} />
            <text x={cx + 7} y={yFor(m.v) + 3} textAnchor="start" fontFamily="'JetBrains Mono'" fontSize="9" fontWeight="500" fill={m.color}>
              {m.v}
            </text>
          </g>
        ))}
        <text x={cx} y={baseY + 10} textAnchor="middle" fontFamily="'JetBrains Mono'" fontSize="8" fill="#6B6B6B">
          {firstLabel}
        </text>
        {legend}
      </svg>
    )
  }

  function pts(vals: number[]) {
    return vals.map((v, i) => ({
      x: padX + (i / (keys.length - 1)) * (220 - 2 * padX),
      y: baseY - Math.round((v / maxVal) * (baseY - 10)),
    }))
  }

  const aPts = pts(aVals)
  const bPts = pts(bVals)
  const aPath = aPts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ')
  const bPath = bPts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ')
  const firstX = aPts[0].x
  const lastX  = aPts[aPts.length - 1].x

  return (
    <svg viewBox="0 0 220 76" style={{ width: '100%', height: 'auto', display: 'block' }}>
      <line x1="0" y1={baseY} x2="220" y2={baseY} stroke="#E5E5E5" strokeWidth="0.5" />
      <path d={aPath} fill="none" stroke={colorA} strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx={aPts[aPts.length - 1].x} cy={aPts[aPts.length - 1].y} r="2.5" fill={colorA} />
      <path d={bPath} fill="none" stroke={colorB} strokeWidth="1.5" strokeLinejoin="round" strokeDasharray="4 2" />
      <circle cx={bPts[bPts.length - 1].x} cy={bPts[bPts.length - 1].y} r="2.5" fill={colorB} />
      <text x={firstX} y={baseY + 10} textAnchor="middle" fontFamily="'JetBrains Mono'" fontSize="8" fill="#6B6B6B">
        {firstLabel}
      </text>
      <text x={lastX} y={baseY + 10} textAnchor="middle" fontFamily="'JetBrains Mono'" fontSize="8" fill="#6B6B6B">
        {lastLabel}
      </text>
      {legend}
    </svg>
  )
}
