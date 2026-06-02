'use client'
import { useState } from 'react'

export default function TooltipIcon({ text, direction = 'up', align = 'center' }: { text: string; direction?: 'up' | 'down'; align?: 'left' | 'center' | 'right' }) {
  const [visible, setVisible] = useState(false)
  const placement = direction === 'down'
    ? { top: 'calc(100% + 6px)', bottom: 'auto' }
    : { bottom: 'calc(100% + 6px)', top: 'auto' }
  const alignStyle = align === 'right'
    ? { right: 0, left: 'auto' as const, transform: 'none' }
    : align === 'left'
    ? { left: 0, transform: 'none' }
    : { left: '50%' as const, transform: 'translateX(-50%)' }
  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      <span style={{ cursor: 'help', color: '#6B6B6B', fontSize: 11, letterSpacing: 0, textTransform: 'none', lineHeight: 1 }}>
        ⓘ
      </span>
      {visible && (
        <span style={{
          position: 'absolute', ...placement, ...alignStyle,
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
