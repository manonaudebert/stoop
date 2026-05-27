type Marker = { percentile: number | null; label: string }

function ordinal(n: number): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  return `${n}${ ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th' }`
}

const MARKER_COLORS = ['#7F1D1D', '#1D4ED8']

function Track({ y }: { y: number }) {
  return (
    <>
      <rect x="0"   y={y} width="44" height="6" fill="#84A98C" opacity="0.45" />
      <rect x="44"  y={y} width="44" height="6" fill="#84A98C" opacity="0.7" />
      <rect x="88"  y={y} width="44" height="6" fill="#E4A11B" opacity="0.6" />
      <rect x="132" y={y} width="44" height="6" fill="#E4A11B" opacity="0.85" />
      <rect x="176" y={y} width="44" height="6" fill="#7F1D1D" opacity="0.7" />
    </>
  )
}

export default function RankViz({
  percentile,
  markers,
}: {
  percentile?: number | null
  markers?: Marker[]
}) {
  if (markers) {
    return (
      <svg viewBox="0 0 220 58" style={{ width: '100%', height: 'auto', display: 'block' }}>
        <Track y={18} />
        {markers.map((m, i) => {
          if (m.percentile == null) return null
          const color = MARKER_COLORS[i] ?? '#111111'
          const cx = Math.min(Math.max((m.percentile / 100) * 220, 6), 214)
          return (
            <g key={i}>
              <line x1={cx} y1="10" x2={cx} y2="32" stroke={color} strokeWidth="1.5" />
              <circle cx={cx} cy="21" r="4" fill="#FFFFFF" stroke={color} strokeWidth="1.5" />
            </g>
          )
        })}
        {/* Legend */}
        {markers.map((m, i) => {
          const color = MARKER_COLORS[i] ?? '#111111'
          const x = i === 0 ? 0 : 112
          return (
            <g key={i} transform={`translate(${x}, 40)`}>
              <line x1="0" y1="4" x2="10" y2="4" stroke={color} strokeWidth="1.5" />
              <circle cx="5" cy="4" r="2.5" fill="#FFFFFF" stroke={color} strokeWidth="1.5" />
              <text x="14" y="8" fontFamily="'JetBrains Mono'" fontSize="8" fill="#525252">{m.label}</text>
            </g>
          )
        })}
      </svg>
    )
  }

  // Single-marker (legacy)
  if (percentile == null) {
    return (
      <svg viewBox="0 0 220 48" style={{ width: '100%', height: 'auto', display: 'block' }}>
        <line x1="0" y1="29" x2="220" y2="29" stroke="#E5E5E5" strokeWidth="6" strokeLinecap="round" />
        <text x="110" y="44" textAnchor="middle" fontFamily="'JetBrains Mono'" fontSize="9" fill="#737373">not comparable</text>
      </svg>
    )
  }

  const markerX   = Math.min(Math.max((percentile / 100) * 220, 6), 214)
  const nearLeft  = markerX < 28
  const nearRight = markerX > 192
  const labelX    = nearLeft ? 0 : nearRight ? 220 : markerX
  const anchor    = nearLeft ? 'start' : nearRight ? 'end' : 'middle'
  return (
    <svg viewBox="0 0 220 58" style={{ width: '100%', height: 'auto', display: 'block' }}>
      {/* Percentile label — above the stem */}
      <text x={labelX} y={10} textAnchor={anchor as 'start' | 'middle' | 'end'}
        fontFamily="'JetBrains Mono'" fontSize="8" fill="#525252">
        {ordinal(Math.round(percentile))} pct
      </text>
      <Track y={36} />
      <line x1={markerX} y1="14" x2={markerX} y2="50" stroke="#111111" strokeWidth="1.5" />
      <circle cx={markerX} cy="39" r="4" fill="#FFFFFF" stroke="#111111" strokeWidth="1.5" />
    </svg>
  )
}
