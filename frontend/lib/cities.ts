// Per-city configuration for the small set of values that genuinely differ
// between cities. Routing and API-function selection are handled by the
// separate route trees (`app/hpd`, `app/dob`, `app/sf`) and deliberately live
// outside this config. City-aware pages read from here and pass the primitive
// values down to city-agnostic components (e.g. TrendStatCard, rankCopy), so
// leaf components never branch on city.

export type City = 'NYC' | 'SF'

export type CityConfig = {
  // Minimum number of events in the trend comparison window (last 4 years)
  // required before TrendStatCard shows a direction. SF data is sparser, so a
  // genuinely bad building clears a lower bar than in NYC.
  trendMinEvents: number
  // Neighborhood-ranking copy: shown when size-normalized ranking is
  // unavailable, and the trailing methodology note. Source data and lookback
  // windows differ per city, so the copy does too.
  rankMissingMessage: string
  rankTrailingNote: string
}

export const CITY_CONFIG: Record<City, CityConfig> = {
  NYC: {
    trendMinEvents: 4,
    rankMissingMessage: 'Building footprint or height data is missing — size-normalized ranking unavailable.',
    rankTrailingNote: 'Size-normalized against residential buildings in the neighborhood for issues in the last 10 years.',
  },
  SF: {
    trendMinEvents: 2,
    rankMissingMessage: 'Building size data is missing — size-normalized ranking unavailable.',
    rankTrailingNote: 'Size-normalized against residential buildings in the neighborhood.',
  },
}
