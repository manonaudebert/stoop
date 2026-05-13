import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Methodology — Tenement',
  description: 'How Tenement calculates building safety scores and assigns risk tiers from NYC Department of Buildings complaint data.',
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

// ── priority tier data ────────────────────────────────────────────────────────

const PRIORITY_TIERS = [
  {
    label: 'A',
    name: 'Imminent danger',
    deduction: 15,
    color: '#7F1D1D',
    textColor: '#FFFFFF',
    examples: 'Collapse risk, falling debris, blocked egress, gas leaks, elevator accidents',
  },
  {
    label: 'B',
    name: 'Active violation',
    deduction: 8,
    color: '#FEF3C7',
    textColor: '#92400E',
    examples: 'Illegal work in progress, no permit, SRO conversion, sprinkler defects',
  },
  {
    label: 'C',
    name: 'Minor / administrative',
    deduction: 3,
    color: '#D1FAE5',
    textColor: '#065F46',
    examples: 'Zoning non-compliance, certificate of occupancy issues, failure to maintain',
  },
  {
    label: 'D',
    name: 'Tracking / inspection',
    deduction: 1,
    color: '#FFFFFF',
    textColor: '#111111',
    border: '0.5px solid #E5E5E5',
    examples: 'Routine inspections, contractor sign absent, inter-agency referrals',
  },
]

const RECENCY_TIERS = [
  { label: '≤ 2 years', weight: '1.0×', desc: 'Full weight' },
  { label: '2 – 5 years', weight: '0.5×', desc: 'Half weight' },
  { label: '> 5 years', weight: '0.25×', desc: 'Quarter weight' },
]

const RISK_TIERS = [
  { label: 'Very low',  bg: '#D4F5CB', text: '#1F4012', range: '< 15th percentile',  desc: 'Fewer complaints than 85 %+ of residential peers' },
  { label: 'Low',       bg: '#A8E5A0', text: '#1F4012', range: '15th – 40th',         desc: 'Below-average complaint activity for the neighborhood' },
  { label: 'Moderate',  bg: '#FFD930', text: '#5C4A0A', range: '40th – 70th',         desc: 'Around average for the neighborhood' },
  { label: 'High',      bg: '#F5A047', text: '#5C3A0A', range: '70th – 90th',         desc: 'More complaints than most residential peers' },
  { label: 'Very high', bg: '#EF4637', text: '#FFFFFF', range: '≥ 90th percentile',   desc: 'Among the 10 % most-complained buildings in the area' },
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
        <Link href="/leaderboard" style={{
          fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em',
          textTransform: 'uppercase', color: '#A3A3A3', textDecoration: 'none',
        }}>
          Leaderboard
        </Link>
      </header>

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
            Every score and risk tier on Tenement is derived from public records published by
            the NYC Department of Buildings. This page explains exactly how raw complaint
            data is transformed into the numbers you see.
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
              description="Every complaint filed with the DOB since 2007, including category, status, inspection dates, and disposition. This is the primary dataset behind all scores."
              href="https://data.cityofnewyork.us/Housing-Development/DOB-Complaints-Received/eabe-havv"
            />
            <DataSourceCard
              id="5zhs-2jue"
              title="NYC Building Footprints"
              agency="NYC Dept. of City Planning"
              description="Building centroids with latitude, longitude, borough, and construction year — used to plot buildings on the map and derive borough from BIN when absent."
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
          <SectionTitle>Complaint priority</SectionTitle>
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
                      −{t.deduction} base deduction
                    </span>
                  </div>
                  <p style={{ ...PROSE, fontSize: 13 }}>{t.examples}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── 4. The score ───────────────────────────────────────────────── */}
        <section style={{ marginBottom: '3rem' }}>
          <SectionTitle>The safety score</SectionTitle>
          <p style={{ ...PROSE, marginBottom: 20 }}>
            Each building receives a score from 0 to 100. Higher is safer. A building with
            no complaints receives a perfect 100; every complaint reduces the score in
            proportion to how serious it was and how recently it was filed.
          </p>

          {/* Formula card */}
          <div style={{ ...CARD, marginBottom: 12, textAlign: 'center', padding: '28px 20px' }}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#737373', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 16 }}>
              Score formula
            </p>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: 28, fontWeight: 500,
              color: '#111111', letterSpacing: '-0.02em', marginBottom: 8,
            }}>
              Score = 100 × e<sup style={{ fontSize: 16 }}>−D / 40</sup>
            </div>
            <p style={{ ...PROSE, fontSize: 13 }}>
              where <strong style={{ color: '#111111', fontWeight: 500 }}>D</strong> is the
              total weighted deduction accumulated across all complaints
            </p>
          </div>

          {/* Deduction breakdown */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>

            {/* Priority weights */}
            <div style={CARD}>
              <p style={SECTION_HEADER}>Step 1 — priority deduction</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {PRIORITY_TIERS.map(t => (
                  <div key={t.label} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '7px 10px', borderRadius: 6,
                    background: t.color, border: t.border ?? 'none',
                  }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: t.textColor }}>
                      Priority {t.label}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 500, color: t.textColor }}>
                      −{t.deduction}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Recency weights */}
            <div style={CARD}>
              <p style={SECTION_HEADER}>Step 2 — recency multiplier</p>
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
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 500, color: '#111111' }}>
                      {r.weight}
                    </span>
                  </div>
                ))}
              </div>
              <p style={{ ...PROSE, fontSize: 12, marginTop: 10 }}>
                Complaints with no date recorded are treated as 2–5 years old (0.5× weight).
              </p>
            </div>
          </div>

          {/* Worked example */}
          <div style={{ ...CARD, background: '#FAFAFA', border: '0.5px solid #E5E5E5' }}>
            <p style={SECTION_HEADER}>Example calculation</p>
            <p style={{ ...PROSE, fontSize: 13, marginBottom: 12 }}>
              A building with one recent Priority A complaint and two older Priority B complaints:
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
              {[
                { desc: '1 × Priority A, filed 6 months ago', calc: '15 × 1.0 = 15.0' },
                { desc: '2 × Priority B, filed 3 years ago',  calc: '2 × (8 × 0.5) = 8.0' },
              ].map(row => (
                <div key={row.desc} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 12px', borderRadius: 6, background: '#FFFFFF', border: '0.5px solid #E5E5E5',
                }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#525252' }}>{row.desc}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: '#111111' }}>{row.calc}</span>
                </div>
              ))}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 12px', borderRadius: 6, background: '#111111',
              }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#A3A3A3' }}>
                  Total deduction D = 23.0 → Score = 100 × e<sup style={{ fontSize: 9 }}>−23/40</sup>
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 500, color: '#FFFFFF' }}>
                  ≈ 56.3
                </span>
              </div>
            </div>
            <p style={{ ...PROSE, fontSize: 13 }}>
              The exponential function means early complaints cause the largest drops; a building
              must accumulate substantially more complaints to fall from 60 → 30 than from 100 → 60.
              The divisor of 40 is calibrated so that a building receiving roughly one Priority A
              complaint per year stabilizes near a score of 55.
            </p>
          </div>
        </section>

        {/* ── 5. Risk tiers ──────────────────────────────────────────────── */}
        <section style={{ marginBottom: '3rem' }}>
          <SectionTitle>Risk tiers</SectionTitle>
          <p style={{ ...PROSE, marginBottom: 16 }}>
            Risk tiers are <strong style={{ color: '#111111', fontWeight: 500 }}>neighborhood-relative</strong>,
            not absolute. A building is compared only to residential peers in its own NTA
            (Neighborhood Tabulation Area) using its <em>neighborhood percentile</em> —
            the share of peers with a higher safety score. This prevents buildings in
            historically under-resourced areas from being unfairly penalized relative to the
            city-wide average.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {RISK_TIERS.map(t => (
              <div key={t.label} style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: '12px 18px', borderRadius: 8,
                background: t.bg,
              }}>
                <div style={{ width: 80, flexShrink: 0 }}>
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: t.text,
                  }}>
                    {t.label}
                  </span>
                </div>
                <div style={{ flex: 1 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: t.text, opacity: 0.75 }}>
                    {t.desc}
                  </span>
                </div>
                <div style={{ flexShrink: 0 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: t.text, opacity: 0.75 }}>
                    {t.range}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Special cases */}
          <div style={{ ...CARD, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={SECTION_HEADER}>Special cases</p>
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
                  of complaint history cannot be reliably ranked. They receive a score but no
                  percentile comparison.
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

        {/* ── 6. Neighborhood comparison ─────────────────────────────────── */}
        <section style={{ marginBottom: '3rem' }}>
          <SectionTitle>Neighborhood comparisons</SectionTitle>
          <div style={{ ...CARD, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <p style={SECTION_HEADER}>Neighborhood percentile</p>
              <p style={PROSE}>
                Within each NTA, buildings are ranked by safety score from highest to lowest.
                A building at the 80th percentile has a lower score than 80% of its residential
                peers — meaning it received relatively more or more serious complaints. Percentiles
                are computed independently per NTA, so a score of 70 may rank high in one
                neighborhood and low in another.
              </p>
            </div>
            <div style={{ height: '0.5px', background: '#E5E5E5' }} />
            <div>
              <p style={SECTION_HEADER}>Serious complaint rate</p>
              <p style={PROSE}>
                Priority A and B complaints per year, averaged over the full complaint history
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
                than 1 lower.
              </p>
            </div>
          </div>
        </section>

        {/* ── 7. Limitations ─────────────────────────────────────────────── */}
        <section style={{ marginBottom: '2rem' }}>
          <SectionTitle>Limitations</SectionTitle>
          <div style={{ ...CARD }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                {
                  title: 'DOB complaints only',
                  body: 'Tenement tracks complaints filed with the NYC Department of Buildings. Housing maintenance violations (heat, hot water, pests, mold) are handled by HPD and are not included. For a fuller picture, check hpdonline.nyc.gov.',
                },
                {
                  title: 'Records begin in 2007',
                  body: 'Electronic DOB complaint records are available from 2007 onwards. Complaints filed before that year, or any complaints that were never digitized, are not reflected in scores.',
                },
                {
                  title: 'BIN matching',
                  body: 'Complaints are attributed to buildings using the Building Identification Number (BIN). If a complaint was filed with a missing or incorrect BIN, it will not appear on the correct building\'s page. Unmatched complaints are excluded from all scores.',
                },
                {
                  title: 'Complaint ≠ violation',
                  body: 'A complaint is a report filed by a member of the public or another agency — it does not mean a violation was confirmed. Scores reflect complaint volume and severity, not confirmed violations.',
                },
                {
                  title: 'Sync frequency',
                  body: 'The dataset is refreshed periodically from NYC Open Data. There may be a lag of several days between a complaint being filed and it appearing here.',
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
