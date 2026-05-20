export default function RankViz({ percentile }: { percentile: number | null }) {
  if (percentile == null) {
    return (
      <svg viewBox="0 0 220 48" style={{ width: '100%', height: 'auto', display: 'block' }}>
        <line x1="0" y1="29" x2="220" y2="29" stroke="#E5E5E5" strokeWidth="6" strokeLinecap="round" />
        <text x="110" y="44" textAnchor="middle" fontFamily="'JetBrains Mono'" fontSize="9" fill="#737373">not comparable</text>
      </svg>
    )
  }

  const markerX = Math.min(Math.max((percentile / 100) * 220, 6), 214)

  return (
    <svg viewBox="0 0 220 48" style={{ width: '100%', height: 'auto', display: 'block' }}>
      <rect x="0"   y="26" width="44" height="6" fill="#84A98C" opacity="0.45" />
      <rect x="44"  y="26" width="44" height="6" fill="#84A98C" opacity="0.7" />
      <rect x="88"  y="26" width="44" height="6" fill="#E4A11B" opacity="0.6" />
      <rect x="132" y="26" width="44" height="6" fill="#E4A11B" opacity="0.85" />
      <rect x="176" y="26" width="44" height="6" fill="#7F1D1D" opacity="0.7" />
      <line x1={markerX} y1="18" x2={markerX} y2="40" stroke="#111111" strokeWidth="1.5" />
      <circle cx={markerX} cy="29" r="4" fill="#FFFFFF" stroke="#111111" strokeWidth="1.5" />
    </svg>
  )
}
