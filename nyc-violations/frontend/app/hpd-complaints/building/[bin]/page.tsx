import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getHpdComplaintBuilding, getHpdComplaintTimeline, getHpdComplaintBreakdown } from '@/lib/api'
import BuildingNavBar from '@/components/BuildingNavBar'
import ViolationTimeline from '@/components/ViolationTimeline'
import ViolationCategoryBreakdown from '@/components/ViolationCategoryBreakdown'
import ComplaintTypeBreakdown from '@/components/ComplaintTypeBreakdown'
import type { HpdComplaint } from '@/lib/types'

const TIER_META: Record<string, { color: string; bg: string }> = {
  'Emergency': { color: '#7F1D1D', bg: '#FEF2F2' },
  'Active':    { color: '#92400E', bg: '#FFF7ED' },
  'Resolved':  { color: '#166534', bg: '#F0FDF4' },
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—'
  try {
    const [y, m, d] = iso.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return iso }
}

function ComplaintRow({ c }: { c: HpdComplaint }) {
  const isOpen = c.complaint_status === 'Open'
  const isEmergency = c.type === 'EMERGENCY'

  return (
    <tr style={{ borderBottom: '0.5px solid #E5E5E5' }}>
      <td style={{ padding: '12px 16px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
        <span style={{
          display: 'inline-block', padding: '2px 7px', borderRadius: 4,
          fontSize: 10, fontFamily: 'var(--font-mono)', letterSpacing: '0.06em',
          fontWeight: 500,
          color: isEmergency ? '#7F1D1D' : '#525252',
          background: isEmergency ? '#FEF2F2' : '#F5F5F5',
        }}>
          {isEmergency ? 'Emergency' : 'Non-emergency'}
        </span>
      </td>
      <td style={{ padding: '12px 8px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
        <span style={{
          fontSize: 11, fontFamily: 'var(--font-mono)',
          color: isOpen ? '#7F1D1D' : '#737373',
        }}>
          {isOpen ? 'Open' : 'Closed'}
        </span>
      </td>
      <td style={{ padding: '12px 8px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
        <span style={{ fontSize: 12, color: '#525252' }}>{c.apartment ?? '—'}</span>
      </td>
      <td style={{ padding: '12px 8px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#525252' }}>
          {fmtDate(c.received_date)}
        </span>
      </td>
      <td style={{ padding: '12px 8px 12px 0', verticalAlign: 'top' }}>
        <span style={{ fontSize: 12, color: '#111111', display: 'block' }}>
          {c.major_category ?? '—'}
          {c.minor_category && c.minor_category !== c.major_category
            ? <span style={{ color: '#737373' }}> · {c.minor_category}</span>
            : null}
        </span>
        {c.status_description && (
          <span style={{ fontSize: 11, color: '#737373', display: 'block', marginTop: 2 }}>
            {c.status_description}
          </span>
        )}
      </td>
    </tr>
  )
}

export default async function HpdComplaintsBuildingPage({
  params,
  searchParams,
}: {
  params: Promise<{ bin: string }>
  searchParams: Promise<{ page?: string; category?: string; status?: string }>
}) {
  const { bin } = await params
  const sp = await searchParams
  const page = Number(sp.page ?? 1)
  const majorCategory = sp.category
  const status = sp.status

  const [building, timeline, breakdown] = await Promise.all([
    getHpdComplaintBuilding(bin, page, majorCategory, status).catch(() => null),
    getHpdComplaintTimeline(bin).catch(() => []),
    getHpdComplaintBreakdown(bin).catch(() => []),
  ])

  if (!building) notFound()

  const tier = building.complaint_risk_tier ?? 'Resolved'
  const tierMeta = TIER_META[tier] ?? TIER_META['Resolved']
  const totalPages = Math.ceil(building.total_count / building.page_size)

  function pageUrl(p: number) {
    const q = new URLSearchParams()
    q.set('page', String(p))
    if (majorCategory) q.set('category', majorCategory)
    if (status) q.set('status', status)
    return `/hpd-complaints/building/${bin}?${q}`
  }

  function filterUrl(updates: Record<string, string | undefined>) {
    const q = new URLSearchParams()
    q.set('page', '1')
    const cat = 'category' in updates ? updates.category : majorCategory
    const st  = 'status'   in updates ? updates.status   : status
    if (cat) q.set('category', cat)
    if (st)  q.set('status', st)
    return `/hpd-complaints/building/${bin}?${q}`
  }

  // Distinct top major_categories for filter pills (deduplicated, sorted by total count)
  const topCategories = Array.from(
    breakdown.reduce((acc, d) => {
      acc.set(d.major_category, (acc.get(d.major_category) ?? 0) + d.count)
      return acc
    }, new Map<string, number>())
  ).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([cat]) => cat)

  const FilterPill = ({ label, active, href }: { label: string; active: boolean; href: string }) => (
    <Link
      href={href}
      style={{
        display: 'inline-block', padding: '4px 10px', borderRadius: 20,
        fontSize: 11, fontFamily: 'var(--font-mono)', textDecoration: 'none',
        background: active ? '#111111' : '#F5F5F5',
        color: active ? '#FFFFFF' : '#525252',
        border: `0.5px solid ${active ? '#111111' : '#E5E5E5'}`,
      }}
    >
      {label}
    </Link>
  )

  // Aggregate by major_category for the top categories horizontal chart.
  // breakdown rows are now (type, major_category) tuples so we need to sum.
  const categoryTotals = new Map<string, number>()
  for (const d of breakdown) {
    categoryTotals.set(d.major_category, (categoryTotals.get(d.major_category) ?? 0) + d.count)
  }
  const breakdownForCategoryChart = Array.from(categoryTotals.entries()).map(([cat, count]) => ({
    violation_class: cat,
    category: cat,
    count,
    open_count: 0, // category chart only shows totals
  }))

  return (
    <>
      <BuildingNavBar backHref="/hpd-complaints" backLabel="← HPD complaints map" />

      <main style={{ maxWidth: 960, margin: '0 auto', padding: '32px 24px 80px' }}>

        {/* Cross-links */}
        <div style={{ marginBottom: 20 }}>
          <Link
            href={`/building/${bin}`}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em',
              textTransform: 'uppercase', color: '#737373', textDecoration: 'none',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M11 6l-6 6 6 6"/>
            </svg>
            DOB complaints
          </Link>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#D4D1C3', margin: '0 8px' }}>·</span>
          <Link
            href={`/hpd/building/${bin}`}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em',
              textTransform: 'uppercase', color: '#737373', textDecoration: 'none',
            }}
          >
            HPD violations
          </Link>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#D4D1C3', margin: '0 8px' }}>·</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#111111', fontWeight: 500 }}>
            HPD complaints
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#D4D1C3', margin: '0 8px' }}>·</span>
          <Link
            href={`/hpd-overview/building/${bin}`}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em',
              textTransform: 'uppercase', color: '#737373', textDecoration: 'none',
            }}
          >
            HPD overview
          </Link>
        </div>

        {/* Hero */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span style={{
              display: 'inline-block', padding: '3px 10px', borderRadius: 6,
              fontSize: 10, fontFamily: 'var(--font-mono)', letterSpacing: '0.08em',
              fontWeight: 500, color: tierMeta.color, background: tierMeta.bg,
              textTransform: 'uppercase',
            }}>
              {tier}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#A3A3A3' }}>
              HPD Complaints
            </span>
          </div>
          <h1 style={{
            fontFamily: 'var(--font-serif)', fontSize: 36, fontWeight: 500,
            color: '#111111', letterSpacing: '-0.02em', lineHeight: 1.1, margin: '0 0 8px',
          }}>
            {building.address ?? 'Unknown address'}
          </h1>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#737373', margin: 0 }}>
            {building.borough}{building.zip_code ? ` · ${building.zip_code}` : ''} · BIN {bin}
            {building.nta_name ? ` · ${building.nta_name}` : ''}
          </p>
        </div>

        {/* KPI cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 32 }}>
          {[
            { label: 'Total complaints',  value: building.total_complaints },
            { label: 'Open complaints',   value: building.open_complaints },
            { label: 'Emergency type',    value: building.open_emergency_complaints },
            { label: 'Heat/hot water',    value: building.heat_complaints },
          ].map(({ label, value }) => (
            <div
              key={label}
              style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 12, padding: '18px 20px' }}
            >
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#737373', marginBottom: 8 }}>
                {label}
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 32, fontWeight: 500, color: '#111111', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                {value.toLocaleString()}
              </div>
            </div>
          ))}
        </div>

        {/* Charts row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 12, padding: '20px 24px' }}>
            <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#525252', marginBottom: 16, marginTop: 0 }}>
              Complaints over time
            </h2>
            <ViolationTimeline data={timeline} latestDate={building.latest_complaint_date} />
          </div>
          <div style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 12, padding: '20px 24px' }}>
            <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#525252', marginBottom: 16, marginTop: 0 }}>
              By type
            </h2>
            <ComplaintTypeBreakdown data={breakdown} />
          </div>
        </div>

        {/* Category detail chart — full width */}
        <div style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 12, padding: '20px 24px', marginBottom: 32 }}>
          <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#525252', marginBottom: 16, marginTop: 0 }}>
            Top categories
          </h2>
          <ViolationCategoryBreakdown data={breakdownForCategoryChart} />
        </div>

        {/* Complaint log */}
        <div style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '20px 24px', borderBottom: '0.5px solid #E5E5E5', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#525252', margin: '0 0 4px' }}>
                Complaint log
              </h2>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#A3A3A3', margin: 0 }}>
                {building.total_count.toLocaleString()} complaints
                {majorCategory ? ` · ${majorCategory}` : ''}
                {status ? ` · ${status}` : ''}
              </p>
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <FilterPill label="All categories" active={!majorCategory} href={filterUrl({ category: undefined })} />
              {topCategories.map(cat => (
                <FilterPill key={cat} label={cat} active={majorCategory === cat} href={filterUrl({ category: cat })} />
              ))}
              <span style={{ width: 1, background: '#E5E5E5', alignSelf: 'stretch', margin: '0 2px' }} />
              <FilterPill label="All"    active={!status}            href={filterUrl({ status: undefined })} />
              <FilterPill label="Open"   active={status === 'Open'}  href={filterUrl({ status: 'Open' })} />
              <FilterPill label="Closed" active={status === 'Close'} href={filterUrl({ status: 'Close' })} />
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '0.5px solid #E5E5E5', background: '#FAFAFA' }}>
                  {['Type', 'Status', 'Apt', 'Received', 'Category'].map(h => (
                    <th
                      key={h}
                      style={{
                        padding: '10px 16px', textAlign: 'left',
                        fontFamily: 'var(--font-mono)', fontSize: 10,
                        letterSpacing: '0.08em', textTransform: 'uppercase',
                        color: '#737373', fontWeight: 500, whiteSpace: 'nowrap',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {building.complaints.map(c => (
                  <ComplaintRow key={c.problem_id} c={c} />
                ))}
                {building.complaints.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ padding: '32px 24px', textAlign: 'center', fontSize: 13, color: '#A3A3A3', fontFamily: 'var(--font-mono)' }}>
                      No complaints match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ padding: '16px 24px', borderTop: '0.5px solid #E5E5E5', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#737373' }}>
                Page {page} of {totalPages}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                {page > 1 && (
                  <Link
                    href={pageUrl(page - 1)}
                    style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#111111', textDecoration: 'none', padding: '4px 10px', border: '0.5px solid #E5E5E5', borderRadius: 6 }}
                  >
                    ← Prev
                  </Link>
                )}
                {page < totalPages && (
                  <Link
                    href={pageUrl(page + 1)}
                    style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#111111', textDecoration: 'none', padding: '4px 10px', border: '0.5px solid #E5E5E5', borderRadius: 6 }}
                  >
                    Next →
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>

      </main>
    </>
  )
}
