'use client'

import TooltipIcon from '@/components/TooltipIcon'

export type BarItem = { label: string; count: number; tooltip?: string }

export default function HorizontalBarChart({ data, unit }: { data: BarItem[]; unit?: string }) {
  const visible = data.filter(d => d.count > 0)
  if (!visible.length) return null
  const max = Math.max(...visible.map(d => d.count))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {visible.map(({ label, count, tooltip }) => (
        <div key={label}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-mono)', fontSize: 11, color: '#525252' }}>
              {label}
              {tooltip && <TooltipIcon text={tooltip} />}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#737373', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
              {count.toLocaleString()}{unit ? ` ${unit}` : ''}
            </span>
          </div>
          <div style={{ height: 6, background: '#F5F5F5', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.round(count / max * 100)}%`, background: '#D4D1C3', borderRadius: 3 }} />
          </div>
        </div>
      ))}
    </div>
  )
}
