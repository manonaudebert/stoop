import TooltipIcon from './TooltipIcon'

export type StatListRow = {
  label: string
  value: number
  alert?: boolean
  tooltip?: string
}

// A KPI card with one headline number and a list of labeled sub-rows. Each row
// can flag itself as an alert (rendered red when non-zero) and carry a tooltip.
// Generic over title/rows so it serves "open violations", "open complaints",
// or any similar breakdown across cities.
type Props = {
  title: string
  value: number
  rows: StatListRow[]
}

export default function StatListCard({ title, value, rows }: Props) {
  return (
    <div style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 12, padding: '18px 20px' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#525252', marginBottom: 8 }}>
        {title}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 32, fontWeight: 500, color: '#111111', lineHeight: 1, fontVariantNumeric: 'tabular-nums', marginBottom: 14 }}>
        {value.toLocaleString()}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {rows.map(({ label, value: v, alert, tooltip }) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderTop: '0.5px solid #F5F5F5' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-mono)', fontSize: 11, color: '#525252' }}>
              {label}
              {tooltip && <TooltipIcon text={tooltip} />}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500, fontVariantNumeric: 'tabular-nums', color: alert && v > 0 ? '#7F1D1D' : v > 0 ? '#111111' : '#6B6B6B' }}>
              {v.toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
