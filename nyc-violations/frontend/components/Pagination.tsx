import Link from 'next/link'

type Props = {
  page: number
  totalPages: number
  prevHref: string
  nextHref: string
}

export default function Pagination({ page, totalPages, prevHref, nextHref }: Props) {
  if (totalPages <= 1) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', borderTop: '0.5px solid #E5E5E5' }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#737373' }}>
        Page {page} of {totalPages}
      </span>
      <div style={{ display: 'flex', gap: 8 }}>
        {page > 1 && (
          <Link href={prevHref} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500, padding: '6px 12px', borderRadius: 8, border: '0.5px solid #A3A3A3', color: '#111111', textDecoration: 'none' }}>
            ← Prev
          </Link>
        )}
        {page < totalPages && (
          <Link href={nextHref} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500, padding: '6px 12px', borderRadius: 8, border: '0.5px solid #A3A3A3', color: '#111111', textDecoration: 'none' }}>
            Next →
          </Link>
        )}
      </div>
    </div>
  )
}
