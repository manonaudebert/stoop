'use client'

import { useEffect, useRef, useCallback } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import type { SelectedBuilding } from './BuildingSidebar'

const DEFAULT_CLUSTERS_URL = '/api/proxy/map/clusters'

// Cluster color: the 75th-percentile (upper-quartile) risk tier among the
// buildings in the cluster. Mapbox clusterProperties can only accumulate, so we
// tally per-tier counts (n1..n4) on the cluster and derive
// n0 = point_count − (n1+n2+n3+n4), where tier 0 folds in
// Very low / Insufficient data / Not comparable / null. The p75 tier is the
// first whose running total reaches three-quarters of the cluster size —
// surfacing problem areas without the worst single building dominating.
const clusterColor: mapboxgl.Expression = [
  'let',
  'q', ['*', ['get', 'point_count'], 0.75],
  'n0', ['-', ['get', 'point_count'], ['+', ['get', 'n1'], ['get', 'n2'], ['get', 'n3'], ['get', 'n4']]],
  [
    'case',
    ['>=', ['var', 'n0'], ['var', 'q']],                                                          '#A8CFAC', // very low
    ['>=', ['+', ['var', 'n0'], ['get', 'n1']], ['var', 'q']],                                    '#688F72', // low
    ['>=', ['+', ['var', 'n0'], ['get', 'n1'], ['get', 'n2']], ['var', 'q']],                     '#C77F0A', // moderate
    ['>=', ['+', ['var', 'n0'], ['get', 'n1'], ['get', 'n2'], ['get', 'n3']], ['var', 'q']],      '#BC4B33', // high
    '#7F1D1D', // very high
  ],
]

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

function featureTier(riskLevel: string | null | undefined): string {
  if (!riskLevel) return 'no-data'
  return RISK_TO_TIER[riskLevel] ?? 'no-data'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyTierFilter(src: mapboxgl.GeoJSONSource, raw: any, visible: Set<string>, ntaCodes: string[]) {
  src.setData({
    ...raw,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    features: raw.features.filter((f: any) =>
      visible.has(featureTier(f.properties?.risk_level)) &&
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
  onBuildingSelect: (building: SelectedBuilding | null) => void
  flyTarget: { lng: number; lat: number; id: number } | null
  selectedBin: string | null
  visibleTiers: string[]
  showNtaBorders: boolean
  selectedNtas: string[]
  onNtaSelect: (nta: NtaSelection | null) => void
  onNtaListLoad: (ntas: NtaSelection[]) => void
  clustersUrl?: string
  isMobile?: boolean
}

export default function Map({ onBuildingSelect, flyTarget, selectedBin, visibleTiers, showNtaBorders, selectedNtas, onNtaSelect, onNtaListLoad, clustersUrl = DEFAULT_CLUSTERS_URL, isMobile = false }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const navControlRef = useRef<mapboxgl.NavigationControl | null>(null)
  const onSelectRef = useRef(onBuildingSelect)
  onSelectRef.current = onBuildingSelect
  const onNtaSelectRef = useRef(onNtaSelect)
  onNtaSelectRef.current = onNtaSelect
  const onNtaListLoadRef = useRef(onNtaListLoad)
  onNtaListLoadRef.current = onNtaListLoad
  const clustersUrlRef = useRef(clustersUrl)
  clustersUrlRef.current = clustersUrl
  // Monotonic token so out-of-order cluster fetches can be discarded
  const loadSeqRef = useRef(0)
  const loadAbortRef = useRef<AbortController | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawDataRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ntaDataRef = useRef<any>(null)
  const visibleTiersRef = useRef(visibleTiers)
  visibleTiersRef.current = visibleTiers
  const selectedNtasRef = useRef(selectedNtas)
  selectedNtasRef.current = selectedNtas
  const showNtaBordersRef = useRef(showNtaBorders)
  showNtaBordersRef.current = showNtaBorders

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
    if (src) applyTierFilter(src, raw, new Set(visibleTiers), selectedNtasRef.current)
  }, [visibleTiers])

  useEffect(() => {
    const map = mapRef.current
    const raw = rawDataRef.current
    if (!map || !raw) return
    const src = map.getSource('buildings') as mapboxgl.GeoJSONSource | undefined
    if (src) applyTierFilter(src, raw, new Set(visibleTiersRef.current), selectedNtas)
  }, [selectedNtas])

  // Toggle NTA border visibility
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const visibility = showNtaBorders ? 'visible' : 'none'
    for (const id of NTA_LAYERS) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility)
    }
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
    if (src) applyTierFilter(src, geojson, new Set(visibleTiersRef.current), selectedNtasRef.current)
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
        .catch(() => { /* non-critical — map still works without NTA layer */ })

      map.addSource('buildings', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
        clusterMaxZoom: 13,
        clusterRadius: 40,
        clusterProperties: {
          open_complaints:  ['+', ['get', 'open_complaints']],
          total_complaints: ['+', ['get', 'total_complaints']],
          // Per-tier counts so the cluster color can be the median tier (see clusterColor).
          n1: ['+', ['case', ['==', ['get', 'risk_level'], 'Low'],       1, 0]],
          n2: ['+', ['case', ['==', ['get', 'risk_level'], 'Moderate'],  1, 0]],
          n3: ['+', ['case', ['==', ['get', 'risk_level'], 'High'],      1, 0]],
          n4: ['+', ['case', ['==', ['get', 'risk_level'], 'Very high'], 1, 0]],
        },
      })

      map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: 'buildings',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': clusterColor,
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
          'circle-color': ['match', ['coalesce', ['get', 'risk_level'], ''],
            'Very low',          '#A8CFAC',
            'Insufficient data', '#A8CFAC',
            'Not comparable',    '#A8CFAC',
            'Low',               '#688F72',
            'Moderate',          '#C77F0A',
            'High',              '#BC4B33',
            'Very high',         '#7F1D1D',
            '#A8CFAC',
          ],
          'circle-radius': ['interpolate', ['linear'], ['coalesce', ['get', 'total_complaints'], 1], 1, 5, 100, 8, 500, 11],
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
      onSelectRef.current({
        bin: props.bin,
        address: props.address ?? null,
        borough: props.borough ?? null,
        zip_code: props.zip_code ?? null,
        total_complaints: props.total_complaints ?? 0,
        open_complaints: props.open_complaints ?? 0,
        priority_a_complaints: props.priority_a_complaints ?? 0,
        risk_level: props.risk_level ?? null,
      })
    })

    map.on('click', e => {
      const features = map.queryRenderedFeatures(e.point, { layers: ['unclustered', 'clusters'] })
      if (features.length === 0) onSelectRef.current(null)
    })

    map.on('mouseenter', 'clusters',     () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'clusters',     () => { map.getCanvas().style.cursor = '' })
    map.on('mouseenter', 'unclustered',  () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'unclustered',  () => { map.getCanvas().style.cursor = '' })
    map.on('mouseenter', 'nta-fill',     () => { if (showNtaBordersRef.current) map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'nta-fill',     () => { map.getCanvas().style.cursor = '' })

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

    return () => { map.remove(); mapRef.current = null }
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

  return <div ref={containerRef} className="w-full h-full" />
}
