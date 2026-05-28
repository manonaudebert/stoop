import type { BuildingSummary, BuildingDetail, TimelinePoint, CategoryBreakdownItem, NeighborhoodData, HpdBuildingSummary, HpdBuildingDetail, ViolationClassBreakdownItem, ViolationAgeBucketItem, HpdComplaintBuildingSummary, HpdComplaintBuildingDetail, ComplaintCategoryBreakdownItem, ComplaintMinorBreakdownItem, ComplaintTypePeriodItem, ComplaintResolutionItem } from './types'

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

async function get<T>(path: string): Promise<T> {
  const { base, headers } = getConfig()
  const res = await fetch(`${base}${path}`, { headers })
  if (!res.ok) throw new ApiError(res.status, path)
  return res.json()
}

export async function searchBuildings(q: string): Promise<BuildingSummary[]> {
  return get(`/building/search?q=${encodeURIComponent(q)}`)
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

export async function searchHpdBuildings(q: string): Promise<HpdBuildingSummary[]> {
  return get(`/hpd/building/search?q=${encodeURIComponent(q)}`)
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

export async function searchHpdComplaintBuildings(q: string): Promise<HpdComplaintBuildingSummary[]> {
  return get(`/hpd-complaints/building/search?q=${encodeURIComponent(q)}`)
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

export async function getHpdComplaintMinorBreakdown(bin: string): Promise<ComplaintMinorBreakdownItem[]> {
  return get(`/hpd-complaints/building/${bin}/minor-breakdown`)
}

export async function getHpdComplaintTypePeriodBreakdown(bin: string): Promise<ComplaintTypePeriodItem[]> {
  return get(`/hpd-complaints/building/${bin}/type-period-breakdown`)
}

export async function getHpdComplaintResolutionBreakdown(bin: string): Promise<ComplaintResolutionItem[]> {
  return get(`/hpd-complaints/building/${bin}/resolution-breakdown`)
}
