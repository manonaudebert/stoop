export default function Loading() {
  return (
    <div style={{ minHeight: '100vh', background: '#FAFAFA' }}>
      <div style={{ background: '#111111', height: 52 }} />
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '32px 20px' }}>
        <div className="skeleton" style={{ height: 24, width: 200, marginBottom: 24 }} />
        <div style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 12, overflow: 'hidden' }}>
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 20px', borderBottom: '0.5px solid #E5E5E5' }}>
              <div className="skeleton" style={{ height: 14, width: 24, borderRadius: 3 }} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div className="skeleton" style={{ height: 14, width: `${55 + (i % 3) * 10}%` }} />
                <div className="skeleton" style={{ height: 10, width: '30%' }} />
              </div>
              <div className="skeleton" style={{ height: 10, width: 60, borderRadius: 3 }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
