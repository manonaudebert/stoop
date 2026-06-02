'use client'

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts'
import type { ViolationClassBreakdownItem } from '@/lib/types'

const TOP_N = 10

function toTitleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
}

function stripLegalPrefix(s: string): string {
  if (!s.startsWith('§')) return s
  const idx = s.indexOf(' - ')
  return idx !== -1 ? s.slice(idx + 3).trim() : s
}

function cleanLabel(s: string): string {
  return toTitleCase(stripLegalPrefix(s))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: any[]; label?: string }) {
  if (!active || !payload?.length) return null
  const total = payload[0]?.value ?? 0
  return (
    <div style={{ background: '#111111', borderRadius: 4, padding: '6px 10px', maxWidth: 280 }}>
      <p style={{ fontSize: 10, color: '#525252', marginBottom: 4, whiteSpace: 'normal' }}>{label}</p>
      <p style={{ fontSize: 12, color: '#FFFFFF', margin: 0 }}>{total.toLocaleString()} violations</p>
    </div>
  )
}

export default function ViolationCategoryBreakdown({ data }: { data: ViolationClassBreakdownItem[] }) {
  if (!data.length) return null

  const byCat: Record<string, number> = {}
  for (const item of data) {
    const cat = item.category ?? 'Uncategorized'
    byCat[cat] = (byCat[cat] ?? 0) + item.count
  }

  const chartData = Object.entries(byCat)
    .map(([cat, count]) => ({ category: cleanLabel(cat), count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_N)
    .reverse() // largest at top for horizontal layout

  const chartHeight = Math.max(200, chartData.length * 32 + 32)

  return (
    <ResponsiveContainer width="100%" height={chartHeight}>
      <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 24, left: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="2 4" stroke="#E5E5E5" strokeWidth={0.5} horizontal={false} />
        <XAxis
          type="number"
          tick={{ fontSize: 10, fill: '#737373', fontFamily: 'JetBrains Mono' }}
          allowDecimals={false}
          axisLine={{ stroke: '#E5E5E5', strokeWidth: 0.5 }}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="category"
          tick={{ fontSize: 11, fill: '#525252' }}
          width={220}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: string) => v.length > 28 ? v.slice(0, 27) + '…' : v}
        />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
        <Bar dataKey="count" fill="#D4D1C3" radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
