'use client'

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import type { CategoryBreakdownItem } from '@/lib/types'

const PRIORITY_COLORS: Record<string, string> = {
  A: '#7F1D1D',
  B: '#E4A11B',
  C: '#84A98C',
  D: '#D4D4D4',
}

export default function ComplaintBreakdown({ data }: { data: CategoryBreakdownItem[] }) {
  if (!data.length) return <p style={{ fontSize: 13, color: '#525252' }}>No breakdown data.</p>

  const top = data.slice(0, 8)
  const max = Math.max(...top.map(d => d.count))

  const LEGEND = [
    { priority: 'A', label: 'Imminent' },
    { priority: 'B', label: 'Serious'  },
    { priority: 'C', label: 'Standard' },
    { priority: 'D', label: 'Minor'    },
  ]

  return (
    <>
    <div style={{ display: 'flex', gap: 14, marginBottom: 10, flexWrap: 'wrap' }}>
      {LEGEND.map(({ priority, label }) => (
        <span key={priority} style={{ display: 'inline-flex', alignItems: 'center', gap: 5,
          fontFamily: 'var(--font-mono)', fontSize: 10, color: '#525252' }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0,
            background: PRIORITY_COLORS[priority] ?? '#D4D4D4' }} />
          {priority} — {label}
        </span>
      ))}
    </div>
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={top} layout="vertical" margin={{ top: 0, right: 8, left: 4, bottom: 0 }} barCategoryGap="30%">
        <XAxis
          type="number"
          domain={[0, max]}
          tick={{ fontSize: 10, fill: '#737373', fontFamily: 'JetBrains Mono' }}
          allowDecimals={false}
          axisLine={{ stroke: '#E5E5E5', strokeWidth: 0.5 }}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="description"
          width={280}
          tick={{ fontSize: 12, fill: '#525252' }}
          tickFormatter={(v: string) => {
            if (!v) return '?'
            return v.length > 45 ? v.slice(0, 45) + '…' : v
          }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={{ background: '#111111', border: 'none', borderRadius: 4, padding: '6px 10px' }}
          labelStyle={{ fontSize: 10, color: '#737373' }}
          itemStyle={{ fontSize: 13, color: '#FFFFFF', fontWeight: 500 }}
          cursor={{ fill: 'rgba(17,17,17,0.04)' }}
          formatter={(v) => [v, 'complaints']}
          labelFormatter={(_: unknown, payload: readonly { payload?: CategoryBreakdownItem }[]) => {
            const item = payload?.[0]?.payload
            return item ? item.description ?? `Priority ${item.priority ?? '?'}` : ''
          }}
        />
        <Bar dataKey="count" radius={[0, 3, 3, 0]} background={{ fill: '#F5F5F5', radius: 3 }}>
          {top.map((entry, i) => (
            <Cell key={i} fill={PRIORITY_COLORS[entry.priority ?? ''] ?? '#D4D4D4'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
    </>
  )
}
