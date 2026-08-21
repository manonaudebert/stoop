'use client'

import TooltipIcon from '@/components/TooltipIcon'

export type BarItem = {
  label: string
  count: number
  tooltip?: string
  // A row that belongs in the list but not on the scale. SF's violation card
  // uses it for notices naming no condition: they are real records and often
  // the largest count, so charting them normally would set `max` and squash
  // every actual condition into a sliver of a bar that means nothing. Muted
  // rows are excluded from `max`, drawn without a fill, and sorted last.
  muted?: boolean
  note?: string
}

export default function HorizontalBarChart({ data, unit }: { data: BarItem[]; unit?: string }) {
  const visible = data.filter(d => d.count > 0)
  if (!visible.length) return null
  const scaled = visible.filter(d => !d.muted)
  // Falls back to the muted rows only when they are all there is, so a card
  // with nothing but unnamed notices still renders rather than dividing by -Inf.
  const max = Math.max(...(scaled.length ? scaled : visible).map(d => d.count))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {[...visible].sort((a, b) => Number(a.muted ?? false) - Number(b.muted ?? false))
        .map(({ label, count, tooltip, muted, note }) => (
        <div key={label} style={muted ? { marginTop: 4, paddingTop: 10, borderTop: '0.5px solid #F0F0F0' } : undefined}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-mono)', fontSize: 11, color: muted ? '#8A8A8A' : '#525252' }}>
              {label}
              {tooltip && <TooltipIcon text={tooltip} />}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: muted ? '#8A8A8A' : '#525252', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
              {count.toLocaleString()}{unit ? ` ${unit}` : ''}
            </span>
          </div>
          {muted ? (
            // A dashed rule where the bar would be: the row keeps its place in
            // the list, and reads at a glance as "not on this scale".
            <div style={{ height: 6, borderBottom: '1px dashed #E5E5E5' }} />
          ) : (
            <div style={{ height: 6, background: '#F5F5F5', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.round(count / max * 100)}%`, background: '#D4D1C3', borderRadius: 3 }} />
            </div>
          )}
          {note && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#8A8A8A', marginTop: 4, lineHeight: 1.5 }}>
              {note}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
