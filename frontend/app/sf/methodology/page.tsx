import type { Metadata } from 'next'
import BuildingNavBar from '@/components/BuildingNavBar'
import {
  CARD, SECTION_HEADER, PROSE,
  SectionTitle, DataSourceCard, SeverityList, RecencyCard, RiskLevelTable,
  MethodologyAbout, MethodologyIntro,
  type SeverityItem,
} from '@/components/methodology/shared'

export const metadata: Metadata = {
  title: "about — stoop",
  description: 'How Stoop compares San Francisco buildings using 311 housing complaints and DBI Notices of Violation — normalized by building size.',
}

// ── SF 311 housing-complaint severity (service_subtype → tier) ────────────────
// Mirrors the CASE weights in sf_housing_complaints_summary.

const SF_COMPLAINT_TIERS: SeverityItem[] = [
  { key: 'A', badge: 'A', name: 'Severe / immediately hazardous', weight: 15, color: '#7F1D1D', textColor: '#FFFFFF',
    examples: 'No heat or hot water, unsafe lead-paint work, blocked exits, fire hazards, hazardous electrical, missing/broken smoke detectors, fire-alarm & sprinkler failures' },
  { key: 'B', badge: 'B', name: 'Serious / hazardous', weight: 8, color: '#FEF3C7', textColor: '#92400E',
    examples: 'Rodent, insect & bed-bug infestations, mold and mildew, broken or leaking plumbing, broken doors & windows, inadequate ventilation, defective decks/stairs/handrails' },
  { key: 'C', badge: 'C', name: 'Minor / quality-of-life', weight: 3, color: '#D1FAE5', textColor: '#065F46',
    examples: 'General maintenance, peeling paint, garbage receptacles, clutter, non-hazardous electrical, second-hand smoke, noise from building systems' },
]

// ── SF DBI Notice-of-Violation severity (nov_category_description → tier) ──────
// Mirrors the CASE weights in sf_violations_summary.

const SF_VIOLATION_TIERS: SeverityItem[] = [
  { key: 'A', badge: 'A', name: 'Fire, smoke & lead', weight: 15, color: '#7F1D1D', textColor: '#FFFFFF',
    examples: 'Fire section, smoke-detection section, and lead section notices' },
  { key: 'B', badge: 'B', name: 'Structural, systems & health', weight: 8, color: '#FEF3C7', textColor: '#92400E',
    examples: 'Building (structural), plumbing & electrical, interior surfaces, sanitation, and security-requirements sections' },
  { key: 'C', badge: 'C', name: 'Other / uncategorized', weight: 3, color: '#D1FAE5', textColor: '#065F46',
    examples: 'Other section, Hotel Conversion Ordinance, and notices with no code section recorded' },
]

// ── page ──────────────────────────────────────────────────────────────────────

export default function SfMethodologyPage() {
  return (
    <div style={{ minHeight: '100vh', background: '#FAFAFA' }}>

      <BuildingNavBar backHref="/sf/map" backLabel="← Back to map" leaderboardHref="/sf/leaderboard" aboutHref="/sf/methodology" />

      {/* ── Section 1: Mission (generic, shared) ─────────────────────────── */}
      <MethodologyAbout />

      {/* ── Section 2: Methodology (SF) ──────────────────────────────────── */}
      <MethodologyIntro city="SF">
        <p style={{ ...PROSE, maxWidth: 600 }}>
          Every metric and comparison on Stoop&apos;s San Francisco pages is derived from public records
          published on DataSF — the city&apos;s 311 residential-building service requests and the
          Department of Building Inspection&apos;s (DBI) Notices of Violation. Here&apos;s how raw data becomes
          the numbers you see, and how buildings are compared fairly regardless of size, given
          publicly available data.
        </p>
      </MethodologyIntro>

      <main style={{ maxWidth: 860, margin: '0 auto', padding: '2.5rem 1.5rem' }}>

        {/* ── 1. Data sources ────────────────────────────────────────────── */}
        <section style={{ marginBottom: '3rem' }}>
          <SectionTitle>Data sources</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
            <DataSourceCard
              id="vw6y-z8j6"
              title="311 Cases — Residential Building"
              agency="City &amp; County of San Francisco"
              description="311 service requests filtered to residential-building housing complaints. Both the 'Residential Building Request' and later 'Residential Building' service names are included, covering roughly 2010 to today. Primary dataset behind the Housing Conditions risk level and neighborhood percentile."
              href="https://data.sfgov.org/d/vw6y-z8j6"
            />
            <DataSourceCard
              id="nbtm-fbw5"
              title="DBI Notices of Violation"
              agency="SF Dept. of Building Inspection"
              description="Notices of Violation issued by DBI after inspection, grouped by code section. A status of 'active' flags a violation that is still unresolved — the open-violations count and the Building Safety risk both come from this dataset."
              href="https://data.sfgov.org/d/nbtm-fbw5"
            />
            <DataSourceCard
              id="acdm-wktn"
              title="Parcels — Active and Retired"
              agency="City &amp; County of San Francisco"
              description="Parcel polygons with their Analysis Neighborhood and centroid. Complaints and violations are grouped by parcel (mapblklot), and the Analysis Neighborhood defines each building's peer group for percentile ranking."
              href="https://data.sfgov.org/d/acdm-wktn"
            />
            <DataSourceCard
              id="ynuv-fyni"
              title="Building Footprints"
              agency="City &amp; County of San Francisco"
              description="Building-footprint polygons with area and median height. Aggregated to the parcel and used to estimate building scale for size-normalized comparisons."
              href="https://data.sfgov.org/d/ynuv-fyni"
            />
            <DataSourceCard
              id="ramy-di5m"
              title="Enterprise Addressing System (EAS)"
              agency="City &amp; County of San Francisco"
              description="Every registered SF address. Used as the address-search corpus — including buildings with zero complaints, so a clean 'no records' result is trustworthy — and as the crosswalk that resolves an address to its parcel."
              href="https://data.sfgov.org/d/ramy-di5m"
            />
          </div>
        </section>

        {/* ── 2. Grain note ──────────────────────────────────────────────── */}
        <section style={{ marginBottom: '3rem' }}>
          <SectionTitle>Unit of analysis</SectionTitle>
          <p style={{ ...PROSE, marginBottom: 0 }}>
            San Francisco records are analyzed at the <strong style={{ color: '#111111', fontWeight: 500 }}>parcel</strong> level
            (the <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, background: '#F5F5F5', padding: '1px 5px', borderRadius: 3 }}>mapblklot</code> lot
            identifier), and condominium sub-lots are folded back onto their physical lot so a single
            building isn&apos;t split into dozens of units. About 6 of every 7 parcels contain exactly one
            building; the remaining ~1 in 7 hold more than one structure and are grouped together as a
            single entry.
          </p>
        </section>

        {/* ── 3. 311 complaint severity ──────────────────────────────────── */}
        <section style={{ marginBottom: '3rem' }}>
          <SectionTitle>311 complaint severity</SectionTitle>
          <p style={{ ...PROSE, marginBottom: 16 }}>
            Each 311 residential-building complaint is assigned a severity tier from its
            subtype (e.g. <em>heat_lack_of_heat</em>), using weights that match the tiers used on the
            New York pages. Unknown or unlisted subtypes default to the minor tier.
          </p>
          <SeverityList items={SF_COMPLAINT_TIERS} />
          <p style={{ ...PROSE, fontSize: 13, marginTop: 12 }}>
            A handful of regulatory subtypes — illegal construction / work beyond permit scope,
            illegal guest-room conversions, and visitor-policy violations — are recorded with a
            weight of 0. They are permitting and lease-policy matters, not habitability hazards, so
            they do not contribute to the risk score.
          </p>
          <p style={{ ...PROSE, fontSize: 13, marginTop: 12 }}>
            On the building page, the complaint-severity card counts Tier A, B, and C reports from
            the last 5 years. A clean window is shown as an empty state rather than three zero rows.
          </p>
        </section>

        {/* ── 4. DBI violation severity ──────────────────────────────────── */}
        <section style={{ marginBottom: '3rem' }}>
          <SectionTitle>DBI violation severity</SectionTitle>
          <p style={{ ...PROSE, marginBottom: 16 }}>
            DBI Notices of Violation are classified by their code-section category into three tiers,
            using the same 15 / 8 / 3 weights as the complaint tiers. The weighted violation sum
            uses the same recency multipliers as the complaint sum (see Building size normalization
            below), so recent serious violations weigh more than old minor ones.
          </p>
          <SeverityList items={SF_VIOLATION_TIERS} />
          <p style={{ ...PROSE, fontSize: 13, marginTop: 12 }}>
            The open-violations card applies these same tiers to notices whose status is currently
            active. Its three tier counts therefore add up to the open-violation headline.
          </p>
        </section>

        {/* ── 5. Building size normalization ─────────────────────────────── */}
        <section style={{ marginBottom: '3rem' }}>
          <SectionTitle>Top violation conditions</SectionTitle>
          <div style={CARD}>
            <p style={PROSE}>
              The &ldquo;Top violation conditions&rdquo; chart does not group notices by the DBI
              code-section category used for severity weighting. Those categories name chapters of
              the code, not necessarily what is wrong. Instead, Stoop applies an ordered,
              rules-based classifier to the notice text and groups matching records by the condition
              named there. The chart defaults to the last 5 years and can be switched to all time.
              Notices that contain inspector narrative but name no specific condition are counted in
              a footnote and are not presented as a problem category.
            </p>
          </div>
        </section>

        <section style={{ marginBottom: '3rem' }}>
          <SectionTitle>Building size normalization</SectionTitle>
          <p style={{ ...PROSE, marginBottom: 20 }}>
            A large apartment complex will naturally accumulate more complaints than a small
            two-flat. Raw counts penalize larger buildings unfairly. To make comparisons meaningful,
            all weighted sums are divided by an estimate of building scale before peer ranking. Since
            we don&apos;t have the exact unit count for each building, size is estimated from its
            footprint and height.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" style={{ marginBottom: 12 }}>
            <div style={CARD}>
              <p style={SECTION_HEADER}>Estimated scale</p>
              <div style={{
                fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 500,
                color: '#111111', marginBottom: 10,
              }}>
                scale = footprint area × max(height, 1)
              </div>
              <p style={{ ...PROSE, fontSize: 13 }}>
                Footprint area (m²) from the building polygon multiplied by median building height
                (m), aggregated across all footprints on the parcel. This approximates total building
                volume without needing unit counts.
              </p>
            </div>
            <div style={CARD}>
              <p style={SECTION_HEADER}>Complaint density</p>
              <div style={{
                fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 500,
                color: '#111111', marginBottom: 10,
              }}>
                density = weighted sum / scale × 1 000
              </div>
              <p style={{ ...PROSE, fontSize: 13 }}>
                Weighted complaint or violation sum divided by estimated scale, then scaled up for
                readability. A small building and a large building with proportional histories get the
                same density.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" style={{ marginBottom: 12 }}>
            <RecencyCard note="Applied to both datasets (311 complaints and DBI violations). Records with no date, or older than 10 years, contribute nothing to the weighted sum." />
            <div style={{ ...CARD, background: '#FAFAFA' }}>
              <p style={SECTION_HEADER}>Size-normalized percentile</p>
              <p style={{ ...PROSE, fontSize: 13 }}>
                Each building&apos;s density is ranked via <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, background: '#F5F5F5', padding: '1px 5px', borderRadius: 3 }}>PERCENT_RANK()</code> within
                its Analysis Neighborhood, separately for 311 complaints and DBI violations. Buildings
                without footprint or height data fall back to their raw weighted sum for ranking. A
                density percentile of 20 means the building has fewer weighted complaints per unit of
                scale than 80% of its neighbors.
              </p>
            </div>
          </div>
        </section>

        {/* ── 6. Risk level ──────────────────────────────────────────────── */}
        <section style={{ marginBottom: '3rem' }}>
          <SectionTitle>Risk level</SectionTitle>
          <p style={{ ...PROSE, marginBottom: 20 }}>
            A building&apos;s neighborhood percentile is mapped to a risk level label shown on building
            pages and the map. The label reflects how the building compares to peers within the same
            Analysis Neighborhood, not citywide. Housing Conditions (311) and Building Safety (DBI)
            each get their own risk level. The map colors each dot using whichever dataset lens—
            Housing Complaints or DBI Violations—is currently selected.
          </p>
          <RiskLevelTable />
        </section>

        {/* ── 7. Special cases ───────────────────────────────────────────── */}
        <section style={{ marginBottom: '3rem' }}>
          <SectionTitle>Special cases</SectionTitle>
          <div style={{ ...CARD, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{
                width: 10, height: 10, borderRadius: '50%', background: '#D4D1C3',
                flexShrink: 0, marginTop: 4,
              }} />
              <div>
                <p style={{ fontFamily: 'var(--font-serif)', fontSize: 14, fontWeight: 500, color: '#111111', margin: '0 0 3px' }}>
                  Too few records
                </p>
                <p style={{ ...PROSE, fontSize: 13 }}>
                  SF buildings carry far fewer records than NYC ones, so a low floor keeps the
                  percentile meaningful. A building with fewer than 2 total 311 complaints, or fewer
                  than 3 total violations, is shown as &ldquo;Very low&rdquo; rather than ranked.
                </p>
              </div>
            </div>
            <div style={{ height: '0.5px', background: '#E5E5E5' }} />
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{
                width: 10, height: 10, borderRadius: '50%', background: '#D4D1C3',
                flexShrink: 0, marginTop: 4,
              }} />
              <div>
                <p style={{ fontFamily: 'var(--font-serif)', fontSize: 14, fontWeight: 500, color: '#111111', margin: '0 0 3px' }}>
                  No neighborhood
                </p>
                <p style={{ ...PROSE, fontSize: 13 }}>
                  A parcel that can&apos;t be placed in an Analysis Neighborhood has no peer group to rank
                  against, so it also falls back to &ldquo;Very low&rdquo; rather than receiving a percentile.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ── 8. Neighborhood comparison ─────────────────────────────────── */}
        <section style={{ marginBottom: '3rem' }}>
          <SectionTitle>Neighborhood comparisons</SectionTitle>
          <div style={{ ...CARD, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <p style={SECTION_HEADER}>Neighborhood percentile</p>
              <p style={PROSE}>
                Percentile comparisons are <strong style={{ color: '#111111', fontWeight: 500 }}>neighborhood-relative</strong>,
                not absolute. A building is compared only to peers in its own Analysis Neighborhood.
                Within each neighborhood, buildings are ranked by weighted complaint density from
                lowest to highest. A building at the 80th percentile has higher weighted complaint
                density than 80% of its neighbors, meaning it received relatively more or more serious
                reports. Percentiles are computed independently per neighborhood, so the same density
                may rank high in one and low in another.
              </p>
            </div>
            <div style={{ height: '0.5px', background: '#E5E5E5' }} />
            <div>
              <p style={SECTION_HEADER}>Trend</p>
              <p style={PROSE}>
                The 311 complaint trend compares the average annual rate of the last 2 years against
                the 3 years before that. A building is &ldquo;worsening&rdquo; if the recent rate exceeds the
                prior rate by more than 1 complaint per year, and &ldquo;improving&rdquo; if it is more than 1
                lower. The trend arrow is shown for housing complaints only.
              </p>
            </div>
            <div style={{ height: '0.5px', background: '#E5E5E5' }} />
            <div>
              <p style={SECTION_HEADER}>Reported vs. unresolved</p>
              <p style={PROSE}>
                311 cases in San Francisco auto-close once they&apos;re referred on, so there is no
                meaningful &ldquo;open complaint&rdquo; count — the 311 domain measures what tenants
                <em> reported</em> (volume, category, recency, trend). The <em>unresolved</em> signal
                lives in the DBI domain instead: open violations are Notices of Violation whose status
                is still &ldquo;active.&rdquo;
              </p>
            </div>
          </div>
        </section>

        {/* ── 9. Leaderboard ─────────────────────────────────────────────── */}
        <section style={{ marginBottom: '3rem' }}>
          <SectionTitle>Building Brief</SectionTitle>
          <div style={CARD}>
            <p style={PROSE}>
              Unlike the New York brief&apos;s AI-assisted corpus, the San Francisco Building Brief
              uses authored copy selected entirely by deterministic rules. It can surface up to three
              renter-relevant watch items. Complaint signals use the last 5 years; violation signals
              use notices that are active now. Complaint subtypes are grouped through a fixed
              taxonomy, while violation conditions are assigned by an ordered classifier over DBI
              notice text. The text is used only for classification and is never reproduced in the
              brief. One qualifying report or active notice can surface an item. If no rule crosses
              its threshold, that does not establish that the property has no problems.
            </p>
          </div>
        </section>

        <section style={{ marginBottom: '3rem' }}>
          <SectionTitle>Leaderboard</SectionTitle>
          <p style={{ ...PROSE, marginBottom: 20 }}>
            The San Francisco leaderboard ranks buildings by 311 complaint activity in the <strong style={{ color: '#111111', fontWeight: 500 }}>last 2 years</strong>,
            not all-time totals, so it reflects current conditions rather than accumulated history.
            Buildings need at least 5 total complaints (and at least 1 in the last 2 years) to appear.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
            <div style={CARD}>
              <p style={SECTION_HEADER}>Housing Conditions</p>
              <p style={{ ...PROSE, fontSize: 13, marginBottom: 12 }}>
                Sorted by 311 residential-building complaints filed in the last 2 years. Each row also
                shows the building&apos;s open DBI violations (status = active) as a second column, so you
                can see reported activity and unresolved enforcement side by side.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[
                  { label: 'Primary sort', value: 'Complaints last 2yr' },
                  { label: 'Also shown',   value: 'Open violations' },
                ].map(row => (
                  <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#525252' }}>{row.label}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#111111' }}>{row.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── 10. Limitations ────────────────────────────────────────────── */}
        <section style={{ marginBottom: '2rem' }}>
          <SectionTitle>Limitations</SectionTitle>
          <div style={{ ...CARD }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                {
                  title: 'Complaint ≠ confirmed violation',
                  body: '311 cases are reports filed by the public; they are not confirmed findings. DBI Notices of Violation are issued after inspection and carry more weight. Scores reflect the full record of complaints and violations, not confirmed outcomes only.',
                },
                {
                  title: 'Parcel grain',
                  body: 'Records are grouped by parcel. About 1 in 7 SF parcels hold more than one building, and those structures are counted together as a single entry. A parcel is a close but imperfect stand-in for a single building.',
                },
                {
                  title: 'Record depth',
                  body: '311 residential-building complaints begin around 2010. DBI Notice-of-Violation dates are floored at 1980 to drop corrupt values in the source. Anything filed before the record period, or never digitized, is not reflected.',
                },
                {
                  title: 'Address matching',
                  body: 'Each 311 case is matched to a parcel through its normalized EAS address, with a geographic point-in-parcel fallback for unmatched rows. Cases that match neither are excluded from scoring. DBI violations carry a block-and-lot key, so they join to a parcel directly.',
                },
                {
                  title: 'Scale estimation',
                  body: 'Building scale is estimated from footprint area and height. Buildings missing either value cannot be size-normalized and fall back to a raw weighted-sum ranking within their neighborhood. Scale is a proxy; it does not account for unit density or occupancy.',
                },
                {
                  title: 'Sync frequency',
                  body: 'New cases are pulled from DataSF weekly. DBI republishes its violations wholesale, so the weekly incremental pass catches newly-filed violations but can miss status changes (e.g. a violation being resolved) on older ones; a monthly full refresh re-pulls the entire violations dataset to true up open/closed status. Expect a lag of several days between a case being filed and it appearing here.',
                },
              ].map((item, i) => (
                <div key={item.title}>
                  {i > 0 && <div style={{ height: '0.5px', background: '#E5E5E5', marginBottom: 12 }} />}
                  <p style={{ fontFamily: 'var(--font-serif)', fontSize: 14, fontWeight: 500, color: '#111111', margin: '0 0 4px' }}>
                    {item.title}
                  </p>
                  <p style={{ ...PROSE, fontSize: 13 }}>{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Footer note */}
        <p style={{
          fontFamily: 'var(--font-mono)', fontSize: 11, color: '#6B6B6B',
          textAlign: 'center', letterSpacing: '0.04em', lineHeight: 1.6,
        }}>
          All data is sourced from DataSF (data.sfgov.org) and is in the public domain.
        </p>

      </main>
    </div>
  )
}
