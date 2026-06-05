import React from 'react'
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

  const base: React.CSSProperties = {
    fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.07em',
    textTransform: 'uppercase', textDecoration: 'none',
    padding: '5px 12px', borderRadius: 20, border: '0.5px solid',
    display: 'inline-block', lineHeight: 1,
  }

  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {([
        { key: 'hpd' as const, label: 'Housing Conditions' },
        { key: 'dob' as const, label: 'Building Safety' },
      ] as const).map(({ key, label }) => {
        const isActive = active === key
        if (isActive) {
          return (
            <span key={key} style={{ ...base, background: '#111111', borderColor: '#111111', color: '#FFFFFF' }}>
              {label}
            </span>
          )
        }
        return (
          <Link key={key} href={url(key)} style={{ ...base, background: 'transparent', borderColor: '#D4D4D4', color: '#525252' }}>
            {label}
          </Link>
        )
      })}
    </div>
  )
}
