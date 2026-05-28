import BuildingExplainer from './BuildingExplainer'

type Props = {
  address: string
  meta: string
  explainerLabel: string
  explainerText: string | string[]
  badge?: React.ReactNode
  bordered?: boolean
}

export default function BuildingHero({ address, meta, explainerLabel, explainerText, badge, bordered }: Props) {
  return (
    <div style={bordered
      ? { marginBottom: 28, paddingBottom: 24, borderBottom: '0.5px solid #E5E5E5' }
      : { marginBottom: 32 }
    }>
      {badge}
      <h1 style={{
        fontFamily: 'var(--font-serif)', fontSize: 40, fontWeight: 500,
        color: '#111111', letterSpacing: '-0.02em', lineHeight: 1.1, margin: '0 0 8px',
      }}>
        {address}
      </h1>
      <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#737373', margin: 0 }}>
        {meta}
      </p>
      <BuildingExplainer label={explainerLabel} text={explainerText} />
    </div>
  )
}
