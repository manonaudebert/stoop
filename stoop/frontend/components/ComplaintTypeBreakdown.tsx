'use client'

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts'
import type { ComplaintCategoryBreakdownItem } from '@/lib/types'

const TYPE_META: Record<string, { label: string; color: string; openColor: string }> = {
  'IMMEDIATE EMERGENCY': { label: 'Imm. Emergency', color: '#7F1D1D', openColor: '#450A0A' },
  'EMERGENCY':           { label: 'Emergency',      color: '#EF4637', openColor: '#7F1D1D' },
  'HAZARDOUS':           { label: 'Hazardous',      color: '#F5A047', openColor: '#92400E' },
  'NON EMERGENCY':       { label: 'Non-emergency',  color: '#FFD930', openColor: '#78350F' },
  'REFERRAL':            { label: 'Referral',        color: '#D4D1C3', openColor: '#737373' },
}

const TYPE_ORDER = ['IMMEDIATE EMERGENCY', 'EMERGENCY', 'HAZARDOUS', 'NON EMERGENCY', 'REFERRAL']

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function TypeTooltip({ active, payload, label }: { active?: boolean; payload?: any[]; label?: string }) {
  if (!active || !payload?.length) return null
  const total = payload.find((p: { dataKey: string }) => p.dataKey === 'count')?.value ?? 0
  const open  = payload.find((p: { dataKey: string }) => p.dataKey === 'open_count')?.value ?? 0
  return (
    <div style={{ background: '#111111', borderRadius: 4, padding: '6px 10px' }}>
      <p style={{ fontSize: 10, color: '#737373', marginBottom: 4 }}>{label}</p>
      <p style={{ fontSize: 12, color: '#FFFFFF', margin: '2px 0' }}>{total.toLocaleString()} total</p>
      <p style={{ fontSize: 12, color: '#F5A047', margin: '2px 0' }}>{open.toLocaleString()} open</p>
    </div>
  )
}

export default function ComplaintTypeBreakdown({ data }: { data: ComplaintCategoryBreakdownItem[] }) {
  if (!data.length) return <p style={{ fontSize: 13, color: '#525252' }}>No data.</p>

  // Aggregate by type across all major_categories
  const byType: Record<string, { count: number; open_count: number }> = {}
  for (const item of data) {
    const t = item.type ?? 'NON EMERGENCY'
    if (!byType[t]) byType[t] = { count: 0, open_count: 0 }
    byType[t].count      += item.count
    byType[t].open_count += item.open_count
  }

  const chartData = TYPE_ORDER
    .filter(t => byType[t])
    .map(t => ({
      type: TYPE_META[t]?.label ?? t,
      count: byType[t].count,
      open_count: byType[t].open_count,
      _key: t,
    }))

  if (!chartData.length) return <p style={{ fontSize: 13, color: '#525252' }}>No data.</p>

  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={chartData} margin={{ top: 4, right: 8, left: -8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="2 4" stroke="#E5E5E5" strokeWidth={0.5} vertical={false} />
        <XAxis
          dataKey="type"
          tick={{ fontSize: 11, fill: '#737373', fontFamily: 'JetBrains Mono' }}
          axisLine={{ stroke: '#E5E5E5', strokeWidth: 0.5 }}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 10, fill: '#737373', fontFamily: 'JetBrains Mono' }}
          allowDecimals={false}
          axisLine={false}
          tickLine={false}
          width={36}
        />
        <Tooltip content={<TypeTooltip />} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
        <Bar dataKey="count" name="Total" radius={[3, 3, 0, 0]}>
          {chartData.map(d => (
            <Cell key={d._key} fill={TYPE_META[d._key]?.color ?? '#D4D1C3'} />
          ))}
        </Bar>
        <Bar dataKey="open_count" name="Open" radius={[3, 3, 0, 0]}>
          {chartData.map(d => (
            <Cell key={d._key} fill={TYPE_META[d._key]?.openColor ?? '#737373'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
