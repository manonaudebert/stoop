import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getBuilding, getTimeline, getBreakdown, getNeighborhood, ApiError } from '@/lib/api'
import BuildingNavBar from '@/components/BuildingNavBar'
import BuildingGate from '@/components/BuildingGate'
import ComplaintTimeline from '@/components/ComplaintTimeline'
import ComplaintBreakdown from '@/components/ComplaintBreakdown'
import OutcomeCell from '@/components/OutcomeCell'
import type { Complaint, TimelinePoint } from '@/lib/types'

// ── helpers ──────────────────────────────────────────────────────────────────

const toTitleCase = (str: string) => str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  try {
    const [y, m, d] = dateStr.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    })
  } catch { return dateStr }
}

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

// Fixed dot positions for the distribution chart (right-skewed, most buildings = few serious complaints)
const DIST_DOTS: Array<{ x: number; y: number }> = [
  { x: 6, y: 42 }, { x: 12, y: 40 }, { x: 18, y: 38 }, { x: 24, y: 34 }, { x: 30, y: 32 },
  { x: 36, y: 28 }, { x: 42, y: 32 }, { x: 48, y: 36 }, { x: 54, y: 34 },
  { x: 60, y: 38 }, { x: 66, y: 36 }, { x: 74, y: 40 }, { x: 84, y: 38 },
  { x: 94, y: 40 }, { x: 106, y: 42 }, { x: 118, y: 40 }, { x: 130, y: 42 },
  { x: 144, y: 42 }, { x: 158, y: 42 }, { x: 174, y: 42 }, { x: 186, y: 42 },
]

function SeverityViz({ count }: { count: number }) {
  const markerX = Math.min(Math.max((count / 30) * 218 + 2, 6), 214)
  return (
    <svg viewBox="0 0 220 64" style={{ width: '100%', height: 'auto', display: 'block' }}>
      <line x1="0" y1="44" x2="220" y2="44" stroke="#E5E5E5" strokeWidth="0.5" />
      <g fill="#737373" opacity="0.5">
        {DIST_DOTS.map(({ x, y }, i) => (
          <circle key={i} cx={x} cy={y} r="1.6" />
        ))}
      </g>
      <line x1={markerX} y1="20" x2={markerX} y2="44" stroke="#7F1D1D" strokeWidth="1.5" />
      <circle cx={markerX} cy="42" r="3.5" fill="#7F1D1D" />
      <text x={markerX} y="14" textAnchor="middle" fontFamily="'JetBrains Mono'" fontSize="9" fill="#7F1D1D" fontWeight="500">{count}</text>
      <text x="2" y="58" fontFamily="'JetBrains Mono'" fontSize="8" fill="#737373">0</text>
      <text x="110" y="58" textAnchor="middle" fontFamily="'JetBrains Mono'" fontSize="8" fill="#737373">median</text>
      <text x="218" y="58" textAnchor="end" fontFamily="'JetBrains Mono'" fontSize="8" fill="#737373">30+</text>
    </svg>
  )
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
  if (years.length < 2) {
    return (
      <svg viewBox="0 0 220 64" style={{ width: '100%', height: 'auto', display: 'block' }}>
        <line x1="0" y1="48" x2="220" y2="48" stroke="#E5E5E5" strokeWidth="0.5" />
        <text x="110" y="30" textAnchor="middle" fontFamily="'JetBrains Mono'" fontSize="9" fill="#737373">not enough history</text>
      </svg>
    )
  }

  const vals = years.map(y => byYear[y])
  const maxVal = Math.max(...vals, 1)
  const baseY = 48
  const padX = 8

  const points = vals.map((v, i) => ({
    x: padX + (i / (vals.length - 1)) * (220 - 2 * padX),
    y: baseY - Math.round((v / maxVal) * (baseY - 12)),
  }))

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ')
  const areaPath = `${linePath} L ${points[points.length - 1].x},${baseY} L ${points[0].x},${baseY} Z`

  const peakIdx = vals.indexOf(Math.max(...vals))
  const peakPt = points[peakIdx]
  const lastPt = points[points.length - 1]

  return (
    <svg viewBox="0 0 220 64" style={{ width: '100%', height: 'auto', display: 'block' }}>
      <line x1="0" y1={baseY} x2="220" y2={baseY} stroke="#E5E5E5" strokeWidth="0.5" />
      <path d={areaPath} fill="#111111" opacity="0.08" />
      <path d={linePath} fill="none" stroke="#111111" strokeWidth="1.25" strokeLinejoin="round" />
      <circle cx={lastPt.x} cy={lastPt.y} r="3" fill="#111111" />
      <text x={peakPt.x} y={Math.min(peakPt.y - 5, 10)} textAnchor="middle" fontFamily="'JetBrains Mono'" fontSize="9" fill="#525252">
        peak: {Math.max(...vals)}
      </text>
      <text x={points[0].x} y="62" textAnchor="middle" fontFamily="'JetBrains Mono'" fontSize="8" fill="#737373">
        &apos;{String(years[0]).slice(2)}
      </text>
      <text x={lastPt.x} y="62" textAnchor="middle" fontFamily="'JetBrains Mono'" fontSize="8" fill="#737373">
        &apos;{String(years[years.length - 1]).slice(2)}
      </text>
    </svg>
  )
}

function RankViz({ percentile }: { percentile: number | null }) {
  if (percentile == null) {
    return (
      <svg viewBox="0 0 220 64" style={{ width: '100%', height: 'auto', display: 'block' }}>
        <line x1="0" y1="29" x2="220" y2="29" stroke="#E5E5E5" strokeWidth="6" strokeLinecap="round" />
        <text x="110" y="50" textAnchor="middle" fontFamily="'JetBrains Mono'" fontSize="9" fill="#737373">not comparable</text>
      </svg>
    )
  }

  const markerX = Math.min(Math.max((percentile / 100) * 220, 6), 214)

  return (
    <svg viewBox="0 0 220 64" style={{ width: '100%', height: 'auto', display: 'block' }}>
      <rect x="0"   y="26" width="44" height="6" fill="#84A98C" opacity="0.45" />
      <rect x="44"  y="26" width="44" height="6" fill="#84A98C" opacity="0.7" />
      <rect x="88"  y="26" width="44" height="6" fill="#E4A11B" opacity="0.6" />
      <rect x="132" y="26" width="44" height="6" fill="#E4A11B" opacity="0.85" />
      <rect x="176" y="26" width="44" height="6" fill="#7F1D1D" opacity="0.7" />
      <line x1={markerX} y1="18" x2={markerX} y2="40" stroke="#111111" strokeWidth="1.5" />
      <circle cx={markerX} cy="29" r="4" fill="#FFFFFF" stroke="#111111" strokeWidth="1.5" />
      <text x="2"   y="52" fontFamily="'JetBrains Mono'" fontSize="8" fill="#737373">quietest</text>
      <text x="218" y="52" textAnchor="end" fontFamily="'JetBrains Mono'" fontSize="8" fill="#737373">loudest</text>
    </svg>
  )
}

// ── insight card ──────────────────────────────────────────────────────────────

function InsightCard({
  eyebrow, aside, headline, sub, children,
}: {
  eyebrow: string; aside?: string; headline: string; sub: string; children?: React.ReactNode
}) {
  return (
    <div style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 12, padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#525252' }}>
          {eyebrow}
        </span>
        {aside && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#737373' }}>
            {aside}
          </span>
        )}
      </div>
      <div style={{ fontSize: 15, fontWeight: 500, color: '#111111', marginBottom: 4, lineHeight: 1.3 }}>
        {headline}
      </div>
      <div style={{ fontSize: 12, color: '#525252', marginBottom: 16, lineHeight: 1.5 }}>
        {sub}
      </div>
      {children}
    </div>
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
        {formatDate(c.date_entered)}
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
        {formatDate(c.disposition_date)}
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
  searchParams: Promise<{ page?: string; status?: string; category?: string; from?: string }>
}) {
  const { bin } = await params
  const { page: pageStr, status, category, from } = await searchParams
  const page = Number(pageStr ?? 1)

  let building, timeline, breakdown, neighborhood
  try {
    ;[building, timeline, breakdown] = await Promise.all([
      getBuilding(bin, page, status, category),
      getTimeline(bin),
      getBreakdown(bin),
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
          <div style={{ padding: '40px 32px 36px', background: '#FAFAFA', borderBottom: '0.5px solid #E5E5E5' }}>
            <div style={{ maxWidth: 1260, margin: '0 auto' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#737373', marginBottom: 6 }}>
                Few complaints
              </div>
              <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 44, fontWeight: 500, color: '#111111', letterSpacing: '-0.02em', lineHeight: 1.05, margin: 0 }}>
                {toTitleCase(building.address ?? '')}
              </h1>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#525252', marginTop: 8 }}>
                {building.borough} · ZIP {building.zip_code} · BIN {building.bin}
                {building.construction_year && ` · Built ${building.construction_year}`}
              </p>
            </div>
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
    return `/building/${bin}?${sp}`
  }

  // ── insight card data ────────────────────────────────────────────────────
  const ntaName        = building.nta_name ?? neighborhood?.nta_name ?? 'this neighborhood'
  const years          = Math.round(yearsOnRecord(building.first_complaint_date))
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
  const sub2 = insufficient
    ? `${building.recent_complaint_count ?? 0} complaint${(building.recent_complaint_count ?? 0) !== 1 ? 's' : ''} in the last 2 years.`
    : notComparable
    ? 'Complaint trends are only tracked for residential buildings.'
    : `${building.recent_complaint_count} in the last 2 years vs ${building.prior_complaint_count} in the 3 years before.`

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
    : `More complaints than ${Math.round(building.neighborhood_percentile!)}% of residential buildings in ${ntaName}.`

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: '#FAFAFA' }}>

      <BuildingNavBar backHref={backHref} backLabel={backLabel} />
      <BuildingGate bin={bin}>

      {/* Hero */}
      <div style={{ padding: '40px 32px 36px', background: '#FAFAFA', borderBottom: '0.5px solid #E5E5E5' }}>
        <div style={{ maxWidth: 1260, margin: '0 auto', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 48 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: eyebrow.color, marginBottom: 6 }}>
              {eyebrow.text}
            </div>
            <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 44, fontWeight: 500, color: '#111111', letterSpacing: '-0.02em', lineHeight: 1.05, margin: 0 }}>
              {toTitleCase(building.address ?? '')}
            </h1>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#525252', marginTop: 8, marginBottom: 0 }}>
              {building.borough} · ZIP {building.zip_code} · BIN {building.bin}
              {neighborhood?.nta_name && ` · ${neighborhood.nta_name}`}
              {building.first_complaint_date && ` · On record since ${formatDate(building.first_complaint_date)}`}
              {building.construction_year && ` · Built ${building.construction_year}`}
            </p>
          </div>
          {!insufficient && !notComparable && (
            <p style={{ fontFamily: 'var(--font-serif)', fontSize: 18, fontStyle: 'italic', fontWeight: 400, color: '#111111', lineHeight: 1.45, maxWidth: 360, flexShrink: 0, margin: 0 }}>
              {headline3}
            </p>
          )}
        </div>
      </div>

      <main style={{ maxWidth: 1260, margin: '0 auto', padding: '1.75rem 1.5rem' }}>

        {/* Cross-links */}
        <div style={{ marginBottom: 20 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#111111', fontWeight: 500 }}>
            DOB complaints
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#D4D1C3', margin: '0 8px' }}>·</span>
          <Link href={`/hpd-overview/building/${bin}`} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#737373', textDecoration: 'none' }}>
            HPD overview
          </Link>
        </div>

        {/* Three insight cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 12 }}>
          <InsightCard eyebrow="Severity" aside="Pri A+B" headline={headline1} sub={sub1}>
            <SeverityViz count={building.priority_ab_complaints} />
          </InsightCard>
          <InsightCard eyebrow="Trend" aside="Last 5 years" headline={headline2} sub={sub2}>
            <TrendViz timeline={timeline} />
          </InsightCard>
          <InsightCard eyebrow="Rank" aside={ntaName.length > 22 ? ntaName.slice(0, 22) + '…' : ntaName} headline={headline3} sub={sub3}>
            <RankViz percentile={notComparable || insufficient ? null : building.neighborhood_percentile} />
          </InsightCard>
        </div>

        {/* KPI stat cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 12 }}>
          {[
            { label: 'Total complaints', value: building.total_complaints },
            { label: 'Active',           value: building.open_complaints },
            { label: 'Priority A',       value: building.priority_a_complaints },
            { label: 'Priority A+B',     value: building.priority_ab_complaints },
          ].map(({ label, value }) => (
            <div key={label} style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 8, padding: '14px' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#525252', marginBottom: 8 }}>
                {label}
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 30, fontWeight: 500, color: '#111111', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                {value.toLocaleString()}
              </div>
            </div>
          ))}
        </div>

        {/* Chart cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 8, padding: '14px' }}>
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
          <div style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 8, padding: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#525252' }}>
                Top complaint types
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#737373' }}>by volume</span>
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
                href={`/building/${bin}?status=ACTIVE`}
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
                href={`/building/${bin}`}
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

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 1.25rem', borderTop: '0.5px solid #E5E5E5' }}>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#737373' }}>
                Page {page} of {totalPages}
              </p>
              <div style={{ display: 'flex', gap: 6 }}>
                {page > 1 && (
                  <Link href={pageUrl(page - 1)} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500, padding: '6px 12px', borderRadius: 8, border: '0.5px solid #A3A3A3', color: '#111111', textDecoration: 'none' }}>
                    ← Prev
                  </Link>
                )}
                {page < totalPages && (
                  <Link href={pageUrl(page + 1)} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500, padding: '6px 12px', borderRadius: 8, border: '0.5px solid #A3A3A3', color: '#111111', textDecoration: 'none' }}>
                    Next →
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>

      </main>
      </BuildingGate>
    </div>
  )
}
