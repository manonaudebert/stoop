import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getBuilding, getTimeline, getBreakdown, getNeighborhood, ApiError } from '@/lib/api'
import { fmtDate } from '@/lib/fmt'
import BuildingNavBar from '@/components/BuildingNavBar'
import BuildingGate from '@/components/BuildingGate'
import BuildingHero from '@/components/BuildingHero'
import BuildingCrossLinks from '@/components/BuildingCrossLinks'
import InsightCard from '@/components/InsightCard'
import StatCard from '@/components/StatCard'
import Pagination from '@/components/Pagination'
import ComplaintTimeline from '@/components/ComplaintTimeline'
import ComplaintBreakdown from '@/components/ComplaintBreakdown'
import OutcomeCell from '@/components/OutcomeCell'
import RankViz from '@/components/RankViz'
import type { Complaint, TimelinePoint } from '@/lib/types'

// ── helpers ──────────────────────────────────────────────────────────────────

const toTitleCase = (str: string) => str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())


function yearsOnRecord(firstDate: string | null): number {
  if (!firstDate) return 1
  const [y, m, d] = firstDate.split('-').map(Number)
  const days = (Date.now() - new Date(y, m - 1, d).getTime()) / 86400000
  return Math.max(days / 365.25, 1)
}

function tierEyebrow(riskLevel: string | null): { text: string; color: string } {
  if (riskLevel === 'Very high') return { text: 'Loud', color: '#7F1D1D' }
  if (riskLevel === 'High')      return { text: 'High activity', color: '#7F1D1D' }
  if (riskLevel === 'Moderate')  return { text: 'Moderate activity', color: '#525252' }
  if (riskLevel === 'Low')       return { text: 'Low activity', color: '#525252' }
  if (riskLevel === 'Very low')  return { text: 'Quiet', color: '#525252' }
  if (riskLevel === 'Insufficient data') return { text: 'Few complaints', color: '#737373' }
  if (riskLevel === 'Not comparable')    return { text: 'Non-residential', color: '#737373' }
  return { text: riskLevel ?? '', color: '#525252' }
}

// ── inline SVG visualizations ────────────────────────────────────────────────

// Percentile track: 0 (fewest) → 100 (most).
// Shows rate/yr, Nth-pct, and (med. X.X/yr) in a stacked label above the marker.
function ordinal(n: number): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  return `${n}${ ['th','st','nd','rd'][n % 10] ?? 'th' }`
}

function SeverityViz({ rate, percentile, medianRate }: {
  rate: number | null
  percentile: number | null
  medianRate: number | null
}) {
  // Vertical layout (Y = track centre):
  //   y=14  rate label (line 1, 9px)
  //   y=25  percentile label (line 2, 8px)
  //   y=36  median label (line 3, 7.5px)
  //   -- 4px gap --
  //   y=40  stem top
  //   y=50  stem bottom / circle top  (r=5)
  //   y=55  track centre (Y)
  //   y=75  axis labels
  const L = 12, W = 196, Y = 55

  if (percentile === null) {
    return (
      <svg viewBox="0 0 220 76" style={{ width: '100%', height: 'auto', display: 'block' }}>
        <rect x={L} y={Y - 2} width={W} height="4" rx="2" fill="#F5F5F5" />
      </svg>
    )
  }

  const pct     = Math.max(0, Math.min(percentile, 100))
  const markerX = L + (pct / 100) * W

  // Keep labels inside the viewBox at the edges
  const nearLeft  = markerX < L + 28
  const nearRight = markerX > L + W - 28
  const labelX    = nearLeft ? L : nearRight ? L + W : markerX
  const anchor    = nearLeft ? 'start' : nearRight ? 'end' : 'middle'

  return (
    <svg viewBox="0 0 220 86" style={{ width: '100%', height: 'auto', display: 'block' }}>
      {/* Track */}
      <rect x={L} y={Y - 2} width={W} height="4" rx="2" fill="#F5F5F5" />
      {/* Filled portion */}
      <rect x={L} y={Y - 2} width={(pct / 100) * W} height="4" rx="2" fill="#7F1D1D" opacity="0.18" />
      {/* Median tick */}
      <line x1={L + W / 2} y1={Y - 7} x2={L + W / 2} y2={Y + 7} stroke="#D4D4D4" strokeWidth="1" />
      {/* Marker */}
      <circle cx={markerX} cy={Y} r="5" fill="#7F1D1D" />
      {/* Stem — from circle top (Y-5=50) up to y=40, below all labels */}
      <line x1={markerX} y1={Y - 5} x2={markerX} y2={40} stroke="#7F1D1D" strokeWidth="1" />
      {/* Rate — line 1, y=14 */}
      {rate !== null && (
        <text x={labelX} y={14} textAnchor={anchor as 'start' | 'middle' | 'end'}
          fontFamily="'JetBrains Mono'" fontSize="9" fill="#7F1D1D" fontWeight="500">
          {rate.toFixed(1)}/yr
        </text>
      )}
      {/* Percentile — line 2, y=25 */}
      <text x={labelX} y={25} textAnchor={anchor as 'start' | 'middle' | 'end'}
        fontFamily="'JetBrains Mono'" fontSize="8" fill="#7F1D1D" opacity="0.7">
        {ordinal(Math.round(pct))} pct
      </text>
      {/* Median — line 3, y=36 */}
      {medianRate !== null && (
        <text x={labelX} y={36} textAnchor={anchor as 'start' | 'middle' | 'end'}
          fontFamily="'JetBrains Mono'" fontSize="7.5" fill="#A3A3A3">
          (med. {medianRate.toFixed(1)}/yr)
        </text>
      )}
      {/* Axis labels */}
      <text x={L}         y={Y + 20} fontFamily="'JetBrains Mono'" fontSize="7.5" fill="#A3A3A3">fewer</text>
      <text x={L + W / 2} y={Y + 20} textAnchor="middle" fontFamily="'JetBrains Mono'" fontSize="7.5" fill="#A3A3A3">median</text>
      <text x={L + W}     y={Y + 20} textAnchor="end"    fontFamily="'JetBrains Mono'" fontSize="7.5" fill="#A3A3A3">most</text>
    </svg>
  )
}

function niceMax(v: number): number {
  if (v <= 5)  return 5
  if (v <= 10) return 10
  if (v <= 20) return 20
  if (v <= 50) return 50
  return Math.ceil(v / 10) * 10
}

function TrendViz({ timeline }: { timeline: TimelinePoint[] }) {
  const today = new Date()
  const cutoffYear = today.getFullYear() - 5

  const byYear: Record<number, number> = {}
  for (const pt of timeline) {
    const year = parseInt(pt.month.slice(0, 4))
    if (year >= cutoffYear) {
      byYear[year] = (byYear[year] ?? 0) + pt.count
    }
  }

  const years = Object.keys(byYear).map(Number).sort()

  // Layout constants
  const VW = 220, VH = 100
  const PL = 26, PR = 8, PT = 10, PB = 22   // left/right/top/bottom padding
  const baseY = VH - PB                      // y=78  (zero line)
  const topY  = PT                           // y=10  (max line)
  const chartH = baseY - topY               // 68px
  const chartW = VW - PL - PR               // 186px

  if (years.length < 2) {
    return (
      <svg viewBox={`0 0 ${VW} ${VH}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        <line x1={PL} y1={baseY} x2={VW - PR} y2={baseY} stroke="#E5E5E5" strokeWidth="0.5" />
        <text x={PL + chartW / 2} y={topY + chartH / 2 + 4} textAnchor="middle"
          fontFamily="'JetBrains Mono'" fontSize="9" fill="#737373">not enough history</text>
      </svg>
    )
  }

  const vals  = years.map(y => byYear[y])
  const yMax  = niceMax(Math.max(...vals, 1))
  const midVal = yMax / 2

  const toY = (v: number) => baseY - (v / yMax) * chartH
  const toX = (i: number) => PL + (i / (vals.length - 1)) * chartW

  const points  = vals.map((v, i) => ({ x: toX(i), y: toY(v) }))
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ')
  const lastPt  = points[points.length - 1]

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {/* Grid lines */}
      <line x1={PL} y1={topY}       x2={VW - PR} y2={topY}       stroke="#F0F0F0" strokeWidth="0.5" />
      <line x1={PL} y1={toY(midVal)} x2={VW - PR} y2={toY(midVal)} stroke="#F0F0F0" strokeWidth="0.5" />
      <line x1={PL} y1={baseY}      x2={VW - PR} y2={baseY}      stroke="#E5E5E5" strokeWidth="0.5" />

      {/* Y axis labels */}
      <text x={PL - 4} y={topY + 3}        textAnchor="end" fontFamily="'JetBrains Mono'" fontSize="7" fill="#A3A3A3">{yMax}</text>
      <text x={PL - 4} y={toY(midVal) + 3} textAnchor="end" fontFamily="'JetBrains Mono'" fontSize="7" fill="#A3A3A3">{midVal}</text>
      <text x={PL - 4} y={baseY + 3}       textAnchor="end" fontFamily="'JetBrains Mono'" fontSize="7" fill="#A3A3A3">0</text>

      {/* Line + end dot */}
      <path d={linePath} fill="none" stroke="#111111" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx={lastPt.x} cy={lastPt.y} r="2.5" fill="#111111" />

      {/* X labels */}
      <text x={points[0].x} y={baseY + 13} textAnchor="middle" fontFamily="'JetBrains Mono'" fontSize="8" fill="#A3A3A3">
        &apos;{String(years[0]).slice(2)}
      </text>
      <text x={lastPt.x} y={baseY + 13} textAnchor="middle" fontFamily="'JetBrains Mono'" fontSize="8" fill="#A3A3A3">
        &apos;{String(years[years.length - 1]).slice(2)}
      </text>
    </svg>
  )
}

// ── complaint table ───────────────────────────────────────────────────────────

const PRIORITY_DOT: Record<string, string> = {
  A: '#7F1D1D', B: '#E4A11B', C: '#84A98C', D: '#D4D4D4',
}

const PRIORITY_BADGE: Record<string, { bg: string; text: string; border?: string }> = {
  A: { bg: '#7F1D1D', text: '#FFFFFF' },
  B: { bg: '#FEF3C7', text: '#92400E' },
  C: { bg: '#D1FAE5', text: '#065F46' },
  D: { bg: '#FFFFFF',  text: '#111111', border: '0.5px solid #E5E5E5' },
}

function PriorityBadge({ priority }: { priority: string | null }) {
  if (!priority) return null
  const s = PRIORITY_BADGE[priority] ?? { bg: '#F5F5F5', text: '#525252' }
  return (
    <span style={{
      fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500,
      letterSpacing: '0.05em', textTransform: 'uppercase',
      padding: '3px 8px', borderRadius: 4,
      background: s.bg, color: s.text, border: s.border ?? 'none', whiteSpace: 'nowrap',
    }}>
      {priority}
    </span>
  )
}

function ComplaintRow({ c }: { c: Complaint }) {
  const dot = PRIORITY_DOT[c.category_priority ?? ''] ?? '#D4D4D4'
  const isActive = c.status === 'ACTIVE'
  return (
    <tr style={{ borderBottom: '0.5px solid #E5E5E5' }}>
      <td style={{ width: 4, padding: 0, background: dot }} />
      <td style={{ padding: '11px 14px', fontFamily: 'var(--font-mono)', fontSize: 12, color: '#737373', whiteSpace: 'nowrap' }}>
        {fmtDate(c.date_entered)}
      </td>
      <td style={{ padding: '11px 14px', maxWidth: 280 }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: '#111111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', margin: 0 }}>
          {c.category_description ?? c.complaint_category ?? '—'}
        </p>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#737373', marginTop: 1, margin: 0 }}>
          {c.complaint_category}
        </p>
      </td>
      <td style={{ padding: '11px 14px' }}>
        <PriorityBadge priority={c.category_priority} />
      </td>
      <td style={{ padding: '11px 14px' }}>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500,
          letterSpacing: '0.05em', textTransform: 'uppercase',
          padding: '3px 8px', borderRadius: 4,
          background: isActive ? '#7F1D1D' : '#FFFFFF',
          color: isActive ? '#FFFFFF' : '#111111',
          border: isActive ? 'none' : '0.5px solid #E5E5E5',
        }}>
          {c.status ?? '—'}
        </span>
      </td>
      <td style={{ padding: '11px 14px', fontFamily: 'var(--font-mono)', fontSize: 12, color: '#737373', whiteSpace: 'nowrap' }}>
        {fmtDate(c.disposition_date)}
      </td>
      <td style={{ padding: '11px 14px' }}>
        <OutcomeCell description={c.disposition_description} code={c.disposition_code} />
      </td>
    </tr>
  )
}

// ── page ──────────────────────────────────────────────────────────────────────

export default async function BuildingPage({
  params,
  searchParams,
}: {
  params: Promise<{ bin: string }>
  searchParams: Promise<{ page?: string; status?: string; category?: string; from?: string; bw?: string }>
}) {
  const { bin } = await params
  const { page: pageStr, status, category, from, bw } = await searchParams
  const page = Number(pageStr ?? 1)
  const breakdownYears = bw === '5yr' ? 5 : undefined

  let building, timeline, breakdown, neighborhood
  try {
    ;[building, timeline, breakdown] = await Promise.all([
      getBuilding(bin, page, status, category),
      getTimeline(bin),
      getBreakdown(bin, breakdownYears),
    ])
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound()
    throw err
  }
  neighborhood = await getNeighborhood(bin)

  const backHref  = from === 'leaderboard' ? '/leaderboard' : '/'
  const backLabel = from === 'leaderboard' ? '← Leaderboard' : '← Map'
  const eyebrow = tierEyebrow(building.risk_level)

  // ── empty state ──────────────────────────────────────────────────────────
  if (building.total_complaints === 0) {
    return (
      <div style={{ minHeight: '100vh', background: '#FAFAFA' }}>
        <BuildingNavBar backHref={backHref} backLabel={backLabel} />
        <BuildingGate bin={bin}>
          <div style={{ maxWidth: 1260, margin: '0 auto', padding: '32px 24px 0' }}>
            <BuildingHero
              address={building.address ?? ''}
              meta={[building.borough, `ZIP ${building.zip_code}`, `BIN ${building.bin}`, building.construction_year && `Built ${building.construction_year}`].filter(Boolean).join(' · ')}
              explainerLabel="Data Source: NYC Department of Buildings"
              explainerText="NYC Department of Buildings (DOB) oversees construction and building safety across NYC. Complaints may relate to unsafe construction, structural concerns, illegal work, or building code violations reported by residents, inspectors, or 311."
              badge={<div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#737373', marginBottom: 6 }}>Few complaints</div>}
              bordered
            />
          </div>
          <main style={{ maxWidth: 640, margin: '0 auto', padding: '4rem 1.5rem', textAlign: 'center' }}>
            <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 28, fontWeight: 500, color: '#111111', letterSpacing: '-0.02em', margin: '0 0 16px' }}>
              No complaints on record
            </h2>
            <p style={{ fontSize: 15, color: '#525252', lineHeight: 1.7, marginBottom: 32 }}>
              This doesn&apos;t mean no issues have ever existed — complaints may have been filed under a different BIN,
              before electronic records began in 2007, or may be tracked by a different agency such as HPD.
              If you have concerns about this building, check HPD&apos;s building records at hpdonline.nyc.gov.
            </p>
            <a
              href="https://hpdonline.nyc.gov"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                fontSize: 13, fontWeight: 500, padding: '10px 20px',
                background: '#111111', color: '#FFFFFF', borderRadius: 8, textDecoration: 'none',
              }}
            >
              View on HPD Online
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
            </a>
          </main>
        </BuildingGate>
      </div>
    )
  }

  const totalPages = Math.ceil(building.total_count / building.page_size)

  function pageUrl(p: number) {
    const sp = new URLSearchParams()
    sp.set('page', String(p))
    if (status) sp.set('status', status)
    if (category) sp.set('category', category)
    return `/dob/building/${bin}?${sp}`
  }

  // ── insight card data ────────────────────────────────────────────────────
  const ntaName        = building.nta_name ?? neighborhood?.nta_name ?? 'this neighborhood'
  const years          = Math.round(yearsOnRecord(building.first_complaint_date))
  const firstYear      = building.first_complaint_date?.slice(0, 4) ?? null
  const rl             = building.risk_level
  const insufficient   = rl === 'Insufficient data'
  const notComparable  = rl === 'Not comparable'

  // Card 1: Severity
  const headline1 = insufficient  ? 'Very few serious complaints on record'
    : notComparable              ? 'Serious complaint rate not available'
    : (building.serious_rate_percentile ?? 0) >= 90 ? 'Among the highest rates of serious complaints nearby'
    : (building.serious_rate_percentile ?? 0) >= 70 ? 'More serious complaints than most buildings nearby'
    : (building.serious_rate_percentile ?? 0) >= 40 ? 'About as many serious complaints as similar buildings'
    : 'Fewer serious complaints than most buildings nearby'
  const sub1 = insufficient
    ? `${building.priority_ab_complaints} Priority A and B complaint${building.priority_ab_complaints !== 1 ? 's' : ''} on record — not enough to establish a rate.`
    : notComparable
    ? 'This building is not in a residential NTA and cannot be compared to residential peers.'
    : `${building.priority_ab_complaints} Priority A and B complaints over ${years} year${years !== 1 ? 's' : ''} — ${(building.serious_rate ?? 0).toFixed(1)} per year on average.`

  // Card 2: Trend
  const headline2 = insufficient  ? 'Very little complaint activity on record'
    : notComparable              ? 'Trend analysis not available'
    : building.trend_direction === 'improving' ? 'Complaints have decreased in recent years'
    : building.trend_direction === 'worsening' ? 'Complaints have increased in the last 2 years'
    : 'Complaint rate has been consistent over time'

  const recent2 = building.recent_complaint_count ?? 0
  const prior3  = building.prior_complaint_count  ?? 0
  const prior2  = Math.round(prior3 * 2 / 3)   // normalise prior 3-yr window → 2-yr equiv for fair comparison

  const sub2 = insufficient
    ? `${recent2} complaint${recent2 !== 1 ? 's' : ''} in the last 2 years.`
    : notComparable
    ? 'Complaint trends are only tracked for residential buildings.'
    : prior2 === 0
    ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: recent2 > 0 ? '#92400E' : '#A3A3A3' }}>
        {recent2 > 0 ? '↑ Rising — no prior history' : '— No trend data'}
      </span>
    : (() => {
        const pct = Math.round(((recent2 - prior2) / prior2) * 100)
        const counts = `(${recent2} vs ${prior2} prior 2 yrs)`
        const [arrow, label, color] = pct >= 10
          ? ['↑', `Up ${pct}% in the last 2 years`, '#7F1D1D']
          : pct <= -10
          ? ['↓', `Down ${Math.abs(pct)}% in the last 2 years`, '#166534']
          : ['→', 'Stable in the last 2 years', '#737373']
        return (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color }}>
            {arrow} {label} {counts}
          </span>
        )
      })()

  // Card 3: Rank
  const headline3 = insufficient  ? `Too few complaints to rank against ${ntaName}`
    : notComparable              ? 'Neighborhood comparison not available'
    : (building.neighborhood_percentile ?? 0) >= 90 ? `Among the most complained-about buildings in ${ntaName}`
    : (building.neighborhood_percentile ?? 0) >= 70 ? `Worse than most buildings in ${ntaName}`
    : (building.neighborhood_percentile ?? 0) >= 40 ? `About average for ${ntaName}`
    : `Better than most buildings in ${ntaName}`
  const sub3 = insufficient
    ? 'Buildings need at least 10 complaints and 2 years of history to rank.'
    : notComparable
    ? 'This building is in a park, airport, cemetery, or other non-residential area.'
    : `More complaints than ${Math.round(building.neighborhood_percentile!)}% of residential buildings in ${ntaName} over the last 10 years.`

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: '#FAFAFA' }}>

      <BuildingNavBar backHref={backHref} backLabel={backLabel} />
      <BuildingGate bin={bin}>

      <main style={{ maxWidth: 1260, margin: '0 auto', padding: '32px 24px 80px' }}>

        <BuildingCrossLinks items={[
          { label: 'Building Safety' },
          { label: 'Housing Conditions', href: `/hpd/building/${bin}` },
        ]} />

        <BuildingHero
          address={building.address ?? ''}
          meta={[
            building.borough,
            `ZIP ${building.zip_code}`,
            `BIN ${building.bin}`,
            neighborhood?.nta_name,
            building.first_complaint_date && `On record since ${fmtDate(building.first_complaint_date)}`,
            building.construction_year && `Built ${building.construction_year}`,
          ].filter(Boolean).join(' · ')}
          explainerLabel="Data Source: NYC Department of Buildings"
          explainerText="NYC Department of Buildings (DOB) oversees construction and building safety across NYC. Complaints may relate to unsafe construction, structural concerns, illegal work, or building code violations reported by residents, inspectors, or 311."
          bordered
        />

        {/* Three insight cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 12 }}>
          <InsightCard eyebrow="Neighborhood" aside={ntaName.length > 22 ? ntaName.slice(0, 22) + '…' : ntaName} headline={headline3} sub={sub3}>
            <RankViz percentile={notComparable || insufficient ? null : building.neighborhood_percentile} />
          </InsightCard>
          <InsightCard eyebrow="Activity Trends" aside="Last 5 years" headline={headline2} sub={sub2}>
            <TrendViz timeline={timeline} />
          </InsightCard>
          <InsightCard eyebrow="Complaint Severity" aside="Last 10 years" headline={headline1} sub={sub1} tooltip="DOB complaints are prioritized from Priority A (most urgent safety concerns) through lower-priority categories based on severity and potential public risk. The chart shows this building's Priority A+B rate per year relative to other residential buildings in the same neighborhood, based on the last 10 years of complaints.">
            <SeverityViz
              rate={insufficient || notComparable ? null : building.serious_rate}
              percentile={insufficient || notComparable ? null : building.serious_rate_percentile}
              medianRate={insufficient || notComparable ? null : (neighborhood?.median_serious_rate ?? null)}
            />
          </InsightCard>
        </div>

        {/* KPI stat cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 12 }}>
          <StatCard label={firstYear ? `Total complaints since ${firstYear}` : 'Total complaints'} value={building.total_complaints} />
          <StatCard label="Active"           value={building.open_complaints} />
          <StatCard label="Priority A"       value={building.priority_a_complaints} tooltip="The highest-severity DOB complaints, alleging conditions that present an imminent risk to public safety (e.g., structural instability, collapse risk, shaking buildings). DOB's target is to inspect within 24 hours. Count includes all complaints ever filed, not just active ones." />
          <StatCard label="Priority A+B"     value={building.priority_ab_complaints} tooltip="Combined count of Priority A complaints (imminent safety risks, 24-hour target) and Priority B complaints (serious but non-imminent, e.g., illegal conversions, work without a permit, inadequate scaffolding, 40-day target). Includes all complaints ever filed." />
        </div>

        {/* Chart cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 12, padding: '20px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#525252' }}>
                Complaints over time
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#737373' }}>monthly</span>
            </div>
            <ComplaintTimeline
              data={timeline}
              firstDate={building.first_complaint_date}
              lastDate={building.latest_complaint_date}
            />
          </div>
          <div style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 12, padding: '20px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#525252' }}>
                Top complaint types
              </span>
              <div style={{ display: 'flex', gap: 4 }}>
                <Link
                  href={`/dob/building/${bin}?bw=5yr`}
                  scroll={false}
                  style={{
                    fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500,
                    padding: '4px 9px', borderRadius: 6, textDecoration: 'none',
                    background: bw === '5yr' ? '#111111' : 'transparent',
                    color: bw === '5yr' ? '#FFFFFF' : '#737373',
                    border: bw === '5yr' ? 'none' : '0.5px solid #D4D4D4',
                  }}
                >
                  5 yrs
                </Link>
                <Link
                  href={`/dob/building/${bin}`}
                  scroll={false}
                  style={{
                    fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500,
                    padding: '4px 9px', borderRadius: 6, textDecoration: 'none',
                    background: !bw ? '#111111' : 'transparent',
                    color: !bw ? '#FFFFFF' : '#737373',
                    border: !bw ? 'none' : '0.5px solid #D4D4D4',
                  }}
                >
                  All time
                </Link>
              </div>
            </div>
            <ComplaintBreakdown data={breakdown} />
          </div>
        </div>

        {/* Complaint log */}
        <div style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 12 }}>

          {/* Log header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem', borderBottom: '0.5px solid #E5E5E5' }}>
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#525252' }}>
                Complaint log
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 24, fontWeight: 500, color: '#111111', letterSpacing: '-0.02em', marginTop: 2, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                {building.total_count.toLocaleString()}
                <span style={{ fontSize: 13, color: '#737373', fontWeight: 400, letterSpacing: 0, marginLeft: 6 }}>total</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <Link
                href={`/dob/building/${bin}?status=ACTIVE`}
                style={{
                  fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500,
                  padding: '7px 12px', borderRadius: 8, textDecoration: 'none',
                  background: status === 'ACTIVE' ? '#111111' : 'transparent',
                  color: status === 'ACTIVE' ? '#FFFFFF' : '#111111',
                  border: status === 'ACTIVE' ? 'none' : '0.5px solid #A3A3A3',
                  letterSpacing: '0.02em',
                }}
              >
                Active only
              </Link>
              <Link
                href={`/dob/building/${bin}`}
                style={{
                  fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500,
                  padding: '7px 12px', borderRadius: 8, textDecoration: 'none',
                  background: !status ? '#111111' : 'transparent',
                  color: !status ? '#FFFFFF' : '#111111',
                  border: !status ? 'none' : '0.5px solid #A3A3A3',
                  letterSpacing: '0.02em',
                }}
              >
                All
              </Link>
            </div>
          </div>

          {/* Table */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '0.5px solid #E5E5E5', background: '#FAFAFA' }}>
                  <th style={{ width: 4, padding: 0 }} />
                  {['Date', 'Complaint type', 'Priority', 'Status', 'Closed', 'Outcome'].map(h => (
                    <th key={h} style={{
                      padding: '9px 14px',
                      fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500,
                      color: '#737373', letterSpacing: '0.1em', textTransform: 'uppercase',
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {building.complaints.map(c => <ComplaintRow key={c.id} c={c} />)}
              </tbody>
            </table>
          </div>

          <Pagination page={page} totalPages={totalPages} prevHref={pageUrl(page - 1)} nextHref={pageUrl(page + 1)} />
        </div>

      </main>
      </BuildingGate>
    </div>
  )
}
