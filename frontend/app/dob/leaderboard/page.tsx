import Link from 'next/link'
import { getLeaderboardRecent } from '@/lib/api'
import type { BuildingSummary } from '@/lib/types'
import BuildingNavBar from '@/components/BuildingNavBar'
import LeaderboardToggle from '@/components/LeaderboardToggle'

const BOROUGHS = ['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island']

const TREND: Record<string, string> = {
  worsening:  '↑',
  stable:     '→',
  improving:  '↓',
}
const TREND_COLOR: Record<string, string> = {
  worsening:  '#BC4B33',
  stable:     '#A3A3A3',
  improving:  '#84A98C',
}

function BuildingRow({
  rank,
  building,
  maxRecent,
}: {
  rank: number
  building: BuildingSummary
  maxRecent: number
}) {
  const recent2yr = building.recent_complaint_count ?? 0
  const barPct = maxRecent > 0 ? (recent2yr / maxRecent) * 100 : 0
  const barColor = barPct > 66 ? '#7F1D1D' : barPct > 33 ? '#BC4B33' : '#D97B65'
  const rankColor = rank <= 3 ? '#7F1D1D' : rank <= 10 ? '#BC4B33' : '#A3A3A3'
  const trend = building.trend_direction ?? ''

  return (
    <Link
      href={`/dob/building/${building.bin}?from=leaderboard`}
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
        {/* Rank */}
        <div style={{ width: 32, flexShrink: 0, textAlign: 'right' }}>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 500,
            color: rankColor, fontVariantNumeric: 'tabular-nums',
          }}>
            {rank}
          </span>
        </div>

        {/* Trend arrow */}
        <div style={{ width: 14, flexShrink: 0, textAlign: 'center' }}>
          <span style={{ fontSize: 12, color: TREND_COLOR[trend] ?? '#A3A3A3' }}>
            {TREND[trend] ?? '·'}
          </span>
        </div>

        {/* Building info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{
            fontFamily: 'var(--font-serif)', fontSize: 15, fontWeight: 500,
            color: '#111111', margin: 0,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {building.address ?? 'Unknown address'}
          </p>
          <p style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, color: '#737373',
            margin: '3px 0 0', letterSpacing: '0.06em', textTransform: 'uppercase',
          }}>
            {building.borough}
            {building.zip_code ? ` · ${building.zip_code}` : ''}
            {building.nta_name ? ` · ${building.nta_name}` : ''}
          </p>

          {/* Recent complaint bar */}
          <div style={{ marginTop: 8, background: '#F5F5F5', borderRadius: 3, height: 4, overflow: 'hidden' }}>
            <div style={{ width: `${barPct}%`, height: '100%', background: barColor, borderRadius: 3, minWidth: 4 }} />
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', gap: 24, flexShrink: 0, alignItems: 'center' }}>
          {/* 2yr complaints — primary sort */}
          <div style={{ textAlign: 'right' }}>
            <p style={{
              fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 500,
              color: barColor, margin: 0, lineHeight: 1, fontVariantNumeric: 'tabular-nums',
            }}>
              {recent2yr.toLocaleString()}
            </p>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#737373', margin: '3px 0 0', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              last 2yr
            </p>
          </div>

          {/* Priority A+B last 2yr — tiebreaker */}
          <div style={{ textAlign: 'right' }}>
            <p style={{
              fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 500,
              color: building.priority_ab_2yr > 0 ? '#525252' : '#A3A3A3',
              margin: 0, lineHeight: 1, fontVariantNumeric: 'tabular-nums',
            }}>
              {building.priority_ab_2yr.toLocaleString()}
            </p>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#737373', margin: '3px 0 0', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              serious 2yr
            </p>
          </div>
        </div>
      </div>
    </Link>
  )
}

export default async function DobLeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ borough?: string }>
}) {
  const { borough } = await searchParams
  const buildings = await getLeaderboardRecent(borough)
  const maxRecent = buildings[0]?.recent_complaint_count ?? 1

  function boroughUrl(b?: string) {
    const sp = new URLSearchParams()
    if (b) sp.set('borough', b)
    return `/dob/leaderboard${sp.size ? `?${sp}` : ''}`
  }

  return (
    <div style={{ minHeight: '100vh', background: '#FAFAFA' }}>

      <BuildingNavBar backHref="/" backLabel="Map" />

      {/* Page header */}
      <div style={{ background: '#FFFFFF', borderBottom: '0.5px solid #E5E5E5', padding: '1.5rem 1.5rem 0', position: 'relative' }}>
        <div className="flex justify-end mb-4 md:absolute md:top-6 md:right-6 md:mb-0">
          <LeaderboardToggle active="dob" borough={borough} />
        </div>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
              <h1 style={{
                fontFamily: 'var(--font-serif)', fontSize: 32, fontWeight: 500,
                color: '#111111', letterSpacing: '-0.02em', margin: 0, lineHeight: 1.1,
              }}>
                Most active buildings
              </h1>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#737373', whiteSpace: 'nowrap' }}>
                Top {buildings.length}{borough ? ` · ${borough}` : ' · all boroughs'}
              </span>
            </div>
          </div>
          <p style={{
            fontFamily: 'var(--font-sans)', fontSize: 13, color: '#525252',
            lineHeight: 1.6, margin: '0 0 20px', maxWidth: 640,
          }}>
            Ranked by complaints filed in the last 2 years with the Department of Buildings. Ties broken by serious complaints (Priority A+B) in the same window. The trend arrow shows whether the annual complaint rate is rising or falling compared to the prior 3 years.
          </p>

          {/* Borough tabs */}
          <div style={{ display: 'flex', gap: 0, borderBottom: '0.5px solid #E5E5E5', marginBottom: -1 }}>
            {[undefined, ...BOROUGHS].map(b => {
              const active = (b ?? undefined) === (borough ?? undefined)
              return (
                <Link
                  key={b ?? 'all'}
                  href={boroughUrl(b)}
                  style={{
                    fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.04em',
                    textTransform: 'uppercase', textDecoration: 'none',
                    padding: '10px 14px',
                    color: active ? '#7F1D1D' : '#737373',
                    borderBottom: active ? '2px solid #7F1D1D' : '2px solid transparent',
                    whiteSpace: 'nowrap',
                    transition: 'color 0.1s',
                  }}
                >
                  {b ?? 'All'}
                </Link>
              )
            })}
          </div>
        </div>
      </div>

      {/* List */}
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '1.5rem 1.5rem' }}>
        <div style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 12, overflow: 'hidden' }}>

          {/* Column headers */}
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
              color: '#737373', letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0,
            }}>
              Building
            </p>
            <div style={{ display: 'flex', gap: 24 }}>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, color: '#737373', letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0, minWidth: 56, textAlign: 'right' }}>
                Last 2yr
              </p>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, color: '#737373', letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0, minWidth: 64, textAlign: 'right' }}>
                Serious 2yr
              </p>
            </div>
          </div>

          {buildings.length === 0 ? (
            <p style={{ padding: '2rem', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 13, color: '#737373' }}>
              No buildings found.
            </p>
          ) : (
            buildings.map((b, i) => (
              <BuildingRow
                key={b.bin}
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
