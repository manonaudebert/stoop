'use client'

import { useEffect, useState } from 'react'

import { reportDegraded } from '@/lib/api'

import { RecordLink, Section, SectionHeader, StatCell } from '@/components/MapSidebarParts'

// One building across both datasets, as carried by a unified map feature. Any
// field group is null when the building has no record in that dataset.
export type UnifiedBuilding = {
  bin: string
  address: string | null
  borough: string | null
  zip_code: string | null
  // DOB — building safety
  dob_risk_level?: string | null
  dob_total?: number | null
  dob_open?: number | null
  dob_priority_a?: number | null
  // HPD — housing conditions (complaints)
  hpd_risk_level?: string | null
  hpd_total?: number | null
  hpd_open?: number | null
  hpd_open_emergency?: number | null
}

type ViolationSummary = {
  bin: string
  total_violations: number
  open_violations: number
  rent_impairing_count: number
}

// Marks the section whose risk currently drives the map colors, so a tenant
// reading a green/red dot knows which of the two dimensions they're looking at.
type Props = {
  building: UnifiedBuilding
  onClose: () => void
  activeLens: 'HPD' | 'DOB'
}

export default function CombinedBuildingSidebar({ building, onClose, activeLens }: Props) {
  const hasHpd = building.hpd_total != null || building.hpd_risk_level != null
  const hasDob = building.dob_total != null || building.dob_risk_level != null

  const [violations, setViolations] = useState<ViolationSummary | null | 'loading' | 'error'>('loading')

  useEffect(() => {
    if (!hasHpd) { setViolations(null); return }
    setViolations('loading')
    let cancelled = false
    fetch(`/api/proxy/hpd/building/search?q=${encodeURIComponent(building.bin)}`)
      .then(r => {
        // A failed request must not collapse into an empty result set: "no
        // violations on file" and "we could not load this" are different facts,
        // and on this card the difference is the whole product.
        if (!r.ok) throw new Error(`hpd search ${r.status}`)
        return r.json()
      })
      .then((results: ViolationSummary[]) => {
        if (cancelled) return
        setViolations(results.find(r => r.bin === building.bin) ?? null)
      })
      .catch(err => {
        if (cancelled) return
        reportDegraded('sidebar hpd violations', err)
        setViolations('error')
      })
    return () => { cancelled = true }
  }, [building.bin, hasHpd])

  const vFailed  = violations === 'error'
  const v        = typeof violations === 'string' ? null : violations
  const vLoading = violations === 'loading'

  const divider = <div style={{ height: '0.5px', background: '#E5E5E5', margin: '14px 0' }} />

  return (
    <div className="w-full sm:w-60" style={{
      background: '#FFFFFF', borderRadius: 12, padding: '16px 18px',
      border: '0.5px solid #6B6B6B',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{
            fontFamily: 'var(--font-serif)', fontSize: 17, fontWeight: 500,
            color: '#111111', letterSpacing: '-0.01em', lineHeight: 1.15, margin: 0,
          }}>
            {building.address ?? 'Unknown address'}
          </p>
          <p style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, color: '#525252',
            marginTop: 4, marginBottom: 0,
          }}>
            {building.borough}{building.zip_code ? ` · ${building.zip_code}` : ''}
            {building.bin ? ` · BIN ${building.bin}` : ''}
          </p>
        </div>
        <button
          onClick={onClose}
          style={{
            flexShrink: 0, background: 'none', border: 'none',
            cursor: 'pointer', fontSize: 18, color: '#6B6B6B',
            padding: 0, lineHeight: 1, marginTop: -1,
          }}
          aria-label="Close"
        >
          ×
        </button>
      </div>

      {divider}

      {/* ── Housing conditions (HPD) ── */}
      <Section active={activeLens === 'HPD'}>
        <SectionHeader title="Housing conditions" level={hasHpd ? building.hpd_risk_level : undefined} active={activeLens === 'HPD'} />
        {hasHpd ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
              <StatCell label="Total complaints" value={building.hpd_total ?? null} />
              <StatCell label="Total violations" value={v?.total_violations ?? null} loading={vLoading} />
              <StatCell label="Open violations"  value={v?.open_violations ?? null}  loading={vLoading} />
            </div>
            {vFailed && (
              <p style={{
                fontFamily: 'var(--font-sans)', fontSize: 11, color: '#92400E',
                margin: '-8px 0 12px',
              }}>
                Violation counts couldn&apos;t be loaded — this is a loading problem, not a clean record.
              </p>
            )}
            <RecordLink href={`/hpd/building/${building.bin}`}>View housing record</RecordLink>
          </>
        ) : (
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: '#6B6B6B', margin: 0 }}>
            No HPD housing records on file.
          </p>
        )}
      </Section>

      {divider}

      {/* ── Building safety (DOB) ── */}
      <Section active={activeLens === 'DOB'}>
        <SectionHeader title="Building safety" level={hasDob ? building.dob_risk_level : undefined} active={activeLens === 'DOB'} />
        {hasDob ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
              <StatCell label="Total"      value={building.dob_total ?? null} />
              <StatCell label="Open"       value={building.dob_open ?? null} />
              <StatCell label="Priority A" value={building.dob_priority_a ?? null} />
            </div>
            <RecordLink href={`/dob/building/${building.bin}`}>View safety record</RecordLink>
          </>
        ) : (
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: '#6B6B6B', margin: 0 }}>
            No DOB building-safety records on file.
          </p>
        )}
      </Section>
    </div>
  )
}
