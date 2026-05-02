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
      <p style={{ fontSize: 10, color: '#6B6B65', marginBottom: 2 }}>{label}</p>
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

  if (!data.length) return <p style={{ fontSize: 13, color: '#6B6B65' }}>No timeline data.</p>

  const today = new Date()
  const twoYearsAgo = new Date(today.getFullYear() - 2, today.getMonth(), 1)
  const fiveYearsAgo = new Date(today.getFullYear() - 5, today.getMonth(), 1)
  const twoYearsStr = toMonthStr(twoYearsAgo)
  const fiveYearsStr = toMonthStr(fiveYearsAgo)

  // Filter to last 5 years unless full history is requested
  const visibleData = showFull ? data : data.filter(d => d.month >= fiveYearsStr)
  const hasOlderData = data.some(d => d.month < fiveYearsStr)

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

  // Ensure boundary months exist so ReferenceLine can anchor to them
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
        <p style={{ fontSize: 11, color: '#6B6B65', margin: 0 }}>
          {firstDate && <>First filed {fmtDate(firstDate)}.</>}
          {lastDate && <> Latest: {fmtDate(lastDate)}.</>}
        </p>
        {hasOlderData && (
          <button
            onClick={() => setShowFull(v => !v)}
            style={{
              fontSize: 11, fontWeight: 500, color: '#0601B4',
              background: 'none', border: 'none', cursor: 'pointer',
              padding: 0, letterSpacing: '0.02em', flexShrink: 0,
            }}
          >
            {showFull ? 'Last 5 years' : 'Full history'}
          </button>
        )}
      </div>

      <ResponsiveContainer width="100%" height={190}>
        <AreaChart data={enriched} margin={{ top: 4, right: 8, left: -8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="#E5E3DA" strokeWidth={0.5} vertical={false} />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 10, fill: '#6B6B65' }}
            tickFormatter={(v: string) => v.slice(0, 4)}
            interval="preserveStartEnd"
            minTickGap={40}
            axisLine={{ stroke: '#E5E3DA', strokeWidth: 0.5 }}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#6B6B65' }}
            allowDecimals={false}
            axisLine={false}
            tickLine={false}
            width={28}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#6B6B65', strokeWidth: 1, strokeDasharray: '2 2' }} />
          {showFull && inRange(fiveYearsStr) && (
            <ReferenceLine
              x={fiveYearsStr}
              stroke="#6B6B65"
              strokeDasharray="3 3"
              label={{ value: '5 yrs ago', fontSize: 9, fill: '#6B6B65', position: 'insideTopLeft' }}
            />
          )}
          {inRange(twoYearsStr) && (
            <ReferenceLine
              x={twoYearsStr}
              stroke="#6B6B65"
              strokeDasharray="3 3"
              label={{ value: '2 yrs ago', fontSize: 9, fill: '#6B6B65', position: 'insideTopLeft' }}
            />
          )}
          <Area type="monotone" dataKey="old"    stackId="a" stroke="none" fill="#E6E5FF" fillOpacity={1} dot={false} />
          <Area type="monotone" dataKey="mid"    stackId="a" stroke="none" fill="#B5B3F5" fillOpacity={1} dot={false} />
          <Area type="monotone" dataKey="recent" stackId="a" stroke="none" fill="#0601B4" fillOpacity={1} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </>
  )
}
