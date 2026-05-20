'use client'
import { useState } from 'react'

export default function BuildingExplainer({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ marginTop: 10 }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em',
          textTransform: 'uppercase', color: '#737373', background: 'none',
          border: 'none', cursor: 'pointer', padding: 0,
          display: 'flex', alignItems: 'center', gap: 6, userSelect: 'none',
        }}
      >
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s', flexShrink: 0 }}>
          <path d="M2 4.5l4 4 4-4" stroke="#A3A3A3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        {label}
      </button>
      {open && (
        <p style={{ fontSize: 12, color: '#737373', lineHeight: 1.55, margin: '6px 0 0 0', fontFamily: 'var(--font-sans)' }}>
          {text}
        </p>
      )}
    </div>
  )
}
