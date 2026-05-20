import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getHpdBuilding, getHpdTimeline, getHpdBreakdown } from '@/lib/api'
import BuildingNavBar from '@/components/BuildingNavBar'
import BuildingExplainer from '@/components/BuildingExplainer'
import ViolationTimeline from '@/components/ViolationTimeline'
import ViolationBreakdown from '@/components/ViolationBreakdown'
import ViolationCategoryBreakdown from '@/components/ViolationCategoryBreakdown'
import ViolationDescription from '@/components/ViolationDescription'
import type { HpdViolation } from '@/lib/types'

const CLASS_META: Record<string, { label: string; color: string; bg: string }> = {
  A: { label: 'Emergency',     color: '#7F1D1D', bg: '#FEF2F2' },
  B: { label: 'Hazardous',    color: '#92400E', bg: '#FFF7ED' },
  C: { label: 'Non-hazardous', color: '#525252', bg: '#F5F5F5' },
  I: { label: 'Informational', color: '#737373', bg: '#FAFAFA' },
}

const TIER_META: Record<string, { color: string; bg: string }> = {
  'Emergency':     { color: '#7F1D1D', bg: '#FEF2F2' },
  'Hazardous':     { color: '#92400E', bg: '#FFF7ED' },
  'Non-hazardous': { color: '#525252', bg: '#F5F5F5' },
  'Resolved':      { color: '#166534', bg: '#F0FDF4' },
}

function stripLegalPrefix(s: string | null | undefined): string | null {
  if (!s) return null
  if (!s.startsWith('§')) return s
  const idx = s.indexOf(' - ')
  return idx !== -1 ? s.slice(idx + 3).trim() : s
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—'
  try {
    const [y, m, d] = iso.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return iso }
}

function ViolationRow({ v }: { v: HpdViolation }) {
  const cls = CLASS_META[v.violation_class ?? ''] ?? CLASS_META.C
  const isOpen = v.violation_status === 'Open'

  return (
    <tr style={{ borderBottom: '0.5px solid #E5E5E5' }}>
      <td style={{ padding: '12px 16px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
        <span style={{
          display: 'inline-block', padding: '2px 7px', borderRadius: 4,
          fontSize: 10, fontFamily: 'var(--font-mono)', letterSpacing: '0.06em',
          fontWeight: 500, color: cls.color, background: cls.bg,
        }}>
          Class {v.violation_class ?? '?'}
        </span>
      </td>
      <td style={{ padding: '12px 8px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
        <span style={{
          fontSize: 11, fontFamily: 'var(--font-mono)',
          color: isOpen ? '#7F1D1D' : '#737373',
        }}>
          {isOpen ? 'Open' : 'Closed'}
        </span>
        {v.rent_impairing === 'Y' && (
          <span style={{
            display: 'block', fontSize: 9, fontFamily: 'var(--font-mono)',
            letterSpacing: '0.06em', color: '#EF4637', marginTop: 2,
          }}>
            RENT IMPAIRING
          </span>
        )}
      </td>
      <td style={{ padding: '12px 8px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
        <span style={{ fontSize: 12, color: '#525252' }}>
          {v.apartment ?? '—'}
        </span>
      </td>
      <td style={{ padding: '12px 8px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#525252' }}>
          {fmtDate(v.nov_issued_date)}
        </span>
      </td>
      <td style={{ padding: '12px 8px 12px 0', verticalAlign: 'top' }}>
        <ViolationDescription
          short={v.order_short_description ?? stripLegalPrefix(v.nov_description)}
          full={v.nov_description}
          category={v.order_category}
        />
      </td>
    </tr>
  )
}

export default async function HpdBuildingPage({
  params,
  searchParams,
}: {
  params: Promise<{ bin: string }>
  searchParams: Promise<{ page?: string; class?: string; status?: string }>
}) {
  const { bin } = await params
  const sp = await searchParams
  const page = Number(sp.page ?? 1)
  const violationClass = sp.class
  const status = sp.status

  const [building, timeline, breakdown] = await Promise.all([
    getHpdBuilding(bin, page, violationClass, status).catch(() => null),
    getHpdTimeline(bin).catch(() => []),
    getHpdBreakdown(bin).catch(() => []),
  ])

  if (!building) notFound()

  const tier = building.hpd_risk_tier ?? 'Non-hazardous'
  const tierMeta = TIER_META[tier] ?? TIER_META['Non-hazardous']
  const totalPages = Math.ceil(building.total_count / building.page_size)

  function pageUrl(p: number) {
    const q = new URLSearchParams()
    q.set('page', String(p))
    if (violationClass) q.set('class', violationClass)
    if (status) q.set('status', status)
    return `/hpd/building/${bin}?${q}#log`
  }

  function filterUrl(updates: Record<string, string | undefined>) {
    const q = new URLSearchParams()
    q.set('page', '1')
    const cls = 'class'  in updates ? updates.class  : violationClass
    const st  = 'status' in updates ? updates.status : status
    if (cls) q.set('class', cls)
    if (st)  q.set('status', st)
    return `/hpd/building/${bin}?${q}#log`
  }

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

  return (
    <>
      <BuildingNavBar backHref="/hpd" backLabel="← HPD map" />

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
              HPD Violations
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
          <BuildingExplainer
            label="About HPD violations"
            text="NYC Housing Preservation & Development (HPD) tracks housing conditions that impact tenant safety and quality of life. Violations are issued after HPD inspectors verify that a building condition violates NYC housing law. Class C violations are immediately hazardous and must be corrected within 24 hours."
          />
        </div>

        {/* KPI cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 32 }}>
          {[
            { label: 'Total violations',   value: building.total_violations },
            { label: 'Open violations',    value: building.open_violations },
            { label: 'Class A (emergency)',value: building.class_a_violations },
            { label: 'Open rent-impairing', value: building.rent_impairing_count },
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

        {/* Charts row — timeline + class breakdown side by side */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 12, padding: '20px 24px' }}>
            <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#525252', marginBottom: 16, marginTop: 0 }}>
              Violations over time
            </h2>
            <ViolationTimeline data={timeline} latestDate={building.latest_violation_date} />
          </div>
          <div style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 12, padding: '20px 24px' }}>
            <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#525252', marginBottom: 16, marginTop: 0 }}>
              By class
            </h2>
            <ViolationBreakdown data={breakdown} />
          </div>
        </div>

        {/* Category chart — full width */}
        <div style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 12, padding: '20px 24px', marginBottom: 32 }}>
          <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#525252', marginBottom: 16, marginTop: 0 }}>
            Top categories
          </h2>
          <ViolationCategoryBreakdown data={breakdown} />
        </div>

        {/* Violation log */}
        <div id="log" style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 12, overflow: 'hidden', scrollMarginTop: '72px' }}>
          <div style={{ padding: '20px 24px', borderBottom: '0.5px solid #E5E5E5', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#525252', margin: '0 0 4px' }}>
                Violation log
              </h2>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#A3A3A3', margin: 0 }}>
                {building.total_count.toLocaleString()} violations
                {violationClass ? ` · Class ${violationClass}` : ''}
                {status ? ` · ${status}` : ''}
              </p>
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <FilterPill label="All classes" active={!violationClass} href={filterUrl({ class: undefined })} />
              {['A', 'B', 'C', 'I'].map(cls => (
                <FilterPill key={cls} label={`Class ${cls}`} active={violationClass === cls} href={filterUrl({ class: cls })} />
              ))}
              <span style={{ width: 1, background: '#E5E5E5', alignSelf: 'stretch', margin: '0 2px' }} />
              <FilterPill label="All"    active={!status}            href={filterUrl({ status: undefined })} />
              <FilterPill label="Open"   active={status === 'Open'}   href={filterUrl({ status: 'Open' })} />
              <FilterPill label="Closed" active={status === 'Close'}  href={filterUrl({ status: 'Close' })} />
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '0.5px solid #E5E5E5', background: '#FAFAFA' }}>
                  {['Class', 'Status', 'Apt', 'Issued', 'Description'].map(h => (
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
                {building.violations.map(v => (
                  <ViolationRow key={v.violation_id} v={v} />
                ))}
                {building.violations.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ padding: '32px 24px', textAlign: 'center', fontSize: 13, color: '#A3A3A3', fontFamily: 'var(--font-mono)' }}>
                      No violations match the current filters.
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
