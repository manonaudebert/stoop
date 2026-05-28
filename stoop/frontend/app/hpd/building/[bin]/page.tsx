import React from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { fmtDate } from '@/lib/fmt'
import RankViz from '@/components/RankViz'
import {
  getHpdBuilding, getHpdTimeline, getHpdBreakdown, getHpdBreakdownRecent, getHpdOpenViolationAges,
  getHpdComplaintBuilding, getHpdComplaintTimeline, getHpdComplaintBreakdown,
  getHpdComplaintMinorBreakdown,
  getHpdComplaintTypePeriodBreakdown, getHpdComplaintResolutionBreakdown,
} from '@/lib/api'
import { MINOR_TO_GROUP, FILTER_GROUP_DESCRIPTIONS, VIOLATION_CATEGORY_TOOLTIPS, type RenterFacingGroup } from '@/lib/constants'
import TooltipIcon from '@/components/TooltipIcon'
import BuildingNavBar from '@/components/BuildingNavBar'
import BuildingHero from '@/components/BuildingHero'
import BuildingCrossLinks from '@/components/BuildingCrossLinks'
import InsightCard from '@/components/InsightCard'
import Pagination from '@/components/Pagination'
import FilterPill from '@/components/FilterPill'
import ViolationTimeline from '@/components/ViolationTimeline'
import ViolationCategoryBreakdown from '@/components/ViolationCategoryBreakdown'
import OpenViolationAgesCard from '@/components/OpenViolationAgesCard'
import type { TimelinePoint, HpdViolation, HpdComplaint, ComplaintTypePeriodItem, ComplaintResolutionItem, ViolationAgeBucketItem } from '@/lib/types'

// ── helpers ───────────────────────────────────────────────────────────────────

function toTitleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
}

function stripLegalPrefix(s: string | null | undefined): string | null {
  if (!s) return null
  if (!s.startsWith('§')) return s
  const idx = s.indexOf(' - ')
  return idx !== -1 ? s.slice(idx + 3).trim() : s
}

const CLASS_META: Record<string, { label: string; color: string; bg: string }> = {
  A: { label: 'Emergency',     color: '#7F1D1D', bg: '#FEF2F2' },
  B: { label: 'Hazardous',     color: '#92400E', bg: '#FFF7ED' },
  C: { label: 'Non-hazardous', color: '#525252', bg: '#F5F5F5' },
  I: { label: 'Informational', color: '#737373', bg: '#FAFAFA' },
}

const TIER_COLORS: Record<string, { color: string; bg: string }> = {
  'Emergency':     { color: '#7F1D1D', bg: '#FEF2F2' },
  'Hazardous':     { color: '#92400E', bg: '#FFF7ED' },
  'Non-hazardous': { color: '#525252', bg: '#F5F5F5' },
  'Active':        { color: '#92400E', bg: '#FFF7ED' },
  'Resolved':      { color: '#166534', bg: '#F0FDF4' },
}

// ── row components ────────────────────────────────────────────────────────────

function ViolationRow({ v }: { v: HpdViolation }) {
  const cls = CLASS_META[v.violation_class ?? ''] ?? CLASS_META.C
  const isOpen = v.violation_status === 'Open'
  return (
    <tr style={{ borderBottom: '0.5px solid #E5E5E5' }}>
      <td style={{ padding: '12px 16px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
        <span style={{ display: 'inline-block', padding: '2px 7px', borderRadius: 4, fontSize: 10, fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', fontWeight: 500, color: cls.color, background: cls.bg }}>
          Class {v.violation_class ?? '?'}
        </span>
      </td>
      <td style={{ padding: '12px 8px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: isOpen ? '#7F1D1D' : '#737373' }}>
          {isOpen ? 'Open' : 'Closed'}
        </span>
        {v.rent_impairing === 'Y' && (
          <span style={{ display: 'block', fontSize: 9, fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', color: '#EF4637', marginTop: 2 }}>
            RENT IMPAIRING
          </span>
        )}
      </td>
      <td style={{ padding: '12px 8px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
        <span style={{ fontSize: 12, color: '#525252' }}>{v.apartment ?? '—'}</span>
      </td>
      <td style={{ padding: '12px 8px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#525252' }}>{fmtDate(v.nov_issued_date)}</span>
      </td>
      <td style={{ padding: '12px 8px 12px 0', verticalAlign: 'top' }}>
        <span style={{ fontSize: 12, color: '#111111', display: 'block', lineHeight: 1.4 }}>
          {v.order_short_description ?? stripLegalPrefix(v.nov_description) ?? '—'}
          {v.order_category && (
            <span style={{ color: '#737373' }}> · {v.order_category}</span>
          )}
        </span>
        {v.nov_description && (
          <span style={{ fontSize: 11, color: '#737373', display: 'block', marginTop: 2, lineHeight: 1.4 }}>
            {v.nov_description}
          </span>
        )}
      </td>
    </tr>
  )
}

function ComplaintRow({ c }: { c: HpdComplaint }) {
  const isOpen = c.complaint_status === 'Open'
  const isEmergency = c.type === 'EMERGENCY'
  return (
    <tr style={{ borderBottom: '0.5px solid #E5E5E5' }}>
      <td style={{ padding: '12px 16px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
        <span style={{ display: 'inline-block', padding: '2px 7px', borderRadius: 4, fontSize: 10, fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', fontWeight: 500, color: isEmergency ? '#7F1D1D' : '#525252', background: isEmergency ? '#FEF2F2' : '#F5F5F5' }}>
          {isEmergency ? 'Emergency' : 'Non-emergency'}
        </span>
      </td>
      <td style={{ padding: '12px 8px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: isOpen ? '#7F1D1D' : '#737373' }}>
          {isOpen ? 'Open' : 'Closed'}
        </span>
      </td>
      <td style={{ padding: '12px 8px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
        <span style={{ fontSize: 12, color: '#525252' }}>{c.apartment ?? '—'}</span>
      </td>
      <td style={{ padding: '12px 8px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#525252' }}>{fmtDate(c.received_date)}</span>
      </td>
      <td style={{ padding: '12px 8px 12px 0', verticalAlign: 'top' }}>
        <span style={{ fontSize: 12, color: '#111111', display: 'block' }}>
          {c.major_category ?? '—'}
          {c.minor_category && c.minor_category !== c.major_category
            ? <span style={{ color: '#737373' }}> · {c.minor_category}</span>
            : null}
        </span>
        {c.status_description && (
          <span style={{ fontSize: 11, color: '#737373', display: 'block', marginTop: 2 }}>{c.status_description}</span>
        )}
      </td>
    </tr>
  )
}

// ── mini visualizations ────────────────────────────────────────────────────────

function HazardViz({ openC, openB }: { openC: number; openB: number }) {
  const maxVal = Math.max(openC, openB, 1)
  const TRACK = 188

  const bars = [
    { label: 'Class C', desc: 'immediately hazardous', count: openC, color: '#7F1D1D' },
    { label: 'Class B', desc: 'hazardous',             count: openB, color: '#92400E' },
  ]

  if (openC + openB === 0) {
    return (
      <svg viewBox="0 0 220 28" style={{ width: '100%', height: 'auto', display: 'block' }}>
        <rect x="0" y="0" width={TRACK} height="6" rx="2" fill="#F0FDF4" />
        <text x="0" y="22" fontFamily="'JetBrains Mono'" fontSize="8" fill="#166534">No open Class B or C violations</text>
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 220 52" style={{ width: '100%', height: 'auto', display: 'block' }}>
      {bars.map(({ label, desc, count, color }, i) => {
        const baseY = i * 26
        const fillW = count > 0 ? Math.max((count / maxVal) * TRACK, 3) : 0
        return (
          <g key={label} transform={`translate(0, ${baseY})`}>
            <text fontFamily="'JetBrains Mono'" fontSize="8" y="10">
              <tspan fontWeight="500" fill={color}>{label}</tspan>
              <tspan fill="#A3A3A3" dx="6">{desc}</tspan>
            </text>
            <rect x="0" y="14" width={TRACK} height="6" rx="2" fill="#F5F5F5" />
            {fillW > 0 && <rect x="0" y="14" width={fillW} height="6" rx="2" fill={color} opacity="0.8" />}
            <text x={TRACK + 6} y="21" fontFamily="'JetBrains Mono'" fontSize="9" fontWeight="500"
              fill={count > 0 ? color : '#D4D4D4'}>{count}</text>
          </g>
        )
      })}
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
      <path d={vPath} fill="none" stroke="#7F1D1D" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx={vPts[vPts.length - 1].x} cy={vPts[vPts.length - 1].y} r="2.5" fill="#7F1D1D" />
      <path d={cPath} fill="none" stroke="#1D4ED8" strokeWidth="1.5" strokeLinejoin="round" strokeDasharray="4 2" />
      <circle cx={cPts[cPts.length - 1].x} cy={cPts[cPts.length - 1].y} r="2.5" fill="#1D4ED8" />
      <text x={firstX} y={baseY + 10} textAnchor="middle" fontFamily="'JetBrains Mono'" fontSize="8" fill="#A3A3A3">
        &apos;{String(years[0]).slice(2)}
      </text>
      <text x={lastX} y={baseY + 10} textAnchor="middle" fontFamily="'JetBrains Mono'" fontSize="8" fill="#A3A3A3">
        &apos;{String(years[years.length - 1]).slice(2)}
      </text>
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


function OpenViolationsCard({ open, classC, classB, rentImpairing }: {
  open: number; classC: number; classB: number; rentImpairing: number
}) {
  const rows = [
    { label: 'Class C (immed. haz.)', value: classC, alert: classC > 0,
      tooltip: 'Verified violations posing immediate danger to occupants, including no heat or hot water, lead paint, mold, rodent/roach infestations, and structural hazards. Default correction window is 24 hours, with longer windows for certain categories (e.g., 21 days for lead and pests).' },
    { label: 'Class B (hazardous)',   value: classB, alert: classB > 0, tooltip: 'Verified hazardous violations that may affect health or safety, including leaks, mold, broken windows or doors, unsafe electrical conditions, and plumbing issues. Default correction window is 30 days.' },
    { label: 'Rent-impairing',        value: rentImpairing, alert: rentImpairing > 0,
      tooltip: 'A specific subset of violations designated by HPD under Multiple Dwelling Law as constituting a fire hazard or serious threat to life, health, or safety. If left uncorrected for more than six months, the landlord is barred from collecting rent (subject to the tenant following statutory procedures).' },
  ]
  return (
    <div style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 12, padding: '18px 20px' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#737373', marginBottom: 8 }}>
        Open violations
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 32, fontWeight: 500, color: '#111111', lineHeight: 1, fontVariantNumeric: 'tabular-nums', marginBottom: 14 }}>
        {open.toLocaleString()}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {rows.map(({ label, value, alert, tooltip }) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderTop: '0.5px solid #F5F5F5' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-mono)', fontSize: 11, color: '#737373' }}>
              {label}
              {tooltip && <TooltipIcon text={tooltip} />}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500, fontVariantNumeric: 'tabular-nums', color: alert && value > 0 ? '#7F1D1D' : value > 0 ? '#111111' : '#A3A3A3' }}>
              {value.toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function TotalViolationsCard({ total, timeline }: { total: number; timeline: TimelinePoint[] }) {
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
    trendColor = '#A3A3A3'
  } else if (prior === 0) {
    trendLabel = recent > 0 ? '↑ Rising — no prior history' : '— No trend data'
    trendColor = recent > 0 ? '#92400E' : '#A3A3A3'
  } else {
    const pct = Math.round(((recent - prior) / prior) * 100)
    const counts = `(${recent.toLocaleString()} vs ${prior.toLocaleString()} prior 2 yrs)`
    if (pct >= 10)       { trendLabel = `↑ Up ${pct}% in the last 2 years ${counts}`;             trendColor = '#7F1D1D' }
    else if (pct <= -10) { trendLabel = `↓ Down ${Math.abs(pct)}% in the last 2 years ${counts}`; trendColor = '#166534' }
    else                 { trendLabel = '→ Stable in the last 2 years';                            trendColor = '#737373' }
  }

  return (
    <div style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 12, padding: '18px 20px' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#737373', marginBottom: 8 }}>
        Total violations since {firstYear}
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

function TotalComplaintsCard({ total, timeline }: { total: number; timeline: TimelinePoint[] }) {
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
    trendColor = '#A3A3A3'
  } else if (prior === 0) {
    trendLabel = recent > 0 ? '↑ Rising — no prior history' : '— No trend data'
    trendColor = recent > 0 ? '#92400E' : '#A3A3A3'
  } else {
    const pct = Math.round(((recent - prior) / prior) * 100)
    const counts = `(${recent.toLocaleString()} vs ${prior.toLocaleString()} prior 2 yrs)`
    if (pct >= 10)       { trendLabel = `↑ Up ${pct}% in the last 2 years ${counts}`;             trendColor = '#7F1D1D' }
    else if (pct <= -10) { trendLabel = `↓ Down ${Math.abs(pct)}% in the last 2 years ${counts}`; trendColor = '#166534' }
    else                 { trendLabel = '→ Stable in the last 2 years';                            trendColor = '#737373' }
  }

  return (
    <div style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 12, padding: '18px 20px' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#737373', marginBottom: 8 }}>
        Total complaints since {firstYear}
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

const RESOLUTION_ROWS: { keys: string[]; label: string }[] = [
  { keys: ['no_access', 'partial_no_access'],          label: 'No access' },
  { keys: ['inspected_violation'],                     label: 'Violation issued' },
  { keys: ['inspected_no_violation'],                  label: 'No violation' },
  { keys: ['phone_resolved'],                          label: 'Phone resolved' },
  { keys: ['open', 'insufficient_time', 'lead_followup', 'section_8_failure', 'unknown'], label: 'Other' },
]

function ComplaintResolutionCard({ data }: { data: ComplaintResolutionItem[] }) {
  const byBucket = Object.fromEntries(data.map(d => [d.bucket, d.count]))
  const total = data.reduce((s, d) => s + d.count, 0)
  const pct = (n: number) => total === 0 ? '—' : `${Math.round((n / total) * 100)}%`

  return (
    <div style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 12, padding: '18px 20px' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#737373', marginBottom: 12 }}>
        Complaint Resolution
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0 16px' }}>
        {RESOLUTION_ROWS.map(({ keys, label }) => {
          const n = keys.reduce((s, k) => s + (byBucket[k] ?? 0), 0)
          return (
            <React.Fragment key={label}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#525252', padding: '5px 0', borderTop: '0.5px solid #F5F5F5' }}>{label}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500, color: '#111111', textAlign: 'right', padding: '5px 0', borderTop: '0.5px solid #F5F5F5', fontVariantNumeric: 'tabular-nums' }}>{pct(n)}</span>
            </React.Fragment>
          )
        })}
        <span />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#A3A3A3', textAlign: 'right', paddingTop: 6 }}>({total.toLocaleString()})</span>
      </div>
    </div>
  )
}

function ComplaintTypePeriodCard({ data }: { data: ComplaintTypePeriodItem[] }) {
  const TYPES = [
    { key: 'IMMEDIATE EMERGENCY', label: 'Immed. Emergency' },
    { key: 'EMERGENCY',           label: 'Emergency' },
    { key: 'NON EMERGENCY',       label: 'Non-Emergency' },
  ]
  const get = (key: string) => data.find(d => d.type === key) ?? { recent_count: 0, prior_count: 0 }
  const recentTotal = data.reduce((s, d) => s + d.recent_count, 0)
  const priorTotal  = data.reduce((s, d) => s + d.prior_count, 0)
  const pct = (n: number, total: number) => total === 0 ? '—' : `${Math.round((n / total) * 100)}%`

  return (
    <div style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 12, padding: '18px 20px' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#737373', marginBottom: 12 }}>
        Urgency breakdown
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '0 16px' }}>
        <span />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#A3A3A3', textAlign: 'right', whiteSpace: 'nowrap' }}>Last 12 mo.</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#A3A3A3', textAlign: 'right', whiteSpace: 'nowrap' }}>Prior 4 yr.</span>
        {TYPES.map(({ key, label }) => {
          const d = get(key)
          return (
            <React.Fragment key={key}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#525252', padding: '5px 0', borderTop: '0.5px solid #F5F5F5' }}>{label}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500, color: '#111111', textAlign: 'right', padding: '5px 0', borderTop: '0.5px solid #F5F5F5', fontVariantNumeric: 'tabular-nums' }}>{pct(d.recent_count, recentTotal)}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500, color: '#737373', textAlign: 'right', padding: '5px 0', borderTop: '0.5px solid #F5F5F5', fontVariantNumeric: 'tabular-nums' }}>{pct(d.prior_count, priorTotal)}</span>
            </React.Fragment>
          )
        })}
        <span />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#A3A3A3', textAlign: 'right', paddingTop: 6 }}>({recentTotal.toLocaleString()})</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#A3A3A3', textAlign: 'right', paddingTop: 6 }}>({priorTotal.toLocaleString()})</span>
      </div>
    </div>
  )
}

// ── page ──────────────────────────────────────────────────────────────────────

export default async function HpdOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ bin: string }>
  searchParams: Promise<{
    show?: string
    charts?: string
    vpage?: string; vcls?: string; vst?: string
    cpage?: string; ccat?: string; cst?: string
  }>
}) {
  const { bin } = await params
  const sp = await searchParams

  const show = sp.show  // 'violations' | 'complaints' | undefined
  const showCharts = sp.charts === '1'
  const vpage = Number(sp.vpage ?? 1)
  const vcls = sp.vcls
  const vst = sp.vst
  const cpage = Number(sp.cpage ?? 1)
  const ccat = sp.ccat
  const cst = sp.cst

  const [violations, violationTimeline, violationBreakdown, violationBreakdownRecent, openViolationAges, complaints, complaintTimeline, complaintBreakdown, complaintTypePeriod, complaintResolution, minorBreakdown] = await Promise.all([
    getHpdBuilding(bin, 1).catch(() => null),
    getHpdTimeline(bin).catch(() => [] as TimelinePoint[]),
    getHpdBreakdown(bin).catch(() => []),
    getHpdBreakdownRecent(bin).catch(() => []),
    getHpdOpenViolationAges(bin).catch(() => [] as ViolationAgeBucketItem[]),
    getHpdComplaintBuilding(bin, 1).catch(() => null),
    getHpdComplaintTimeline(bin).catch(() => [] as TimelinePoint[]),
    getHpdComplaintBreakdown(bin).catch(() => []),
    getHpdComplaintTypePeriodBreakdown(bin).catch(() => [] as ComplaintTypePeriodItem[]),
    getHpdComplaintResolutionBreakdown(bin).catch(() => [] as ComplaintResolutionItem[]),
    getHpdComplaintMinorBreakdown(bin).catch(() => []),
  ])

  if (!violations && !complaints) notFound()

  // Log data — only fetched when the log is toggled open
  const violationsLog = show === 'violations'
    ? await getHpdBuilding(bin, vpage, vcls, vst).catch(() => null)
    : null
  const complaintsLog = show === 'complaints'
    ? await getHpdComplaintBuilding(bin, cpage, ccat, cst).catch(() => null)
    : null

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

  const COMPLAINT_BREAKDOWN_GROUPS = [
    { key: 'heating_hot_water',               label: 'Heat / hot water' },
    { key: 'water_damage_plumbing',           label: 'Water & plumbing' },
    { key: 'mold_pests_sanitation',           label: 'Mold & pests' },
    { key: 'electrical_power',                label: 'Electrical' },
    { key: 'safety_fire',                     label: 'Safety & fire' },
    { key: 'elevator_accessibility',          label: 'Elevator' },
    { key: 'building_maintenance_operations', label: 'Bldg maintenance' },
    { key: 'appliances',                      label: 'Appliances' },
    { key: 'outdoor_structural',              label: 'Outdoor / structural' },
    { key: 'low_priority_admin',              label: 'Admin' },
  ]

  const groupCounts = minorBreakdown.reduce<Record<string, number>>((acc, item) => {
    const group = MINOR_TO_GROUP[item.minor_category]
    if (group) acc[group] = (acc[group] ?? 0) + item.count
    return acc
  }, {})
  const fiveYearComplaintTotal = minorBreakdown.reduce((s, item) => s + item.count, 0)
  const latestComplDate     = complaints?.latest_complaint_date ?? null

  const openClassC  = violationBreakdown.filter(d => d.violation_class === 'C').reduce((s, d) => s + d.open_count, 0)
  const openClassB  = violationBreakdown.filter(d => d.violation_class === 'B').reduce((s, d) => s + d.open_count, 0)
  const openClassA  = violationBreakdown.filter(d => d.violation_class === 'A').reduce((s, d) => s + d.open_count, 0)
  const totalClassC = violationBreakdown.filter(d => d.violation_class === 'C').reduce((s, d) => s + d.count, 0)
  const totalClassB = violationBreakdown.filter(d => d.violation_class === 'B').reduce((s, d) => s + d.count, 0)

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

  const activityHeadline =
      historicTotal === 0 && recentTotal === 0 ? 'No HPD activity on record'
    : recentTotal === 0                         ? 'No recent activity, older records on file'
    : recentTotal < 5  && historicTotal < 5     ? 'Few HPD records on file'
    : recentTotal < 5  && historicTotal >= 5    ? 'Mostly historical, limited recent activity'
    : recentTotal >= 5 && recentTotal >= historicTotal * 0.5 ? 'More activity recently than in past years'
    :                                             'A steady level of activity over time'

  const activitySub = recentTotal + historicTotal > 0
    ? `Last 2 yrs: ${recentViol} violation${recentViol !== 1 ? 's' : ''} · ${recentCompl} complaint${recentCompl !== 1 ? 's' : ''}`
    : 'No timeline data available.'

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

  const recentViolByCategory = new Map<string, number>()
  for (const d of violationBreakdownRecent) {
    const cat = d.category ?? `Class ${d.violation_class}`
    recentViolByCategory.set(cat, (recentViolByCategory.get(cat) ?? 0) + d.count)
  }
  const recentViolTotal = violationBreakdownRecent.reduce((s, d) => s + d.count, 0)
  const topViolCategoriesRecent = Array.from(recentViolByCategory.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)

  const complByCategory = new Map<string, { count: number; open_count: number }>()
  for (const d of complaintBreakdown) {
    const prev = complByCategory.get(d.major_category) ?? { count: 0, open_count: 0 }
    complByCategory.set(d.major_category, { count: prev.count + d.count, open_count: prev.open_count + d.open_count })
  }
  const topComplCategories = Array.from(complByCategory.entries())
    .map(([cat, { count, open_count }]) => ({ violation_class: cat, category: cat, count, open_count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)

  const violPct = violations?.violations_density_pct ?? null
  const complPct = complaints?.complaints_density_pct ?? null

function pctHeadline(vp: number | null, cp: number | null): string {
    const primary = vp ?? cp
    const metric = vp !== null ? 'violations' : 'complaints'
    if (primary === null) return 'Not enough data to compare building size'
    const better = Math.round(100 - primary)
    if (primary <= 20) return `Fewer ${metric} than ${better}% of nearby buildings`
    if (primary <= 40) return `Below-average ${metric} for the neighborhood`
    if (primary <= 60) return `Around average ${metric} for the neighborhood`
    if (primary <= 80) return `Above-average ${metric} for the neighborhood`
    return `More ${metric} than ${primary}% of nearby buildings`
  }

  function pctPhrase(pct: number, metric: string): string {
    const r = Math.round(pct)
    return pct >= 50
      ? `more ${metric} than ${r}% of buildings`
      : `fewer ${metric} than ${100 - r}% of buildings`
  }

  function pctSub(vp: number | null, cp: number | null, nta: string): string {
    if (vp === null && cp === null)
      return 'Building footprint or height data is missing — size-normalized ranking unavailable.'
    const loc = nta || 'the neighborhood'
    const parts: string[] = []
    if (vp !== null) parts.push(pctPhrase(vp, 'violations'))
    if (cp !== null) parts.push(pctPhrase(cp, 'complaints'))
    const joined = parts.join(' and ')
    const first = joined.charAt(0).toUpperCase() + joined.slice(1)
    return `${first} in ${loc}.\nSize-normalized against residential buildings in the neighborhood for issues in the last 10 years.`
  }

  const neighborhoodHeadline = pctHeadline(violPct, complPct)
  const neighborhoodSub = pctSub(violPct, complPct, ntaName)

  const vTierMeta  = TIER_COLORS[violationsTier] ?? { color: '#525252', bg: '#F5F5F5' }
  const cTierMeta  = TIER_COLORS[complaintsTier] ?? { color: '#525252', bg: '#F5F5F5' }
  const metaLine   = [borough, zipCode && `ZIP ${zipCode}`, `BIN ${bin}`, ntaName].filter(Boolean).join(' · ')

  // ── filter/page URL helpers ────────────────────────────────────────────────

  function chartsToggleUrl() {
    const q = new URLSearchParams()
    if (!showCharts) q.set('charts', '1')
    const qs = q.toString()
    return `/hpd/building/${bin}${qs ? `?${qs}` : ''}`
  }

  function violFilterUrl(updates: Record<string, string | undefined>) {
    const q = new URLSearchParams()
    q.set('show', 'violations')
    q.set('vpage', '1')
    const cls = 'vcls' in updates ? updates.vcls : vcls
    const st  = 'vst'  in updates ? updates.vst  : vst
    if (cls) q.set('vcls', cls)
    if (st)  q.set('vst', st)
    return `/hpd/building/${bin}?${q}#log-controls`
  }

  function violPageUrl(p: number) {
    const q = new URLSearchParams()
    q.set('show', 'violations')
    q.set('vpage', String(p))
    if (vcls) q.set('vcls', vcls)
    if (vst)  q.set('vst', vst)
    return `/hpd/building/${bin}?${q}#log-controls`
  }

  function complFilterUrl(updates: Record<string, string | undefined>) {
    const q = new URLSearchParams()
    q.set('show', 'complaints')
    q.set('cpage', '1')
    const cat = 'ccat' in updates ? updates.ccat : ccat
    const st  = 'cst'  in updates ? updates.cst  : cst
    if (cat) q.set('ccat', cat)
    if (st)  q.set('cst', st)
    return `/hpd/building/${bin}?${q}#log-controls`
  }

  function complPageUrl(p: number) {
    const q = new URLSearchParams()
    q.set('show', 'complaints')
    q.set('cpage', String(p))
    if (ccat) q.set('ccat', ccat)
    if (cst)  q.set('cst', cst)
    return `/hpd/building/${bin}?${q}#log-controls`
  }

  // Top complaint categories for filter pills
  const topComplaintCategories = Array.from(
    complaintBreakdown.reduce((acc, d) => {
      acc.set(d.major_category, (acc.get(d.major_category) ?? 0) + d.count)
      return acc
    }, new Map<string, number>())
  ).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([cat]) => cat)

  const violTotalPages = violationsLog ? Math.ceil(violationsLog.total_count / violationsLog.page_size) : 0
  const complTotalPages = complaintsLog ? Math.ceil(complaintsLog.total_count / complaintsLog.page_size) : 0

  return (
    <>
      <BuildingNavBar backHref="/hpd" backLabel="← Back to map" />

      <main style={{ maxWidth: 1260, margin: '0 auto', padding: '32px 24px 80px' }}>

        <BuildingCrossLinks items={[
          { label: 'Building Safety', href: `/dob/building/${bin}` },
          { label: 'Housing Conditions' },
        ]} />

        <BuildingHero
          address={address}
          meta={[
            metaLine,
            latestViolDate && `Last violation ${fmtDate(latestViolDate)}`,
            latestComplDate && `Last complaint ${fmtDate(latestComplDate)}`,
          ].filter(Boolean).join(' · ')}
          explainerLabel="Data Source: NYC Housing Preservation & Development"
          explainerText={[
            "New York City Department of Housing Preservation & Development (HPD) oversees housing conditions that impact tenant safety and quality of life.",
            "Complaints are reports submitted by tenants or the public, while violations are issued after HPD inspectors verify that a building condition violates the NYC Housing Maintenance Code or Multiple Dwelling Law.",
          ]}
          bordered
        />

        {/* Three insight cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: showCharts ? 0 : 12 }}>
          <InsightCard eyebrow="Neighborhood" aside={ntaName || undefined} headline={neighborhoodHeadline} sub={neighborhoodSub}>
            <RankViz markers={[
              { percentile: violPct, label: 'Violations' },
              { percentile: complPct, label: 'Complaints' },
            ]} />
          </InsightCard>
          <InsightCard
            eyebrow="Activity Trends"
            aside="Last 5 years"
            headline={activityHeadline}
            sub={activitySub}
            footer={
              <Link
                href={chartsToggleUrl()}
                scroll={false}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#737373', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                {showCharts ? '▲ Hide all activity over time' : '▼ View all activity over time'}
              </Link>
            }
          >
            <CombinedTrendViz violTimeline={violationTimeline} complTimeline={complaintTimeline} />
          </InsightCard>
          <InsightCard eyebrow="Severity" aside="open violations" headline={hazardHeadline} sub={hazardSub} tooltip="HPD violations are categorized by severity, from Class A (non-hazardous) to Class C (immediately hazardous conditions requiring urgent correction).">
            <HazardViz openC={breakdownOpenC} openB={breakdownOpenB} />
          </InsightCard>
        </div>

        {/* Expandable charts — toggled from Activity card */}
        {showCharts && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, margin: '12px 0' }}>
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
        )}

        {/* KPI rows */}
        <div style={{ marginBottom: 4 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#A3A3A3', marginBottom: 6 }}>
            HPD Violations
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            <TotalViolationsCard total={totalViolations} timeline={violationTimeline} />
            <OpenViolationsCard open={openViolations} classC={openClassC} classB={openClassB} rentImpairing={rentImpairing} />
            <OpenViolationAgesCard data={openViolationAges} />
            <div style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 12, padding: '18px 20px' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#737373', marginBottom: 12 }}>
                Top categories (past 5 yrs)
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {topViolCategoriesRecent.map(([category, count]) => {
                  const pct = recentViolTotal > 0 ? Math.round(count / recentViolTotal * 100) : 0
                  const tooltip = VIOLATION_CATEGORY_TOOLTIPS[category]
                  return (
                    <div key={category} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-mono)', fontSize: 10, color: '#525252' }}>
                        {toTitleCase(category)}
                        {tooltip && <TooltipIcon text={tooltip} />}
                      </span>
                      <span style={{ textAlign: 'right', flexShrink: 0 }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: '#111111', fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#A3A3A3', marginLeft: 4, fontVariantNumeric: 'tabular-nums' }}>({count.toLocaleString()})</span>
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 12, marginBottom: 12 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#A3A3A3', marginBottom: 6 }}>
            HPD Complaints (tenant-reported)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            <TotalComplaintsCard total={totalComplaints} timeline={complaintTimeline} />
            <ComplaintResolutionCard data={complaintResolution} />
            <ComplaintTypePeriodCard data={complaintTypePeriod} />
            <div style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 12, padding: '18px 20px' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#737373', marginBottom: 12 }}>
                Top groups (past 5 yrs)
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[...COMPLAINT_BREAKDOWN_GROUPS]
                  .sort((a, b) => (groupCounts[b.key] ?? 0) - (groupCounts[a.key] ?? 0))
                  .slice(0, 5)
                  .map(({ key, label }) => {
                  const count = groupCounts[key] ?? 0
                  const pct = fiveYearComplaintTotal > 0 ? Math.round(count / fiveYearComplaintTotal * 100) : 0
                  return (
                    <div key={key} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#525252' }}>{label}</span>
                        <TooltipIcon text={FILTER_GROUP_DESCRIPTIONS[key as RenterFacingGroup]} />
                      </span>
                      <span style={{ textAlign: 'right', flexShrink: 0 }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: '#111111', fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#A3A3A3', marginLeft: 4, fontVariantNumeric: 'tabular-nums' }}>({count.toLocaleString()})</span>
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
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

        {/* Log toggle buttons */}
        <div id="log-controls" style={{ display: 'flex', gap: 8, marginBottom: 12, scrollMarginTop: '72px' }}>
          <Link
            href={show === 'violations' ? `/hpd/building/${bin}` : `/hpd/building/${bin}?show=violations#log-controls`}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500,
              padding: '8px 14px', borderRadius: 8, textDecoration: 'none', whiteSpace: 'nowrap',
              border: show === 'violations' ? '0.5px solid #111111' : '0.5px solid #A3A3A3',
              background: show === 'violations' ? '#111111' : '#FFFFFF',
              color: show === 'violations' ? '#FFFFFF' : '#111111',
            }}
          >
            {show === 'violations' ? 'Hide violations ↑' : 'See violations →'}
          </Link>
          <Link
            href={show === 'complaints' ? `/hpd/building/${bin}` : `/hpd/building/${bin}?show=complaints#log-controls`}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500,
              padding: '8px 14px', borderRadius: 8, textDecoration: 'none', whiteSpace: 'nowrap',
              border: show === 'complaints' ? '0.5px solid #111111' : '0.5px solid #A3A3A3',
              background: show === 'complaints' ? '#111111' : '#FFFFFF',
              color: show === 'complaints' ? '#FFFFFF' : '#111111',
            }}
          >
            {show === 'complaints' ? 'Hide complaints ↑' : 'See complaints →'}
          </Link>
        </div>

        {/* Violation log */}
        {show === 'violations' && violationsLog && (
          <div id="violation-log" style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 12, overflow: 'hidden', marginBottom: 12 }}>
            <div style={{ padding: '20px 24px', borderBottom: '0.5px solid #E5E5E5', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#525252', margin: '0 0 4px' }}>
                  Violation log
                </h2>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#A3A3A3', margin: 0 }}>
                  {violationsLog.total_count.toLocaleString()} violations
                  {vcls ? ` · Class ${vcls}` : ''}
                  {vst ? ` · ${vst}` : ''}
                </p>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                <FilterPill label="All classes" active={!vcls} href={violFilterUrl({ vcls: undefined })} />
                {['A', 'B', 'C', 'I'].map(cls => (
                  <FilterPill key={cls} label={`Class ${cls}`} active={vcls === cls} href={violFilterUrl({ vcls: cls })} />
                ))}
                <span style={{ width: 1, background: '#E5E5E5', alignSelf: 'stretch', margin: '0 2px' }} />
                <FilterPill label="All"    active={!vst}             href={violFilterUrl({ vst: undefined })} />
                <FilterPill label="Open"   active={vst === 'Open'}   href={violFilterUrl({ vst: 'Open' })} />
                <FilterPill label="Closed" active={vst === 'Close'}  href={violFilterUrl({ vst: 'Close' })} />
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '0.5px solid #E5E5E5', background: '#FAFAFA' }}>
                    {['Class', 'Status', 'Apt', 'Issued', 'Description'].map(h => (
                      <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#737373', fontWeight: 500, whiteSpace: 'nowrap' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {violationsLog.violations.map((v: HpdViolation) => (
                    <ViolationRow key={v.violation_id} v={v} />
                  ))}
                  {violationsLog.violations.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ padding: '32px 24px', textAlign: 'center', fontSize: 13, color: '#A3A3A3', fontFamily: 'var(--font-mono)' }}>
                        No violations match the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <Pagination page={vpage} totalPages={violTotalPages} prevHref={violPageUrl(vpage - 1)} nextHref={violPageUrl(vpage + 1)} />
          </div>
        )}

        {/* Complaint log */}
        {show === 'complaints' && complaintsLog && (
          <div id="complaint-log" style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 12, overflow: 'hidden', marginBottom: 12 }}>
            <div style={{ padding: '20px 24px', borderBottom: '0.5px solid #E5E5E5', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#525252', margin: '0 0 4px' }}>
                  Complaint log
                </h2>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#A3A3A3', margin: 0 }}>
                  {complaintsLog.total_count.toLocaleString()} complaints
                  {ccat ? ` · ${ccat}` : ''}
                  {cst ? ` · ${cst}` : ''}
                </p>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                <FilterPill label="All categories" active={!ccat} href={complFilterUrl({ ccat: undefined })} />
                {topComplaintCategories.map(cat => (
                  <FilterPill key={cat} label={cat} active={ccat === cat} href={complFilterUrl({ ccat: cat })} />
                ))}
                <span style={{ width: 1, background: '#E5E5E5', alignSelf: 'stretch', margin: '0 2px' }} />
                <FilterPill label="All"    active={!cst}             href={complFilterUrl({ cst: undefined })} />
                <FilterPill label="Open"   active={cst === 'Open'}   href={complFilterUrl({ cst: 'Open' })} />
                <FilterPill label="Closed" active={cst === 'Close'}  href={complFilterUrl({ cst: 'Close' })} />
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '0.5px solid #E5E5E5', background: '#FAFAFA' }}>
                    {['Type', 'Status', 'Apt', 'Received', 'Category'].map(h => (
                      <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#737373', fontWeight: 500, whiteSpace: 'nowrap' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {complaintsLog.complaints.map((c: HpdComplaint) => (
                    <ComplaintRow key={c.problem_id} c={c} />
                  ))}
                  {complaintsLog.complaints.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ padding: '32px 24px', textAlign: 'center', fontSize: 13, color: '#A3A3A3', fontFamily: 'var(--font-mono)' }}>
                        No complaints match the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <Pagination page={cpage} totalPages={complTotalPages} prevHref={complPageUrl(cpage - 1)} nextHref={complPageUrl(cpage + 1)} />
          </div>
        )}

        {/* DOB cross-link note */}
        <div style={{ background: '#FAFAFA', border: '0.5px solid #E5E5E5', borderRadius: 12, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 20 }}>
          <p style={{ fontSize: 13, color: '#525252', margin: 0, lineHeight: 1.5, flex: 1 }}>
            DOB complaints — construction, permits, and structural issues filed with the NYC Dept. of Buildings — are scored separately.
          </p>
          <Link
            href={`/dob/building/${bin}`}
            style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500, padding: '8px 14px', borderRadius: 8, border: '0.5px solid #A3A3A3', color: '#111111', textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0 }}
          >
            DOB complaints →
          </Link>
        </div>

      </main>
    </>
  )
}
