'use client'

import { useEffect, useRef, useCallback } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'

export type SfLens = 'complaints' | 'violations'

const SF_CLUSTERS_URL = '/api/proxy/sf/map/clusters'

const RISK_PALETTE = {
  'very-low':  '#A8CFAC',
  'low':       '#688F72',
  'moderate':  '#C77F0A',
  'high':      '#BC4B33',
  'very-high': '#7F1D1D',
} as const

const RISK_TO_TIER: Record<string, string> = {
  'Very low':          'very-low',
  'Low':               'low',
  'Moderate':          'moderate',
  'High':              'high',
  'Very high':         'very-high',
  'Insufficient data': 'very-low',
}

// lens-specific field names on each GeoJSON feature
function riskField(lens: SfLens)    { return lens === 'complaints' ? 'complaints_risk_level' : 'violations_risk_level' }
function presentField(lens: SfLens) { return lens === 'complaints' ? 'complaints_present'     : 'violations_present' }
function totalField(lens: SfLens)   { return lens === 'complaints' ? 'total_complaints'       : 'total_violations' }
// cluster property prefix (c_ = complaints, v_ = violations)
function prefix(lens: SfLens)       { return lens === 'complaints' ? 'c' : 'v' }

// Unclustered dot: grey if absent from active lens, else risk-coloured
function dotColor(lens: SfLens): mapboxgl.Expression {
  const rf = riskField(lens)
  const pf = presentField(lens)
  return ['case',
    ['==', ['get', pf], 0], '#C4C2B8',
    ['match', ['coalesce', ['get', rf], ''],
      'Very low',  RISK_PALETTE['very-low'],
      'Low',       RISK_PALETTE['low'],
      'Moderate',  RISK_PALETTE['moderate'],
      'High',      RISK_PALETTE['high'],
      'Very high', RISK_PALETTE['very-high'],
      RISK_PALETTE['very-low'],
    ],
  ]
}

function dotRadius(lens: SfLens): mapboxgl.Expression {
  return ['interpolate', ['linear'], ['coalesce', ['get', totalField(lens)], 1], 1, 5, 100, 8, 500, 11]
}

// Cluster circle: colour driven by the 75th-percentile risk tier among the
// buildings in the cluster (same algorithm as the NYC map).
function clusterColor(p: string): mapboxgl.Expression {
  const n = (i: number): mapboxgl.Expression => ['get', `${p}_n${i}`]
  const present: mapboxgl.Expression = ['get', `${p}_present`]
  return [
    'case',
    ['==', present, 0], '#C4C2B8',
    [
      'let', 'q', ['*', present, 0.75],
      'n0', ['-', present, ['+', n(1), n(2), n(3), n(4)]],
      [
        'case',
        ['>=', ['var', 'n0'],                                        ['var', 'q']], RISK_PALETTE['very-low'],
        ['>=', ['+', ['var', 'n0'], n(1)],                           ['var', 'q']], RISK_PALETTE['low'],
        ['>=', ['+', ['var', 'n0'], n(1), n(2)],                     ['var', 'q']], RISK_PALETTE['moderate'],
        ['>=', ['+', ['var', 'n0'], n(1), n(2), n(3)],               ['var', 'q']], RISK_PALETTE['high'],
        RISK_PALETTE['very-high'],
      ],
    ],
  ]
}

function featureTier(risk: string | null | undefined): string {
  if (!risk) return 'no-data'
  return RISK_TO_TIER[risk] ?? 'very-low'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyFilter(src: mapboxgl.GeoJSONSource, raw: any, visibleTiers: Set<string>, nhoods: string[], lens: SfLens) {
  const rf = riskField(lens)
  src.setData({
    ...raw,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    features: raw.features.filter((f: any) =>
      visibleTiers.has(featureTier(f.properties?.[rf])) &&
      (nhoods.length === 0 || nhoods.includes(f.properties?.neighborhood))
    ),
  })
}

const NO_MATCH = ['==', ['get', 'mapblklot'], ''] as mapboxgl.FilterSpecification

// SF Analysis Neighborhoods (41 static polygons) bundled as a same-origin asset;
// see frontend/public/sf-neighborhoods.geojson. The `nhood` name matches the
// `neighborhood` value carried on each building feature, so selection filters by name.
const NHOOD_URL = '/sf-neighborhoods.geojson'
const NHOOD_LAYERS = ['nhood-fill', 'nhood-line', 'nhood-label'] as const

type NhoodSelection = { name: string }

type Props = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onBuildingSelect: (properties: any | null) => void
  flyTarget: { lng: number; lat: number; id: number } | null
  selectedId: string | null
  lens: SfLens
  visibleTiers: string[]
  showNeighborhoods: boolean
  selectedNeighborhoods: string[]
  onNeighborhoodSelect: (nhood: NhoodSelection | null) => void
  onNeighborhoodListLoad: (nhoods: NhoodSelection[]) => void
  isMobile?: boolean
}

export default function SfMap({ onBuildingSelect, flyTarget, selectedId, lens, visibleTiers, showNeighborhoods, selectedNeighborhoods, onNeighborhoodSelect, onNeighborhoodListLoad, isMobile = false }: Props) {
  const containerRef   = useRef<HTMLDivElement>(null)
  const mapRef         = useRef<mapboxgl.Map | null>(null)
  const navControlRef  = useRef<mapboxgl.NavigationControl | null>(null)
  const onSelectRef        = useRef(onBuildingSelect)
  const onNhoodSelectRef   = useRef(onNeighborhoodSelect)
  const onNhoodListLoadRef = useRef(onNeighborhoodListLoad)
  const loadSeqRef     = useRef(0)
  const loadAbortRef   = useRef<AbortController | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawDataRef         = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nhoodDataRef       = useRef<any>(null)
  const nhoodPopupRef      = useRef<mapboxgl.Popup | null>(null)
  const visibleTiersRef    = useRef(visibleTiers)
  const selectedNhoodsRef  = useRef(selectedNeighborhoods)
  const showNhoodsRef      = useRef(showNeighborhoods)
  const lensRef            = useRef(lens)

  // Keep the "latest value" refs in sync after each render. Declared before the
  // effects that read them so it commits first, giving those effects (and the
  // once-registered map event handlers) the current props/state.
  useEffect(() => {
    onSelectRef.current        = onBuildingSelect
    onNhoodSelectRef.current   = onNeighborhoodSelect
    onNhoodListLoadRef.current = onNeighborhoodListLoad
    visibleTiersRef.current    = visibleTiers
    selectedNhoodsRef.current  = selectedNeighborhoods
    showNhoodsRef.current      = showNeighborhoods
    lensRef.current            = lens
  })

  useEffect(() => {
    if (!flyTarget || !mapRef.current) return
    mapRef.current.flyTo({ center: [flyTarget.lng, flyTarget.lat], zoom: 16, duration: 1000 })
  }, [flyTarget])

  useEffect(() => {
    const map = mapRef.current
    const raw = rawDataRef.current
    if (!map || !raw) return
    const src = map.getSource('buildings') as mapboxgl.GeoJSONSource | undefined
    if (src) applyFilter(src, raw, new Set(visibleTiers), selectedNhoodsRef.current, lensRef.current)
  }, [visibleTiers])

  // Re-filter buildings when the neighborhood selection changes
  useEffect(() => {
    const map = mapRef.current
    const raw = rawDataRef.current
    if (!map || !raw) return
    const src = map.getSource('buildings') as mapboxgl.GeoJSONSource | undefined
    if (src) applyFilter(src, raw, new Set(visibleTiersRef.current), selectedNeighborhoods, lensRef.current)
  }, [selectedNeighborhoods])

  // Toggle neighborhood border visibility
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const visibility = showNeighborhoods ? 'visible' : 'none'
    for (const id of NHOOD_LAYERS) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility)
    }
    if (!showNeighborhoods) nhoodPopupRef.current?.remove()
  }, [showNeighborhoods])

  // Switch lens: repaint dots + clusters, re-filter
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (map.getLayer('unclustered')) {
      map.setPaintProperty('unclustered', 'circle-color', dotColor(lens))
      map.setPaintProperty('unclustered', 'circle-radius', dotRadius(lens))
    }
    if (map.getLayer('selected-dot')) {
      map.setPaintProperty('selected-dot', 'circle-color', dotColor(lens))
      map.setPaintProperty('selected-dot', 'circle-radius', dotRadius(lens))
    }
    if (map.getLayer('clusters')) {
      map.setPaintProperty('clusters', 'circle-color', clusterColor(prefix(lens)))
    }
    const raw = rawDataRef.current
    const src = map.getSource('buildings') as mapboxgl.GeoJSONSource | undefined
    if (src && raw) applyFilter(src, raw, new Set(visibleTiersRef.current), selectedNhoodsRef.current, lens)
  }, [lens])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const filter = selectedId
      ? ['==', ['get', 'mapblklot'], selectedId] as mapboxgl.FilterSpecification
      : NO_MATCH
    if (map.getLayer('selected-halo')) map.setFilter('selected-halo', filter)
    if (map.getLayer('selected-dot'))  map.setFilter('selected-dot',  filter)
  }, [selectedId])

  // Nav control: desktop only (mobile uses pinch gestures + bottom sheets)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (isMobile) {
      if (navControlRef.current) {
        map.removeControl(navControlRef.current)
        navControlRef.current = null
      }
    } else if (!navControlRef.current) {
      navControlRef.current = new mapboxgl.NavigationControl({ showCompass: false })
      map.addControl(navControlRef.current, 'bottom-right')
    }
  }, [isMobile])

  const loadClusters = useCallback(async (map: mapboxgl.Map) => {
    const b = map.getBounds()
    if (!b) return
    const zoom = map.getZoom()
    const url = `${SF_CLUSTERS_URL}?west=${b.getWest()}&south=${b.getSouth()}&east=${b.getEast()}&north=${b.getNorth()}&zoom=${zoom.toFixed(2)}`

    loadAbortRef.current?.abort()
    const controller = new AbortController()
    loadAbortRef.current = controller
    const seq = ++loadSeqRef.current

    let geojson
    try {
      const res = await fetch(url, { signal: controller.signal })
      if (!res.ok) return
      geojson = await res.json()
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') console.error('SF map load error:', err)
      return
    }

    if (seq !== loadSeqRef.current || !mapRef.current) return
    rawDataRef.current = geojson
    const src = map.getSource('buildings') as mapboxgl.GeoJSONSource | undefined
    if (src) applyFilter(src, geojson, new Set(visibleTiersRef.current), selectedNhoodsRef.current, lensRef.current)
  }, [])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ''

    const savedView = (() => {
      try { return JSON.parse(sessionStorage.getItem('sfMapView') ?? 'null') }
      catch { return null }
    })()

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: savedView?.center ?? [-122.4194, 37.7749],
      zoom:   savedView?.zoom   ?? 12,
      minZoom: 10,
      maxZoom: 18,
    })
    mapRef.current = map

    map.on('load', () => {
      // Neighborhood boundaries — added before the building source so the dots
      // and clusters render on top. Loaded once, toggled via visibility.
      map.addSource('nhood-boundaries', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.addLayer({
        id: 'nhood-fill',
        type: 'fill',
        source: 'nhood-boundaries',
        layout: { visibility: showNhoodsRef.current ? 'visible' : 'none' },
        paint: { 'fill-color': '#111111', 'fill-opacity': 0.03 },
      })
      map.addLayer({
        id: 'nhood-line',
        type: 'line',
        source: 'nhood-boundaries',
        layout: { visibility: showNhoodsRef.current ? 'visible' : 'none' },
        paint: { 'line-color': '#111111', 'line-width': 1, 'line-opacity': 0.6 },
      })
      map.addLayer({
        id: 'nhood-label',
        type: 'symbol',
        source: 'nhood-boundaries',
        minzoom: 12,
        layout: {
          visibility: showNhoodsRef.current ? 'visible' : 'none',
          'text-field': ['get', 'nhood'],
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
      fetch(NHOOD_URL)
        .then(r => r.json())
        .then(geojson => {
          nhoodDataRef.current = geojson
          const src = map.getSource('nhood-boundaries') as mapboxgl.GeoJSONSource | undefined
          src?.setData(geojson)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const list: NhoodSelection[] = geojson.features
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((f: any) => ({ name: f.properties?.nhood ?? '' }))
            .filter((n: NhoodSelection) => n.name)
            .sort((a: NhoodSelection, b: NhoodSelection) => a.name.localeCompare(b.name))
          onNhoodListLoadRef.current(list)
        })
        .catch(() => { /* non-critical — map still works without the neighborhood layer */ })

      map.addSource('buildings', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
        clusterMaxZoom: 13,
        clusterRadius: 40,
        // Per-tier tallies for both lenses so cluster color can switch
        // between complaints and violations without rebuilding the source.
        clusterProperties: {
          c_present: ['+', ['get', 'complaints_present']],
          c_n1: ['+', ['case', ['==', ['get', 'complaints_risk_level'], 'Low'],       1, 0]],
          c_n2: ['+', ['case', ['==', ['get', 'complaints_risk_level'], 'Moderate'],  1, 0]],
          c_n3: ['+', ['case', ['==', ['get', 'complaints_risk_level'], 'High'],      1, 0]],
          c_n4: ['+', ['case', ['==', ['get', 'complaints_risk_level'], 'Very high'], 1, 0]],
          v_present: ['+', ['get', 'violations_present']],
          v_n1: ['+', ['case', ['==', ['get', 'violations_risk_level'], 'Low'],       1, 0]],
          v_n2: ['+', ['case', ['==', ['get', 'violations_risk_level'], 'Moderate'],  1, 0]],
          v_n3: ['+', ['case', ['==', ['get', 'violations_risk_level'], 'High'],      1, 0]],
          v_n4: ['+', ['case', ['==', ['get', 'violations_risk_level'], 'Very high'], 1, 0]],
        },
      })

      map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: 'buildings',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color':         clusterColor(prefix(lensRef.current)),
          'circle-radius':        ['step', ['get', 'point_count'], 16, 10, 22, 50, 28],
          'circle-opacity':       0.9,
          'circle-stroke-width':  1.5,
          'circle-stroke-color':  'rgba(0,0,0,0.45)',
        },
      })

      map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: 'buildings',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-size':  12,
          'text-font':  ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
        },
        paint: { 'text-color': '#fff' },
      })

      map.addLayer({
        id: 'unclustered',
        type: 'circle',
        source: 'buildings',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color':        dotColor(lensRef.current),
          'circle-radius':       dotRadius(lensRef.current),
          'circle-opacity':      0.88,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': 'rgba(0,0,0,0.45)',
        },
      })

      map.addLayer({
        id: 'selected-halo',
        type: 'circle',
        source: 'buildings',
        filter: NO_MATCH,
        paint: {
          'circle-radius':       18,
          'circle-color':        '#7F1D1D',
          'circle-opacity':      0,
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
          'circle-color':        dotColor(lensRef.current),
          'circle-radius':       dotRadius(lensRef.current),
          'circle-opacity':      1,
          'circle-stroke-width': 2.5,
          'circle-stroke-color': '#FFFFFF',
        },
      })

      loadClusters(map)
    })

    // Zoom into cluster on click
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
      onSelectRef.current(props ?? null)
    })

    // Click a neighborhood polygon: fit the map to it and select it (which the
    // wrapper turns into a filter). Only active while borders are shown.
    map.on('click', 'nhood-fill', e => {
      if (!showNhoodsRef.current) return
      const name: string | undefined = e.features?.[0]?.properties?.nhood
      if (!name) return

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const feature = nhoodDataRef.current?.features?.find((f: any) => f.properties?.nhood === name)
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

      onNhoodSelectRef.current({ name })
    })

    map.on('click', e => {
      const hit = map.queryRenderedFeatures(e.point, { layers: ['unclustered', 'clusters'] })
      if (!hit.length) onSelectRef.current(null)
    })

    map.on('mouseenter', 'clusters',    () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'clusters',    () => { map.getCanvas().style.cursor = '' })
    map.on('mouseenter', 'unclustered', () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'unclustered', () => { map.getCanvas().style.cursor = '' })

    // Neighborhood name tooltip on hover — only while the borders are shown.
    const nhoodPopup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 8 })
    nhoodPopupRef.current = nhoodPopup
    map.on('mousemove', 'nhood-fill', e => {
      if (!showNhoodsRef.current) { nhoodPopup.remove(); return }
      const name: string | undefined = e.features?.[0]?.properties?.nhood
      if (!name) { nhoodPopup.remove(); return }
      map.getCanvas().style.cursor = 'pointer'
      nhoodPopup
        .setLngLat(e.lngLat)
        .setHTML(`<span style="font-family:var(--font-mono);font-size:11px;letter-spacing:0.04em;color:#FFFFFF;white-space:nowrap">${name}</span>`)
        .addTo(map)
    })
    map.on('mouseleave', 'nhood-fill', () => {
      map.getCanvas().style.cursor = ''
      nhoodPopup.remove()
    })

    let moveTimer: ReturnType<typeof setTimeout> | null = null
    map.on('moveend', () => {
      if (moveTimer) clearTimeout(moveTimer)
      moveTimer = setTimeout(() => {
        loadClusters(map)
        try {
          sessionStorage.setItem('sfMapView', JSON.stringify({ center: map.getCenter(), zoom: map.getZoom() }))
        } catch { /* ignore */ }
      }, 200)
    })

    return () => {
      loadAbortRef.current?.abort()
      nhoodPopupRef.current?.remove()
      map.remove()
      mapRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={containerRef} className="w-full h-full" role="region" aria-label="Map and controls" />
}
