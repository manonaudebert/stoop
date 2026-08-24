import { NextRequest, NextResponse } from 'next/server'

const UPSTREAM = process.env.INTERNAL_API_URL
const SECRET   = process.env.INTERNAL_API_SECRET

// Page views and client-side errors, beaconed from the browser. Separate from
// /api/proxy because that handler is GET-only by design; this one mirrors its
// shape so the internal key still never reaches the browser.
export async function POST(req: NextRequest) {
  if (!UPSTREAM || !SECRET) return new NextResponse(null, { status: 204 })

  try {
    const body = await req.text()
    await fetch(`${UPSTREAM}/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Internal-Key': SECRET,
        ...(req.cookies.get('stoop_dev') ? { 'X-Stoop-Internal': '1' } : {}),
      },
      body,
      cache: 'no-store',
    })
  } catch (err) {
    // Telemetry must never surface to the user as a failure.
    console.warn('[stoop] event beacon dropped', err)
  }
  return new NextResponse(null, { status: 204 })
}
