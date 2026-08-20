import type { BuildingSummary, BuildingDetail, TimelinePoint, CategoryBreakdownItem, NeighborhoodData, HpdBuildingSummary, HpdBuildingDetail, ViolationClassBreakdownItem, ViolationAgeBucketItem, HpdComplaintBuildingSummary, HpdComplaintBuildingDetail, ComplaintCategoryBreakdownItem, ComplaintMinorBreakdownItem, ComplaintTypePeriodItem, ComplaintResolutionItem, SfBuildingSummary, SfBuildingDetail, SfComplaintBreakdownItem, SfViolationBreakdownItem, BuildingBrief, SfBuildingBrief } from './types'

export class ApiError extends Error {
  constructor(public status: number, path: string) {
    super(`API error ${status}: ${path}`)
  }
}

// Server-side: call FastAPI directly with the internal secret.
// Client-side: call the Next.js proxy (which adds the secret).
function getConfig(): { base: string; headers: HeadersInit } {
  if (typeof window === 'undefined') {
    return {
      base: process.env.INTERNAL_API_URL ?? 'http://localhost:8000',
      headers: { 'X-Internal-Key': process.env.INTERNAL_API_SECRET ?? '' },
    }
  }
  return { base: '/api/proxy', headers: {} }
}

// Source data refreshes weekly via the ingest pipeline, so server-side reads
// can sit in Next's Data Cache for a day before revalidating. This keeps repeat
// page renders from re-hitting FastAPI/Neon, letting the database scale to zero.
// `revalidate` only affects server-side fetches; the client path goes through
// /api/proxy (cache: 'no-store') and ignores it.
const DAY = 86400

type GetOptions = { signal?: AbortSignal; revalidate?: number }

async function get<T>(path: string, opts: GetOptions = {}): Promise<T> {
  const { base, headers } = getConfig()
  const res = await fetch(`${base}${path}`, {
    headers,
    signal: opts.signal,
    next: { revalidate: opts.revalidate ?? DAY },
  })
  if (!res.ok) throw new ApiError(res.status, path)
  return res.json()
}

export async function searchBuildings(q: string, signal?: AbortSignal): Promise<BuildingSummary[]> {
  return get(`/building/search?q=${encodeURIComponent(q)}`, { signal, revalidate: 3600 })
}

export async function getBuilding(
  bin: string,
  page = 1,
  status?: string,
  category?: string,
): Promise<BuildingDetail> {
  const params = new URLSearchParams({ page: String(page) })
  if (status) params.set('status', status)
  if (category) params.set('category', category)
  return get(`/building/${bin}?${params}`)
}

export async function getTimeline(bin: string): Promise<TimelinePoint[]> {
  return get(`/building/${bin}/timeline`)
}

export async function getBreakdown(bin: string, years?: number): Promise<CategoryBreakdownItem[]> {
  const params = years ? `?years=${years}` : ''
  return get(`/building/${bin}/breakdown${params}`)
}

export async function getNeighborhood(bin: string): Promise<NeighborhoodData | null> {
  try {
    return await get(`/building/${bin}/neighborhood`)
  } catch {
    return null
  }
}

export async function getLeaderboardRecent(borough?: string): Promise<BuildingSummary[]> {
  const params = borough ? `?borough=${encodeURIComponent(borough)}` : ''
  return get(`/building/leaderboard-recent${params}`)
}

// ── HPD violations ────────────────────────────────────────────────────────────

export async function searchHpdBuildings(q: string, signal?: AbortSignal): Promise<HpdBuildingSummary[]> {
  return get(`/hpd/building/search?q=${encodeURIComponent(q)}`, { signal, revalidate: 3600 })
}

export async function getHpdBuilding(
  bin: string,
  page = 1,
  violation_class?: string,
  status?: string,
): Promise<HpdBuildingDetail> {
  const params = new URLSearchParams({ page: String(page) })
  if (violation_class) params.set('violation_class', violation_class)
  if (status) params.set('status', status)
  return get(`/hpd/building/${bin}?${params}`)
}

export async function getHpdTimeline(bin: string): Promise<TimelinePoint[]> {
  return get(`/hpd/building/${bin}/timeline`)
}

export async function getHpdBreakdown(bin: string): Promise<ViolationClassBreakdownItem[]> {
  return get(`/hpd/building/${bin}/breakdown`)
}

export async function getHpdBreakdownRecent(bin: string): Promise<ViolationClassBreakdownItem[]> {
  return get(`/hpd/building/${bin}/breakdown-recent`)
}

export async function getHpdOpenViolationAges(bin: string): Promise<ViolationAgeBucketItem[]> {
  return get(`/hpd/building/${bin}/open-ages`)
}

// ── HPD complaints ────────────────────────────────────────────────────────────

export async function getHpdComplaintLeaderboard(borough?: string): Promise<HpdComplaintBuildingSummary[]> {
  const params = borough ? `?borough=${encodeURIComponent(borough)}` : ''
  return get(`/hpd-complaints/building/leaderboard-recent${params}`)
}

export async function searchHpdComplaintBuildings(q: string, signal?: AbortSignal): Promise<HpdComplaintBuildingSummary[]> {
  return get(`/hpd-complaints/building/search?q=${encodeURIComponent(q)}`, { signal, revalidate: 3600 })
}

export async function getHpdComplaintBuilding(
  bin: string,
  page = 1,
  major_category?: string,
  status?: string,
): Promise<HpdComplaintBuildingDetail> {
  const params = new URLSearchParams({ page: String(page) })
  if (major_category) params.set('major_category', major_category)
  if (status) params.set('status', status)
  return get(`/hpd-complaints/building/${bin}?${params}`)
}

export async function getHpdComplaintTimeline(bin: string): Promise<TimelinePoint[]> {
  return get(`/hpd-complaints/building/${bin}/timeline`)
}

export async function getHpdComplaintBreakdown(bin: string): Promise<ComplaintCategoryBreakdownItem[]> {
  return get(`/hpd-complaints/building/${bin}/breakdown`)
}

export async function getHpdComplaintMinorBreakdown(bin: string, years?: number): Promise<ComplaintMinorBreakdownItem[]> {
  const qs = years !== undefined ? `?years=${years}` : ''
  return get(`/hpd-complaints/building/${bin}/minor-breakdown${qs}`)
}

export async function getHpdComplaintTypePeriodBreakdown(bin: string): Promise<ComplaintTypePeriodItem[]> {
  return get(`/hpd-complaints/building/${bin}/type-period-breakdown`)
}

export async function getHpdComplaintResolutionBreakdown(bin: string): Promise<ComplaintResolutionItem[]> {
  return get(`/hpd-complaints/building/${bin}/resolution-breakdown`)
}

// ── SF (San Francisco) ────────────────────────────────────────────────────────

export async function searchSfBuildings(q: string, signal?: AbortSignal): Promise<SfBuildingSummary[]> {
  return get(`/sf/building/search?q=${encodeURIComponent(q)}`, { signal, revalidate: 3600 })
}

export async function getSfLeaderboard(): Promise<SfBuildingSummary[]> {
  return get('/sf/building/leaderboard')
}

export async function getSfBuilding(
  mapblklot: string,
  page = 1,
  show?: 'complaints' | 'violations',
  vst?: 'Open' | 'Close',
): Promise<SfBuildingDetail> {
  const params = new URLSearchParams({ page: String(page) })
  if (show) params.set('show', show)
  if (vst) params.set('vst', vst)
  return get(`/sf/building/${mapblklot}?${params}`)
}

export async function getSfComplaintsTimeline(mapblklot: string): Promise<TimelinePoint[]> {
  return get(`/sf/building/${mapblklot}/complaints-timeline`)
}

export async function getSfViolationsTimeline(mapblklot: string): Promise<TimelinePoint[]> {
  return get(`/sf/building/${mapblklot}/violations-timeline`)
}

export async function getSfComplaintsBreakdown(mapblklot: string, years?: number): Promise<SfComplaintBreakdownItem[]> {
  const qs = years !== undefined ? `?years=${years}` : ''
  return get(`/sf/building/${mapblklot}/complaints-breakdown${qs}`)
}

export async function getSfViolationsBreakdown(mapblklot: string, years?: number): Promise<SfViolationBreakdownItem[]> {
  const qs = years !== undefined ? `?years=${years}` : ''
  return get(`/sf/building/${mapblklot}/violations-breakdown${qs}`)
}

export async function getHpdBuildingBrief(bin: string): Promise<BuildingBrief> {
  return get(`/hpd/building/${bin}/brief`)
}

export async function getSfBuildingBrief(id: string): Promise<SfBuildingBrief> {
  return get(`/sf/building/${id}/brief`)
}
