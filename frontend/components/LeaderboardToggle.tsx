import Link from 'next/link'

type Dataset = 'dob' | 'hpd'

export default function LeaderboardToggle({
  active,
  borough,
}: {
  active: Dataset
  borough?: string
}) {
  function url(dataset: Dataset) {
    const sp = new URLSearchParams()
    if (borough) sp.set('borough', borough)
    const base = dataset === 'dob' ? '/dob/leaderboard' : '/hpd/leaderboard'
    return `${base}${sp.size ? `?${sp}` : ''}`
  }

  return (
    <div style={{
      display: 'inline-flex',
      background: '#F5F5F5',
      borderRadius: 10,
      padding: 4,
      gap: 3,
      flexShrink: 0,
    }}>
      {([
        { key: 'hpd' as const, label: 'Housing Conditions', sub: 'HPD Complaints' },
        { key: 'dob' as const, label: 'Building Safety',    sub: 'DOB Complaints' },
      ] as const).map(({ key, label, sub }) => (
        <Link
          key={key}
          href={url(key)}
          style={{ textDecoration: 'none' }}
        >
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '6px 14px',
            borderRadius: 7,
            background: active === key ? '#111111' : 'transparent',
            transition: 'background 0.15s',
            minWidth: 110,
          }}>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              fontWeight: 600,
              color: active === key ? '#FFFFFF' : '#525252',
              transition: 'color 0.15s',
              whiteSpace: 'nowrap',
            }}>
              {label}
            </span>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: '#A3A3A3',
              marginTop: 2,
              whiteSpace: 'nowrap',
            }}>
              {sub}
            </span>
          </div>
        </Link>
      ))}
    </div>
  )
}
