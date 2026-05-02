import type { BuildingSummary, BuildingDetail, TimelinePoint, CategoryBreakdownItem, NeighborhoodData } from './types'

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

export class ApiError extends Error {
  constructor(public status: number, path: string) {
    super(`API error ${status}: ${path}`)
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
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

export async function getBreakdown(bin: string): Promise<CategoryBreakdownItem[]> {
  return get(`/building/${bin}/breakdown`)
}

export async function getNeighborhood(bin: string): Promise<NeighborhoodData | null> {
  try {
    return await get(`/building/${bin}/neighborhood`)
  } catch {
    return null
  }
}

export async function getLeaderboard(borough?: string): Promise<BuildingSummary[]> {
  const params = borough ? `?borough=${encodeURIComponent(borough)}` : ''
  return get(`/building/leaderboard${params}`)
}
