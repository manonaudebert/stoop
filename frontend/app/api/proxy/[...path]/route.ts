import { NextRequest, NextResponse } from 'next/server'

const UPSTREAM = process.env.INTERNAL_API_URL
const SECRET   = process.env.INTERNAL_API_SECRET

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  if (!UPSTREAM || !SECRET) {
    return NextResponse.json({ detail: 'API not configured' }, { status: 503 })
  }

  const { path } = await params
  const target = `${UPSTREAM}/${path.join('/')}${req.nextUrl.search}`

  try {
    // `cache: 'no-store'` keeps Next from caching upstream itself — the CDN edge
    // does the caching, driven by the backend's Cache-Control.
    const res = await fetch(target, {
      headers: { 'X-Internal-Key': SECRET },
      cache: 'no-store',
    })

    const headers: Record<string, string> = {
      'content-type': res.headers.get('content-type') ?? 'application/json',
    }

    // The backend (api/main.py) is the single source of truth for cache policy:
    // it sets Cache-Control on cacheable GETs (map clusters, building detail,
    // leaderboards, breakdowns, timelines; search kept fresher) and omits it for
    // everything else. Forward it, and mirror into the CDN-specific headers so
    // both the Vercel Edge and Cloudflare tiers cache (Cloudflare also needs a
    // Cache Rule making /api/proxy/* eligible). Absent header → not cached.
    const cacheControl = res.headers.get('cache-control')
    if (cacheControl) {
      headers['Cache-Control']            = cacheControl
      headers['Vercel-CDN-Cache-Control'] = cacheControl
      headers['CDN-Cache-Control']        = cacheControl
    }

    return new NextResponse(res.body, {
      status: res.status,
      headers,
    })
  } catch {
    return NextResponse.json({ detail: 'API unavailable' }, { status: 503 })
  }
}
