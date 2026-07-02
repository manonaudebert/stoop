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
function applyFilter(src: mapboxgl.GeoJSONSource, raw: any, visibleTiers: Set<string>, lens: SfLens) {
  const rf = riskField(lens)
  src.setData({
    ...raw,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    features: raw.features.filter((f: any) => visibleTiers.has(featureTier(f.properties?.[rf]))),
  })
}

const NO_MATCH = ['==', ['get', 'mapblklot'], ''] as mapboxgl.FilterSpecification

type Props = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onBuildingSelect: (properties: any | null) => void
  flyTarget: { lng: number; lat: number; id: number } | null
  selectedId: string | null
  lens: SfLens
  visibleTiers: string[]
  isMobile?: boolean
}

export default function SfMap({ onBuildingSelect, flyTarget, selectedId, lens, visibleTiers, isMobile = false }: Props) {
  const containerRef   = useRef<HTMLDivElement>(null)
  const mapRef         = useRef<mapboxgl.Map | null>(null)
  const navControlRef  = useRef<mapboxgl.NavigationControl | null>(null)
  const onSelectRef    = useRef(onBuildingSelect)
  onSelectRef.current  = onBuildingSelect
  const loadSeqRef     = useRef(0)
  const loadAbortRef   = useRef<AbortController | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawDataRef         = useRef<any>(null)
  const visibleTiersRef    = useRef(visibleTiers)
  visibleTiersRef.current  = visibleTiers
  const lensRef        = useRef(lens)
  lensRef.current      = lens

  useEffect(() => {
    if (!flyTarget || !mapRef.current) return
    mapRef.current.flyTo({ center: [flyTarget.lng, flyTarget.lat], zoom: 16, duration: 1000 })
  }, [flyTarget])

  useEffect(() => {
    const map = mapRef.current
    const raw = rawDataRef.current
    if (!map || !raw) return
    const src = map.getSource('buildings') as mapboxgl.GeoJSONSource | undefined
    if (src) applyFilter(src, raw, new Set(visibleTiers), lensRef.current)
  }, [visibleTiers])

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
    if (src && raw) applyFilter(src, raw, new Set(visibleTiersRef.current), lens)
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
    if (src) applyFilter(src, geojson, new Set(visibleTiersRef.current), lensRef.current)
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

    map.on('click', e => {
      const hit = map.queryRenderedFeatures(e.point, { layers: ['unclustered', 'clusters'] })
      if (!hit.length) onSelectRef.current(null)
    })

    map.on('mouseenter', 'clusters',    () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'clusters',    () => { map.getCanvas().style.cursor = '' })
    map.on('mouseenter', 'unclustered', () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'unclustered', () => { map.getCanvas().style.cursor = '' })

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
      map.remove()
      mapRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={containerRef} className="w-full h-full" />
}
