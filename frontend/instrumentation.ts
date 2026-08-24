import type { Instrumentation } from 'next'

// Next replaces a server-render error's message with an opaque digest before it
// reaches app/error.tsx, so the boundary can never see which API request failed.
// This hook runs server-side where the original message — and the request id
// lib/api.ts folded into it — is still intact, and pairs the two.
export const onRequestError: Instrumentation.onRequestError = async (err, request) => {
  const message = err instanceof Error ? err.message : String(err)
  // React may re-wrap the original error during a Server Component render, so
  // `digest` is the reliable identifier, not the instance itself.
  const digest =
    typeof err === 'object' && err !== null && 'digest' in err
      ? String(err.digest)
      : undefined
  const requestId = /request_id=([a-f0-9]+)/.exec(message)?.[1]

  console.error('[stoop] server render failed', {
    path: request.path,
    digest,
    request_id: requestId,
    message,
  })

  const upstream = process.env.INTERNAL_API_URL
  const secret = process.env.INTERNAL_API_SECRET
  if (!upstream || !secret) return

  try {
    await fetch(`${upstream}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Internal-Key': secret },
      body: JSON.stringify({
        kind: 'error',
        route: request.path?.slice(0, 120),
        request_id: requestId ?? null,
        digest: digest ?? null,
      }),
      cache: 'no-store',
    })
  } catch {
    /* already logged above; never let reporting mask the original error */
  }
}
