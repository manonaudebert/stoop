// Shared neighborhood-ranking copy for building pages (NYC HPD + SF).
// `vp` / `cp` are size-normalized percentiles (0–100, higher = worse) for
// violations and complaints; the primary metric is violations when present.

export function pctHeadline(vp: number | null, cp: number | null): string {
  const primary = vp ?? cp
  const metric = vp !== null ? 'violations' : 'complaints'
  if (primary === null) return 'Not enough data to compare building size'
  const better = Math.round(100 - primary)
  if (primary <= 20) return `Fewer ${metric} than ${better}% of nearby buildings`
  if (primary <= 40) return `Below-average ${metric} for the neighborhood`
  if (primary <= 60) return `Around average ${metric} for the neighborhood`
  if (primary <= 80) return `Above-average ${metric} for the neighborhood`
  return `More ${metric} than ${Math.round(primary)}% of nearby buildings`
}

export function pctPhrase(pct: number, metric: string): string {
  const r = Math.round(pct)
  return pct >= 50
    ? `more ${metric} than ${r}% of buildings`
    : `fewer ${metric} than ${100 - r}% of buildings`
}

// The missing-data message and trailing methodology note differ per city
// (different source data and lookback windows), so they're passed in.
export function pctSub(
  vp: number | null,
  cp: number | null,
  location: string,
  opts: { missingMessage: string; trailingNote: string },
): string {
  if (vp === null && cp === null) return opts.missingMessage
  const loc = location || 'the neighborhood'
  const parts: string[] = []
  if (vp !== null) parts.push(pctPhrase(vp, 'violations'))
  if (cp !== null) parts.push(pctPhrase(cp, 'complaints'))
  const joined = parts.join(' and ')
  const first = joined.charAt(0).toUpperCase() + joined.slice(1)
  return `${first} in ${loc}.\n${opts.trailingNote}`
}
