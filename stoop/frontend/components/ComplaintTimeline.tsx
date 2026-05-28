'use client'

import { useState } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'
import type { TimelinePoint } from '@/lib/types'

type EnrichedPoint = { month: string; old: number; mid: number; recent: number }

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '?'
  try {
    const [y, m, d] = iso.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    })
  } catch { return iso }
}

function toMonthStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: any[]; label?: string }) {
  if (!active || !payload?.length) return null
  const total = (payload as { value: number }[]).reduce((s, p) => s + (p.value || 0), 0)
  if (!total) return null
  return (
    <div style={{ background: '#111111', borderRadius: 4, padding: '6px 10px' }}>
      <p style={{ fontSize: 10, color: '#737373', marginBottom: 2 }}>{label}</p>
      <p style={{ fontSize: 13, color: '#FFFFFF', fontWeight: 500 }}>{total} complaints</p>
    </div>
  )
}

export default function ComplaintTimeline({
  data,
  firstDate,
  lastDate,
}: {
  data: TimelinePoint[]
  firstDate?: string | null
  lastDate?: string | null
}) {
  const [showFull, setShowFull] = useState(false)

  if (!data.length) return <p style={{ fontSize: 13, color: '#525252' }}>No timeline data.</p>

  const today = new Date()
  const twoYearsAgo = new Date(today.getFullYear() - 2, today.getMonth(), 1)
  const fiveYearsAgo = new Date(today.getFullYear() - 5, today.getMonth(), 1)
  const twoYearsStr = toMonthStr(twoYearsAgo)
  const fiveYearsStr = toMonthStr(fiveYearsAgo)

  const hasRecentData = data.some(d => d.month >= fiveYearsStr && d.count > 0)
  const windowStartStr = (() => {
    if (hasRecentData || !lastDate) return fiveYearsStr
    const [y, m] = lastDate.split('-').map(Number)
    return toMonthStr(new Date(y - 5, m - 1, 1))
  })()
  const windowLabel = (() => {
    if (hasRecentData || !lastDate) return 'Last 5 years'
    const endYear = lastDate.slice(0, 4)
    const startYear = String(Number(endYear) - 5)
    return `${startYear}–${endYear}`
  })()

  const visibleData = showFull ? data : data.filter(d => d.month >= windowStartStr)
  const hasOlderData = data.some(d => d.month < windowStartStr)

  const enriched: EnrichedPoint[] = visibleData.map(d => {
    const dt = new Date(d.month + '-01')
    const isRecent = dt >= twoYearsAgo
    const isMid = !isRecent && dt >= fiveYearsAgo
    return {
      month: d.month,
      old: !isRecent && !isMid ? d.count : 0,
      mid: isMid ? d.count : 0,
      recent: isRecent ? d.count : 0,
    }
  })

  const existingMonths = new Set(enriched.map(d => d.month))
  const dataStart = enriched[0]?.month ?? ''
  const dataEnd = enriched[enriched.length - 1]?.month ?? ''

  const boundaries = showFull ? [fiveYearsStr, twoYearsStr] : [twoYearsStr]
  for (const m of boundaries) {
    if (!existingMonths.has(m) && m >= dataStart && m <= dataEnd) {
      enriched.push({ month: m, old: 0, mid: 0, recent: 0 })
    }
  }
  enriched.sort((a, b) => a.month.localeCompare(b.month))

  const inRange = (m: string) => m >= dataStart && m <= dataEnd

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#737373', margin: 0 }}>
          {firstDate && <>First filed {fmtDate(firstDate)}.</>}
          {lastDate && <> Latest: {fmtDate(lastDate)}.</>}
        </p>
        {hasOlderData && (
          <button
            onClick={() => setShowFull(v => !v)}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500,
              color: '#7F1D1D', background: 'none', border: 'none',
              cursor: 'pointer', padding: 0, letterSpacing: '0.04em', flexShrink: 0,
            }}
          >
            {showFull ? windowLabel : 'Full history'}
          </button>
        )}
      </div>

      <ResponsiveContainer width="100%" height={190}>
        <AreaChart data={enriched} margin={{ top: 4, right: 8, left: -8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="#E5E5E5" strokeWidth={0.5} vertical={false} />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 10, fill: '#737373', fontFamily: 'JetBrains Mono' }}
            tickFormatter={(v: string) => v.slice(0, 4)}
            interval="preserveStartEnd"
            minTickGap={40}
            axisLine={{ stroke: '#E5E5E5', strokeWidth: 0.5 }}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#737373', fontFamily: 'JetBrains Mono' }}
            allowDecimals={false}
            axisLine={false}
            tickLine={false}
            width={28}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#737373', strokeWidth: 1, strokeDasharray: '2 2' }} />
          {showFull && inRange(fiveYearsStr) && (
            <ReferenceLine
              x={fiveYearsStr}
              stroke="#A3A3A3"
              strokeDasharray="3 3"
              label={{ value: '5 yrs ago', fontSize: 9, fill: '#737373', position: 'insideTopLeft' }}
            />
          )}
          {inRange(twoYearsStr) && (
            <ReferenceLine
              x={twoYearsStr}
              stroke="#A3A3A3"
              strokeDasharray="3 3"
              label={{ value: '2 yrs ago', fontSize: 9, fill: '#737373', position: 'insideTopLeft' }}
            />
          )}
          <Area type="monotone" dataKey="old"    stackId="a" stroke="none" fill="#E5E5E5" fillOpacity={1} dot={false} />
          <Area type="monotone" dataKey="mid"    stackId="a" stroke="none" fill="#A3A3A3" fillOpacity={0.6} dot={false} />
          <Area type="monotone" dataKey="recent" stackId="a" stroke="none" fill="#7F1D1D" fillOpacity={0.85} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </>
  )
}
