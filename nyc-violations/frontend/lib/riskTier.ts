export type RiskTier = { bg: string; text: string }

const SCORE_TIERS: Array<{ min: number; tier: RiskTier }> = [
  { min: 95, tier: { bg: '#D4F5CB', text: '#1F4012' } },
  { min: 86, tier: { bg: '#A8E5A0', text: '#1F4012' } },
  { min: 70, tier: { bg: '#FFD930', text: '#5C4A0A' } },
  { min: 45, tier: { bg: '#F5A047', text: '#5C3A0A' } },
  { min: 0,  tier: { bg: '#EF4637', text: '#FFFFFF' } },
]

const NULL_TIER: RiskTier = { bg: '#F5F3EA', text: '#6B6B65' }

export function scoreToTier(score: number | null | undefined): RiskTier {
  if (score == null) return NULL_TIER
  return SCORE_TIERS.find(t => score >= t.min)?.tier ?? NULL_TIER
}

const RISK_LEVEL_MAP: Record<string, RiskTier> = {
  'Very low':          { bg: '#D4F5CB', text: '#111111' },
  'Low':               { bg: '#A8E5A0', text: '#111111' },
  'Moderate':          { bg: '#FFD930', text: '#111111' },
  'High':              { bg: '#F5A047', text: '#111111' },
  'Very high':         { bg: '#EF4637', text: '#FFFFFF' },
  'Insufficient data': { bg: '#D4F5CB', text: '#111111' },
  'Not comparable':    { bg: '#D4D1C3', text: '#111111' },
}

export function riskLevelToTier(level: string | null | undefined): RiskTier {
  return RISK_LEVEL_MAP[level ?? 'Insufficient data'] ?? RISK_LEVEL_MAP['Insufficient data']
}
