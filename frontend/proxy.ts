import { NextRequest, NextResponse } from 'next/server'

// Visiting any page with ?dev=1 tags this browser as the maintainer's for a
// year; ?dev=0 clears it. The proxy forwards the cookie to the API, which
// stamps api_events.internal — tagged rather than dropped, so your own sessions
// stay queryable on purpose instead of being invisible.
export function proxy(req: NextRequest) {
  const dev = req.nextUrl.searchParams.get('dev')
  if (dev === null) return NextResponse.next()

  const url = req.nextUrl.clone()
  url.searchParams.delete('dev')
  const res = NextResponse.redirect(url)

  if (dev === '0') {
    res.cookies.delete('stoop_dev')
  } else {
    res.cookies.set('stoop_dev', '1', {
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
      path: '/',
    })
  }
  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
