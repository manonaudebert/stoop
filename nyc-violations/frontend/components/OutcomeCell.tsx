'use client'

import { useState } from 'react'

export default function OutcomeCell({
  description,
  code,
}: {
  description: string | null
  code: string | null
}) {
  const [expanded, setExpanded] = useState(false)

  if (!description) {
    return (
      <span style={{ fontSize: 11, color: '#6B6B65', fontFamily: 'var(--font-mono)' }}>
        {code ?? '—'}
      </span>
    )
  }

  const text = description.charAt(0).toUpperCase() + description.slice(1).toLowerCase()
  const isLong = text.length > 120

  return (
    <p style={{ fontSize: 12, color: '#111111', whiteSpace: 'normal', lineHeight: 1.4, maxWidth: 320, margin: 0 }}>
      {isLong && !expanded ? text.slice(0, 120) : text}
      {isLong && !expanded && (
        <>
          {'… '}
          <button
            onClick={() => setExpanded(true)}
            style={{ fontSize: 11, color: '#0601B4', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
          >
            more
          </button>
        </>
      )}
    </p>
  )
}
