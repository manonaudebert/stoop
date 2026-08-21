'use client'

// Chrome behavior shared by the two map wrappers — `UnifiedMapWrapper` (NYC)
// and `SfMapWrapper` (SF). Each hook below was written twice, verbatim, once
// per city.
//
// This is deliberately the SMALL half of the map-wrapper reuse. The wrappers
// are structurally parallel — same state shape, renamed variables — but they
// differ in the map component they mount, their lens union, their clusters
// endpoint, and their area vocabulary (NYC filters by NTA code, SF by
// neighborhood name). Collapsing those into one generic wrapper means a
// config-driven component over ~1,270 lines of the most-trafficked page in the
// app, with no frontend test coverage to catch a regression. What lives here
// instead is the part that is city-agnostic on its face: viewport, keyboard,
// and a dismissible banner.

import { useCallback, useEffect, useState } from 'react'

// The Tailwind `sm` breakpoint. Below it the map's floating cards become
// bottom sheets.
const MOBILE_QUERY = '(max-width: 639.98px)'

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY)
    const update = () => setIsMobile(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return isMobile
}

// Closes a transient overlay on Escape. No-op while `active` is false, so the
// listener only exists for as long as the thing it closes is open.
export function useEscapeKey(active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onEscape() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, onEscape])
}

// A one-time welcome card, remembered in localStorage. The key is per-city
// (`stoop_welcome_dismissed` / `sf_welcome_dismissed`) so dismissing one map's
// card does not silently dismiss the other's — that was true before this hook
// existed and is preserved rather than tidied away.
export function useWelcomeBanner(storageKey: string) {
  const [showWelcome, setShowWelcome] = useState(false)
  useEffect(() => {
    if (!localStorage.getItem(storageKey)) setShowWelcome(true)
  }, [storageKey])
  const dismissWelcome = useCallback(() => {
    localStorage.setItem(storageKey, '1')
    setShowWelcome(false)
  }, [storageKey])
  return { showWelcome, dismissWelcome }
}
