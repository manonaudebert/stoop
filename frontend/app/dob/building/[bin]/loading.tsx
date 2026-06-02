export default function Loading() {
  return (
    <div style={{ minHeight: '100vh', background: '#FAFAFA' }}>
      {/* Nav bar skeleton */}
      <div style={{ background: '#111111', height: 52 }} />

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 20px' }}>
        {/* Hero block */}
        <div style={{ marginBottom: 32 }}>
          <div className="skeleton" style={{ height: 11, width: 80, marginBottom: 12 }} />
          <div className="skeleton" style={{ height: 28, width: '55%', marginBottom: 10 }} />
          <div className="skeleton" style={{ height: 14, width: '30%' }} />
        </div>

        {/* Stat row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" style={{ marginBottom: 28 }}>
          {[1, 2, 3].map(i => (
            <div key={i} style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 12, padding: '16px 18px' }}>
              <div className="skeleton" style={{ height: 28, width: 48, marginBottom: 8 }} />
              <div className="skeleton" style={{ height: 10, width: '60%' }} />
            </div>
          ))}
        </div>

        {/* Chart */}
        <div style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 12, padding: '20px 24px', marginBottom: 20 }}>
          <div className="skeleton" style={{ height: 12, width: 120, marginBottom: 16 }} />
          <div className="skeleton" style={{ height: 120, width: '100%', borderRadius: 6 }} />
        </div>

        {/* Table */}
        <div style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '0.5px solid #E5E5E5' }}>
            <div className="skeleton" style={{ height: 12, width: 140 }} />
          </div>
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} style={{ display: 'flex', gap: 16, padding: '14px 20px', borderBottom: '0.5px solid #E5E5E5', alignItems: 'center' }}>
              <div className="skeleton" style={{ height: 18, width: 60, borderRadius: 4 }} />
              <div className="skeleton" style={{ height: 12, width: 36 }} />
              <div className="skeleton" style={{ height: 12, width: '40%', marginLeft: 'auto' }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
