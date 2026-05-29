import Link from 'next/link'
import type { Metadata } from 'next'
import BuildingNavBar from '@/components/BuildingNavBar'

export const metadata: Metadata = {
  title: 'Methodology — stoop',
  description: 'How stoop compares NYC buildings using DOB complaints, HPD violations, and HPD tenant complaints — normalized by building size.',
}

// ── design tokens ─────────────────────────────────────────────────────────────

const CARD: React.CSSProperties = {
  background: '#FFFFFF',
  border: '0.5px solid #E5E5E5',
  borderRadius: 12,
  padding: 20,
}

const SECTION_HEADER: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  letterSpacing: '0.12em',
  textTransform: 'uppercase' as const,
  color: '#737373',
  marginBottom: 12,
  marginTop: 0,
}

const PROSE: React.CSSProperties = {
  fontSize: 14,
  color: '#525252',
  lineHeight: 1.7,
  margin: 0,
}

// ── priority / severity data ──────────────────────────────────────────────────

const HPD_VIOLATION_CLASSES = [
  { label: 'C', name: 'Immediately hazardous', weight: 15, color: '#7F1D1D', textColor: '#FFFFFF',
    examples: 'Lead paint, mold, heat failure, pest infestation, structural hazard' },
  { label: 'B', name: 'Hazardous', weight: 8, color: '#FEF3C7', textColor: '#92400E',
    examples: 'Broken locks, defective plumbing, missing smoke detectors, damaged floors' },
  { label: 'A', name: 'Non-hazardous', weight: 3, color: '#D1FAE5', textColor: '#065F46',
    examples: 'Peeling paint (non-lead), minor repairs, cosmetic defects' },
  { label: 'I', name: 'Informational', weight: 1, color: '#FFFFFF', textColor: '#111111',
    border: '0.5px solid #E5E5E5', examples: 'Administrative notices, permit-related items' },
]

const HPD_COMPLAINT_TYPES: { label: string; weight: number; color: string; textColor: string; examples: string; border?: string }[] = [
  { label: 'IMMEDIATE EMERGENCY', weight: 15, color: '#7F1D1D', textColor: '#FFFFFF',
    examples: 'No heat in winter, gas leak, sewage backup, structural collapse risk' },
  { label: 'EMERGENCY', weight: 8, color: '#FEF3C7', textColor: '#92400E',
    examples: 'Mold, pest infestation, water leak, broken elevator' },
  { label: 'NON EMERGENCY', weight: 3, color: '#D1FAE5', textColor: '#065F46',
    examples: 'Cosmetic damage, minor repairs, general maintenance' },
]

const PRIORITY_TIERS = [
  {
    label: 'A',
    name: 'Imminent danger',
    weight: 15,
    color: '#7F1D1D',
    textColor: '#FFFFFF',
    examples: 'Collapse risk, falling debris, blocked egress, gas leaks, elevator accidents',
  },
  {
    label: 'B',
    name: 'Active violation',
    weight: 8,
    color: '#FEF3C7',
    textColor: '#92400E',
    examples: 'Illegal work in progress, no permit, SRO conversion, sprinkler defects',
  },
  {
    label: 'C',
    name: 'Minor / administrative',
    weight: 3,
    color: '#D1FAE5',
    textColor: '#065F46',
    examples: 'Zoning non-compliance, certificate of occupancy issues, failure to maintain',
  },
  {
    label: 'D',
    name: 'Tracking / inspection',
    weight: 1,
    color: '#FFFFFF',
    textColor: '#111111',
    border: '0.5px solid #E5E5E5',
    examples: 'Routine inspections, contractor sign absent, inter-agency referrals',
  },
]

const RECENCY_TIERS = [
  { label: '≤ 2 years',   weight: '1.0×', desc: 'Full weight' },
  { label: '2 – 5 years', weight: '0.5×', desc: 'Half weight' },
  { label: '5 – 10 years',weight: '0.25×',desc: 'Quarter weight' },
  { label: '> 10 years',  weight: '0',    desc: 'Excluded' },
]

// ── sub-components ────────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{
      fontFamily: 'var(--font-serif)',
      fontSize: 22,
      fontWeight: 500,
      color: '#111111',
      letterSpacing: '-0.02em',
      margin: '0 0 16px',
    }}>
      {children}
    </h2>
  )
}

function DataSourceCard({
  id,
  title,
  agency,
  description,
  href,
}: {
  id: string
  title: string
  agency: string
  description: string
  href: string
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{ ...CARD, display: 'block', textDecoration: 'none', transition: 'border-color 0.15s' }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
        <div>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#737373', margin: '0 0 4px' }}>
            {agency}
          </p>
          <p style={{ fontFamily: 'var(--font-serif)', fontSize: 16, fontWeight: 500, color: '#111111', margin: 0 }}>
            {title}
          </p>
        </div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#A3A3A3" strokeWidth="2" style={{ flexShrink: 0, marginTop: 2 }}>
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
          <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
        </svg>
      </div>
      <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#A3A3A3', margin: '0 0 8px', letterSpacing: '0.04em' }}>
        dataset: {id}
      </p>
      <p style={{ ...PROSE, fontSize: 13 }}>{description}</p>
    </a>
  )
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function MethodologyPage() {
  return (
    <div style={{ minHeight: '100vh', background: '#FAFAFA' }}>

      <BuildingNavBar backHref="/" backLabel="Map" />

      {/* Page header */}
      <div style={{ background: '#FFFFFF', borderBottom: '0.5px solid #E5E5E5', padding: '2rem 1.5rem' }}>
        <div style={{ maxWidth: 860, margin: '0 auto' }}>
          <p style={SECTION_HEADER}>How it works</p>
          <h1 style={{
            fontFamily: 'var(--font-serif)', fontSize: 40, fontWeight: 500,
            color: '#111111', letterSpacing: '-0.02em', margin: '0 0 12px', lineHeight: 1.1,
          }}>
            Methodology
          </h1>
          <p style={{ ...PROSE, maxWidth: 600 }}>
            Every metric and comparison on stoop is derived from public records published
            by the NYC Department of Buildings and the NYC Department of Housing Preservation
            &amp; Development. This page explains exactly how raw data is transformed into the
            numbers you see, and how buildings are compared fairly regardless of size.
          </p>
        </div>
      </div>

      <main style={{ maxWidth: 860, margin: '0 auto', padding: '2.5rem 1.5rem' }}>

        {/* ── 1. Data sources ────────────────────────────────────────────── */}
        <section style={{ marginBottom: '3rem' }}>
          <SectionTitle>Data sources</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
            <DataSourceCard
              id="eabe-havv"
              title="DOB Complaints Received"
              agency="NYC Dept. of Buildings"
              description="Every complaint filed with the DOB since 2007, including category, status, inspection dates, and disposition. Primary dataset behind the DOB safety score."
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
              description="Complaints filed directly by tenants about housing conditions — heat, hot water, pests, mold, leaks, and more. Classified as Immediate Emergency, Emergency, or Non Emergency."
              href="https://data.cityofnewyork.us/Housing-Development/Housing-Maintenance-Code-Complaints/ygpa-z7cr"
            />
            <DataSourceCard
              id="5zhs-2jue"
              title="NYC Building Footprints"
              agency="NYC Dept. of City Planning"
              description="Building polygons with roof height and footprint area — used to estimate total building scale for size-normalized comparisons, plus centroids for map placement."
              href="https://data.cityofnewyork.us/Housing-Development/Building-Footprints/nqwf-w8eh"
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

        {/* ── 2. Data processing ─────────────────────────────────────────── */}
        <section style={{ marginBottom: '3rem' }}>
          <SectionTitle>Data processing</SectionTitle>
          <div style={{ ...CARD, display: 'flex', flexDirection: 'column', gap: 20 }}>

            <div>
              <p style={SECTION_HEADER}>Download &amp; normalize</p>
              <p style={PROSE}>
                The full complaints CSV is downloaded directly from NYC Open Data on each sync.
                Column names are mapped from the raw DOB headers (e.g., <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, background: '#F5F5F5', padding: '1px 5px', borderRadius: 3 }}>Date Entered</code> → <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, background: '#F5F5F5', padding: '1px 5px', borderRadius: 3 }}>date_entered</code>),
                date columns are parsed, and borough is derived from the first digit of each
                building&apos;s BIN (1 = Manhattan, 2 = Bronx, 3 = Brooklyn, 4 = Queens, 5 = Staten Island).
                The internal <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, background: '#F5F5F5', padding: '1px 5px', borderRadius: 3 }}>DOBRunDate</code> column is discarded — it records when the NYC export was generated, not any event at the building.
              </p>
            </div>

            <div style={{ height: '0.5px', background: '#E5E5E5' }} />

            <div>
              <p style={SECTION_HEADER}>Deduplication</p>
              <p style={PROSE}>
                Some rows appear more than once in the raw export (e.g., when a complaint status
                is updated). Duplicates are resolved by keeping the <em>last</em> occurrence of
                each unique <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, background: '#F5F5F5', padding: '1px 5px', borderRadius: 3 }}>complaint_number</code>, which reflects the most recent known status.
              </p>
            </div>

            <div style={{ height: '0.5px', background: '#E5E5E5' }} />

            <div>
              <p style={SECTION_HEADER}>BIN validation</p>
              <p style={PROSE}>
                BINs consisting entirely of zeros (e.g., <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, background: '#F5F5F5', padding: '1px 5px', borderRadius: 3 }}>0000000</code>) are treated as missing
                and excluded from scoring. Complaints with no valid BIN cannot be attributed
                to a specific building.
              </p>
            </div>

            <div style={{ height: '0.5px', background: '#E5E5E5' }} />

            <div>
              <p style={SECTION_HEADER}>Neighborhood assignment</p>
              <p style={PROSE}>
                Each building is assigned to an NTA via point-in-polygon using NYC&apos;s 2020 NTA
                boundaries. A spatial index (STRtree) is used for efficient bulk matching.
                Buildings outside all NTA polygons — typically those missing or slightly off their
                recorded coordinates — are excluded from neighborhood comparisons but still scored.
              </p>
            </div>
          </div>
        </section>

        {/* ── 3. Priority classification ─────────────────────────────────── */}
        <section style={{ marginBottom: '3rem' }}>
          <SectionTitle>DOB complaint priority</SectionTitle>
          <p style={{ ...PROSE, marginBottom: 16 }}>
            Each of the 254 DOB complaint category codes is assigned a priority tier based on
            the DOB&apos;s own classification system (rev. 09/21). When a complaint&apos;s category is
            unknown or absent, it defaults to Priority C.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {PRIORITY_TIERS.map(t => (
              <div key={t.label} style={{
                ...CARD,
                padding: '14px 18px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 16,
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 6, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: t.color, border: t.border ?? 'none',
                }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 500, color: t.textColor }}>
                    {t.label}
                  </span>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 3 }}>
                    <span style={{ fontFamily: 'var(--font-serif)', fontSize: 15, fontWeight: 500, color: '#111111' }}>
                      {t.name}
                    </span>
                    <span style={{
                      fontFamily: 'var(--font-mono)', fontSize: 11, color: '#737373',
                      letterSpacing: '0.04em',
                    }}>
                      weight {t.weight}
                    </span>
                  </div>
                  <p style={{ ...PROSE, fontSize: 13 }}>{t.examples}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── 4. HPD violation severity ──────────────────────────────────── */}
        <section style={{ marginBottom: '3rem' }}>
          <SectionTitle>HPD violation severity</SectionTitle>
          <p style={{ ...PROSE, marginBottom: 16 }}>
            HPD Housing Maintenance Code violations are classified into four classes by severity.
            The weighted violation sum uses the same recency multipliers as the DOB weighted sum
            (see Building size normalization below), so recent serious violations weigh more than old minor ones.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {HPD_VIOLATION_CLASSES.map(c => (
              <div key={c.label} style={{
                ...CARD, padding: '14px 18px',
                display: 'flex', alignItems: 'flex-start', gap: 16,
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 6, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: c.color, border: c.border ?? 'none',
                }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 500, color: c.textColor }}>
                    {c.label}
                  </span>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 3 }}>
                    <span style={{ fontFamily: 'var(--font-serif)', fontSize: 15, fontWeight: 500, color: '#111111' }}>
                      {c.name}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#737373', letterSpacing: '0.04em' }}>
                      weight {c.weight}
                    </span>
                  </div>
                  <p style={{ ...PROSE, fontSize: 13 }}>{c.examples}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── 5. HPD complaint urgency ────────────────────────────────────── */}
        <section style={{ marginBottom: '3rem' }}>
          <SectionTitle>HPD tenant complaint urgency</SectionTitle>
          <p style={{ ...PROSE, marginBottom: 16 }}>
            HPD tenant complaints are classified by urgency when filed. Because complaints are
            typically closed once an inspector visits or a violation is issued, raw open counts
            understate the building&apos;s history. The weighted complaint sum captures the full
            record — with higher weight for urgent and recent complaints.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {HPD_COMPLAINT_TYPES.map(t => (
              <div key={t.label} style={{
                display: 'flex', alignItems: 'center',
                padding: '12px 18px', borderRadius: 8,
                background: t.color, border: t.border ?? 'none',
                gap: 16,
              }}>
                <div style={{ flex: 1 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: t.textColor }}>
                    {t.label}
                  </span>
                  <p style={{ ...PROSE, fontSize: 13, color: t.textColor, opacity: 0.8, margin: '3px 0 0' }}>
                    {t.examples}
                  </p>
                </div>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 500, color: t.textColor, flexShrink: 0 }}>
                  weight {t.weight}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* ── 6. Building size normalization ─────────────────────────────── */}
        <section style={{ marginBottom: '3rem' }}>
          <SectionTitle>Building size normalization</SectionTitle>
          <p style={{ ...PROSE, marginBottom: 20 }}>
            A 200-unit tower will naturally accumulate more complaints than a four-unit brownstone.
            Raw counts penalize larger buildings unfairly. To make comparisons meaningful, all
            weighted sums are divided by an estimate of building scale before peer ranking.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
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

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div style={CARD}>
              <p style={SECTION_HEADER}>Recency multiplier</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {RECENCY_TIERS.map(r => (
                  <div key={r.label} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '7px 10px', borderRadius: 6, background: '#FAFAFA', border: '0.5px solid #E5E5E5',
                  }}>
                    <div>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: '#111111' }}>
                        {r.label}
                      </span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#737373', marginLeft: 8 }}>
                        {r.desc}
                      </span>
                    </div>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 500, color: r.weight === '0' ? '#A3A3A3' : '#111111' }}>
                      {r.weight}
                    </span>
                  </div>
                ))}
              </div>
              <p style={{ ...PROSE, fontSize: 12, marginTop: 10 }}>
                Applied to all three datasets (DOB, HPD violations, HPD complaints). Complaints with no date recorded are treated as 2–5 years old (0.5×).
              </p>
            </div>
            <div style={{ ...CARD, background: '#FAFAFA' }}>
              <p style={SECTION_HEADER}>Size-normalized percentile</p>
              <p style={{ ...PROSE, fontSize: 13 }}>
                Each building&apos;s density is ranked via <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, background: '#F5F5F5', padding: '1px 5px', borderRadius: 3 }}>PERCENT_RANK()</code> within
                its NTA, separately for HPD violations, HPD complaints, and DOB complaints.
                Buildings without footprint or height data receive a raw count percentile instead.
                A density percentile of 20 means the building has fewer weighted complaints per
                unit of scale than 80% of its residential neighbors.
              </p>
            </div>
          </div>
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
                  Buildings in non-residential NTAs — parks, airports, cemeteries, and similar
                  areas (NTA type ≠ 0) — are excluded from percentile ranking because there are
                  no meaningful residential peers to compare against.
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
                not absolute — a building is compared only to residential peers in its own NTA.
                Within each NTA, buildings are ranked by weighted complaint density from lowest to highest.
                A building at the 80th percentile has higher weighted complaint density than 80% of its residential
                peers — meaning it received relatively more or more serious complaints. Percentiles
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

        {/* ── 9. Leaderboards ────────────────────────────────────────────── */}
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
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#737373' }}>{row.label}</span>
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
                window — counting all emergency complaints regardless of whether they are
                still open.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[
                  { label: 'Primary sort', value: 'Complaints last 2yr' },
                  { label: 'Tiebreaker',   value: 'Emergency complaints 2yr' },
                ].map(row => (
                  <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#737373' }}>{row.label}</span>
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
                  body: 'DOB and HPD complaints are reports filed by the public or other agencies — they are not confirmed findings. HPD violations are formally issued after inspection and carry more weight. Scores reflect the full record of complaints and violations, not confirmed outcomes only.',
                },
                {
                  title: 'Records begin in 2007',
                  body: 'Electronic DOB complaint records are available from 2007 onwards. HPD violation and complaint records vary in depth. Complaints filed before the digital record period, or those never digitized, are not reflected in scores.',
                },
                {
                  title: 'BIN matching',
                  body: 'All data is attributed to buildings using the Building Identification Number (BIN). If a complaint or violation was filed with a missing or incorrect BIN, it will not appear on the correct building\'s page and is excluded from scoring.',
                },
                {
                  title: 'Scale estimation',
                  body: 'Building scale is estimated from footprint area and roof height. Buildings missing either value cannot be size-normalized and fall back to raw count percentiles within their NTA. Scale is a proxy — it does not account for unit density or occupancy.',
                },
                {
                  title: 'Sync frequency',
                  body: 'All datasets are refreshed periodically from NYC Open Data. There may be a lag of several days between a complaint being filed and it appearing here.',
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
          fontFamily: 'var(--font-mono)', fontSize: 11, color: '#A3A3A3',
          textAlign: 'center', letterSpacing: '0.04em', lineHeight: 1.6,
        }}>
          All data is sourced from NYC Open Data and is in the public domain.
        </p>

      </main>
    </div>
  )
}
