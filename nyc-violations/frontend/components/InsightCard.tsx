import TooltipIcon from './TooltipIcon'

type Props = {
  eyebrow: string
  aside?: string
  headline: string
  sub: string
  tooltip?: string
  children?: React.ReactNode
}

export default function InsightCard({ eyebrow, aside, headline, sub, tooltip, children }: Props) {
  return (
    <div style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 12, padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#525252' }}>
          {eyebrow}
          {tooltip && <TooltipIcon text={tooltip} />}
        </span>
        {aside && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#737373' }}>
            {aside}
          </span>
        )}
      </div>
      <div style={{ fontSize: 15, fontWeight: 500, color: '#111111', marginBottom: 4, lineHeight: 1.3 }}>
        {headline}
      </div>
      <div style={{ fontSize: 12, color: '#525252', marginBottom: 16, lineHeight: 1.5 }}>
        {sub}
      </div>
      {children}
    </div>
  )
}
