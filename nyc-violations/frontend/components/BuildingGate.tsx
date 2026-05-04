'use client'

import { useViewGate } from '@/lib/useViewGate'
import AuthGateModal from './AuthGateModal'

type Props = { bin: string; children: React.ReactNode }

export default function BuildingGate({ bin, children }: Props) {
  const { gated } = useViewGate(bin)
  return (
    <>
      {children}
      {gated && <AuthGateModal />}
    </>
  )
}
