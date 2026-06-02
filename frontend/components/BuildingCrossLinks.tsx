import Link from 'next/link'

type Item = { label: string; href?: string }

export default function BuildingCrossLinks({ items }: { items: Item[] }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 24 }}>
      {items.map(item => {
        const active = !item.href
        const base: React.CSSProperties = {
          fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.07em',
          textTransform: 'uppercase', textDecoration: 'none',
          padding: '5px 12px', borderRadius: 20, border: '0.5px solid',
          display: 'inline-block', lineHeight: 1,
        }
        if (active) {
          return (
            <span key={item.label} style={{ ...base, background: '#111111', borderColor: '#111111', color: '#FFFFFF' }}>
              {item.label}
            </span>
          )
        }
        return (
          <Link key={item.label} href={item.href!} style={{ ...base, background: 'transparent', borderColor: '#D4D4D4', color: '#525252' }}>
            {item.label}
          </Link>
        )
      })}
    </div>
  )
}
