import Link from 'next/link'
import { getLeaderboard } from '@/lib/api'
import type { BuildingSummary } from '@/lib/types'

const BOROUGHS = ['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island']

const RISK_DOT: Record<string, string> = {
  'Very low':          '#C5E0C8',
  'Low':               '#84A98C',
  'Moderate':          '#E4A11B',
  'High':              '#BC4B33',
  'Very high':         '#7F1D1D',
  'Insufficient data': '#C5E0C8',
  'Not comparable':    '#C5E0C8',
}
function riskDot(level: string | null): string {
  return RISK_DOT[level ?? ''] ?? '#A3A3A3'
}

function BuildingRow({
  rank,
  building,
  maxComplaints,
}: {
  rank: number
  building: BuildingSummary
  maxComplaints: number
}) {
  const dot = riskDot(building.risk_level)
  const barPct = maxComplaints > 0 ? (building.total_complaints / maxComplaints) * 100 : 0
  // Shade the bar from deep oxblood (#7F1D1D) at #1 down to a lighter red at the bottom
  const barColor = barPct > 66 ? '#7F1D1D' : barPct > 33 ? '#BC4B33' : '#D97B65'
  const rankColor = rank <= 3 ? '#7F1D1D' : rank <= 10 ? '#BC4B33' : '#A3A3A3'

  return (
    <Link
      href={`/building/${building.bin}?from=leaderboard`}
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

        {/* Tier dot */}
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }} />

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
            {building.bin ? ` · ${building.bin}` : ''}
          </p>

          {/* Complaint bar */}
          <div style={{ marginTop: 8, background: '#F5F5F5', borderRadius: 3, height: 4, overflow: 'hidden' }}>
            <div style={{ width: `${barPct}%`, height: '100%', background: barColor, borderRadius: 3, minWidth: 4 }} />
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', gap: 24, flexShrink: 0, alignItems: 'center' }}>
          <div style={{ textAlign: 'right' }}>
            <p style={{
              fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 500,
              color: barColor, margin: 0, lineHeight: 1, fontVariantNumeric: 'tabular-nums',
            }}>
              {building.total_complaints.toLocaleString()}
            </p>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#737373', margin: '3px 0 0', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              complaints
            </p>
          </div>

          <div style={{ textAlign: 'right' }}>
            <p style={{
              fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 500,
              color: building.open_complaints > 0 ? '#7F1D1D' : '#A3A3A3',
              margin: 0, lineHeight: 1, fontVariantNumeric: 'tabular-nums',
            }}>
              {building.open_complaints.toLocaleString()}
            </p>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#737373', margin: '3px 0 0', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              active
            </p>
          </div>

          {/* Score */}
          <div style={{
            borderLeft: `3px solid ${barColor}`,
            borderRadius: 4,
            paddingLeft: 10,
            textAlign: 'left',
            minWidth: 48,
            flexShrink: 0,
          }}>
            <p style={{
              fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 500,
              color: '#111111', margin: 0, lineHeight: 1, fontVariantNumeric: 'tabular-nums',
            }}>
              {building.score != null ? building.score.toFixed(0) : '—'}
            </p>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#737373', margin: '2px 0 0', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              score
            </p>
          </div>
        </div>
      </div>
    </Link>
  )
}

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ borough?: string }>
}) {
  const { borough } = await searchParams
  const buildings = await getLeaderboard(borough)
  const maxComplaints = buildings[0]?.total_complaints ?? 1

  function boroughUrl(b?: string) {
    const sp = new URLSearchParams()
    if (b) sp.set('borough', b)
    return `/leaderboard${sp.size ? `?${sp}` : ''}`
  }

  return (
    <div style={{ minHeight: '100vh', background: '#FAFAFA' }}>

      {/* Nav */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: '#111111',
        padding: '10px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
      }}>
        <Link href="/" style={{
          fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em',
          textTransform: 'uppercase', color: '#A3A3A3', textDecoration: 'none',
          whiteSpace: 'nowrap', flexShrink: 0,
        }}>
          ← Map
        </Link>
        <span style={{
          fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 500,
          color: '#FFFFFF', letterSpacing: '-0.015em',
        }}>
          Tenement
        </span>
        <div style={{ flex: 1 }} />
        <Link href="/methodology" style={{
          fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em',
          textTransform: 'uppercase', color: '#A3A3A3', textDecoration: 'none',
          whiteSpace: 'nowrap', flexShrink: 0,
        }}>
          Methodology
        </Link>
      </header>

      {/* Page header */}
      <div style={{ background: '#FFFFFF', borderBottom: '0.5px solid #E5E5E5', padding: '1.5rem 1.5rem 0' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 20 }}>
            <h1 style={{
              fontFamily: 'var(--font-serif)', fontSize: 32, fontWeight: 500,
              color: '#111111', letterSpacing: '-0.02em', margin: 0, lineHeight: 1.1,
            }}>
              Most complained buildings
            </h1>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#737373' }}>
              Top {buildings.length}{borough ? ` · ${borough}` : ' · citywide'}
            </span>
          </div>

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
            <div style={{ width: 8, flexShrink: 0 }} />
            <p style={{
              flex: 1,
              fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500,
              color: '#737373', letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0,
            }}>
              Building
            </p>
            <div style={{ display: 'flex', gap: 24 }}>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, color: '#737373', letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0, minWidth: 56, textAlign: 'right' }}>
                Total
              </p>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, color: '#737373', letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0, minWidth: 40, textAlign: 'right' }}>
                Active
              </p>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, color: '#737373', letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0, minWidth: 56, textAlign: 'center' }}>
                Score
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
                maxComplaints={maxComplaints}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
