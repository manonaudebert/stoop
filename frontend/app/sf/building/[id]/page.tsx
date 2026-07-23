import Link from 'next/link'
import { notFound } from 'next/navigation'
import { fmtDate } from '@/lib/fmt'
import { pctHeadline, pctSub } from '@/lib/rankCopy'
import { CITY_CONFIG } from '@/lib/cities'
import {
  getSfBuilding,
  getSfComplaintsTimeline,
  getSfViolationsTimeline,
  getSfComplaintsBreakdown,
  getSfViolationsBreakdown,
} from '@/lib/api'
import { ApiError } from '@/lib/api'
import BuildingNavBar from '@/components/BuildingNavBar'
import BuildingHero from '@/components/BuildingHero'
import InsightCard from '@/components/InsightCard'
import RankViz from '@/components/RankViz'
import CombinedTrendViz from '@/components/CombinedTrendViz'
import TrendStatCard from '@/components/TrendStatCard'
import StatListCard from '@/components/StatListCard'
import RecordLog from '@/components/RecordLog'
import FilterPill from '@/components/FilterPill'
import WindowToggle from '@/components/WindowToggle'
import Pagination from '@/components/Pagination'
import HorizontalBarChart from '@/components/HorizontalBarChart'
import type { Sf311Complaint, SfNov, SfComplaintBreakdownItem, SfViolationBreakdownItem } from '@/lib/types'

// ── row components ──────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string | null }) {
  const isOpen = status?.toLowerCase() === 'active' || status?.toLowerCase() === 'open'
  return (
    <span style={{
      display: 'inline-block', padding: '2px 7px', borderRadius: 4,
      fontSize: 10, fontFamily: 'var(--font-mono)', letterSpacing: '0.06em',
      fontWeight: 500,
      color: isOpen ? '#7F1D1D' : '#166534',
      background: isOpen ? '#FEF2F2' : '#F0FDF4',
    }}>
      {isOpen ? 'Open' : (status ?? 'Unknown')}
    </span>
  )
}

function ComplaintRow({ c }: { c: Sf311Complaint }) {
  return (
    <tr style={{ borderBottom: '0.5px solid #E5E5E5' }}>
      <td style={{ padding: '12px 16px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
        <StatusBadge status={c.status_description} />
      </td>
      <td style={{ padding: '12px 8px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#525252' }}>
          {fmtDate(c.requested_datetime)}
        </span>
      </td>
      <td style={{ padding: '12px 8px 12px 0', verticalAlign: 'top' }}>
        <span style={{ fontSize: 13, color: '#111111', display: 'block', lineHeight: 1.4 }}>
          {c.service_subtype
            ? c.service_subtype.replace(/_/g, ' ').replace(/\b\w/g, s => s.toUpperCase())
            : c.service_name ?? '—'}
        </span>
      </td>
    </tr>
  )
}

function NovRow({ v }: { v: SfNov }) {
  return (
    <tr style={{ borderBottom: '0.5px solid #E5E5E5' }}>
      <td style={{ padding: '12px 16px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
        <StatusBadge status={v.status} />
      </td>
      <td style={{ padding: '12px 8px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#525252' }}>
          {fmtDate(v.date_filed)}
        </span>
      </td>
      <td style={{ padding: '12px 8px', verticalAlign: 'top' }}>
        <span style={{ fontSize: 13, color: '#111111', display: 'block', lineHeight: 1.4 }}>
          {v.nov_category_description ?? '—'}
        </span>
      </td>
      <td style={{ padding: '12px 8px', verticalAlign: 'top' }}>
        <span style={{ fontSize: 13, color: '#111111', display: 'block', lineHeight: 1.4 }}>
          {v.item ?? '—'}
        </span>
      </td>
      <td style={{ padding: '12px 8px 12px 0', verticalAlign: 'top' }}>
        <span style={{ fontSize: 12, color: '#525252', display: 'block', lineHeight: 1.4 }}>
          {v.nov_item_description ?? '—'}
        </span>
      </td>
    </tr>
  )
}

// ── mobile cards (shown ≤640px via RecordLog's log-cards-wrap) ─────────────────

function ComplaintCard({ c }: { c: Sf311Complaint }) {
  return (
    <div style={{ padding: '14px 16px', borderBottom: '0.5px solid #E5E5E5' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <StatusBadge status={c.status_description} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#525252' }}>{fmtDate(c.requested_datetime)}</span>
      </div>
      <div style={{ fontSize: 13, color: '#111111', lineHeight: 1.4 }}>
        {c.service_subtype
          ? c.service_subtype.replace(/_/g, ' ').replace(/\b\w/g, s => s.toUpperCase())
          : c.service_name ?? '—'}
      </div>
    </div>
  )
}

function NovCard({ v }: { v: SfNov }) {
  return (
    <div style={{ padding: '14px 16px', borderBottom: '0.5px solid #E5E5E5' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <StatusBadge status={v.status} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#525252' }}>{fmtDate(v.date_filed)}</span>
      </div>
      <div style={{ fontSize: 13, color: '#111111', lineHeight: 1.4 }}>
        {v.nov_category_description ?? '—'}
        {v.item && <span style={{ color: '#525252' }}> · {v.item}</span>}
      </div>
      {v.nov_item_description && (
        <div style={{ fontSize: 11, color: '#525252', marginTop: 4, lineHeight: 1.4 }}>{v.nov_item_description}</div>
      )}
    </div>
  )
}

export default async function SfBuildingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ page?: string; show?: string; cw?: string; vst?: string }>
}) {
  const { id } = await params
  const { page: pageStr, show, cw, vst: vstStr } = await searchParams
  const page = parseInt(pageStr ?? '1', 10) || 1
  const showTab = show === 'violations' ? 'violations' : show === 'complaints' ? 'complaints' : null
  const vst: 'Open' | 'Close' | undefined = vstStr === 'Open' ? 'Open' : vstStr === 'Close' ? 'Close' : undefined
  const allTime = cw === 'all'              // default view: last 5 years
  const breakdownYears = allTime ? 0 : 5    // 0 → API returns all-time

  let building
  try {
    building = await getSfBuilding(id, page, showTab ?? undefined, vst)
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound()
    throw e
  }

  const [complaintTimeline, violationTimeline, complaintBreakdown, violationBreakdown] = await Promise.all([
    getSfComplaintsTimeline(id),
    getSfViolationsTimeline(id),
    getSfComplaintsBreakdown(id, breakdownYears),
    getSfViolationsBreakdown(id, breakdownYears),
  ])

  // ── derived values ──────────────────────────────────────────────────────────
  const address = building.address ?? 'Unknown address'
  const nhood   = building.neighborhood ?? 'San Francisco'
  const violPct = building.violations_density_pct
  const complPct = building.complaints_density_pct

  const neighborhoodHeadline = pctHeadline(violPct, complPct)
  const neighborhoodSub      = pctSub(violPct, complPct, nhood, {
    missingMessage: CITY_CONFIG.SF.rankMissingMessage,
    trailingNote: CITY_CONFIG.SF.rankTrailingNote,
  })

  // Activity over the last 2 years vs. the prior history, from the timelines.
  const cutoffStr = (() => {
    const d = new Date()
    d.setFullYear(d.getFullYear() - 2)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })()
  const recentViol  = violationTimeline.filter(p => p.month >= cutoffStr).reduce((s, p) => s + p.count, 0)
  const recentCompl = complaintTimeline.filter(p => p.month >= cutoffStr).reduce((s, p) => s + p.count, 0)
  const historicTotal = (building.total_complaints + building.total_violations) - (recentViol + recentCompl)
  const recentTotal   = recentViol + recentCompl

  const activityHeadline =
      historicTotal === 0 && recentTotal === 0 ? 'No activity on record'
    : recentTotal === 0                         ? 'No recent activity, older records on file'
    : recentTotal < 5  && historicTotal < 5     ? 'Few records on file'
    : recentTotal < 5  && historicTotal >= 5    ? 'Mostly historical, limited recent activity'
    : recentTotal >= 5 && recentTotal >= historicTotal * 0.5 ? 'More activity recently than in past years'
    :                                             'A steady level of activity over time'
  const activitySub = recentTotal + historicTotal > 0
    ? `Last 2 yrs: ${recentViol} violation${recentViol !== 1 ? 's' : ''} · ${recentCompl} complaint${recentCompl !== 1 ? 's' : ''}`
    : 'No timeline data available.'

  // Complaint severity tiers, last 5 years (see the "Complaint severity" card)
  const severeCount  = building.severe_complaints_5yr
  const seriousCount = building.serious_complaints_5yr
  const minorCount   = building.minor_complaints_5yr

  const openViolations = building.open_violations
  const severityHeadline = openViolations === 0 && building.total_violations > 0
    ? 'All DBI violations have been resolved'
    : openViolations === 0
    ? 'No open DBI violations on record'
    : building.open_fire_violations > 0
    ? `${building.open_fire_violations} open fire-safety violation${building.open_fire_violations !== 1 ? 's' : ''}`
    : `${openViolations} open DBI violation${openViolations !== 1 ? 's' : ''}`
  const severitySub = openViolations === 0
    ? 'Notices of Violation issued by the Department of Building Inspection, by current status.'
    : 'Active Notices of Violation issued by the Department of Building Inspection.'

  const metaLine = [
    nhood,
    'San Francisco, CA',
    `Parcel ${id}`,
    building.latest_violation_date && `Last violation ${fmtDate(building.latest_violation_date)}`,
    building.latest_complaint_date && `Last complaint ${fmtDate(building.latest_complaint_date)}`,
  ].filter(Boolean).join(' · ')

  // No records for this parcel — EAS still resolves the address, so this is a
  // clean building, not a 404. Mirror the NYC empty state: full nav + hero and
  // a plain-language "no records on file" body.
  if (building.total_complaints === 0 && building.total_violations === 0) {
    return (
      <>
        <BuildingNavBar backHref="/sf/map" backLabel="← Back to map" leaderboardHref="/sf/leaderboard" aboutHref="/sf/methodology" />
        <main className="px-4 sm:px-6 pt-8 pb-20" style={{ maxWidth: 1260, margin: '0 auto' }}>
          <BuildingHero
            address={address}
            meta={metaLine}
            explainerLabel="Data Source: SF 311 & Dept. of Building Inspection"
            explainerText={[
              '311 complaints are housing-related reports submitted by tenants or the public.',
              'DBI Notices of Violation are issued after the Department of Building Inspection verifies a code violation.',
            ]}
            badge={<div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#525252', marginBottom: 6 }}>No records on file</div>}
            bordered
          />
          <div style={{ maxWidth: 640, margin: '0 auto', padding: '4rem 1.5rem', textAlign: 'center' }}>
            <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 28, fontWeight: 500, color: '#111111', letterSpacing: '-0.02em', margin: '0 0 16px' }}>
              No records on file
            </h2>
            <p style={{ fontSize: 15, color: '#525252', lineHeight: 1.7, margin: 0 }}>
              This parcel has no SF 311 housing complaints or DBI Notices of Violation on record.
              A clean record is a good sign, though newly filed reports can take time to appear here.
            </p>
          </div>
        </main>
      </>
    )
  }

  // ── records log helpers ─────────────────────────────────────────────────────
  const pageSize        = building.page_size ?? 50
  const complaintsTotal = building.complaints_total_count ?? 0
  const violationsTotal = building.violations_total_count ?? 0

  // Top-categories window toggle (5 yrs ↔ all time), preserving open log state.
  function cwUrl(window: 'all' | '5yr') {
    const sp = new URLSearchParams()
    if (window === 'all') sp.set('cw', 'all')
    if (showTab) sp.set('show', showTab)
    if (showTab === 'violations' && vst) sp.set('vst', vst)
    const qs = sp.toString()
    return `/sf/building/${id}${qs ? `?${qs}` : ''}`
  }

  function toggleHref(t: 'complaints' | 'violations') {
    const sp = new URLSearchParams()
    if (showTab !== t) sp.set('show', t)
    if (allTime) sp.set('cw', 'all')
    if (t === 'violations' && showTab === 'violations' && vst) sp.set('vst', vst)
    const qs = sp.toString()
    return `/sf/building/${id}${qs ? `?${qs}` : ''}#log-controls`
  }

  function pageHref(p: number) {
    const sp = new URLSearchParams()
    if (showTab) sp.set('show', showTab)
    if (allTime) sp.set('cw', 'all')
    if (showTab === 'violations' && vst) sp.set('vst', vst)
    sp.set('page', String(p))
    return `/sf/building/${id}?${sp}#log-controls`
  }

  // Status filter for the violation log; resets pagination to page 1.
  function violFilterUrl(nextVst: 'Open' | 'Close' | undefined) {
    const sp = new URLSearchParams()
    sp.set('show', 'violations')
    if (allTime) sp.set('cw', 'all')
    if (nextVst) sp.set('vst', nextVst)
    return `/sf/building/${id}?${sp}#log-controls`
  }

  const cwToggle = () => (
    <WindowToggle fiveYrHref={cwUrl('5yr')} allHref={cwUrl('all')} allTime={allTime} />
  )

  const toggleBtn = (t: 'complaints' | 'violations', label: string) => {
    const active = showTab === t
    return (
      <Link
        href={toggleHref(t)}
        style={{
          fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500,
          padding: '8px 14px', borderRadius: 8, textDecoration: 'none', whiteSpace: 'nowrap',
          border: active ? '0.5px solid #111111' : '0.5px solid #6B6B6B',
          background: active ? '#111111' : '#FFFFFF',
          color: active ? '#FFFFFF' : '#111111',
        }}
      >
        {active ? `Hide ${label} ↑` : `See ${label} →`}
      </Link>
    )
  }

  return (
    <>
      <BuildingNavBar backHref="/sf/map" backLabel="← Back to map" leaderboardHref="/sf/leaderboard" aboutHref="/sf/methodology" />

      <main className="px-4 sm:px-6 pt-8 pb-20" style={{ maxWidth: 1260, margin: '0 auto' }}>
        <BuildingHero
          address={address}
          meta={metaLine}
          explainerLabel="Data Source: SF 311 & Dept. of Building Inspection"
          explainerText={[
            '311 complaints are housing-related reports submitted by tenants or the public. The risk level ranks this building by complaints per 1,000 sq ft of estimated building volume against others in the same neighborhood.',
            'DBI Notices of Violation are issued after the Department of Building Inspection verifies a code violation. Risk is based on total violation volume normalized to building footprint and height.',
          ]}
          bordered
        />

        {/* Three insight cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" style={{ marginBottom: 12 }}>
          <InsightCard eyebrow="Neighborhood" aside={nhood} headline={neighborhoodHeadline} sub={neighborhoodSub}>
            <RankViz markers={[
              { percentile: violPct, label: 'Violations' },
              { percentile: complPct, label: 'Complaints' },
            ]} />
          </InsightCard>
          <InsightCard eyebrow="Activity Trends" aside="Last 5 years" headline={activityHeadline} sub={activitySub}>
            <CombinedTrendViz seriesA={violationTimeline} seriesB={complaintTimeline} adaptiveBuckets />
          </InsightCard>
          <InsightCard
            eyebrow="Severity"
            aside="open violations"
            headline={severityHeadline}
            sub={severitySub}
            tooltip="DBI Notices of Violation that remain in an active status, including any flagged as fire-safety or lead hazards."
          >
            <div>
              {[
                { label: 'Open fire-safety violations', value: building.open_fire_violations },
                { label: 'Open lead violations', value: building.open_lead_violations },
              ].map(({ label, value }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '0.5px solid #F5F5F5' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#525252' }}>{label}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: value > 0 ? '#7F1D1D' : '#6B6B6B', fontVariantNumeric: 'tabular-nums' }}>
                    {value.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </InsightCard>
        </div>

        {/* KPI row — 311 complaints */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#6B6B6B', marginBottom: 6 }}>
            311 Housing Complaints
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <TrendStatCard noun="complaints" total={building.total_complaints} timeline={complaintTimeline} minEvents={CITY_CONFIG.SF.trendMinEvents} />
            <StatListCard
              title="Complaint severity"
              aside="Last 5 years"
              value={severeCount + seriousCount + minorCount}
              emptyMessage="No complaints reported in the last 5 years."
              rows={[
                { label: 'Severe', value: severeCount, alert: severeCount > 0,
                  tooltip: 'Immediately hazardous problems — no heat or hot water, lead paint, fire hazards, blocked exits, or missing smoke/fire-safety equipment.' },
                { label: 'Serious', value: seriousCount, alert: seriousCount > 0,
                  tooltip: 'Serious habitability problems — rodents or other pests, mold, plumbing leaks, broken doors or windows, or inadequate ventilation.' },
                { label: 'Minor', value: minorCount,
                  tooltip: 'Lower-impact, quality-of-life issues — general maintenance, peeling paint, garbage, or clutter.' },
              ]}
            />
          </div>
        </div>

        {/* KPI row — DBI violations */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#6B6B6B', marginBottom: 6 }}>
            Dept. of Building Inspection Violations
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <TrendStatCard noun="violations" total={building.total_violations} timeline={violationTimeline} minEvents={CITY_CONFIG.SF.trendMinEvents} />
            <StatListCard
              title="Open violations"
              value={openViolations}
              rows={[
                { label: 'Fire safety', value: building.open_fire_violations, alert: building.open_fire_violations > 0,
                  tooltip: 'Active DBI Notices of Violation in the fire-safety category.' },
                { label: 'Lead', value: building.open_lead_violations, alert: building.open_lead_violations > 0,
                  tooltip: 'Active DBI Notices of Violation related to lead hazards.' },
              ]}
            />
          </div>
        </div>

        {/* Top categories */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" style={{ marginBottom: 12 }}>
          {violationBreakdown.length > 0 && (
            <div style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 12, padding: '20px 24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#525252', margin: 0 }}>
                  Top violation categories
                </h2>
                {cwToggle()}
              </div>
              <HorizontalBarChart
                data={violationBreakdown.map((r: SfViolationBreakdownItem) => ({
                  label: r.category,
                  count: r.count,
                  tooltip: r.open_count > 0 ? `${r.open_count} open` : undefined,
                }))}
                unit="violations"
              />
            </div>
          )}
          {complaintBreakdown.length > 0 && (
            <div style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 12, padding: '20px 24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#525252', margin: 0 }}>
                  Top complaint types
                </h2>
                {cwToggle()}
              </div>
              <HorizontalBarChart
                data={complaintBreakdown.map((r: SfComplaintBreakdownItem) => ({
                  label: r.subtype.replace(/_/g, ' ').replace(/\b\w/g, s => s.toUpperCase()),
                  count: r.count,
                }))}
                unit="complaints"
              />
            </div>
          )}
        </div>

        {/* Log toggle buttons */}
        <div id="log-controls" style={{ display: 'flex', gap: 8, marginBottom: 12, scrollMarginTop: '72px' }}>
          {toggleBtn('violations', `violations (${building.total_violations.toLocaleString()})`)}
          {toggleBtn('complaints', `complaints (${building.total_complaints.toLocaleString()})`)}
        </div>

        {/* Violation log */}
        {showTab === 'violations' && (
          <div style={{ marginBottom: 12 }}>
            <RecordLog<SfNov>
              title="Violation log"
              countLabel={`${violationsTotal.toLocaleString()} DBI violations${vst ? ` · ${vst === 'Open' ? 'Open' : 'Closed'}` : ''}`}
              columns={['Status', 'Filed', 'Category', 'Item', 'NOV Item Description']}
              items={building.violations}
              renderRow={(v) => <NovRow key={v.row_id} v={v} />}
              renderCard={(v) => <NovCard key={v.row_id} v={v} />}
              emptyText="No DBI violation records match the current filter."
              filters={<>
                <FilterPill label="All"    active={!vst}            href={violFilterUrl(undefined)} />
                <FilterPill label="Open"   active={vst === 'Open'}  href={violFilterUrl('Open')} />
                <FilterPill label="Closed" active={vst === 'Close'} href={violFilterUrl('Close')} />
              </>}
            />
            {violationsTotal > pageSize && (
              <div style={{ marginTop: 16 }}>
                <Pagination page={page} totalPages={Math.ceil(violationsTotal / pageSize)} prevHref={pageHref(page - 1)} nextHref={pageHref(page + 1)} />
              </div>
            )}
          </div>
        )}

        {/* Complaint log */}
        {showTab === 'complaints' && (
          <div style={{ marginBottom: 12 }}>
            <RecordLog<Sf311Complaint>
              title="Complaint log"
              countLabel={`${complaintsTotal.toLocaleString()} 311 complaints`}
              columns={['Status', 'Filed', 'Type']}
              items={building.complaints}
              renderRow={(c) => <ComplaintRow key={c.service_request_id} c={c} />}
              renderCard={(c) => <ComplaintCard key={c.service_request_id} c={c} />}
              emptyText="No 311 complaint records found."
            />
            {complaintsTotal > pageSize && (
              <div style={{ marginTop: 16 }}>
                <Pagination page={page} totalPages={Math.ceil(complaintsTotal / pageSize)} prevHref={pageHref(page - 1)} nextHref={pageHref(page + 1)} />
              </div>
            )}
          </div>
        )}

        <div style={{ textAlign: 'center', paddingTop: 8 }}>
          <a href="https://www.sf.gov/departments/311-customer-service-center" target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-mono)', fontSize: 11, color: '#737373', textDecoration: 'none' }}>
            See something wrong?{' '}
            <span style={{ color: '#111111' }}>File a complaint with SF 311</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6B6B6B" strokeWidth="2" style={{ flexShrink: 0 }}>
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </a>
        </div>
      </main>
    </>
  )
}
