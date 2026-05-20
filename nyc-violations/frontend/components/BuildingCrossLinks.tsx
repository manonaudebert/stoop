import Link from 'next/link'

type Item = { label: string; href?: string; arrow?: boolean }

const BackArrow = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M19 12H5M11 6l-6 6 6 6"/>
  </svg>
)

export default function BuildingCrossLinks({ items }: { items: Item[] }) {
  return (
    <div style={{ marginBottom: 20 }}>
      {items.map((item, i) => (
        <span key={item.label}>
          {i > 0 && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#D4D1C3', margin: '0 8px' }}>·</span>
          )}
          {item.href ? (
            <Link
              href={item.href}
              style={{
                fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em',
                textTransform: 'uppercase', color: '#737373', textDecoration: 'none',
                ...(item.arrow ? { display: 'inline-flex', alignItems: 'center', gap: 6 } : {}),
              }}
            >
              {item.arrow && <BackArrow />}
              {item.label}
            </Link>
          ) : (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#111111', fontWeight: 500 }}>
              {item.label}
            </span>
          )}
        </span>
      ))}
    </div>
  )
}
