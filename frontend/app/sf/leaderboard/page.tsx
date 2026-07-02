import Link from 'next/link'
import { getSfLeaderboard } from '@/lib/api'
import type { SfBuildingSummary } from '@/lib/types'
import BuildingNavBar from '@/components/BuildingNavBar'
import TooltipIcon from '@/components/TooltipIcon'
import CityToggle from '@/components/CityToggle'

const SF_NEIGHBORHOODS = [
  'Bayview Hunters Point',
  'Bernal Heights',
  'Castro/Upper Market',
  'Chinatown',
  'Excelsior',
  'Financial District/South Beach',
  'Glen Park',
  'Haight Ashbury',
  'Inner Richmond',
  'Inner Sunset',
  'Japantown',
  'Lakeshore',
  'Marina',
  'Mission',
  'Nob Hill',
  'Noe Valley',
  'North Beach',
  'Oceanview/Merced/Ingleside',
  'Outer Mission',
  'Outer Richmond',
  'Pacific Heights',
  'Portola',
  'Potrero Hill',
  'Russian Hill',
  'South of Market',
  'Tenderloin',
  'Twin Peaks',
  'Visitacion Valley',
  'Western Addition',
]

const TREND: Record<string, string> = {
  worsening: '↑',
  stable:    '→',
  improving: '↓',
}
const TREND_COLOR: Record<string, string> = {
  worsening: '#BC4B33',
  stable:    '#6B6B6B',
  improving: '#4F6F58',
}

function BuildingRow({
  rank,
  building,
  maxRecent,
}: {
  rank: number
  building: SfBuildingSummary
  maxRecent: number
}) {
  const recent    = building.recent_complaint_count ?? 0
  const barPct    = maxRecent > 0 ? (recent / maxRecent) * 100 : 0
  const barColor  = barPct > 66 ? '#7F1D1D' : barPct > 33 ? '#BC4B33' : '#D97B65'
  const rankColor = rank <= 3 ? '#7F1D1D' : rank <= 10 ? '#BC4B33' : '#6B6B6B'
  const trend     = building.trend_direction ?? ''
  const openV     = building.open_violations ?? 0

  return (
    <Link
      href={`/sf/building/${building.mapblklot}`}
      style={{ textDecoration: 'none', display: 'block' }}
    >
      <div
        className="leaderboard-row"
        style={{
          background: '#FFFFFF',
          borderBottom: '0.5px solid #E5E5E5',
          padding: '14px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
        }}
      >
        <div style={{ width: 32, flexShrink: 0, textAlign: 'right' }}>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 500,
            color: rankColor, fontVariantNumeric: 'tabular-nums',
          }}>
            {rank}
          </span>
        </div>

        <div style={{ width: 14, flexShrink: 0, textAlign: 'center' }}>
          <span style={{ fontSize: 12, color: TREND_COLOR[trend] ?? '#6B6B6B' }}>
            {TREND[trend] ?? '·'}
          </span>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{
            fontFamily: 'var(--font-serif)', fontSize: 15, fontWeight: 500,
            color: '#111111', margin: 0,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {building.address ?? 'Unknown address'}
          </p>
          <p style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, color: '#525252',
            margin: '3px 0 0', letterSpacing: '0.06em', textTransform: 'uppercase',
          }}>
            {building.neighborhood ?? 'San Francisco'}
          </p>

          <div style={{ marginTop: 8, background: '#F5F5F5', borderRadius: 3, height: 4, overflow: 'hidden' }}>
            <div style={{ width: `${barPct}%`, height: '100%', background: barColor, borderRadius: 3, minWidth: 4 }} />
          </div>
        </div>

        <div className="flex flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-6" style={{ flexShrink: 0 }}>
          <div style={{ textAlign: 'right' }}>
            <p style={{
              fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 500,
              color: barColor, margin: 0, lineHeight: 1, fontVariantNumeric: 'tabular-nums',
            }}>
              {recent.toLocaleString()}
            </p>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#525252', margin: '3px 0 0', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              complaints
            </p>
          </div>

          <div className="hidden sm:block" style={{ textAlign: 'right' }}>
            <p style={{
              fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 500,
              color: openV > 0 ? '#525252' : '#6B6B6B',
              margin: 0, lineHeight: 1, fontVariantNumeric: 'tabular-nums',
            }}>
              {openV.toLocaleString()}
            </p>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#525252', margin: '3px 0 0', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              open viol.
            </p>
          </div>

          <p className="sm:hidden" style={{
            fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500,
            color: openV > 0 ? '#525252' : '#A3A3A3',
            margin: 0, letterSpacing: '0.06em', textTransform: 'uppercase',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {openV.toLocaleString()} open
          </p>
        </div>
      </div>
    </Link>
  )
}

export default async function SfLeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ neighborhood?: string }>
}) {
  const { neighborhood } = await searchParams
  const buildings = await getSfLeaderboard(neighborhood)
  const maxRecent = buildings[0]?.recent_complaint_count ?? 1

  function noodUrl(n?: string) {
    const sp = new URLSearchParams()
    if (n) sp.set('neighborhood', n)
    return `/sf/leaderboard${sp.size ? `?${sp}` : ''}`
  }

  return (
    <div style={{ minHeight: '100vh', background: '#FAFAFA' }}>
      <BuildingNavBar backHref="/sf/map" backLabel="SF Map" />

      <div className="lb-header" style={{ background: '#FFFFFF', borderBottom: '0.5px solid #E5E5E5', padding: '1.5rem 1.5rem 0' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div style={{ marginBottom: 12 }}>
            <CityToggle current="SF" nycHref="/hpd/leaderboard" sfHref="/sf/leaderboard" />
          </div>

          <div style={{ marginBottom: 12 }}>
            <div className="lb-header-meta" style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
              <h1 className="lb-title" style={{
                fontFamily: 'var(--font-serif)', fontSize: 32, fontWeight: 500,
                color: '#111111', letterSpacing: '-0.02em', margin: 0, lineHeight: 1.1,
              }}>
                Most active SF buildings
              </h1>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#525252', whiteSpace: 'nowrap' }}>
                Top {buildings.length}{neighborhood ? ` · ${neighborhood}` : ' · all neighborhoods'}
              </span>
            </div>
          </div>

          <p style={{
            fontFamily: 'var(--font-sans)', fontSize: 13, color: '#525252',
            lineHeight: 1.6, margin: '0 0 20px', maxWidth: 640,
          }}>
            Ranked by San Francisco 311 residential building complaints filed in the last 2 years.
            The trend arrow shows whether the annual complaint rate is rising or falling vs. the prior 3 years.
            Open violations come from DBI Notices of Violation (status: active).
          </p>

          <div className="lb-tabs" style={{ display: 'flex', gap: 0, borderBottom: '0.5px solid #E5E5E5', marginBottom: -1, overflowX: 'auto' }}>
            {[undefined, ...SF_NEIGHBORHOODS].map(n => {
              const active = (n ?? undefined) === (neighborhood ?? undefined)
              return (
                <Link
                  key={n ?? 'all'}
                  href={noodUrl(n)}
                  style={{
                    fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.04em',
                    textTransform: 'uppercase', textDecoration: 'none',
                    padding: '10px 14px',
                    color: active ? '#7F1D1D' : '#737373',
                    borderBottom: active ? '2px solid #7F1D1D' : '2px solid transparent',
                    whiteSpace: 'nowrap',
                    transition: 'color 0.1s',
                    flexShrink: 0,
                  }}
                >
                  {n ?? 'All'}
                </Link>
              )
            })}
          </div>
        </div>
      </div>

      <div className="lb-container" style={{ maxWidth: 900, margin: '0 auto', padding: '1.5rem 1.5rem' }}>
        <div style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 16,
            padding: '9px 20px', borderBottom: '0.5px solid #E5E5E5',
            background: '#FAFAFA',
          }}>
            <div style={{ width: 32, flexShrink: 0 }} />
            <div style={{ width: 14, flexShrink: 0 }} />
            <p style={{
              flex: 1,
              fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500,
              color: '#525252', letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0,
            }}>
              Building
            </p>
            <div style={{ display: 'flex', gap: 24 }}>
              <p className="flex items-center gap-1" style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, color: '#525252', letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0, minWidth: 76, justifyContent: 'flex-end' }}>
                Last 2yr <TooltipIcon direction="down" align="right" text="Total 311 residential building complaints in the last 2 years. Primary sort key." />
              </p>
              <p className="hidden sm:flex items-center gap-1" style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, color: '#525252', letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0, minWidth: 72, justifyContent: 'flex-end' }}>
                Open viol. <TooltipIcon direction="down" align="right" text="Active DBI Notices of Violation (status = active)." />
              </p>
            </div>
          </div>

          {buildings.length === 0 ? (
            <p style={{ padding: '2rem', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 13, color: '#525252' }}>
              No buildings found.
            </p>
          ) : (
            buildings.map((b, i) => (
              <BuildingRow
                key={b.mapblklot}
                rank={i + 1}
                building={b}
                maxRecent={maxRecent}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
