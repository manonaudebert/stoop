import type { BuildingBrief as Brief, BriefWatchItem } from '@/lib/types'
import TooltipIcon from './TooltipIcon'

/**
 * The deterministic Building Brief — phase 0, no generated text.
 *
 * Two layers, because the authored rules text is legally careful and cited,
 * which is exactly what makes it long. The page already carries every count in
 * cards; the brief's job is interpretation, not restatement.
 *
 *   Layer 1  one compact authored line per item — `brief_line` — plus, for the
 *            class C item, the bare group labels of its hazard areas.
 *   Layer 2  the full authored block, verbatim and unchanged, behind a
 *            per-item disclosure.
 *
 * NO NUMBERS ANYWHERE. `magnitude` — a per-rule count template — was cut from
 * rules.yaml and the API response on 2026-08-12, after a chip was tried here
 * and rejected: the counts sit in cards inches away on the same page, and
 * suppression now encodes severity structurally.
 *
 * Every string is authored — `brief_line`, `condition`, `why_it_matters` and
 * `action` all come verbatim from rules.yaml, each carrying the page of HPD's
 * "ABCs of Housing" it was written from. There is no AI-assisted label anywhere
 * in this component because there is nothing here a model wrote. Phase 1 adds
 * generated `watch_for` sentences into layer 1, and those get labelled; layer 2
 * stays fully authored.
 *
 * The disclosure is a native <details>, so this stays a server component with
 * no client JS and the expanded text remains findable by in-page search.
 */

type Props = {
  brief: Brief
}

const MONO = 'var(--font-mono)'

export default function BuildingBrief({ brief }: Props) {
  const { watch_items, confidence_note, no_flags, has_records } = brief

  return (
    <section
      aria-labelledby="building-brief-heading"
      style={{
        background: '#FFFFFF',
        border: '0.5px solid #E5E5E5',
        borderRadius: 12,
        padding: '20px 24px',
        margin: '12px 0',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: no_flags ? 10 : 14 }}>
        <h2
          id="building-brief-heading"
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            fontFamily: MONO, fontSize: 11, letterSpacing: '0.08em',
            textTransform: 'uppercase', color: '#525252', margin: 0,
          }}
        >
          What to watch for
          <TooltipIcon text="Conditions on this building's HPD record that a prospective or current tenant would want to know about. Each one cites the section of HPD's ABCs of Housing it comes from." />
        </h2>
      </div>

      {no_flags ? (
        <EmptyState hasRecords={has_records} note={confidence_note} />
      ) : (
        <>
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {watch_items.map((item) => (
              <WatchItem key={item.rule_id} item={item} />
            ))}
          </ol>
          {confidence_note && <ConfidenceNote note={confidence_note} />}
        </>
      )}
    </section>
  )
}

function WatchItem({ item }: { item: BriefWatchItem }) {
  // brief_line is the authored compact form; condition is the fallback for a
  // rule that authors none. Never a client-side truncation of the long text —
  // a machine-cut sentence is exactly the kind of paraphrase this feature is
  // built to avoid.
  const headline = item.brief_line ?? item.condition
  const labels = item.hazard_area_labels ?? []

  return (
    <li>
      <div style={{ fontSize: 14, color: '#111111', lineHeight: 1.45 }}>
        {headline}
      </div>

      {labels.length > 0 && (
        <div style={{ fontSize: 12, color: '#737373', lineHeight: 1.5, marginTop: 3 }}>
          includes {labels.map((l) => l.toLowerCase()).join(', ')}
        </div>
      )}

      <details style={{ marginTop: 5 }}>
        <summary
          style={{
            fontFamily: MONO, fontSize: 10, color: '#525252',
            cursor: 'pointer', listStyle: 'none',
          }}
        >
          details &amp; your rights ▸
        </summary>

        {/* Layer 2 — the authored block, verbatim. The route test that pins
            this text against rules.yaml passes against exactly these nodes. */}
        <div style={{ marginTop: 10, paddingLeft: 12, borderLeft: '2px solid #F0F0F0' }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: '#111111', lineHeight: 1.45, marginBottom: 6 }}>
            {item.condition}
          </div>
          <p style={{ fontSize: 12.5, color: '#525252', lineHeight: 1.55, margin: '0 0 6px' }}>
            {item.why_it_matters}
          </p>

          {/* Full label + authored sentence here, where there is room for it.
              An empty array is a real state — flagged, nothing describable —
              and renders nothing rather than an empty heading. */}
          {item.hazard_areas && item.hazard_areas.length > 0 && (
            <ul style={{ listStyle: 'none', margin: '0 0 6px', padding: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
              {item.hazard_areas.map((area) => (
                <li key={area} style={{ fontSize: 12, color: '#525252', lineHeight: 1.5, display: 'flex', gap: 6 }}>
                  <span aria-hidden="true" style={{ color: '#A3A3A3' }}>—</span>
                  <span>{area}</span>
                </li>
              ))}
            </ul>
          )}

          <p style={{ fontSize: 12.5, color: '#111111', lineHeight: 1.55, margin: '0 0 5px' }}>
            {item.action}
          </p>
          {/* One line per source. A rule can make claims from two documents
              — the class C item takes its violation classes from the ABCs PDF
              and its correction deadlines from HPD's penalties-and-fees page —
              and each says what it backs so a reader knows which to check for
              what. Web sources render as real links: a citation nobody can
              follow is decoration. */}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {/* `?? []` guards a payload shape this component did not expect,
                NOT a rule without sources — a server test pins every item to at
                least one citation. Server fetches sit in Next's Data Cache for
                a day (lib/api.ts), so right after the response shape changes,
                a render can still be handed yesterday's payload. Without this,
                that took down the whole building page rather than one item. */}
            {(item.citations ?? []).map((c) => (
              <li key={c.label} style={{ fontFamily: MONO, fontSize: 10, color: '#737373', lineHeight: 1.6 }}>
                {c.url ? (
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#737373', textDecoration: 'underline' }}
                  >
                    {c.label}
                  </a>
                ) : (
                  c.label
                )}
                {c.covers && <span> — {c.covers}</span>}
              </li>
            ))}
          </ul>
        </div>
      </details>
    </li>
  )
}

/**
 * Two different empty states, and the difference matters.
 *
 * ~48% of buildings flag nothing. The section is never hidden: absence would
 * read as "this building is fine" on half the site, unlabelled and therefore
 * impossible to qualify. But it renders as one muted line rather than a card,
 * so it does not eat the top of every other building page.
 *
 * A building with no HPD record at all gets a different sentence, because
 * "nothing crossed the thresholds we flag" implies checking happened — which is
 * not true of a building with nothing to check.
 */
function EmptyState({ hasRecords, note }: { hasRecords: boolean; note: string | null }) {
  return (
    <p style={{ fontSize: 12.5, color: '#737373', lineHeight: 1.55, margin: 0 }}>
      {hasRecords ? (
        <>
          Nothing here crossed the thresholds we flag — which is not the same as
          no problems. Full violation and complaint history below.
        </>
      ) : (
        <>{note ?? 'There are no HPD records on file for this building.'}</>
      )}
    </p>
  )
}

function ConfidenceNote({ note }: { note: string }) {
  return (
    <p
      style={{
        fontSize: 12,
        color: '#737373',
        lineHeight: 1.5,
        margin: '16px 0 0',
        paddingTop: 12,
        borderTop: '0.5px solid #F5F5F5',
      }}
    >
      {note}
    </p>
  )
}
