'use client'

import { useState } from 'react'

type Props = {
  short: string | null
  full: string | null
  category: string | null
}

export default function ViolationDescription({ short, full, category }: Props) {
  const [visible, setVisible] = useState(false)

  return (
    <div style={{ position: 'relative' }}>
      <p
        onMouseEnter={() => full && setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        style={{
          fontSize: 12, color: '#111111', margin: 0, lineHeight: 1.4,
          cursor: full ? 'default' : 'default',
        }}
      >
        {short ?? '—'}
      </p>

      {category && (
        <p style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: '#A3A3A3', margin: '4px 0 0' }}>
          {category}
        </p>
      )}

      {visible && full && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 6px)', left: 0,
          zIndex: 50, width: 320, maxWidth: '80vw',
          background: '#111111', color: '#FFFFFF',
          fontSize: 11, lineHeight: 1.5,
          borderRadius: 6, padding: '8px 12px',
          pointerEvents: 'none',
          boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
        }}>
          {full}
        </div>
      )}
    </div>
  )
}
