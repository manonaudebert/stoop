import Link from 'next/link'

// Segmented "5 yrs / All time" control used on building pages to switch the
// time window of a card (timelines, top-category breakdowns). Both cities pass
// their own href builders so the same control serves NYC and SF.
type Props = {
  fiveYrHref: string
  allHref: string
  allTime: boolean
}

function seg(active: boolean) {
  return {
    fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500,
    padding: '4px 9px', borderRadius: 6, textDecoration: 'none',
    background: active ? '#111111' : 'transparent',
    color: active ? '#FFFFFF' : '#737373',
    border: active ? 'none' : '0.5px solid #D4D4D4',
  } as const
}

export default function WindowToggle({ fiveYrHref, allHref, allTime }: Props) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      <Link href={fiveYrHref} scroll={false} style={seg(!allTime)}>5 yrs</Link>
      <Link href={allHref} scroll={false} style={seg(allTime)}>All time</Link>
    </div>
  )
}
