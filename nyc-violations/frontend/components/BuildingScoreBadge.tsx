'use client'

type RiskTier = { label: string; bg: string; titleText: string; metaText: string }

function getRiskTier(score: number): RiskTier {
  if (score >= 95) return { label: 'Very low',  bg: '#D4F5CB', titleText: '#1F4012', metaText: '#1F4012' }
  if (score >= 86) return { label: 'Low',        bg: '#A8E5A0', titleText: '#1F4012', metaText: '#1F4012' }
  if (score >= 70) return { label: 'Moderate',   bg: '#FFD930', titleText: '#5C4A0A', metaText: '#5C4A0A' }
  if (score >= 45) return { label: 'High',       bg: '#F5A047', titleText: '#5C3A0A', metaText: '#5C3A0A' }
  return                   { label: 'Very high',  bg: '#EF4637', titleText: '#FFFFFF', metaText: '#FEE2DE' }
}

export default function BuildingScoreBadge({ score }: { score: number | null }) {
  if (score == null) {
    return (
      <div style={{ background: '#F5F3EA', border: '0.5px solid #E5E3DA', borderRadius: 12, padding: '1.5rem 2rem', textAlign: 'center', minWidth: 130 }}>
        <p style={{ fontSize: 56, fontWeight: 500, color: '#D4D1C3', lineHeight: 1, letterSpacing: '-0.03em' }}>—</p>
        <p style={{ fontSize: 10, fontWeight: 500, color: '#6B6B65', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 10 }}>
          No score
        </p>
      </div>
    )
  }

  const tier = getRiskTier(score)
  return (
    <div style={{ background: tier.bg, borderRadius: 12, padding: '1.5rem 2rem', textAlign: 'center', minWidth: 130 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 2, lineHeight: 1 }}>
        <span style={{ fontSize: 56, fontWeight: 500, color: tier.titleText, letterSpacing: '-0.03em', lineHeight: 1 }}>
          {score.toFixed(0)}
        </span>
        <span style={{ fontSize: 14, fontWeight: 500, color: tier.metaText, opacity: 0.6, paddingBottom: 6 }}>
          /100
        </span>
      </div>
      <p style={{ fontSize: 10, fontWeight: 500, color: tier.metaText, letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 10 }}>
        {tier.label}
      </p>
    </div>
  )
}
