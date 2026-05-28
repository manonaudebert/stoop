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
    const res = await fetch(target, {
      headers: { 'X-Internal-Key': SECRET },
      cache: 'no-store',
    })
    return new NextResponse(res.body, {
      status: res.status,
      headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
    })
  } catch {
    return NextResponse.json({ detail: 'API unavailable' }, { status: 503 })
  }
}
