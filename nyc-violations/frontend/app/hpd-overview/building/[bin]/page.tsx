import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  getHpdBuilding, getHpdTimeline, getHpdBreakdown,
  getHpdComplaintBuilding, getHpdComplaintTimeline, getHpdComplaintBreakdown,
} from '@/lib/api'
import BuildingNavBar from '@/components/BuildingNavBar'
import ViolationTimeline from '@/components/ViolationTimeline'
import ViolationCategoryBreakdown from '@/components/ViolationCategoryBreakdown'
import type { TimelinePoint } from '@/lib/types'

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—'
  try {
    const [y, m, d] = iso.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return iso }
}

const TIER_COLORS: Record<string, { color: string; bg: string }> = {
  'Emergency':     { color: '#7F1D1D', bg: '#FEF2F2' },
  'Hazardous':     { color: '#92400E', bg: '#FFF7ED' },
  'Non-hazardous': { color: '#525252', bg: '#F5F5F5' },
  'Active':        { color: '#92400E', bg: '#FFF7ED' },
  'Resolved':      { color: '#166534', bg: '#F0FDF4' },
}

// ── mini visualizations ────────────────────────────────────────────────────────

// Shows open Class C and Class B as a severity scale (most → least severe)
function HazardViz({ openC, openB, openA }: { openC: number; openB: number; openA: number }) {
  const total = openC + openB + openA || 1
  const cW = Math.max((openC / total) * 198, openC > 0 ? 4 : 0)
  const bW = Math.max((openB / total) * 198, openB > 0 ? 4 : 0)
  const aW = Math.max((openA / total) * 198, openA > 0 ? 4 : 0)

  if (openC + openB + openA === 0) {
    return (
      <svg viewBox="0 0 220 52" style={{ width: '100%', height: 'auto', display: 'block' }}>
        <rect x="0" y="16" width="198" height="8" rx="3" fill="#F0FDF4" />
        <text x="0" y="42" fontFamily="'JetBrains Mono'" fontSize="8" fill="#166534">No open violations</text>
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 220 52" style={{ width: '100%', height: 'auto', display: 'block' }}>
      {/* Stacked bar: C (dark red) | B (amber) | A (light) */}
      <rect x="0" y="16" width={cW} height="8" rx="0" fill="#7F1D1D" />
      <rect x={cW} y="16" width={bW} height="8" rx="0" fill="#E4A11B" />
      <rect x={cW + bW} y="16" width={aW} height="8" rx="0" fill="#D4D4D4" />
      <rect x="0" y="16" width="198" height="8" rx="3" fill="transparent" stroke="#E5E5E5" strokeWidth="0.5" />
      {/* Legend */}
      <rect x="0"   y="38" width="8" height="8" rx="1" fill="#7F1D1D" />
      <text x="12"  y="46" fontFamily="'JetBrains Mono'" fontSize="8" fill="#525252">Class C — immediately hazardous ({openC})</text>
      <rect x="0"   y="50" width="8" height="8" rx="1" fill="#E4A11B" />
      <text x="12"  y="58" fontFamily="'JetBrains Mono'" fontSize="8" fill="#525252">Class B — hazardous ({openB})</text>
    </svg>
  )
}

function CombinedTrendViz({ violTimeline, complTimeline }: {
  violTimeline: TimelinePoint[]; complTimeline: TimelinePoint[]
}) {
  const cutoffYear = new Date().getFullYear() - 5
  const violByYear: Record<number, number> = {}
  const complByYear: Record<number, number> = {}

  for (const pt of violTimeline) {
    const y = parseInt(pt.month.slice(0, 4))
    if (y >= cutoffYear) violByYear[y] = (violByYear[y] ?? 0) + pt.count
  }
  for (const pt of complTimeline) {
    const y = parseInt(pt.month.slice(0, 4))
    if (y >= cutoffYear) complByYear[y] = (complByYear[y] ?? 0) + pt.count
  }

  const years = Array.from(
    new Set([...Object.keys(violByYear), ...Object.keys(complByYear)].map(Number))
  ).sort()

  if (years.length < 2) {
    return (
      <svg viewBox="0 0 220 76" style={{ width: '100%', height: 'auto', display: 'block' }}>
        <line x1="0" y1="48" x2="220" y2="48" stroke="#E5E5E5" strokeWidth="0.5" />
        <text x="110" y="30" textAnchor="middle" fontFamily="'JetBrains Mono'" fontSize="9" fill="#737373">not enough history</text>
      </svg>
    )
  }

  const violVals = years.map(y => violByYear[y] ?? 0)
  const complVals = years.map(y => complByYear[y] ?? 0)
  const maxVal = Math.max(...violVals, ...complVals, 1)
  const baseY = 50
  const padX = 8

  function pts(vals: number[]) {
    return vals.map((v, i) => ({
      x: padX + (i / (years.length - 1)) * (220 - 2 * padX),
      y: baseY - Math.round((v / maxVal) * (baseY - 10)),
    }))
  }

  const vPts = pts(violVals)
  const cPts = pts(complVals)
  const vPath = vPts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ')
  const cPath = cPts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ')
  const firstX = vPts[0].x
  const lastX  = vPts[vPts.length - 1].x

  return (
    <svg viewBox="0 0 220 76" style={{ width: '100%', height: 'auto', display: 'block' }}>
      <line x1="0" y1={baseY} x2="220" y2={baseY} stroke="#E5E5E5" strokeWidth="0.5" />
      {/* violations — solid dark red */}
      <path d={vPath} fill="none" stroke="#7F1D1D" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx={vPts[vPts.length - 1].x} cy={vPts[vPts.length - 1].y} r="2.5" fill="#7F1D1D" />
      {/* complaints — dashed blue */}
      <path d={cPath} fill="none" stroke="#1D4ED8" strokeWidth="1.5" strokeLinejoin="round" strokeDasharray="4 2" />
      <circle cx={cPts[cPts.length - 1].x} cy={cPts[cPts.length - 1].y} r="2.5" fill="#1D4ED8" />
      {/* year labels */}
      <text x={firstX} y={baseY + 10} textAnchor="middle" fontFamily="'JetBrains Mono'" fontSize="8" fill="#A3A3A3">
        &apos;{String(years[0]).slice(2)}
      </text>
      <text x={lastX} y={baseY + 10} textAnchor="middle" fontFamily="'JetBrains Mono'" fontSize="8" fill="#A3A3A3">
        &apos;{String(years[years.length - 1]).slice(2)}
      </text>
      {/* legend */}
      <line x1="0" y1="68" x2="10" y2="68" stroke="#7F1D1D" strokeWidth="1.5" />
      <text x="13" y="71" fontFamily="'JetBrains Mono'" fontSize="8" fill="#525252">Violations</text>
      <line x1="68" y1="68" x2="78" y2="68" stroke="#1D4ED8" strokeWidth="1.5" strokeDasharray="4 2" />
      <text x="81" y="71" fontFamily="'JetBrains Mono'" fontSize="8" fill="#525252">Complaints</text>
    </svg>
  )
}

function OpenIssueMiniTable({ openC, openB }: { openC: number; openB: number }) {
  const items = [
    { label: 'Open Class C violations (immed. hazardous)', value: openC, alert: true },
    { label: 'Open Class B violations (hazardous)',         value: openB, alert: openB > 0 },
  ]
  return (
    <div>
      {items.map(({ label, value, alert }) => (
        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '0.5px solid #F5F5F5' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#737373' }}>{label}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: alert && value > 0 ? '#7F1D1D' : value > 0 ? '#111111' : '#A3A3A3' }}>
            {value.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── insight card ──────────────────────────────────────────────────────────────

function InsightCard({ eyebrow, aside, headline, sub, children }: {
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

// ── page ──────────────────────────────────────────────────────────────────────

export default async function HpdOverviewPage({
  params,
}: {
  params: Promise<{ bin: string }>
}) {
  const { bin } = await params

  const [violations, violationTimeline, violationBreakdown, complaints, complaintTimeline, complaintBreakdown] = await Promise.all([
    getHpdBuilding(bin, 1).catch(() => null),
    getHpdTimeline(bin).catch(() => [] as TimelinePoint[]),
    getHpdBreakdown(bin).catch(() => []),
    getHpdComplaintBuilding(bin, 1).catch(() => null),
    getHpdComplaintTimeline(bin).catch(() => [] as TimelinePoint[]),
    getHpdComplaintBreakdown(bin).catch(() => []),
  ])

  if (!violations && !complaints) notFound()

  // ── derived values ──────────────────────────────────────────────────────────
  const address        = violations?.address ?? complaints?.address ?? 'Unknown address'
  const borough        = violations?.borough ?? complaints?.borough ?? ''
  const zipCode        = violations?.zip_code ?? complaints?.zip_code ?? ''
  const ntaName        = violations?.nta_name ?? complaints?.nta_name ?? ''
  const violationsTier = violations?.hpd_risk_tier ?? 'Non-hazardous'
  const complaintsTier = complaints?.complaint_risk_tier ?? 'Resolved'

  const totalViolations = violations?.total_violations ?? 0
  const openViolations  = violations?.open_violations ?? 0
  const rentImpairing   = violations?.rent_impairing_count ?? 0
  const latestViolDate  = violations?.latest_violation_date ?? null

  const totalComplaints     = complaints?.total_complaints ?? 0
  const openComplaints      = complaints?.open_complaints ?? 0
  const emergencyComplaints = complaints?.open_emergency_complaints ?? 0
  const heatComplaints      = complaints?.heat_complaints ?? 0
  const latestComplDate     = complaints?.latest_complaint_date ?? null

  // Violation severity from breakdown (Class C = immediately hazardous, Class B = hazardous, Class A = non-hazardous)
  const openClassC  = violationBreakdown.filter(d => d.violation_class === 'C').reduce((s, d) => s + d.open_count, 0)
  const openClassB  = violationBreakdown.filter(d => d.violation_class === 'B').reduce((s, d) => s + d.open_count, 0)
  const openClassA  = violationBreakdown.filter(d => d.violation_class === 'A').reduce((s, d) => s + d.open_count, 0)
  const totalClassC = violationBreakdown.filter(d => d.violation_class === 'C').reduce((s, d) => s + d.count, 0)
  const totalClassB = violationBreakdown.filter(d => d.violation_class === 'B').reduce((s, d) => s + d.count, 0)

  // ── Card 1: Hazard level ───────────────────────────────────────────────────
  // openViolations (from hpd_building_summary) is the authoritative open count —
  // the same source the violation page header uses. The breakdown gives the C/B/A
  // split but is only trusted when the summary confirms there are open violations.
  const breakdownOpenC = openViolations > 0 ? openClassC : 0
  const breakdownOpenB = openViolations > 0 ? openClassB : 0
  const breakdownOpenA = openViolations > 0 ? openClassA : 0

  const hazardHeadline = openViolations === 0 && totalViolations > 0
    ? 'All violations have been resolved'
    : openViolations === 0
    ? 'No HPD violations on record'
    : breakdownOpenC > 0
    ? `${breakdownOpenC} immediately hazardous (Class C) violation${breakdownOpenC !== 1 ? 's' : ''} still open`
    : breakdownOpenB > 0
    ? `${breakdownOpenB} hazardous (Class B) violation${breakdownOpenB !== 1 ? 's' : ''} still open`
    : rentImpairing > 0
    ? `${rentImpairing} rent-impairing violation${rentImpairing !== 1 ? 's' : ''} unresolved`
    : `${openViolations} open violation${openViolations !== 1 ? 's' : ''} (non-hazardous)`

  const hazardSub = openViolations === 0
    ? totalClassC + totalClassB > 0
      ? `${totalClassC} Class C and ${totalClassB} Class B violations on record — all currently closed.`
      : totalViolations > 0
      ? `${totalViolations.toLocaleString()} violations on record (Class A — non-hazardous).`
      : 'No HPD violation records found.'
    : breakdownOpenC > 0
    ? 'Class C violations include lead paint, mold, pest infestations, heat/hot water failure, and structural hazards — the most serious category.'
    : breakdownOpenB > 0
    ? 'Class B violations are hazardous conditions. Landlords must correct them within 30 days.'
    : 'Open violations are non-hazardous (Class A — 90-day correction window).'

  // ── Card 2: Activity (active vs historical) ────────────────────────────────
  const cutoffStr = (() => {
    const d = new Date()
    d.setFullYear(d.getFullYear() - 2)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })()

  const recentViol    = violationTimeline.filter(p => p.month >= cutoffStr).reduce((s, p) => s + p.count, 0)
  const historicViol  = violationTimeline.filter(p => p.month < cutoffStr).reduce((s, p) => s + p.count, 0)
  const recentCompl   = complaintTimeline.filter(p => p.month >= cutoffStr).reduce((s, p) => s + p.count, 0)
  const historicCompl = complaintTimeline.filter(p => p.month < cutoffStr).reduce((s, p) => s + p.count, 0)
  const recentTotal   = recentViol + recentCompl
  const historicTotal = historicViol + historicCompl

  const activityHeadline = recentTotal === 0 && historicTotal > 0
    ? 'Issues are historical — nothing filed recently'
    : recentTotal > 0 && recentTotal >= historicTotal * 0.5
    ? 'Active period — significant recent HPD activity'
    : recentTotal > 0
    ? 'Some recent activity against a longer history'
    : 'No HPD timeline history on record'

  const activitySub = recentTotal + historicTotal > 0
    ? `Last 2 yrs: ${recentViol} violation${recentViol !== 1 ? 's' : ''} · ${recentCompl} complaint${recentCompl !== 1 ? 's' : ''}`
    : 'No timeline data available.'

  // ── top categories ──────────────────────────────────────────────────────────
  const violByCategory = new Map<string, { count: number; open_count: number }>()
  for (const d of violationBreakdown) {
    const cat = d.category ?? `Class ${d.violation_class}`
    const prev = violByCategory.get(cat) ?? { count: 0, open_count: 0 }
    violByCategory.set(cat, { count: prev.count + d.count, open_count: prev.open_count + d.open_count })
  }
  const topViolCategories = Array.from(violByCategory.entries())
    .map(([cat, { count, open_count }]) => ({ violation_class: cat, category: cat, count, open_count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)

  const complByCategory = new Map<string, { count: number; open_count: number }>()
  for (const d of complaintBreakdown) {
    const prev = complByCategory.get(d.major_category) ?? { count: 0, open_count: 0 }
    complByCategory.set(d.major_category, { count: prev.count + d.count, open_count: prev.open_count + d.open_count })
  }
  const topComplCategories = Array.from(complByCategory.entries())
    .map(([cat, { count, open_count }]) => ({ violation_class: cat, category: cat, count, open_count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)

  // ── Card 3: Neighborhood comparison ───────────────────────────────────────
  const violPct = violations?.violations_density_pct ?? null
  const complPct = complaints?.complaints_density_pct ?? null

  function pctHeadline(vp: number | null, cp: number | null): string {
    const primary = vp ?? cp
    if (primary === null) return 'Not enough data to compare building size'
    const better = Math.round(100 - primary)
    if (primary <= 20) return `Fewer issues than ${better}% of nearby buildings`
    if (primary <= 40) return `Below-average issue rate for the neighborhood`
    if (primary <= 60) return `Around average for the neighborhood`
    if (primary <= 80) return `Above-average issue rate for the neighborhood`
    return `More issues than ${primary}% of nearby buildings`
  }

  function pctSub(vp: number | null, cp: number | null, nta: string): string {
    if (vp === null && cp === null)
      return 'Building footprint or height data is missing — size-normalized ranking unavailable.'
    return `Size-normalized and ranked against residential buildings in ${nta || 'the same neighborhood'}. Adjusts for building scale so a tower and a brownstone are compared fairly.`
  }

  const neighborhoodHeadline = pctHeadline(violPct, complPct)
  const neighborhoodSub = pctSub(violPct, complPct, ntaName)

  const vTierMeta  = TIER_COLORS[violationsTier] ?? { color: '#525252', bg: '#F5F5F5' }
  const cTierMeta  = TIER_COLORS[complaintsTier] ?? { color: '#525252', bg: '#F5F5F5' }
  const metaLine   = [borough, zipCode && `ZIP ${zipCode}`, `BIN ${bin}`, ntaName].filter(Boolean).join(' · ')

  return (
    <>
      <BuildingNavBar backHref="/hpd" backLabel="← HPD map" />

      <main style={{ maxWidth: 1260, margin: '0 auto', padding: '32px 24px 80px' }}>

        {/* Cross-links */}
        <div style={{ marginBottom: 20 }}>
          <Link href={`/building/${bin}`} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#737373', textDecoration: 'none' }}>
            DOB complaints
          </Link>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#D4D1C3', margin: '0 8px' }}>·</span>
          <Link href={`/hpd/building/${bin}`} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#737373', textDecoration: 'none' }}>
            HPD violations
          </Link>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#D4D1C3', margin: '0 8px' }}>·</span>
          <Link href={`/hpd-complaints/building/${bin}`} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#737373', textDecoration: 'none' }}>
            HPD complaints
          </Link>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#D4D1C3', margin: '0 8px' }}>·</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#111111', fontWeight: 500 }}>
            HPD overview
          </span>
        </div>

        {/* Hero */}
        <div style={{ marginBottom: 28, paddingBottom: 24, borderBottom: '0.5px solid #E5E5E5' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 6, fontSize: 10, fontFamily: 'var(--font-mono)', letterSpacing: '0.08em', fontWeight: 500, color: vTierMeta.color, background: vTierMeta.bg, textTransform: 'uppercase' }}>
              Violations: {violationsTier}
            </span>
            <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 6, fontSize: 10, fontFamily: 'var(--font-mono)', letterSpacing: '0.08em', fontWeight: 500, color: cTierMeta.color, background: cTierMeta.bg, textTransform: 'uppercase' }}>
              Complaints: {complaintsTier}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#A3A3A3' }}>HPD Overview</span>
          </div>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 40, fontWeight: 500, color: '#111111', letterSpacing: '-0.02em', lineHeight: 1.1, margin: '0 0 8px' }}>
            {address}
          </h1>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#737373', margin: 0 }}>
            {metaLine}
            {latestViolDate && ` · Last violation ${fmtDate(latestViolDate)}`}
            {latestComplDate && ` · Last complaint ${fmtDate(latestComplDate)}`}
          </p>
        </div>

        {/* Three insight cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 12 }}>
          <InsightCard eyebrow="Hazard level" aside="open violations" headline={hazardHeadline} sub={hazardSub}>
            <HazardViz openC={breakdownOpenC} openB={breakdownOpenB} openA={breakdownOpenA} />
            <div style={{ marginTop: 12 }}>
              <OpenIssueMiniTable openC={breakdownOpenC} openB={breakdownOpenB} />
            </div>
          </InsightCard>
          <InsightCard eyebrow="Activity" aside="Last 5 years" headline={activityHeadline} sub={activitySub}>
            <CombinedTrendViz violTimeline={violationTimeline} complTimeline={complaintTimeline} />
          </InsightCard>
          <InsightCard eyebrow="Neighborhood" aside={ntaName || undefined} headline={neighborhoodHeadline} sub={neighborhoodSub}>
            {(violPct !== null || complPct !== null) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  { label: 'HPD violations', pct: violPct },
                  { label: 'HPD complaints', pct: complPct },
                ].map(({ label, pct }) => {
                  if (pct === null) return null
                  const better = Math.round(100 - pct)
                  const barColor = pct <= 40 ? '#166534' : pct <= 65 ? '#92400E' : '#7F1D1D'
                  const barBg    = pct <= 40 ? '#DCFCE7' : pct <= 65 ? '#FEF3C7' : '#FEF2F2'
                  return (
                    <div key={label}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#737373' }}>{label}</span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, color: barColor }}>
                          better than {better}%
                        </span>
                      </div>
                      <div style={{ height: 6, borderRadius: 3, background: '#F5F5F5', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${better}%`, background: barColor, borderRadius: 3, opacity: 0.7 }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </InsightCard>
        </div>

        {/* KPI rows */}
        <div style={{ marginBottom: 4 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#A3A3A3', marginBottom: 6 }}>
            HPD Violations
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            {[
              { label: 'Total violations',              value: totalViolations },
              { label: 'Open violations',               value: openViolations },
              { label: 'Open Class C (immed. haz.)',    value: openClassC },
              { label: 'Rent impairing',                value: rentImpairing },
            ].map(({ label, value }) => (
              <div key={label} style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 12, padding: '18px 20px' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#737373', marginBottom: 8 }}>
                  {label}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 32, fontWeight: 500, color: '#111111', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                  {value.toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 12, marginBottom: 12 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#A3A3A3', marginBottom: 6 }}>
            HPD Complaints (tenant-reported)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            {[
              { label: 'Total complaints', value: totalComplaints },
              { label: 'Open complaints',  value: openComplaints },
              { label: 'Emergency type',   value: emergencyComplaints },
              { label: 'Heat/hot water',   value: heatComplaints },
            ].map(({ label, value }) => (
              <div key={label} style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 12, padding: '18px 20px' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#737373', marginBottom: 8 }}>
                  {label}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 32, fontWeight: 500, color: '#111111', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                  {value.toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Timelines */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 12, padding: '20px 24px' }}>
            <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#525252', marginBottom: 16, marginTop: 0 }}>
              Violations over time
            </h2>
            <ViolationTimeline data={violationTimeline} latestDate={latestViolDate} />
          </div>
          <div style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 12, padding: '20px 24px' }}>
            <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#525252', marginBottom: 16, marginTop: 0 }}>
              Complaints over time
            </h2>
            <ViolationTimeline data={complaintTimeline} latestDate={latestComplDate} />
          </div>
        </div>

        {/* Top categories */}
        {(topViolCategories.length > 0 || topComplCategories.length > 0) && (
          <div style={{ display: 'grid', gridTemplateColumns: topViolCategories.length > 0 && topComplCategories.length > 0 ? '1fr 1fr' : '1fr', gap: 12, marginBottom: 12 }}>
            {topViolCategories.length > 0 && (
              <div style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 12, padding: '20px 24px' }}>
                <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#525252', marginBottom: 16, marginTop: 0 }}>
                  Top violation categories
                </h2>
                <ViolationCategoryBreakdown data={topViolCategories} />
              </div>
            )}
            {topComplCategories.length > 0 && (
              <div style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 12, padding: '20px 24px' }}>
                <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#525252', marginBottom: 16, marginTop: 0 }}>
                  Top complaint categories
                </h2>
                <ViolationCategoryBreakdown data={topComplCategories} />
              </div>
            )}
          </div>
        )}

        {/* DOB cross-link note */}
        <div style={{ background: '#FAFAFA', border: '0.5px solid #E5E5E5', borderRadius: 12, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 20 }}>
          <p style={{ fontSize: 13, color: '#525252', margin: 0, lineHeight: 1.5, flex: 1 }}>
            DOB complaints — construction, permits, and structural issues filed with the NYC Dept. of Buildings — are scored separately.
          </p>
          <Link
            href={`/building/${bin}`}
            style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500, padding: '8px 14px', borderRadius: 8, border: '0.5px solid #A3A3A3', color: '#111111', textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0 }}
          >
            DOB complaints →
          </Link>
        </div>

      </main>
    </>
  )
}
