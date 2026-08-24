'use client'

import { useEffect, useRef, useCallback } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { reportDegraded } from '@/lib/api'

const DEFAULT_CLUSTERS_URL = '/api/proxy/map/unified/clusters'

// The unified source carries both risk dimensions per building. `lens` decides
// which one drives the colors. The risk field, per-tier cluster-count prefix,
// and the total-complaints field used for dot size all swap together.
export type Lens = 'DOB' | 'HPD'

const LENS_FIELDS = {
  DOB: { risk: 'dob_risk_level', total: 'dob_total', prefix: 'dob' },
  HPD: { risk: 'hpd_risk_level', total: 'hpd_total', prefix: 'hpd' },
} as const

const RISK_PALETTE = {
  'very-low':  '#A8CFAC',
  'low':       '#688F72',
  'moderate':  '#C77F0A',
  'high':      '#BC4B33',
  'very-high': '#7F1D1D',
} as const

// Unclustered dot color. Buildings absent from the active lens are filtered
// before they reach the source, so this expression only sees present buildings.
function dotColor(prefix: string, riskField: string): mapboxgl.Expression {
  return ['case',
    ['==', ['get', `${prefix}_present`], 0], '#C4C2B8',
    ['match', ['coalesce', ['get', riskField], ''],
      'Very low',          RISK_PALETTE['very-low'],
      'Insufficient data', RISK_PALETTE['very-low'],
      'Not comparable',    RISK_PALETTE['very-low'],
      'Low',               RISK_PALETTE['low'],
      'Moderate',          RISK_PALETTE['moderate'],
      'High',              RISK_PALETTE['high'],
      'Very high',         RISK_PALETTE['very-high'],
      RISK_PALETTE['very-low'],
    ],
  ]
}

function dotRadius(totalField: string): mapboxgl.Expression {
  return ['interpolate', ['linear'], ['coalesce', ['get', totalField], 1], 1, 5, 100, 8, 500, 11]
}

// Cluster color: the 75th-percentile (upper-quartile) risk tier among the
// buildings in the cluster. Mapbox clusterProperties tally per-tier counts
// (<prefix>_n1..n4) plus a present count (<prefix>_present), and we derive
// n0 = present − (n1+n2+n3+n4) for Very low / Insufficient data / Not comparable.
function clusterColor(prefix: string): mapboxgl.Expression {
  const n = (i: number): mapboxgl.Expression => ['get', `${prefix}_n${i}`]
  const present: mapboxgl.Expression = ['get', `${prefix}_present`]
  return [
    'case',
    ['==', present, 0], '#C4C2B8',
    [
      'let',
      'q', ['*', present, 0.75],
      'n0', ['-', present, ['+', n(1), n(2), n(3), n(4)]],
      [
        'case',
        ['>=', ['var', 'n0'], ['var', 'q']],                              RISK_PALETTE['very-low'],
        ['>=', ['+', ['var', 'n0'], n(1)], ['var', 'q']],                 RISK_PALETTE['low'],
        ['>=', ['+', ['var', 'n0'], n(1), n(2)], ['var', 'q']],           RISK_PALETTE['moderate'],
        ['>=', ['+', ['var', 'n0'], n(1), n(2), n(3)], ['var', 'q']],     RISK_PALETTE['high'],
        RISK_PALETTE['very-high'],
      ],
    ],
  ]
}

const NO_MATCH = ['==', ['get', 'bin'], ''] as mapboxgl.FilterSpecification

const RISK_TO_TIER: Record<string, string> = {
  'Very low':          'very-low',
  'Low':               'low',
  'Moderate':          'moderate',
  'High':              'high',
  'Very high':         'very-high',
  'Insufficient data': 'very-low',
  'Not comparable':    'very-low',
}

// A building absent from the active lens returns 'no-data', which is not in
// ALL_TIERS, so applyTierFilter removes it from the source (hidden, not grey).
function featureTier(riskLevel: string | null | undefined): string {
  if (!riskLevel) return 'no-data'
  return RISK_TO_TIER[riskLevel] ?? 'very-low'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyTierFilter(src: mapboxgl.GeoJSONSource, raw: any, visible: Set<string>, ntaCodes: string[], riskField: string) {
  src.setData({
    ...raw,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    features: raw.features.filter((f: any) =>
      visible.has(featureTier(f.properties?.[riskField])) &&
      (ntaCodes.length === 0 || ntaCodes.includes(f.properties?.nta_code))
    ),
  })
}

const NTA_URL =
  'https://services5.arcgis.com/GfwWNkhOj9bNBqoJ/arcgis/rest/services/' +
  'NYC_Neighborhood_Tabulation_Areas_2020/FeatureServer/0/query' +
  '?where=1=1&outFields=NTA2020,NTAName&outSR=4326&f=pgeojson'

const NTA_LAYERS = ['nta-fill', 'nta-line', 'nta-label'] as const

type NtaSelection = { code: string; name: string }

type Props = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onBuildingSelect: (properties: any | null) => void
  flyTarget: { lng: number; lat: number; id: number } | null
  selectedBin: string | null
  lens: Lens
  visibleTiers: string[]
  showNtaBorders: boolean
  selectedNtas: string[]
  onNtaSelect: (nta: NtaSelection | null) => void
  onNtaListLoad: (ntas: NtaSelection[]) => void
  clustersUrl?: string
  isMobile?: boolean
}

export default function Map({ onBuildingSelect, flyTarget, selectedBin, lens, visibleTiers, showNtaBorders, selectedNtas, onNtaSelect, onNtaListLoad, clustersUrl = DEFAULT_CLUSTERS_URL, isMobile = false }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const navControlRef = useRef<mapboxgl.NavigationControl | null>(null)
  const onSelectRef = useRef(onBuildingSelect)
  const onNtaSelectRef = useRef(onNtaSelect)
  const onNtaListLoadRef = useRef(onNtaListLoad)
  const clustersUrlRef = useRef(clustersUrl)
  // Monotonic token so out-of-order cluster fetches can be discarded
  const loadSeqRef = useRef(0)
  const loadAbortRef = useRef<AbortController | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawDataRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ntaDataRef = useRef<any>(null)
  const ntaPopupRef = useRef<mapboxgl.Popup | null>(null)
  const visibleTiersRef = useRef(visibleTiers)
  const selectedNtasRef = useRef(selectedNtas)
  const showNtaBordersRef = useRef(showNtaBorders)
  const lensRef = useRef(lens)

  // Keep the "latest value" refs in sync after each render. Declared before the
  // effects that read them so it commits first, giving those effects (and the
  // once-registered map event handlers) the current props/state.
  useEffect(() => {
    onSelectRef.current = onBuildingSelect
    onNtaSelectRef.current = onNtaSelect
    onNtaListLoadRef.current = onNtaListLoad
    clustersUrlRef.current = clustersUrl
    visibleTiersRef.current = visibleTiers
    selectedNtasRef.current = selectedNtas
    showNtaBordersRef.current = showNtaBorders
    lensRef.current = lens
  })

  useEffect(() => {
    if (!flyTarget || !mapRef.current) return
    mapRef.current.flyTo({ center: [flyTarget.lng, flyTarget.lat], zoom: 16, duration: 1000 })
  }, [flyTarget])

  // Re-filter source whenever visible tiers or NTA selection changes
  useEffect(() => {
    const map = mapRef.current
    const raw = rawDataRef.current
    if (!map || !raw) return
    const src = map.getSource('buildings') as mapboxgl.GeoJSONSource | undefined
    if (src) applyTierFilter(src, raw, new Set(visibleTiers), selectedNtasRef.current, LENS_FIELDS[lensRef.current].risk)
  }, [visibleTiers])

  useEffect(() => {
    const map = mapRef.current
    const raw = rawDataRef.current
    if (!map || !raw) return
    const src = map.getSource('buildings') as mapboxgl.GeoJSONSource | undefined
    if (src) applyTierFilter(src, raw, new Set(visibleTiersRef.current), selectedNtas, LENS_FIELDS[lensRef.current].risk)
  }, [selectedNtas])

  // Switch the color lens: repaint dots + clusters and re-filter (the tier
  // filter keys off the active lens's risk field) — no refetch, the source
  // already carries both dimensions.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const { risk, total, prefix } = LENS_FIELDS[lens]
    if (map.getLayer('unclustered')) {
      map.setPaintProperty('unclustered', 'circle-color', dotColor(prefix, risk))
      map.setPaintProperty('unclustered', 'circle-radius', dotRadius(total))
    }
    if (map.getLayer('clusters')) {
      map.setPaintProperty('clusters', 'circle-color', clusterColor(prefix))
    }
    const raw = rawDataRef.current
    const src = map.getSource('buildings') as mapboxgl.GeoJSONSource | undefined
    if (src && raw) applyTierFilter(src, raw, new Set(visibleTiersRef.current), selectedNtasRef.current, risk)
  }, [lens])

  // Toggle NTA border visibility
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const visibility = showNtaBorders ? 'visible' : 'none'
    for (const id of NTA_LAYERS) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility)
    }
    if (!showNtaBorders) ntaPopupRef.current?.remove()
  }, [showNtaBorders])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const filter = selectedBin
      ? ['==', ['get', 'bin'], selectedBin] as mapboxgl.FilterSpecification
      : NO_MATCH
    if (map.getLayer('selected-halo')) map.setFilter('selected-halo', filter)
    if (map.getLayer('selected-dot'))  map.setFilter('selected-dot',  filter)
  }, [selectedBin])

  const loadClusters = useCallback(async (map: mapboxgl.Map) => {
    const b = map.getBounds()
    if (!b) return
    const zoom = map.getZoom()
    const url = `${clustersUrlRef.current}?west=${b.getWest()}&south=${b.getSouth()}&east=${b.getEast()}&north=${b.getNorth()}&zoom=${zoom.toFixed(2)}`

    // Cancel any in-flight request and claim a token so we can discard
    // responses that resolve out of order (a stale viewport landing last
    // would otherwise overwrite the dots for the area we moved to).
    loadAbortRef.current?.abort()
    const controller = new AbortController()
    loadAbortRef.current = controller
    const seq = ++loadSeqRef.current

    let geojson
    try {
      const res = await fetch(url, { signal: controller.signal })
      if (!res.ok) {
        console.error('Failed to load map data:', res.status)
        return
      }
      geojson = await res.json()
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') console.error('Failed to load map data:', err)
      return
    }

    if (seq !== loadSeqRef.current) return  // a newer request superseded this one
    if (!mapRef.current) return             // unmounted while fetch was in flight
    rawDataRef.current = geojson
    const src = map.getSource('buildings') as mapboxgl.GeoJSONSource | undefined
    if (src) applyTierFilter(src, geojson, new Set(visibleTiersRef.current), selectedNtasRef.current, LENS_FIELDS[lensRef.current].risk)
  }, [])

  // Reload building data when the clusters endpoint changes (dataset toggle)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const src = map.getSource('buildings') as mapboxgl.GeoJSONSource | undefined
    if (src) src.setData({ type: 'FeatureCollection', features: [] })
    rawDataRef.current = null
    loadClusters(map)
  }, [clustersUrl, loadClusters])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ''

    const savedView = (() => {
      try {
        const raw = sessionStorage.getItem('mapView')
        return raw ? JSON.parse(raw) : null
      } catch { return null }
    })()

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: savedView?.center ?? [-73.98, 40.73],
      zoom: savedView?.zoom ?? 11,
      minZoom: 11,
    })
    mapRef.current = map

    // Nav control is added/removed by the isMobile effect below — on mobile
    // it would collide with the bottom sheets, and pinch-to-zoom covers it.

    map.on('load', () => {
      // NTA boundaries — loaded once, toggled via visibility
      map.addSource('nta-boundaries', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.addLayer({
        id: 'nta-fill',
        type: 'fill',
        source: 'nta-boundaries',
        layout: { visibility: showNtaBorders ? 'visible' : 'none' },
        paint: { 'fill-color': '#111111', 'fill-opacity': 0.03 },
      })
      map.addLayer({
        id: 'nta-line',
        type: 'line',
        source: 'nta-boundaries',
        layout: { visibility: showNtaBorders ? 'visible' : 'none' },
        paint: { 'line-color': '#111111', 'line-width': 1, 'line-opacity': 0.6 },
      })
      map.addLayer({
        id: 'nta-label',
        type: 'symbol',
        source: 'nta-boundaries',
        minzoom: 12,
        layout: {
          visibility: showNtaBorders ? 'visible' : 'none',
          'text-field': ['get', 'NTAName'],
          'text-size': 11,
          'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
          'text-max-width': 8,
        },
        paint: {
          'text-color': '#525252',
          'text-opacity': 0.6,
          'text-halo-color': '#FFFFFF',
          'text-halo-width': 1.5,
        },
      })
      fetch(NTA_URL)
        .then(r => r.json())
        .then(geojson => {
          ntaDataRef.current = geojson
          const src = map.getSource('nta-boundaries') as mapboxgl.GeoJSONSource | undefined
          src?.setData(geojson)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const list: NtaSelection[] = geojson.features
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((f: any) => ({ code: f.properties?.NTA2020 ?? '', name: f.properties?.NTAName ?? '' }))
            .filter((n: NtaSelection) => n.code && n.name)
            .sort((a: NtaSelection, b: NtaSelection) => a.name.localeCompare(b.name))
          onNtaListLoadRef.current(list)
        })
        // Non-critical: the map works without the overlay. Reported so a
        // persistently missing layer is not mistaken for one that has none.
        .catch(err => reportDegraded('nta overlay', err))

      map.addSource('buildings', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
        clusterMaxZoom: 13,
        clusterRadius: 40,
        // Per-tier counts AND a present count for BOTH lenses, so cluster color
        // can switch between DOB and HPD risk — and key severity off buildings
        // that have data, not the raw point count — without rebuilding the
        // source (see clusterColor).
        clusterProperties: {
          dob_present: ['+', ['get', 'dob_present']],
          dob_n1: ['+', ['case', ['==', ['get', 'dob_risk_level'], 'Low'],       1, 0]],
          dob_n2: ['+', ['case', ['==', ['get', 'dob_risk_level'], 'Moderate'],  1, 0]],
          dob_n3: ['+', ['case', ['==', ['get', 'dob_risk_level'], 'High'],      1, 0]],
          dob_n4: ['+', ['case', ['==', ['get', 'dob_risk_level'], 'Very high'], 1, 0]],
          hpd_present: ['+', ['get', 'hpd_present']],
          hpd_n1: ['+', ['case', ['==', ['get', 'hpd_risk_level'], 'Low'],       1, 0]],
          hpd_n2: ['+', ['case', ['==', ['get', 'hpd_risk_level'], 'Moderate'],  1, 0]],
          hpd_n3: ['+', ['case', ['==', ['get', 'hpd_risk_level'], 'High'],      1, 0]],
          hpd_n4: ['+', ['case', ['==', ['get', 'hpd_risk_level'], 'Very high'], 1, 0]],
        },
      })

      map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: 'buildings',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': clusterColor(LENS_FIELDS[lensRef.current].prefix),
          'circle-radius': ['step', ['get', 'point_count'], 16, 10, 22, 50, 28],
          'circle-opacity': 0.9,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': 'rgba(0, 0, 0, 0.45)',
        },
      })

      map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: 'buildings',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-size': 12,
          'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
        },
        paint: { 'text-color': '#fff' },
      })

      map.addLayer({
        id: 'unclustered',
        type: 'circle',
        source: 'buildings',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': dotColor(LENS_FIELDS[lensRef.current].prefix, LENS_FIELDS[lensRef.current].risk),
          'circle-radius': dotRadius(LENS_FIELDS[lensRef.current].total),
          'circle-stroke-width': 1.5,
          'circle-stroke-color': 'rgba(0, 0, 0, 0.45)',
        },
      })

      map.addLayer({
        id: 'selected-halo',
        type: 'circle',
        source: 'buildings',
        filter: NO_MATCH,
        paint: {
          'circle-radius': 18,
          'circle-color': '#7F1D1D',
          'circle-opacity': 0,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#7F1D1D',
          'circle-stroke-opacity': 0.4,
        },
      })

      map.addLayer({
        id: 'selected-dot',
        type: 'circle',
        source: 'buildings',
        filter: NO_MATCH,
        paint: {
          'circle-radius': 8,
          'circle-color': '#1989d4',
          'circle-stroke-width': 2.5,
          'circle-stroke-color': '#FFFFFF',
        },
      })

      loadClusters(map)
    })

    map.on('click', 'nta-fill', e => {
      if (!showNtaBordersRef.current) return
      const props = e.features?.[0]?.properties
      if (!props?.NTA2020) return
      const code: string = props.NTA2020
      const name: string = props.NTAName ?? code

      // Fit map to the full NTA boundary using stored GeoJSON
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const feature = ntaDataRef.current?.features?.find((f: any) => f.properties?.NTA2020 === code)
      if (feature) {
        const bounds = new mapboxgl.LngLatBounds()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const walk = (coords: any): void => {
          if (typeof coords[0] === 'number') bounds.extend(coords as [number, number])
          else coords.forEach(walk)
        }
        walk(feature.geometry.coordinates)
        if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 48, duration: 800 })
      }

      onNtaSelectRef.current({ code, name })
    })

    map.on('click', 'clusters', e => {
      const features = map.queryRenderedFeatures(e.point, { layers: ['clusters'] })
      const clusterId = features[0]?.properties?.cluster_id
      if (!clusterId) return
      const src = map.getSource('buildings') as mapboxgl.GeoJSONSource
      src.getClusterExpansionZoom(clusterId, (err, zoom) => {
        if (err || zoom == null) return
        const coords = (features[0].geometry as GeoJSON.Point).coordinates as [number, number]
        map.easeTo({ center: coords, zoom })
      })
    })

    map.on('click', 'unclustered', e => {
      const props = e.features?.[0]?.properties
      if (!props?.bin) return
      // Hand the full union feature to the wrapper — it carries both DOB and
      // HPD fields for the combined sidebar.
      onSelectRef.current(props)
    })

    map.on('click', e => {
      const features = map.queryRenderedFeatures(e.point, { layers: ['unclustered', 'clusters'] })
      if (features.length === 0) onSelectRef.current(null)
    })

    map.on('mouseenter', 'clusters',     () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'clusters',     () => { map.getCanvas().style.cursor = '' })
    map.on('mouseenter', 'unclustered',  () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'unclustered',  () => { map.getCanvas().style.cursor = '' })

    // Neighborhood name tooltip on hover — only while the borders are shown.
    const ntaPopup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 8 })
    ntaPopupRef.current = ntaPopup
    map.on('mousemove', 'nta-fill', e => {
      if (!showNtaBordersRef.current) { ntaPopup.remove(); return }
      const name: string | undefined = e.features?.[0]?.properties?.NTAName
      if (!name) { ntaPopup.remove(); return }
      map.getCanvas().style.cursor = 'pointer'
      ntaPopup
        .setLngLat(e.lngLat)
        .setHTML(`<span style="font-family:var(--font-mono);font-size:11px;letter-spacing:0.04em;color:#FFFFFF;white-space:nowrap">${name}</span>`)
        .addTo(map)
    })
    map.on('mouseleave', 'nta-fill', () => {
      map.getCanvas().style.cursor = ''
      ntaPopup.remove()
    })

    let moveTimer: ReturnType<typeof setTimeout>
    map.on('moveend', () => {
      clearTimeout(moveTimer)
      moveTimer = setTimeout(() => {
        loadClusters(map)
        try {
          sessionStorage.setItem('mapView', JSON.stringify({
            center: map.getCenter(),
            zoom: map.getZoom(),
          }))
        } catch { /* ignore */ }
      }, 300)
    })

    return () => { ntaPopupRef.current?.remove(); map.remove(); mapRef.current = null }
  }, [loadClusters])

  // Show the zoom/compass control on desktop only — on mobile it overlaps the
  // bottom sheets, and touch gestures (pinch/rotate) make it redundant.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (isMobile) {
      if (navControlRef.current) {
        map.removeControl(navControlRef.current)
        navControlRef.current = null
      }
    } else if (!navControlRef.current) {
      navControlRef.current = new mapboxgl.NavigationControl()
      map.addControl(navControlRef.current, 'bottom-right')
    }
  }, [isMobile])

  return <div ref={containerRef} className="w-full h-full" role="region" aria-label="Map and controls" />
}
