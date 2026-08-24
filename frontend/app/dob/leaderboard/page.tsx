import Link from 'next/link'
import { getLeaderboardRecent } from '@/lib/api'
import type { BuildingSummary } from '@/lib/types'
import BuildingNavBar from '@/components/BuildingNavBar'
import LeaderboardToggle from '@/components/LeaderboardToggle'
import CityToggle from '@/components/CityToggle'
import TooltipIcon from '@/components/TooltipIcon'
import PageBeacon from '@/components/PageBeacon'

const BOROUGHS = ['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island']

const TREND: Record<string, string> = {
  worsening:  '↑',
  stable:     '→',
  improving:  '↓',
}
const TREND_COLOR: Record<string, string> = {
  worsening:  '#BC4B33',
  stable:     '#6B6B6B',
  improving:  '#4F6F58',
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
  const recent2yr   = building.recent_complaint_count ?? 0
  const serious2yr  = building.priority_ab_2yr
  const barPct      = maxRecent > 0 ? (recent2yr / maxRecent) * 100 : 0
  const barColor    = barPct > 66 ? '#7F1D1D' : barPct > 33 ? '#BC4B33' : '#D97B65'
  const rankColor   = rank <= 3 ? '#7F1D1D' : rank <= 10 ? '#BC4B33' : '#6B6B6B'
  const trend       = building.trend_direction ?? ''

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
          <span style={{ fontSize: 12, color: TREND_COLOR[trend] ?? '#6B6B6B' }}>
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
            fontFamily: 'var(--font-mono)', fontSize: 10, color: '#525252',
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
        <div className="flex flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-6" style={{ flexShrink: 0 }}>
          {/* 2yr complaints — primary sort */}
          <div style={{ textAlign: 'right' }}>
            <p style={{
              fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 500,
              color: barColor, margin: 0, lineHeight: 1, fontVariantNumeric: 'tabular-nums',
            }}>
              {recent2yr.toLocaleString()}
            </p>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#525252', margin: '3px 0 0', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              total
            </p>
          </div>

          {/* Serious — desktop: stacked number+label */}
          <div className="hidden sm:block" style={{ textAlign: 'right' }}>
            <p style={{
              fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 500,
              color: serious2yr > 0 ? '#525252' : '#6B6B6B',
              margin: 0, lineHeight: 1, fontVariantNumeric: 'tabular-nums',
            }}>
              {serious2yr.toLocaleString()}
            </p>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#525252', margin: '3px 0 0', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              serious
            </p>
          </div>

          {/* Serious — mobile: compact one line */}
          <p className="sm:hidden" style={{
            fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500,
            color: serious2yr > 0 ? '#525252' : '#A3A3A3',
            margin: 0, letterSpacing: '0.06em', textTransform: 'uppercase',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {serious2yr.toLocaleString()} serious
          </p>
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
      <PageBeacon route="/dob/leaderboard" city="nyc" />

      <BuildingNavBar backHref="/" backLabel="Map" />

      {/* Page header */}
      <div className="lb-header" style={{ background: '#FFFFFF', borderBottom: '0.5px solid #E5E5E5', padding: '1.5rem 1.5rem 0' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div style={{ marginBottom: 12 }}>
            <CityToggle current="NYC" nycHref="/dob/leaderboard" sfHref="/sf/leaderboard" />
          </div>

          <div style={{ marginBottom: 20 }}>
            <LeaderboardToggle active="dob" borough={borough} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <div className="lb-header-meta" style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
              <h1 className="lb-title" style={{
                fontFamily: 'var(--font-serif)', fontSize: 32, fontWeight: 500,
                color: '#111111', letterSpacing: '-0.02em', margin: 0, lineHeight: 1.1,
              }}>
                Most active buildings
              </h1>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#525252', whiteSpace: 'nowrap' }}>
                Top {buildings.length}{borough ? ` · ${borough}` : ' · all boroughs'}
              </span>
            </div>
          </div>
          <p style={{
            fontFamily: 'var(--font-sans)', fontSize: 13, color: '#525252',
            lineHeight: 1.6, margin: '0 0 20px', maxWidth: 640,
          }}>
            Ranked by complaints filed in the last 2 years with the Department of Buildings. Ties are broken by serious complaints (Priority A+B) in the same window. The trend arrow shows whether the annual complaint rate is rising or falling compared to the prior 3 years.
          </p>

          {/* Borough tabs */}
          <div className="lb-tabs" style={{ display: 'flex', gap: 0, borderBottom: '0.5px solid #E5E5E5', marginBottom: -1 }}>
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
      <div className="lb-container" style={{ maxWidth: 900, margin: '0 auto', padding: '1.5rem 1.5rem' }}>
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
              color: '#525252', letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0,
            }}>
              Building
            </p>
            <div style={{ display: 'flex', gap: 24 }}>
              <p className="flex items-center gap-1" style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, color: '#525252', letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0, minWidth: 56, justifyContent: 'flex-end' }}>
                Last 2yr <TooltipIcon direction="down" align="right" text="Total DOB complaints filed in the last 2 years. Used as the primary sort." />
              </p>
              <p className="hidden sm:flex items-center gap-1" style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, color: '#525252', letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0, minWidth: 64, justifyContent: 'flex-end' }}>
                Serious 2yr <TooltipIcon direction="down" align="right" text="Priority A+B complaints in the last 2 years, the most urgent safety categories. Used as a tiebreaker." />
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
