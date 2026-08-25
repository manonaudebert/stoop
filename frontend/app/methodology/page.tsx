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
  description: 'How Stoop compares NYC buildings using DOB complaints, HPD violations, and HPD tenant complaints — normalized by building size.',
}

// ── NYC priority / severity data ──────────────────────────────────────────────

const HPD_VIOLATION_CLASSES: SeverityItem[] = [
  { key: 'C', badge: 'C', name: 'Immediately hazardous', weight: 15, color: '#7F1D1D', textColor: '#FFFFFF',
    examples: 'Lead paint, mold, heat failure, pest infestation, structural hazard' },
  { key: 'B', badge: 'B', name: 'Hazardous', weight: 8, color: '#FEF3C7', textColor: '#92400E',
    examples: 'Broken locks, defective plumbing, missing smoke detectors, damaged floors' },
  { key: 'A', badge: 'A', name: 'Non-hazardous', weight: 3, color: '#D1FAE5', textColor: '#065F46',
    examples: 'Peeling paint (non-lead), minor repairs, cosmetic defects' },
  { key: 'I', badge: 'I', name: 'Informational', weight: 1, color: '#FFFFFF', textColor: '#111111',
    border: '0.5px solid #E5E5E5', examples: 'Administrative notices, permit-related items' },
]

const HPD_COMPLAINT_TYPES: SeverityItem[] = [
  { key: 'IE', badge: 'IE', name: 'Immediate Emergency', weight: 15, color: '#7F1D1D', textColor: '#FFFFFF',
    examples: 'No heat in winter, gas leak, sewage backup, structural collapse risk' },
  { key: 'E',  badge: 'E',  name: 'Emergency', weight: 8, color: '#FEF3C7', textColor: '#92400E',
    examples: 'Mold, pest infestation, water leak, broken elevator' },
  { key: 'NE', badge: 'NE', name: 'Non Emergency', weight: 3, color: '#D1FAE5', textColor: '#065F46',
    examples: 'Cosmetic damage, minor repairs, general maintenance' },
]

const PRIORITY_TIERS: SeverityItem[] = [
  { key: 'A', badge: 'A', name: 'Imminent danger', weight: 15, color: '#7F1D1D', textColor: '#FFFFFF',
    examples: 'Collapse risk, falling debris, blocked egress, gas leaks, elevator accidents' },
  { key: 'B', badge: 'B', name: 'Active violation', weight: 8, color: '#FEF3C7', textColor: '#92400E',
    examples: 'Illegal work in progress, no permit, SRO conversion, sprinkler defects' },
  { key: 'C', badge: 'C', name: 'Minor / administrative', weight: 3, color: '#D1FAE5', textColor: '#065F46',
    examples: 'Zoning non-compliance, certificate of occupancy issues, failure to maintain' },
  { key: 'D', badge: 'D', name: 'Tracking / inspection', weight: 1, color: '#FFFFFF', textColor: '#111111',
    border: '0.5px solid #E5E5E5', examples: 'Routine inspections, contractor sign absent, inter-agency referrals' },
]

// ── page ──────────────────────────────────────────────────────────────────────

export default function MethodologyPage() {
  return (
    <div style={{ minHeight: '100vh', background: '#FAFAFA' }}>

      <BuildingNavBar backHref="/" backLabel="Map" />

      {/* ── Section 1: Mission (generic, shared) ─────────────────────────── */}
      <MethodologyAbout />

      {/* ── Section 2: Methodology (NYC) ─────────────────────────────────── */}
      <MethodologyIntro city="NYC">
        <p style={{ ...PROSE, maxWidth: 600 }}>
          Every metric and comparison on Stoop&apos;s New York pages is derived from public records
          published by the NYC Department of Buildings (DOB) and the NYC Department of Housing
          Preservation &amp; Development (HPD). Here&apos;s how raw data becomes the numbers you see, and how
          buildings are compared fairly regardless of size, given publicly available data.
        </p>
      </MethodologyIntro>

      <main style={{ maxWidth: 860, margin: '0 auto', padding: '2.5rem 1.5rem' }}>

        {/* ── 1. Data sources ────────────────────────────────────────────── */}
        <section style={{ marginBottom: '3rem' }}>
          <SectionTitle>Data sources</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
            <DataSourceCard
              id="eabe-havv"
              title="DOB Complaints Received"
              agency="NYC Dept. of Buildings"
              description="Complaints filed with the DOB since 1988, including category, status, inspection dates, and disposition. Primary dataset behind the DOB risk level and neighborhood percentile ranking."
              href="https://data.cityofnewyork.us/Housing-Development/DOB-Complaints-Received/eabe-havv"
            />
            <DataSourceCard
              id="wvxf-dwi5"
              title="HPD Housing Maintenance Violations"
              agency="NYC Housing Preservation &amp; Development"
              description="Formally issued violations for housing maintenance code breaches. Classified by severity: Class C (immediately hazardous), B (hazardous), A (non-hazardous)."
              href="https://data.cityofnewyork.us/Housing-Development/Housing-Maintenance-Code-Violations/wvxf-dwi5"
            />
            <DataSourceCard
              id="ygpa-z7cr"
              title="HPD Housing Maintenance Complaints"
              agency="NYC Housing Preservation &amp; Development"
              description="Complaints filed directly by tenants about housing conditions like heat, hot water, pests, mold, leaks, and more. Classified as Immediate Emergency, Emergency, or Non Emergency."
              href="https://data.cityofnewyork.us/Housing-Development/Housing-Maintenance-Code-Complaints/ygpa-z7cr"
            />
            <DataSourceCard
              id="5zhs-2jue"
              title="NYC Building Footprints"
              agency="NYC Dept. of City Planning"
              description="Building polygons with roof height and footprint area, used to estimate total building scale for size-normalized comparisons, plus centroids for map placement."
              href="https://data.cityofnewyork.us/d/5zhs-2jue"
            />
            <DataSourceCard
              id="NTA2020"
              title="Neighborhood Tabulation Areas"
              agency="NYC Dept. of City Planning"
              description="2020 NTA polygon boundaries used for point-in-polygon assignment. Each building is placed in exactly one NTA, which defines its peer group for percentile ranking."
              href="https://www.nyc.gov/site/planning/data-maps/open-data/census-download-metadata.page"
            />
          </div>
        </section>

        {/* ── 2. Priority classification ─────────────────────────────────── */}
        <section style={{ marginBottom: '3rem' }}>
          <SectionTitle>DOB complaint priority</SectionTitle>
          <p style={{ ...PROSE, marginBottom: 16 }}>
            DOB complaint category codes are assigned a priority tier based on the agency&apos;s
            classification system (rev. 09/21). When a complaint&apos;s category is unknown or absent,
            it defaults to Priority C.
          </p>
          <SeverityList items={PRIORITY_TIERS} />
        </section>

        {/* ── 3. HPD violation severity ──────────────────────────────────── */}
        <section style={{ marginBottom: '3rem' }}>
          <SectionTitle>HPD violation severity</SectionTitle>
          <p style={{ ...PROSE, marginBottom: 16 }}>
            HPD Housing Maintenance Code violations are classified into four classes by severity.
            The weighted violation sum uses the same recency multipliers as the DOB weighted sum
            (see Building size normalization below), so recent serious violations weigh more than old minor ones.
          </p>
          <SeverityList items={HPD_VIOLATION_CLASSES} />
        </section>

        {/* ── 4. HPD complaint urgency ────────────────────────────────────── */}
        <section style={{ marginBottom: '3rem' }}>
          <SectionTitle>HPD tenant complaint urgency</SectionTitle>
          <p style={{ ...PROSE, marginBottom: 16 }}>
            HPD tenant complaints are classified by urgency when filed. Because complaints are
            typically closed once an inspector visits or a violation is issued, raw open counts
            understate the building&apos;s history. The weighted complaint sum captures the full
            record with higher weight for urgent and recent complaints.
          </p>
          <SeverityList items={HPD_COMPLAINT_TYPES} badgeFontSize={11} />
        </section>

        {/* ── 5. Building size normalization ─────────────────────────────── */}
        <section style={{ marginBottom: '3rem' }}>
          <SectionTitle>Building size normalization</SectionTitle>
          <p style={{ ...PROSE, marginBottom: 20 }}>
            A 200-unit tower will naturally accumulate more complaints than a four-unit brownstone.
            Raw counts penalize larger buildings unfairly. To make comparisons meaningful, all
            weighted sums are divided by an estimate of building scale before peer ranking. Since we
            don&apos;t have the exact unit count for each building, size is estimated by building footprint
            and height on building.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" style={{ marginBottom: 12 }}>
            <div style={CARD}>
              <p style={SECTION_HEADER}>Estimated scale</p>
              <div style={{
                fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 500,
                color: '#111111', marginBottom: 10,
              }}>
                scale = footprint × max(height / 12, 1)
              </div>
              <p style={{ ...PROSE, fontSize: 13 }}>
                Footprint area (sq ft) from the building polygon multiplied by estimated floors
                (roof height ÷ 12 ft per floor). This approximates total floor area without
                needing unit counts.
              </p>
            </div>
            <div style={CARD}>
              <p style={SECTION_HEADER}>Complaint density</p>
              <div style={{
                fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 500,
                color: '#111111', marginBottom: 10,
              }}>
                density = weighted sum / scale × 10 000
              </div>
              <p style={{ ...PROSE, fontSize: 13 }}>
                Weighted complaint or violation sum divided by estimated scale, scaled to
                &ldquo;per 10,000 sq-ft-floors.&rdquo; A small building and a large building with
                proportional complaint histories get the same density.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" style={{ marginBottom: 12 }}>
            <RecencyCard note="Applied to all three datasets (DOB, HPD violations, HPD complaints). Complaints with no date recorded contribute nothing to the weighted sum." />
            <div style={{ ...CARD, background: '#FAFAFA' }}>
              <p style={SECTION_HEADER}>Size-normalized percentile</p>
              <p style={{ ...PROSE, fontSize: 13 }}>
                Each building&apos;s density is ranked via <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, background: '#F5F5F5', padding: '1px 5px', borderRadius: 3 }}>PERCENT_RANK()</code> within
                its NTA, separately for HPD violations, HPD complaints, and DOB complaints. DOB
                comparisons include residential buildings only; the two HPD comparisons include
                every building in the NTA. When scale data is missing, HPD complaints fall back to
                a raw weighted-count percentile. DOB becomes &ldquo;Not comparable,&rdquo; and the HPD
                violation percentile is unavailable. A density percentile of 20 means the building
                has lower weighted activity per unit of scale than 80% of the relevant peer group.
              </p>
            </div>
          </div>
        </section>

        {/* ── 6. Risk level ──────────────────────────────────────────────── */}
        <section style={{ marginBottom: '3rem' }}>
          <SectionTitle>Risk level</SectionTitle>
          <p style={{ ...PROSE, marginBottom: 20 }}>
            A building&apos;s neighborhood percentile is mapped to a risk level label shown
            on building pages and the map. The label reflects how the building compares
            to residential peers within the same neighborhood, not citywide.
          </p>
          <RiskLevelTable />
          <p style={{ ...PROSE, fontSize: 13, marginTop: 12 }}>
            &ldquo;Insufficient data&rdquo; and &ldquo;Not comparable&rdquo; are handled separately — see below.
          </p>
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
                  Insufficient data
                </p>
                <p style={{ ...PROSE, fontSize: 13 }}>
                  Buildings with fewer than 10 total complaints <em>and</em> less than 2 years
                  of complaint history cannot be reliably ranked. They are excluded from
                  percentile comparisons.
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
                  Not comparable
                </p>
                <p style={{ ...PROSE, fontSize: 13 }}>
                  DOB buildings without usable size data, and those in non-residential NTAs such as
                  parks, airports, and cemeteries (NTA type ≠ 0), receive no normalized percentile
                  because there is no meaningful size-normalized residential comparison.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ── 10. Neighborhood comparison ────────────────────────────────── */}
        <section style={{ marginBottom: '3rem' }}>
          <SectionTitle>Neighborhood comparisons</SectionTitle>
          <div style={{ ...CARD, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <p style={SECTION_HEADER}>Neighborhood percentile</p>
              <p style={PROSE}>
                Percentile comparisons are <strong style={{ color: '#111111', fontWeight: 500 }}>neighborhood-relative</strong>,
                not absolute. A building is compared only to residential peers in its own NTA.
                Within each NTA, buildings are ranked by weighted complaint density from lowest to highest.
                A building at the 80th percentile has higher weighted complaint density than 80% of its residential
                peers, meaning it received relatively more or more serious complaints. Percentiles
                are computed independently per NTA, so the same density may rank high in one
                neighborhood and low in another.
              </p>
            </div>
            <div style={{ height: '0.5px', background: '#E5E5E5' }} />
            <div>
              <p style={SECTION_HEADER}>Serious complaint rate</p>
              <p style={PROSE}>
                Priority A and B complaints per year, averaged over the last 10 years
                (minimum 1 year). This rate is also percentile-ranked within each NTA and
                surfaced in the &ldquo;Severity&rdquo; insight card on building pages.
              </p>
            </div>
            <div style={{ height: '0.5px', background: '#E5E5E5' }} />
            <div>
              <p style={SECTION_HEADER}>Trend</p>
              <p style={PROSE}>
                Complaint trend compares the average annual rate of the last 2 years against
                the 3 years before that. A building is &ldquo;worsening&rdquo; if the recent rate exceeds
                the prior rate by more than 1 complaint per year, and &ldquo;improving&rdquo; if it is more
                than 1 lower. The same algorithm is applied independently to DOB complaints
                and HPD tenant complaints.
              </p>
            </div>
          </div>
        </section>

        {/* ── 11. Leaderboards ───────────────────────────────────────────── */}
        <section style={{ marginBottom: '3rem' }}>
          <SectionTitle>Building Brief</SectionTitle>
          <div style={CARD}>
            <p style={PROSE}>
              The Building Brief combines deterministic rule selection with an AI-assisted,
              pre-generated corpus for its &ldquo;Worth checking&rdquo; sentences. No model is called
              when you open a building page. The model-generated sentences are written once for
              reusable record shapes, checked by deterministic validators before publication, and
              labeled &ldquo;AI-assisted&rdquo; on the page; the remaining brief copy is written by hand
              and cited. The brief can surface up to three renter-relevant watch items, prioritizing
              life-safety and essential-service concerns. Complaint signals use the last 5 years;
              violation signals use records that are open now, including lead-paint orders that
              remain open even when their legal order number has been retired. If no rule crosses
              its threshold, that does not establish that the building has no problems.
            </p>
          </div>
        </section>

        <section style={{ marginBottom: '3rem' }}>
          <SectionTitle>Leaderboards</SectionTitle>
          <p style={{ ...PROSE, marginBottom: 20 }}>
            The leaderboard pages rank buildings by complaint activity in the <strong style={{ color: '#111111', fontWeight: 500 }}>last 2 years</strong>,
            not all-time totals, so they reflect current conditions rather than accumulated
            history. Buildings need at least 10 total complaints to appear.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
            <div style={CARD}>
              <p style={SECTION_HEADER}>DOB — Building Safety</p>
              <p style={{ ...PROSE, fontSize: 13, marginBottom: 12 }}>
                Sorted by DOB complaints filed in the last 2 years. Ties broken by serious
                complaints (Priority A+B) in the same window. Only residential buildings
                are included (non-residential NTAs excluded).
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[
                  { label: 'Primary sort', value: 'Complaints last 2yr' },
                  { label: 'Tiebreaker',   value: 'Priority A+B last 2yr' },
                ].map(row => (
                  <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#525252' }}>{row.label}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#111111' }}>{row.value}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={CARD}>
              <p style={SECTION_HEADER}>HPD — Housing Conditions</p>
              <p style={{ ...PROSE, fontSize: 13, marginBottom: 12 }}>
                Sorted by HPD tenant complaints filed in the last 2 years. Ties broken by
                emergency complaints (Emergency + Immediate Emergency) in the same 2-year
                window, counting all emergency complaints regardless of whether they are
                still open.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[
                  { label: 'Primary sort', value: 'Complaints last 2yr' },
                  { label: 'Tiebreaker',   value: 'Emergency complaints 2yr' },
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

        {/* ── 12. Limitations ────────────────────────────────────────────── */}
        <section style={{ marginBottom: '2rem' }}>
          <SectionTitle>Limitations</SectionTitle>
          <div style={{ ...CARD }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                {
                  title: 'Complaint ≠ confirmed violation',
                  body: 'DOB and HPD complaints are reports filed by the public or other agencies. They are not confirmed findings. HPD violations are formally issued after inspection and carry more weight. Scores reflect the full record of complaints and violations, not confirmed outcomes only.',
                },
                {
                  title: 'Records begin in 1988',
                  body: 'DOB complaint records go back to 1988. HPD violation and complaint records vary in depth. Complaints never digitized, or filed before the record period, are not reflected in scores.',
                },
                {
                  title: 'BIN matching',
                  body: 'All data is attributed to buildings using the Building Identification Number (BIN). If a complaint or violation was filed with a missing or incorrect BIN, it will not appear on the correct building\'s page and is excluded from scoring.',
                },
                {
                  title: 'Scale estimation',
                  body: 'Building scale is estimated from footprint area and roof height. HPD complaints missing either value fall back to a raw weighted-count percentile; DOB becomes Not comparable, and the HPD violation percentile is unavailable. Scale is a proxy; it does not account for unit density or occupancy.',
                },
                {
                  title: 'Sync frequency',
                  body: 'All datasets are refreshed periodically (weekly) from NYC Open Data. There may be a lag of several days between a complaint being filed and it appearing here.',
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
          All data is sourced from NYC Open Data and is in the public domain.
        </p>

      </main>
    </div>
  )
}
