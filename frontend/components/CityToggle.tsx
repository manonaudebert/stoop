import React from 'react'
import Link from 'next/link'

type City = 'NYC' | 'SF'

/**
 * Inline segmented NYC | SF switcher. City is the top-level dimension of the
 * app (each city has its own map, leaderboard, and lens model), so this sits
 * next to the wordmark in the map headers and above the dataset toggle on the
 * leaderboards. The active city renders as a static segment; the other links
 * to its equivalent page in the current context (map ↔ map, board ↔ board).
 *
 * - `dark`  matches the near-black map header.
 * - `light` matches the LeaderboardToggle pills on the white leaderboard header.
 */
export default function CityToggle({
  current,
  nycHref,
  sfHref,
  variant = 'light',
}: {
  current: City
  nycHref: string
  sfHref: string
  variant?: 'light' | 'dark'
}) {
  const items: { key: City; href: string }[] = [
    { key: 'NYC', href: nycHref },
    { key: 'SF', href: sfHref },
  ]

  if (variant === 'dark') {
    const base: React.CSSProperties = {
      fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em',
      fontWeight: 600, textDecoration: 'none', padding: '3px 9px', borderRadius: 5,
      lineHeight: 1, display: 'inline-block', transition: 'background 0.15s, color 0.15s',
    }
    return (
      <div style={{
        display: 'flex', gap: 2, flexShrink: 0,
        background: '#000000', border: '0.5px solid #333333', borderRadius: 7, padding: 2,
      }}>
        {items.map(({ key, href }) => {
          const isActive = current === key
          const style: React.CSSProperties = {
            ...base,
            background: isActive ? '#FFFFFF' : 'transparent',
            color: isActive ? '#111111' : '#A3A3A3',
          }
          return isActive
            ? <span key={key} style={style} aria-current="page">{key}</span>
            : <Link key={key} href={href} style={style}>{key}</Link>
        })}
      </div>
    )
  }

  const base: React.CSSProperties = {
    fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.07em',
    textTransform: 'uppercase', textDecoration: 'none',
    padding: '5px 12px', borderRadius: 20, border: '0.5px solid',
    display: 'inline-block', lineHeight: 1,
  }
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {items.map(({ key, href }) => {
        const isActive = current === key
        if (isActive) {
          return (
            <span key={key} aria-current="page" style={{ ...base, background: '#111111', borderColor: '#111111', color: '#FFFFFF' }}>
              {key}
            </span>
          )
        }
        return (
          <Link key={key} href={href} style={{ ...base, background: 'transparent', borderColor: '#D4D4D4', color: '#525252' }}>
            {key}
          </Link>
        )
      })}
    </div>
  )
}
