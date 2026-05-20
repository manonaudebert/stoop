import TooltipIcon from './TooltipIcon'

type Props = {
  label: string
  value: number | string
  tooltip?: string
}

export default function StatCard({ label, value, tooltip }: Props) {
  return (
    <div style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 12, padding: '18px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#737373', marginBottom: 8 }}>
        {label}
        {tooltip && <TooltipIcon text={tooltip} />}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 32, fontWeight: 500, color: '#111111', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
    </div>
  )
}
