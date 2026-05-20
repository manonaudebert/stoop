import Link from 'next/link'

type Props = {
  label: string
  active: boolean
  href: string
}

export default function FilterPill({ label, active, href }: Props) {
  return (
    <Link
      href={href}
      style={{
        display: 'inline-block', padding: '4px 10px', borderRadius: 20,
        fontSize: 11, fontFamily: 'var(--font-mono)', textDecoration: 'none',
        background: active ? '#111111' : '#F5F5F5',
        color: active ? '#FFFFFF' : '#525252',
        border: `0.5px solid ${active ? '#111111' : '#E5E5E5'}`,
      }}
    >
      {label}
    </Link>
  )
}
