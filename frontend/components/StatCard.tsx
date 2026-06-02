import TooltipIcon from './TooltipIcon'

type Props = {
  label: string
  value: number | string
  sub?: string          // optional secondary line below the primary value
  subColor?: string     // optional color override for sub (e.g. red for active counts)
  tooltip?: string
}

export default function StatCard({ label, value, sub, subColor, tooltip }: Props) {
  return (
    <div style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 12, padding: '18px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#737373', marginBottom: 8 }}>
        {label}
        {tooltip && <TooltipIcon text={tooltip} />}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 32, fontWeight: 500, color: '#111111', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      {sub && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: subColor ?? '#6B6B6B', marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
          {sub}
        </div>
      )}
    </div>
  )
}
