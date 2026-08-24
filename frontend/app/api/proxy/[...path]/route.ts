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
      headers: {
        'X-Internal-Key': SECRET,
        // Without this the API only ever sees this server's own fetch agent
        // ("node"), so its crawler check can never fire and every bot counts as
        // a real visitor.
        'User-Agent': req.headers.get('user-agent') ?? '',
        // Tags the maintainer's own traffic so dashboard queries can exclude
        // it. Set by the root proxy.ts on a ?dev=1 visit.
        ...(req.cookies.get('stoop_dev') ? { 'X-Stoop-Internal': '1' } : {}),
      },
      cache: 'no-store',
    })

    const headers: Record<string, string> = {
      'content-type': res.headers.get('content-type') ?? 'application/json',
    }

    // Forward the API's request id so a client-side ApiError can carry it and
    // the browser, the Railway log line, and api_events all share one key.
    const requestId = res.headers.get('x-request-id')
    if (requestId) headers['X-Request-Id'] = requestId

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
  } catch (err) {
    // FastAPI is unreachable — the single most important failure on the site,
    // and until this line it was logged nowhere at all. Vercel captures it.
    console.error('[stoop] upstream unreachable', { path: path.join('/'), err })
    return NextResponse.json({ detail: 'API unavailable' }, { status: 503 })
  }
}
