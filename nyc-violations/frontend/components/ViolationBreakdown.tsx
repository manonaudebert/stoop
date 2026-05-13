'use client'

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, Legend,
} from 'recharts'
import type { ViolationClassBreakdownItem } from '@/lib/types'

const CLASS_META: Record<string, { label: string; color: string; openColor: string }> = {
  A: { label: 'Class A — Emergency',      color: '#EF4637', openColor: '#7F1D1D' },
  B: { label: 'Class B — Hazardous',      color: '#F5A047', openColor: '#92400E' },
  C: { label: 'Class C — Non-hazardous',  color: '#FFD930', openColor: '#78350F' },
  I: { label: 'Class I — Informational',  color: '#D4D1C3', openColor: '#737373' },
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ClassTooltip({ active, payload, label }: { active?: boolean; payload?: any[]; label?: string }) {
  if (!active || !payload?.length) return null
  const total = payload.find((p: { dataKey: string; value: number }) => p.dataKey === 'count')?.value ?? 0
  const open  = payload.find((p: { dataKey: string; value: number }) => p.dataKey === 'open_count')?.value ?? 0
  return (
    <div style={{ background: '#111111', borderRadius: 4, padding: '6px 10px' }}>
      <p style={{ fontSize: 10, color: '#737373', marginBottom: 4 }}>{label}</p>
      <p style={{ fontSize: 12, color: '#FFFFFF', margin: '2px 0' }}>{total} total</p>
      <p style={{ fontSize: 12, color: '#EF4637', margin: '2px 0' }}>{open} open</p>
    </div>
  )
}


export default function ViolationBreakdown({ data }: { data: ViolationClassBreakdownItem[] }) {
  if (!data.length) return <p style={{ fontSize: 13, color: '#525252' }}>No breakdown data.</p>

  const byClass: Record<string, { count: number; open_count: number }> = {}
  for (const item of data) {
    const cls = item.violation_class
    if (!byClass[cls]) byClass[cls] = { count: 0, open_count: 0 }
    byClass[cls].count      += item.count
    byClass[cls].open_count += item.open_count
  }
  const classData = ['A', 'B', 'C', 'I']
    .filter(cls => byClass[cls])
    .map(cls => ({
      class: cls,
      count: byClass[cls].count,
      open_count: byClass[cls].open_count,
    }))

  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={classData} margin={{ top: 4, right: 8, left: -8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="2 4" stroke="#E5E5E5" strokeWidth={0.5} vertical={false} />
        <XAxis
          dataKey="class"
          tick={{ fontSize: 11, fill: '#737373', fontFamily: 'JetBrains Mono' }}
          tickFormatter={v => `Class ${v}`}
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
        <Tooltip content={<ClassTooltip />} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
        <Bar dataKey="count" name="Total" radius={[3, 3, 0, 0]}>
          {classData.map(d => <Cell key={d.class} fill={CLASS_META[d.class]?.color ?? '#D4D1C3'} />)}
        </Bar>
        <Bar dataKey="open_count" name="Open" radius={[3, 3, 0, 0]}>
          {classData.map(d => <Cell key={d.class} fill={CLASS_META[d.class]?.openColor ?? '#737373'} />)}
        </Bar>
        <Legend formatter={(v) => <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono', color: '#737373' }}>{v}</span>} />
      </BarChart>
    </ResponsiveContainer>
  )
}
