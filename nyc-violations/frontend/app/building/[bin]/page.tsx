import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getBuilding, getTimeline, getBreakdown, getNeighborhood, ApiError } from '@/lib/api'
import BuildingNavBar from '@/components/BuildingNavBar'
import BuildingGate from '@/components/BuildingGate'
import ComplaintTimeline from '@/components/ComplaintTimeline'
import ComplaintBreakdown from '@/components/ComplaintBreakdown'
import OutcomeCell from '@/components/OutcomeCell'
import type { Complaint } from '@/lib/types'

const RISK_TIER: Record<string, { bg: string; color: string }> = {
  'Very low':          { bg: '#D4F5CB', color: '#111111' },
  'Low':               { bg: '#A8E5A0', color: '#111111' },
  'Moderate':          { bg: '#FFD930', color: '#111111' },
  'High':              { bg: '#F5A047', color: '#111111' },
  'Very high':         { bg: '#EF4637', color: '#FFFFFF' },
  'Insufficient data': { bg: '#D4F5CB', color: '#111111' },
  'Not comparable':    { bg: '#D4D1C3', color: '#111111' },
}

function getTier(riskLevel: string | null) {
  return RISK_TIER[riskLevel ?? 'Insufficient data'] ?? RISK_TIER['Insufficient data']
}

type IndicatorColor = 'green' | 'yellow' | 'orange' | 'red'

const INDICATOR_HEX: Record<IndicatorColor, string> = {
  green:  '#A8E5A0',
  yellow: '#FFD930',
  orange: '#F5A047',
  red:    '#EF4637',
}

function seriousColor(pct: number | null): IndicatorColor {
  if (pct == null) return 'yellow'
  if (pct >= 90) return 'red'
  if (pct >= 70) return 'orange'
  if (pct >= 40) return 'yellow'
  return 'green'
}

function trendColor(direction: string | null): IndicatorColor {
  if (direction === 'improving') return 'green'
  if (direction === 'worsening') return 'red'
  return 'yellow'
}

function standingColor(pct: number | null): IndicatorColor {
  if (pct == null) return 'yellow'
  if (pct >= 90) return 'red'
  if (pct >= 70) return 'orange'
  if (pct >= 40) return 'yellow'
  return 'green'
}

function heroCopy(c1: IndicatorColor, c2: IndicatorColor, c3: IndicatorColor): string {
  const colors = [c1, c2, c3]
  if (colors.includes('red'))
    return 'This building has significant complaint activity compared to its neighborhood.'
  if (colors.filter(c => c === 'orange').length >= 2)
    return 'This building has above-average complaint activity for its neighborhood.'
  if (colors.every(c => c === 'green'))
    return 'This building has a relatively clean complaint record for its neighborhood.'
  return 'This building has a mixed complaint history — review the details below.'
}

function yearsOnRecord(firstDate: string | null): number {
  if (!firstDate) return 1
  const [y, m, d] = firstDate.split('-').map(Number)
  const days = (Date.now() - new Date(y, m - 1, d).getTime()) / 86400000
  return Math.max(days / 365.25, 1)
}

function Indicator({
  label, color, sentence, detail,
}: {
  label: string; color: IndicatorColor; sentence: string; detail: string
}) {
  const hex = INDICATOR_HEX[color]
  return (
    <div style={{
      background: '#FFFFFF', border: '0.5px solid #E5E3DA', borderRadius: 12,
      borderTop: `4px solid ${hex}`, padding: '1rem 1.25rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: hex, flexShrink: 0 }} />
        <p style={{ fontSize: 10, fontWeight: 600, color: '#6B6B65', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          {label}
        </p>
      </div>
      <p style={{ fontSize: 15, fontWeight: 600, color: '#111111', lineHeight: 1.45, marginBottom: 12 }}>
        {sentence}
      </p>
      <div style={{ height: '0.5px', background: '#E5E3DA', marginBottom: 10 }} />
      <p style={{ fontSize: 12, color: '#6B6B65', lineHeight: 1.6 }}>{detail}</p>
    </div>
  )
}

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

const PRIORITY_DOT: Record<string, string> = {
  A: '#EF4637', B: '#F5A047', C: '#FFD930', D: '#D4D1C3',
}

const PRIORITY_BADGE: Record<string, { bg: string; text: string; border?: string }> = {
  A: { bg: '#EF4637', text: '#FFFFFF' },
  B: { bg: '#FEE2DE', text: '#8B1F15' },
  C: { bg: '#FFD930', text: '#5C4A0A' },
  D: { bg: '#FFFFFF',  text: '#111111', border: '0.5px solid #E5E3DA' },
}

function PriorityBadge({ priority }: { priority: string | null }) {
  if (!priority) return null
  const s = PRIORITY_BADGE[priority] ?? { bg: '#F5F3EA', text: '#6B6B65' }
  return (
    <span style={{
      fontSize: 11, fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase',
      padding: '3px 8px', borderRadius: 4,
      background: s.bg, color: s.text, border: s.border ?? 'none', whiteSpace: 'nowrap',
    }}>
      {priority}
    </span>
  )
}

function ComplaintRow({ c }: { c: Complaint }) {
  const dot = PRIORITY_DOT[c.category_priority ?? ''] ?? '#D4D1C3'
  const isActive = c.status === 'ACTIVE'
  return (
    <tr style={{ borderBottom: '0.5px solid #E5E3DA' }}>
      {/* Priority color bar */}
      <td style={{ width: 4, padding: 0, background: dot }} />
      <td style={{ padding: '11px 14px', fontSize: 12, color: '#6B6B65', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' }}>
        {formatDate(c.date_entered)}
      </td>
      <td style={{ padding: '11px 14px', maxWidth: 280 }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: '#111111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {c.category_description ?? c.complaint_category ?? '—'}
        </p>
        <p style={{ fontSize: 11, color: '#6B6B65', marginTop: 1, fontFamily: 'var(--font-mono)' }}>
          {c.complaint_category}
        </p>
      </td>
      <td style={{ padding: '11px 14px' }}>
        <PriorityBadge priority={c.category_priority} />
      </td>
      <td style={{ padding: '11px 14px' }}>
        <span style={{
          fontSize: 11, fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase',
          padding: '3px 8px', borderRadius: 4,
          background: isActive ? '#EF4637' : '#FFFFFF',
          color: isActive ? '#FFFFFF' : '#111111',
          border: isActive ? 'none' : '0.5px solid #E5E3DA',
        }}>
          {c.status ?? '—'}
        </span>
      </td>
      <td style={{ padding: '11px 14px', fontSize: 12, color: '#6B6B65', whiteSpace: 'nowrap' }}>
        {formatDate(c.disposition_date)}
      </td>
      <td style={{ padding: '11px 14px' }}>
        <OutcomeCell description={c.disposition_description} code={c.disposition_code} />
      </td>
    </tr>
  )
}


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
    throw err  // 5xx → caught by error.tsx
  }
  // Fetch separately — failure doesn't break the page
  neighborhood = await getNeighborhood(bin)

  const tier = getTier(building.risk_level)
  const backHref  = from === 'leaderboard' ? '/leaderboard' : '/'
  const backLabel = from === 'leaderboard' ? '← Leaderboard' : '← Map'

  // Empty state
  if (building.total_complaints === 0) {
    const emptyTier = getTier('Very low')
    return (
      <div style={{ minHeight: '100vh', background: '#FAFAF7' }}>
        <BuildingNavBar backHref={backHref} backLabel={backLabel} />
        <BuildingGate bin={bin}>
        <div style={{ background: emptyTier.bg, padding: '2.5rem 3rem' }}>
          <h1 style={{ fontSize: 48, fontWeight: 500, color: emptyTier.color, letterSpacing: '-0.02em', lineHeight: 1.15, margin: 0 }}>
            {toTitleCase(building.address ?? '')}
          </h1>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: emptyTier.color, opacity: 0.7, marginTop: 10 }}>
            {building.borough} · ZIP {building.zip_code}
            {' · '}BIN {building.bin}
            {building.construction_year && ` · Built ${building.construction_year}`}
          </p>
        </div>
        <main style={{ maxWidth: 640, margin: '0 auto', padding: '4rem 1.5rem', textAlign: 'center' }}>
          <h2 style={{ fontSize: 28, fontWeight: 500, color: '#111111', letterSpacing: '-0.02em', margin: '0 0 16px' }}>
            No complaints on record
          </h2>
          <p style={{ fontSize: 15, color: '#6B6B65', lineHeight: 1.7, marginBottom: 32 }}>
            This doesn&apos;t mean no issues have ever existed — complaints may have been filed under a different BIN,
            before electronic records began in 2007, or may be tracked by a different agency such as HPD.
            If you have concerns about this building, check HPD&apos;s building records at hpdonline.nyc.gov.
          </p>
          <a
            href="https://hpdonline.nyc.gov"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-block', fontSize: 13, fontWeight: 500, padding: '10px 24px',
              background: '#0601B4', color: '#FFFFFF', borderRadius: 8, textDecoration: 'none',
            }}
          >
            View on HPD Online →
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

  return (
    <div style={{ minHeight: '100vh', background: '#FAFAF7' }}>

      <BuildingNavBar backHref={backHref} backLabel={backLabel} />
      <BuildingGate bin={bin}>

      {/* Hero — full-width colored band */}
      <div style={{ background: tier.bg, padding: '2.5rem 3rem' }}>
        <div style={{
          maxWidth: 1260, margin: '0 auto',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 48,
        }}>
          {/* Left: address + meta */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{
              fontSize: 48, fontWeight: 500, color: tier.color,
              letterSpacing: '-0.02em', lineHeight: 1.15, margin: 0,
            }}>
              {toTitleCase(building.address ?? '')}
            </h1>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: tier.color, opacity: 0.7, marginTop: 10 }}>
              {building.borough} · ZIP {building.zip_code}
              {' · '}BIN {building.bin}
              {neighborhood?.nta_name && ` · ${neighborhood.nta_name}`}
            </p>
            {(building.first_complaint_date || building.construction_year) && (
              <p style={{ fontSize: 12, color: tier.color, opacity: 0.6, marginTop: 4 }}>
                {building.first_complaint_date && <>On record since {formatDate(building.first_complaint_date)}</>}
                {building.first_complaint_date && building.construction_year && ' · '}
                {building.construction_year && <>Built {building.construction_year}</>}
              </p>
            )}
          </div>

          {/* Right: hero band copy */}
          {(() => {
            const rl = building.risk_level
            const copy = rl === 'Insufficient data'
              ? 'This building has very few complaints on record.'
              : rl === 'Not comparable'
              ? 'This building is in a non-residential area; neighborhood comparison is not available.'
              : heroCopy(
                  seriousColor(building.serious_rate_percentile),
                  trendColor(building.trend_direction),
                  standingColor(building.neighborhood_percentile),
                )
            return (
              <p style={{ fontSize: 16, color: tier.color, opacity: 0.85, maxWidth: 340, lineHeight: 1.6, flexShrink: 0 }}>
                {copy}
              </p>
            )
          })()}
        </div>
      </div>

      <main style={{ maxWidth: 1260, margin: '0 auto', padding: '1.75rem 1.5rem' }}>

        {/* Three plain-language indicators */}
        {(() => {
          const ntaName = building.nta_name ?? neighborhood?.nta_name ?? 'this neighborhood'
          const years   = Math.round(yearsOnRecord(building.first_complaint_date))
          const rl            = building.risk_level
          const insufficient  = rl === 'Insufficient data'
          const notComparable = rl === 'Not comparable'

          const c1: IndicatorColor = insufficient ? 'green' : notComparable ? 'yellow' : seriousColor(building.serious_rate_percentile)
          const sentence1 = insufficient  ? 'Very few serious complaints on record'
            : notComparable              ? 'Serious complaint rate not available for this area'
            : c1 === 'green'             ? 'Fewer serious complaints than most buildings in this neighborhood'
            : c1 === 'yellow'            ? 'About as many serious complaints as similar buildings nearby'
            : c1 === 'orange'            ? 'More serious complaints than most buildings in this neighborhood'
            :                              'Among the highest rates of serious complaints in this neighborhood'
          const detail1 = insufficient
            ? `${building.priority_ab_complaints} Priority A and B complaint${building.priority_ab_complaints !== 1 ? 's' : ''} on record — not enough to establish a rate.`
            : notComparable
            ? 'This building is not in a residential NTA and cannot be compared to residential peers.'
            : `${building.priority_ab_complaints} Priority A and B complaints over ${years} year${years !== 1 ? 's' : ''} — ${(building.serious_rate ?? 0).toFixed(1)} per year on average.`

          const c2: IndicatorColor = insufficient ? 'green' : notComparable ? 'yellow' : trendColor(building.trend_direction)
          const sentence2 = insufficient  ? 'Very little complaint activity on record'
            : notComparable              ? 'Trend analysis not available for this area'
            : c2 === 'green'             ? 'Complaints have decreased in recent years'
            : c2 === 'red'               ? 'Complaints have increased in the last 2 years'
            :                              'Complaint rate has been consistent over time'
          const detail2 = insufficient
            ? `${building.recent_complaint_count ?? 0} complaint${(building.recent_complaint_count ?? 0) !== 1 ? 's' : ''} in the last 2 years. More history is needed to identify a trend.`
            : notComparable
            ? 'Complaint trends are only tracked for residential buildings.'
            : `${building.recent_complaint_count} complaint${building.recent_complaint_count !== 1 ? 's' : ''} in the last 2 years, compared to ${building.prior_complaint_count} in the 3 years before that.`

          const c3: IndicatorColor = insufficient ? 'green' : notComparable ? 'yellow' : standingColor(building.neighborhood_percentile)
          const sentence3 = insufficient  ? `Too few complaints to rank against ${ntaName}`
            : notComparable              ? 'Neighborhood comparison not available'
            : c3 === 'green'             ? `Better than most buildings in ${ntaName}`
            : c3 === 'yellow'            ? `About average for ${ntaName}`
            : c3 === 'orange'            ? `Worse than most buildings in ${ntaName}`
            :                              `Among the most complained-about buildings in ${ntaName}`
          const detail3 = insufficient
            ? 'Buildings need at least 10 complaints and 2 years of history to rank. A low complaint count is a positive signal.'
            : notComparable
            ? 'This building is in a park, airport, cemetery, or other non-residential area.'
            : `More complaints than ${Math.round(building.neighborhood_percentile!)}% of residential buildings in ${ntaName}.`  

          return (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 20 }}>
              <Indicator label="Serious complaints"    color={c1} sentence={sentence1} detail={detail1} />
              <Indicator label="Recent activity"       color={c2} sentence={sentence2} detail={detail2} />
              <Indicator label="Neighborhood standing" color={c3} sentence={sentence3} detail={detail3} />
            </div>
          )
        })()}

        {/* Stats row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>
          {[
            { label: 'Total complaints', value: building.total_complaints, sub: 'on record' },
            { label: 'Active',           value: building.open_complaints,   sub: 'currently open' },
            { label: 'Priority A',       value: building.priority_a_complaints, sub: 'highest severity' },
            { label: 'Priority A+B',     value: building.priority_ab_complaints, sub: 'serious issues' },
          ].map(({ label, value, sub }) => (
            <div key={label} style={{ background: '#FFFFFF', border: '0.5px solid #E5E3DA', borderRadius: 12, padding: '1.1rem 1.25rem' }}>
              <p style={{ fontSize: 10, fontWeight: 500, color: '#6B6B65', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                {label}
              </p>
              <p style={{ fontSize: 40, fontWeight: 500, color: '#0601B4', letterSpacing: '-0.03em', lineHeight: 1, marginTop: 6 }}>
                {value.toLocaleString()}
              </p>
              <p style={{ fontSize: 12, color: '#6B6B65', marginTop: 4 }}>{sub}</p>
            </div>
          ))}
        </div>

        {/* Charts */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
          <div style={{ background: '#FFFFFF', border: '0.5px solid #E5E3DA', borderRadius: 12, padding: '1.1rem 1.25rem' }}>
            <p style={{ fontSize: 10, fontWeight: 500, color: '#6B6B65', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 14 }}>
              Complaints over time
            </p>
            <ComplaintTimeline
              data={timeline}
              firstDate={building.first_complaint_date}
              lastDate={building.latest_complaint_date}
            />
          </div>
          <div style={{ background: '#FFFFFF', border: '0.5px solid #E5E3DA', borderRadius: 12, padding: '1.1rem 1.25rem' }}>
            <p style={{ fontSize: 10, fontWeight: 500, color: '#6B6B65', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 14 }}>
              Top complaint types
            </p>
            <ComplaintBreakdown data={breakdown} />
          </div>
        </div>

        {/* Complaint log */}
        <div style={{ background: '#FFFFFF', border: '0.5px solid #E5E3DA', borderRadius: 12 }}>

          {/* List header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem', borderBottom: '0.5px solid #E5E3DA' }}>
            <div>
              <p style={{ fontSize: 10, fontWeight: 500, color: '#6B6B65', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                Complaint log
              </p>
              <p style={{ fontSize: 24, fontWeight: 500, color: '#111111', letterSpacing: '-0.02em', marginTop: 2, lineHeight: 1 }}>
                {building.total_count.toLocaleString()}
                <span style={{ fontSize: 13, color: '#6B6B65', fontWeight: 400, letterSpacing: 0, marginLeft: 6 }}>total</span>
              </p>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <Link
                href={`/building/${bin}?status=ACTIVE`}
                style={{
                  fontSize: 12, fontWeight: 500, padding: '7px 14px', borderRadius: 8, textDecoration: 'none',
                  background: status === 'ACTIVE' ? '#0601B4' : 'transparent',
                  color: status === 'ACTIVE' ? '#FFFFFF' : '#111111',
                  border: status === 'ACTIVE' ? 'none' : '0.5px solid #111111',
                  letterSpacing: '-0.01em',
                }}
              >
                Active only
              </Link>
              <Link
                href={`/building/${bin}`}
                style={{
                  fontSize: 12, fontWeight: 500, padding: '7px 14px', borderRadius: 8, textDecoration: 'none',
                  background: !status ? '#0601B4' : 'transparent',
                  color: !status ? '#FFFFFF' : '#111111',
                  border: !status ? 'none' : '0.5px solid #111111',
                  letterSpacing: '-0.01em',
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
                <tr style={{ borderBottom: '0.5px solid #E5E3DA', background: '#FAFAF7' }}>
                  <th style={{ width: 4, padding: 0 }} />
                  {['Date', 'Complaint type', 'Priority', 'Status', 'Closed', 'Outcome'].map(h => (
                    <th key={h} style={{
                      padding: '9px 14px',
                      fontSize: 10, fontWeight: 500, color: '#6B6B65',
                      letterSpacing: '0.12em', textTransform: 'uppercase',
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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 1.25rem', borderTop: '0.5px solid #E5E3DA' }}>
              <p style={{ fontSize: 12, color: '#6B6B65' }}>Page {page} of {totalPages}</p>
              <div style={{ display: 'flex', gap: 6 }}>
                {page > 1 && (
                  <Link href={pageUrl(page - 1)} style={{ fontSize: 12, fontWeight: 500, padding: '6px 14px', borderRadius: 8, border: '0.5px solid #111111', color: '#111111', textDecoration: 'none' }}>
                    ← Prev
                  </Link>
                )}
                {page < totalPages && (
                  <Link href={pageUrl(page + 1)} style={{ fontSize: 12, fontWeight: 500, padding: '6px 14px', borderRadius: 8, border: '0.5px solid #111111', color: '#111111', textDecoration: 'none' }}>
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
