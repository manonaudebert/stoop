type Beacon = {
  kind: 'pageview' | 'error'
  city?: 'nyc' | 'sf'
  route?: string
  building?: string
  status?: number
  request_id?: string
  digest?: string
}

// Fire-and-forget. sendBeacon survives the page unloading, which a fetch does
// not; the fetch fallback covers browsers without it. Never throws: telemetry
// must not be able to break a render.
export function beacon(payload: Beacon) {
  if (typeof navigator === 'undefined') return
  const body = JSON.stringify(payload)
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/event', new Blob([body], { type: 'application/json' }))
      return
    }
    void fetch('/api/event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* telemetry is never worth an exception */
  }
}
