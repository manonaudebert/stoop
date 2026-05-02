'use client'

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import type { CategoryBreakdownItem } from '@/lib/types'

const PRIORITY_COLORS: Record<string, string> = {
  A: '#EF4637',
  B: '#F5A047',
  C: '#FFD930',
  D: '#D4D1C3',
}

export default function ComplaintBreakdown({ data }: { data: CategoryBreakdownItem[] }) {
  if (!data.length) return <p style={{ fontSize: 13, color: '#6B6B65' }}>No breakdown data.</p>

  const top = data.slice(0, 8)
  const max = Math.max(...top.map(d => d.count))

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={top} layout="vertical" margin={{ top: 0, right: 8, left: 4, bottom: 0 }} barCategoryGap="30%">
        <XAxis
          type="number"
          domain={[0, max]}
          tick={{ fontSize: 10, fill: '#6B6B65' }}
          allowDecimals={false}
          axisLine={{ stroke: '#E5E3DA', strokeWidth: 0.5 }}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="description"
          width={280}
          tick={{ fontSize: 12, fill: '#6B6B65' }}
          tickFormatter={(v: string) => {
            if (!v) return '?'
            return v.length > 45 ? v.slice(0, 45) + '…' : v
          }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={{ background: '#111111', border: 'none', borderRadius: 4, padding: '6px 10px' }}
          labelStyle={{ fontSize: 10, color: '#6B6B65' }}
          itemStyle={{ fontSize: 13, color: '#FFFFFF', fontWeight: 500 }}
          cursor={{ fill: 'rgba(6,1,180,0.04)' }}
          formatter={(v) => [v, 'complaints']}
          labelFormatter={(_: unknown, payload: readonly { payload?: CategoryBreakdownItem }[]) => {
            const item = payload?.[0]?.payload
            return item ? item.description ?? `Priority ${item.priority ?? '?'}` : ''
          }}
        />
        <Bar dataKey="count" radius={[0, 3, 3, 0]} background={{ fill: '#F5F3EA', radius: 3 }}>
          {top.map((entry, i) => (
            <Cell key={i} fill={PRIORITY_COLORS[entry.priority ?? ''] ?? '#D4D1C3'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
