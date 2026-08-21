import type { ReactNode } from 'react'

// A reusable record log: a titled header, an optional filter slot, a table
// (desktop) and an optional stacked card view (mobile). Generic over the row
// type so it can list 311 complaints, DBI violations, or any record set.
type Props<T> = {
  // Anchor target, so a link like `#violation-log` can scroll to the card.
  id?: string
  title: string
  countLabel: string
  columns: string[]
  items: T[]
  renderRow: (item: T) => ReactNode
  emptyText: string
  // When provided, the table is hidden on mobile (≤640px) in favor of these
  // stacked cards. Omit to keep the table on all breakpoints.
  renderCard?: (item: T) => ReactNode
  // Optional controls (e.g. filter pills) rendered on the right of the header.
  filters?: ReactNode
  // Rendered inside the card, below the rows. Pagination lives here on the NYC
  // pages; SF places its pager outside the card instead. Both were true before
  // this component was shared, and neither is worth changing to look tidy.
  footer?: ReactNode
}

export default function RecordLog<T>({ id, title, countLabel, columns, items, renderRow, emptyText, renderCard, filters, footer }: Props<T>) {
  return (
    <div id={id} style={{ background: '#FFFFFF', border: '0.5px solid #E5E5E5', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '20px 24px', borderBottom: '0.5px solid #E5E5E5', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#525252', margin: '0 0 4px' }}>
            {title}
          </h2>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#6B6B6B', margin: 0 }}>
            {countLabel}
          </p>
        </div>
        {filters && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {filters}
          </div>
        )}
      </div>
      {items.length === 0 ? (
        <p style={{ padding: '32px 24px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 13, color: '#6B6B6B', margin: 0 }}>
          {emptyText}
        </p>
      ) : (
        <>
          <div className={renderCard ? 'log-table-wrap' : undefined} style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#FAFAFA', borderBottom: '0.5px solid #E5E5E5' }}>
                  {columns.map(h => (
                    <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, color: '#525252', letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map(renderRow)}
              </tbody>
            </table>
          </div>
          {renderCard && (
            <div className="log-cards-wrap">
              {items.map(renderCard)}
            </div>
          )}
        </>
      )}
      {footer}
    </div>
  )
}
