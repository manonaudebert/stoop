'use client'
import { useState } from 'react'

export default function TooltipIcon({ text, direction = 'up' }: { text: string; direction?: 'up' | 'down' }) {
  const [visible, setVisible] = useState(false)
  const placement = direction === 'down'
    ? { top: 'calc(100% + 6px)', bottom: 'auto' }
    : { bottom: 'calc(100% + 6px)', top: 'auto' }
  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      <span style={{ cursor: 'help', color: '#A3A3A3', fontSize: 11, letterSpacing: 0, textTransform: 'none', lineHeight: 1 }}>
        ⓘ
      </span>
      {visible && (
        <span style={{
          position: 'absolute', ...placement, left: '50%',
          transform: 'translateX(-50%)',
          background: '#111111', color: '#FFFFFF',
          fontSize: 11, fontFamily: 'var(--font-sans)', fontWeight: 400,
          lineHeight: 1.5, letterSpacing: 0, textTransform: 'none',
          padding: '8px 10px', borderRadius: 6,
          width: 220, whiteSpace: 'normal',
          boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
          zIndex: 10, pointerEvents: 'none',
        }}>
          {text}
        </span>
      )}
    </span>
  )
}
