'use client'

import { useEffect, useRef } from 'react'
import { beacon } from '@/lib/beacon'

// The API cannot count page views on its own: lib/api.ts caches server-side
// reads for a day so Neon can autosuspend, so a second viewer of the same
// building within 24h produces zero API requests. This is the only honest
// signal, which is why it has to come from the browser.
// `route` is the template (`/hpd/building/[bin]`), never the resolved path —
// the identifier goes in `building` so grouping by route stays low-cardinality.
export default function PageBeacon(
  { route, city, building }: { route: string; city?: 'nyc' | 'sf'; building?: string },
) {
  const sent = useRef(false)
  useEffect(() => {
    if (sent.current) return       // StrictMode double-invokes effects in dev
    sent.current = true
    beacon({ kind: 'pageview', route, city, building })
  }, [route, city, building])
  return null
}
