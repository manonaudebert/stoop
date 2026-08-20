import type { BuildingBriefBase as Brief, BriefWatchItem } from '@/lib/types'
import TooltipIcon from './TooltipIcon'

/**
 * The Building Brief.
 *
 * Two layers, because the authored rules text is legally careful and cited,
 * which is exactly what makes it long. The page already carries every count in
 * cards; the brief's job is interpretation, not restatement.
 *
 *   Layer 1  one compact authored line per item — `brief_line`, which states the
 *            condition and nothing else — the generated `watch_for` sentence
 *            when the corpus has one, and, for the class C item, its hazard
 *            areas named inside the headline.
 *   Layer 2  why_it_matters, action and citations, verbatim and unchanged,
 *            behind a per-item disclosure. Never generated, at any phase.
 *
 * Each fact appears once. The headline states the condition, `watch_for` gives
 * the one thing to look for, and layer 2 explains and cites. `condition` is not
 * rendered at all — see the note at the disclosure below.
 *
 * NO NUMBERS ON A WATCH ITEM. `magnitude` — a per-rule count template — was cut
 * from rules.yaml and the API response on 2026-08-12, after a chip was tried
 * here and rejected: the counts sit in cards inches away on the same page, and
 * suppression now encodes severity structurally.
 *
 * The empty state is the one exception, and carries the record count. The rule
 * above exists because a MODEL could misstate a count; that one is read from
 * the signals row and rendered by code, and it answers a question the wording
 * otherwise leaves open — "nothing crossed the thresholds" reads the same on a
 * building with four records and one with four hundred.
 *
 * Every string here comes verbatim from a city's rules.yaml, each carrying the
 * source it was written from. `watch_for` is the ONE field that may instead be
 * model-written, and only in a city whose pipeline generates it: NYC does,
 * because the ABCs of Housing publishes no viewing checklist, and SF does not,
 * because California's guidebook does. WatchForLine is its own labelled block
 * for that reason — a reader has to be able to tell, without being told twice,
 * which line a model wrote — and `watch_for_source` on the item, never the city,
 * is what decides whether the label appears.
 *
 * `watch_for` is null on most items and that is permanent, not provisional. Only
 * the top two rules are ever generated, and any rule whose corpus is deleted
 * falls back here with no code change — the per-rule kill-switch. Rendering must
 * therefore treat null as ordinary, never as a loading or error state.
 *
 * The disclosure is a native <details>, so this stays a server component with
 * no client JS and the expanded text remains findable by in-page search.
 */

type Props = {
  brief: Brief
  /**
   * The three city-specific strings this component would otherwise hardcode.
   * Defaults are NYC's, so the existing call site is unchanged.
   *
   * Follows the rule stated in `lib/cities.ts`: city-aware pages read the config
   * and pass primitives down, so leaf components never branch on a city. There
   * is deliberately no `city` prop — a component that switches on one grows a
   * second switch every time a string differs.
   */
  recordNoun?: string
  subjectNoun?: string
  sourceLabel?: string
}

const MONO = 'var(--font-mono)'

export default function BuildingBrief({
  brief,
  recordNoun = 'HPD',
  subjectNoun = 'building',
  sourceLabel = "HPD's ABCs of Housing",
}: Props) {
  const { watch_items, confidence_note, no_flags, has_records, record_count } = brief

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
          <TooltipIcon text={`Conditions on this ${subjectNoun}'s ${recordNoun} record that a prospective or current tenant would want to know about. Each one cites the section of ${sourceLabel} it comes from.`} />
        </h2>
      </div>

      {no_flags ? (
        <EmptyState
          recordCount={record_count}
          hasRecords={has_records}
          note={confidence_note}
          recordNoun={recordNoun}
          subjectNoun={subjectNoun}
        />
      ) : (
        <>
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {watch_items.map((item) => (
              <WatchItem key={item.rule_id} item={item} recordNoun={recordNoun} subjectNoun={subjectNoun} />
            ))}
          </ol>
          {confidence_note && <ConfidenceNote note={confidence_note} />}
        </>
      )}
    </section>
  )
}

function WatchItem({
  item,
  recordNoun,
  subjectNoun,
}: {
  item: BriefWatchItem
  recordNoun: string
  subjectNoun: string
}) {
  // brief_line is the authored compact form; condition is the fallback for a
  // rule that authors none. Never a client-side truncation of the long text —
  // a machine-cut sentence is exactly the kind of paraphrase this feature is
  // built to avoid.
  const headline = item.brief_line ?? item.condition

  // The hazard areas are named INSIDE the headline rather than on a muted line
  // beneath it: "Hazardous violations are open" points at nothing on its own,
  // and a reader who stops after line one — which is what layer 1 is for —
  // should not be the one who misses what "hazardous" meant here.
  //
  // Only when the headline is the authored `brief_line`. When a rule authors
  // none we fall back to `condition`, which the API has ALREADY extended with
  // its own areas clause (Rule.condition_with_areas), so appending here would
  // name them twice in one sentence.
  //
  // The phrase arrives joined. Building it from a list here would duplicate
  // `taxonomy.join_prose`, whose serial comma exists because these entries
  // contain their own "and" — the bug that produced "mold and pests and
  // building maintenance". `??` rather than a truthiness check on a list also
  // means a payload predating this field (Next's Data Cache holds fetches for
  // a day) degrades to the bare authored line instead of throwing.
  const areas = item.hazard_area_phrase ?? null
  const headlineText = item.brief_line && areas
    // The authored line keeps its wording and loses only its final period, the
    // same contract `condition_with_areas` follows server-side: extended, never
    // rewritten.
    ? `${headline.replace(/\.\s*$/, '')}, including ${areas}.`
    : headline

  return (
    <li>
      <div style={{ fontSize: 14, color: '#111111', lineHeight: 1.45 }}>
        {headlineText}
      </div>

      {item.watch_for && (
        <WatchForLine
          sentence={item.watch_for}
          generated={item.watch_for_source === 'generated'}
          recordNoun={recordNoun}
          subjectNoun={subjectNoun}
        />
      )}

      <details style={{ marginTop: 5 }}>
        {/* paddingLeft 12 aligns this with the "Worth checking" label above,
            whose text starts at 12px (2px rule + 10px padding). The disclosure
            has no left rule of its own — the alignment is what ties the two
            secondary lines to the same column under the headline. */}
        <summary
          style={{
            fontFamily: MONO, fontSize: 10, color: '#525252',
            cursor: 'pointer', listStyle: 'none', paddingLeft: 12,
          }}
        >
          details ▸
        </summary>

        {/* Layer 2 — the authored block, verbatim. The route test that pins
            this text against rules.yaml passes against exactly these nodes.

            `condition` is deliberately NOT rendered here. The headline above is
            its authored compression ("Mold reported." for "Tenants here have
            reported mold."), so printing both stated one fact twice, the second
            time at greater length and behind a disclosure the reader had to
            open. It stays in the API response: it is what the model is shown as
            the issue text, and it is still the headline fallback for a rule that
            authors no `brief_line`. In that fallback case nothing is lost by its
            absence here either, since the headline IS the condition. */}
        <div style={{ marginTop: 10, paddingLeft: 12, borderLeft: '2px solid #F0F0F0' }}>
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
 * The one generated sentence, and the only place on this page a model wrote
 * anything.
 *
 * Set apart deliberately rather than blended into the authored line above it.
 * The authored text is cited to a page of the ABCs of Housing and the generated
 * text is not, so a reader who wants to check a claim needs to know which is
 * which before they go looking — a labelled block answers that at a glance, and
 * an inline sentence with a footnote does not.
 *
 * "Worth checking" is the same phrase `smoke.py` prints for this field in the
 * terminal, on purpose: one name per thing, so the review artifact and the page
 * can be read against each other without translation.
 *
 * The left rule is 2px #E8E8E8 rather than the disclosure's #F0F0F0 — related
 * idiom, distinguishable weight — and the tag stays mono to inherit the card's
 * existing register for machine-generated metadata.
 */
function WatchForLine({
  sentence,
  generated,
  recordNoun,
  subjectNoun,
}: {
  sentence: string
  /**
   * Drives the label, and it is a fact about THIS ROW rather than about the
   * city. NYC generates the line because the ABCs of Housing publishes no
   * viewing checklist; SF authors it, because California's guidebook does. A NYC
   * rule whose corpus row is deleted also falls back to authored text, so
   * inferring the label from the city would mislabel cited prose as
   * AI-assisted — the one error this component must never make.
   */
  generated: boolean
  recordNoun: string
  subjectNoun: string
}) {
  return (
    <div style={{ marginTop: 6, paddingLeft: 10, borderLeft: '2px solid #E8E8E8' }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.07em',
          textTransform: 'uppercase', color: '#8A8A8A', marginBottom: 2,
        }}
      >
        {generated ? 'Worth checking · AI-assisted' : 'Worth checking'}
        <TooltipIcon
          text={
            generated
              ? `Written by an AI model from this ${subjectNoun}'s ${recordNoun} record. Everything else in this brief is written by hand and cited; open “details” to read it.`
              : 'Written by hand and cited, like the rest of this brief. Open “details” for the source.'
          }
          align="left"
        />
      </div>
      <div style={{ fontSize: 13, color: '#404040', lineHeight: 1.5 }}>
        {sentence}
      </div>
    </div>
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
 *
 * The record count is the one number this component renders, and it is here
 * rather than anywhere else on purpose. "Nothing crossed the thresholds" reads
 * identically on a building with four records and one with four hundred, and
 * those are very different reassurances. Rendered by code from the signals row,
 * never by the model, which is what makes it exempt from the no-numbers rule
 * the watch items follow.
 */
function EmptyState({
  recordCount,
  hasRecords,
  note,
  recordNoun,
  subjectNoun,
}: {
  recordCount: number | undefined
  hasRecords: boolean
  note: string | null
  recordNoun: string
  subjectNoun: string
}) {
  // THREE cases, not two, because `record_count` is newer than the cache in
  // front of it. Server fetches sit in Next's Data Cache for a day
  // (lib/api.ts), so for a day after this shipped a render could be handed a
  // payload with no `record_count` at all.
  //
  // Defaulting that to 0 was the first version and was a real bug: it printed
  // "There are no HPD records on file" on a building with 155 of them. A
  // missing field must cost the reader the NUMBER, never turn into a false
  // claim about the record. `has_records` predates this and answers the only
  // question the branch actually needs.
  if (recordCount != null && recordCount > 0) {
    return (
      <p style={{ fontSize: 12.5, color: '#737373', lineHeight: 1.55, margin: 0 }}>
        {recordCount.toLocaleString()} {recordNoun}{' '}
        {recordCount === 1 ? 'record' : 'records'} on file; none met the
        thresholds we flag. That is not the same as no problems. Full violation
        and complaint history below.
      </p>
    )
  }
  if (hasRecords) {
    return (
      <p style={{ fontSize: 12.5, color: '#737373', lineHeight: 1.55, margin: 0 }}>
        Nothing here met the thresholds we flag. That is not the same as no
        problems. Full violation and complaint history below.
      </p>
    )
  }
  return (
    <p style={{ fontSize: 12.5, color: '#737373', lineHeight: 1.55, margin: 0 }}>
      {note ?? `There are no ${recordNoun} records on file for this ${subjectNoun}.`}
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
