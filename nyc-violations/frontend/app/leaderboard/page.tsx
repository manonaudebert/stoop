import Link from 'next/link'
import { getLeaderboard } from '@/lib/api'
import { scoreToTier } from '@/lib/riskTier'
import type { BuildingSummary } from '@/lib/types'

const BOROUGHS = ['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island']

function BuildingRow({
  rank,
  building,
  maxComplaints,
}: {
  rank: number
  building: BuildingSummary
  maxComplaints: number
}) {
  const tier = scoreToTier(building.score)
  const dot = scoreToTier(building.score).bg
  const barPct = maxComplaints > 0 ? (building.total_complaints / maxComplaints) * 100 : 0

  return (
    <Link
      href={`/building/${building.bin}?from=leaderboard`}
      style={{ textDecoration: 'none', display: 'block' }}
    >
      <div
        className="leaderboard-row"
        style={{
          background: '#FFFFFF',
          borderBottom: '0.5px solid #E5E3DA',
          padding: '14px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
        }}
      >
        {/* Rank */}
        <div style={{ width: 40, flexShrink: 0, textAlign: 'right' }}>
          <span style={{
            fontSize: 13, fontWeight: 500, color: rank <= 10 ? '#0601B4' : '#6B6B65',
            fontFamily: 'var(--font-mono)', letterSpacing: '-0.02em',
          }}>
            {rank}
          </span>
        </div>

        {/* Tier dot */}
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }} />

        {/* Building info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 14, fontWeight: 500, color: '#111111', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {building.address ?? 'Unknown address'}
          </p>
          <p style={{ fontSize: 11, color: '#6B6B65', margin: '2px 0 0', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            {building.borough}
            {building.zip_code ? ` · ${building.zip_code}` : ''}
            {building.bin ? <span style={{ fontFamily: 'var(--font-mono)', textTransform: 'none', letterSpacing: 0 }}> · {building.bin}</span> : null}
          </p>

          {/* Complaint bar */}
          <div style={{ marginTop: 8, background: '#F5F3EA', borderRadius: 3, height: 5, overflow: 'hidden' }}>
            <div style={{ width: `${barPct}%`, height: '100%', background: dot, borderRadius: 3, minWidth: 4 }} />
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', gap: 20, flexShrink: 0, alignItems: 'center' }}>
          <div style={{ textAlign: 'right' }}>
            <p style={{ fontSize: 22, fontWeight: 500, color: '#111111', margin: 0, letterSpacing: '-0.02em', lineHeight: 1 }}>
              {building.total_complaints.toLocaleString()}
            </p>
            <p style={{ fontSize: 10, color: '#6B6B65', margin: '3px 0 0', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              complaints
            </p>
          </div>

          <div style={{ textAlign: 'right' }}>
            <p style={{ fontSize: 14, fontWeight: 500, color: building.open_complaints > 0 ? '#EF4637' : '#6B6B65', margin: 0, letterSpacing: '-0.01em' }}>
              {building.open_complaints.toLocaleString()}
            </p>
            <p style={{ fontSize: 10, color: '#6B6B65', margin: '3px 0 0', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              active
            </p>
          </div>

          {/* Score */}
          <div style={{
            background: tier.bg,
            borderRadius: 8,
            padding: '6px 12px',
            textAlign: 'center',
            minWidth: 56,
            flexShrink: 0,
          }}>
            <p style={{ fontSize: 16, fontWeight: 500, color: tier.text, margin: 0, letterSpacing: '-0.02em', lineHeight: 1 }}>
              {building.score != null ? building.score.toFixed(0) : '—'}
            </p>
            <p style={{ fontSize: 9, fontWeight: 500, color: tier.text, opacity: 0.7, margin: '2px 0 0', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
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
    <div style={{ minHeight: '100vh', background: '#FAFAF7' }}>

      {/* Nav */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: '#0601B4',
        padding: '0 20px',
        height: 44,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
      }}>
        <Link href="/" style={{ fontSize: 14, fontWeight: 500, color: '#FFFFFF', textDecoration: 'none', letterSpacing: '-0.01em', whiteSpace: 'nowrap', flexShrink: 0 }}>
          NYC Building Complaints
        </Link>
        <Link href="/" style={{ fontSize: 13, fontWeight: 400, color: '#B5B3F5', textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0 }}>
          ← Map
        </Link>
      </header>

      {/* Page header */}
      <div style={{ background: '#FFFFFF', borderBottom: '0.5px solid #E5E3DA', padding: '1.5rem 1.5rem 0' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16 }}>
            <h1 style={{ fontSize: 32, fontWeight: 500, color: '#111111', letterSpacing: '-0.02em', margin: 0 }}>
              Most complained buildings
            </h1>
            <span style={{ fontSize: 13, color: '#6B6B65' }}>
              Top {buildings.length}{borough ? ` in ${borough}` : ' citywide'}
            </span>
          </div>

          {/* Borough tabs */}
          <div style={{ display: 'flex', gap: 0, borderBottom: '0.5px solid #E5E3DA', marginBottom: -1 }}>
            {[undefined, ...BOROUGHS].map(b => {
              const active = (b ?? undefined) === (borough ?? undefined)
              return (
                <Link
                  key={b ?? 'all'}
                  href={boroughUrl(b)}
                  style={{
                    fontSize: 13, fontWeight: 500, textDecoration: 'none',
                    padding: '10px 16px',
                    color: active ? '#0601B4' : '#6B6B65',
                    borderBottom: active ? '2px solid #0601B4' : '2px solid transparent',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {b ?? 'All boroughs'}
                </Link>
              )
            })}
          </div>
        </div>
      </div>

      {/* List */}
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '1.5rem 1.5rem' }}>
        <div style={{ background: '#FFFFFF', border: '0.5px solid #E5E3DA', borderRadius: 12, overflow: 'hidden' }}>

          {/* Column headers */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 16,
            padding: '9px 20px', borderBottom: '0.5px solid #E5E3DA',
            background: '#FAFAF7',
          }}>
            <div style={{ width: 40, flexShrink: 0 }} />
            <div style={{ width: 8, flexShrink: 0 }} />
            <p style={{ flex: 1, fontSize: 10, fontWeight: 500, color: '#6B6B65', letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0 }}>
              Building
            </p>
            <div style={{ display: 'flex', gap: 20 }}>
              <p style={{ fontSize: 10, fontWeight: 500, color: '#6B6B65', letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0, minWidth: 56, textAlign: 'right' }}>
                Total
              </p>
              <p style={{ fontSize: 10, fontWeight: 500, color: '#6B6B65', letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0, minWidth: 40, textAlign: 'right' }}>
                Active
              </p>
              <p style={{ fontSize: 10, fontWeight: 500, color: '#6B6B65', letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0, minWidth: 56, textAlign: 'center' }}>
                Score
              </p>
            </div>
          </div>

          {buildings.length === 0 ? (
            <p style={{ padding: '2rem', textAlign: 'center', fontSize: 14, color: '#6B6B65' }}>
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
