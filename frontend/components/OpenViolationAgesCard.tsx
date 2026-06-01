'use client'
import { useState } from 'react'
import type { ViolationAgeBucketItem } from '@/lib/types'

const AGE_BUCKET_LABELS: Record<string, string> = {
  '<30d':   '< 30 days',
  '30-90d': '30–90 days',
  '3-12mo': '3–12 months',
  '1-3yr':  '1–3 years',
  '3yr+':   '3+ years',
}

const AGE_BUCKET_COLORS: Record<string, string> = {
  '<30d':   '#D4D4D4',
  '30-90d': '#A3A3A3',
  '3-12mo': '#737373',
  '1-3yr':  '#7F1D1D',
  '3yr+':   '#7F1D1D',
}

// Bar-fill opacity — grays at full, reds muted like the RankViz track
const AGE_BUCKET_OPACITY: Record<string, number> = {
  '<30d':   1,
  '30-90d': 1,
  '3-12mo': 1,
  '1-3yr':  0.55,
  '3yr+':   0.85,
}

export default function OpenViolationAgesCard({ data }: { data: ViolationAgeBucketItem[] }) {
  const [hovered, setHovered] = useState<string | null>(null)
  const total = data.reduce((s, d) => s + d.count, 0)

  if (total === 0) return (
    <div style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 12, padding: '18px 20px' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#737373', marginBottom: 12 }}>
        Open violation ages
      </div>
      <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#A3A3A3', margin: 0 }}>No open violations</p>
    </div>
  )

  let cursor = 0
  const segments = data.map(({ bucket, count }) => {
    const pct = total > 0 ? (count / total) * 100 : 0
    const seg = { bucket, count, pct, offset: cursor }
    cursor += pct
    return seg
  })

  const hoveredSeg = segments.find(s => s.bucket === hovered) ?? null

  return (
    <div style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 12, padding: '18px 20px' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#737373', marginBottom: 12 }}>
        Open violation ages
      </div>

      <div style={{ position: 'relative', marginBottom: 14 }}>
        <svg
          width="100%" height={12}
          style={{ display: 'block', borderRadius: 4, overflow: 'hidden', cursor: 'default' }}
        >
          <rect x="0" y="0" width="100%" height="12" fill="#F5F5F5" />
          {segments.map(({ bucket, pct, offset }) => pct > 0 && (
            <rect
              key={bucket}
              x={`${offset}%`} y="0"
              width={`${pct}%`} height="12"
              fill={AGE_BUCKET_COLORS[bucket] ?? '#525252'}
              opacity={(AGE_BUCKET_OPACITY[bucket] ?? 1) * (hovered === null || hovered === bucket ? 1 : 0.35)}
              onMouseEnter={() => setHovered(bucket)}
              onMouseLeave={() => setHovered(null)}
            />
          ))}
        </svg>

        {hoveredSeg && (
          <div style={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            left: `clamp(0px, calc(${hoveredSeg.offset + hoveredSeg.pct / 2}% - 60px), calc(100% - 120px))`,
            width: 120,
            background: '#111111',
            color: '#FFFFFF',
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            lineHeight: 1.5,
            padding: '6px 8px',
            borderRadius: 6,
            boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
            pointerEvents: 'none',
            zIndex: 10,
          }}>
            <div style={{ fontWeight: 500 }}>{AGE_BUCKET_LABELS[hoveredSeg.bucket] ?? hoveredSeg.bucket}</div>
            <div style={{ color: '#A3A3A3' }}>
              {hoveredSeg.count} · {Math.round(hoveredSeg.pct)}%
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {data.map(({ bucket, count }) => {
          const pct = total > 0 ? Math.round((count / total) * 100) : 0
          const color = AGE_BUCKET_COLORS[bucket] ?? '#525252'
          return (
            <div key={bucket} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#525252' }}>
                <span style={{ color, opacity: AGE_BUCKET_OPACITY[bucket] ?? 1 }}>▪</span> {AGE_BUCKET_LABELS[bucket] ?? bucket}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#525252', fontVariantNumeric: 'tabular-nums' }}>
                {pct}% <span style={{ color: '#A3A3A3' }}>({count})</span>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
