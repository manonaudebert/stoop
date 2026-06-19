import Link from 'next/link'

type Item = { label: string; href?: string }

export default function BuildingCrossLinks({ items }: { items: Item[] }) {
  return (
    <div
      role="tablist"
      aria-label="Dataset"
      style={{ display: 'flex', gap: 26, borderBottom: '1px solid #E5E5E5', marginBottom: 24 }}
    >
      {items.map(item => {
        const active = !item.href
        const base: React.CSSProperties = {
          fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.1em',
          textTransform: 'uppercase', textDecoration: 'none',
          background: 'none', padding: '4px 1px 12px', marginBottom: '-1px',
          borderBottom: '2px solid transparent', lineHeight: 1.25,
        }
        if (active) {
          return (
            <span
              key={item.label}
              role="tab"
              aria-selected="true"
              style={{ ...base, color: '#111111', fontWeight: 600, borderBottomColor: '#111111' }}
            >
              {item.label}
            </span>
          )
        }
        return (
          <Link
            key={item.label}
            href={item.href!}
            role="tab"
            aria-selected="false"
            style={{ ...base, color: '#9A9A9A' }}
          >
            {item.label}
          </Link>
        )
      })}
    </div>
  )
}
