'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'

const STORAGE_KEY = 'nycbc_viewed'
const FREE_LIMIT  = 5

export function useViewGate(bin: string): { gated: boolean } {
  const { data: session, status } = useSession()
  const [gated, setGated] = useState(false)

  useEffect(() => {
    if (status === 'loading') return
    if (session) { setGated(false); return }

    const stored: string[] = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')

    if (stored.includes(bin)) {
      // This building already counted — just check if already over limit
      setGated(stored.length > FREE_LIMIT)
      return
    }

    const next = [...stored, bin]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    setGated(next.length > FREE_LIMIT)
  }, [bin, session, status])

  return { gated }
}
