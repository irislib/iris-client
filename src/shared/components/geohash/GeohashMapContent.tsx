import {useEffect, useRef, useState, useCallback, useMemo} from "react"
import L, {type Map as LeafletMap} from "leaflet"
import type {AppEvent} from "@/lib/nostr"
import worldGeoJSON from "./world-110m.json"
import {decodeGeohash} from "@/utils/geohash"
import {getGeohashesFromEvent} from "@/utils/locationGeocoding"

interface GeohashMapContentProps {
  geohashes?: string[]
  feedEvents?: AppEvent[]
  onGeohashSelect?: (geohash: string) => void
  height?: string
}

// Proper geohash grid structure
const GEOHASH_EVEN_DICT = "bcfguvyz89destwx2367kmqr0145hjnp"
const GEOHASH_ODD_DICT = "prxznqwyjmtvhksu57eg46df139c028b"

interface GridCell {
  geohash: string
  bounds: [[number, number], [number, number]]
}

function getGeohashGrid(
  bounds: [[number, number], [number, number]],
  parentGeohash: string = ""
): GridCell[] {
  const [[startLat, startLng], [endLat, endLng]] = bounds
  const offset = parentGeohash.length
  const odd = offset % 2

  const rowsNumber = odd ? 8 : 4
  const columnsNumber = odd ? 4 : 8
  const geohashDict = odd ? GEOHASH_ODD_DICT : GEOHASH_EVEN_DICT

  const lngStep = (endLng - startLng) / columnsNumber
  const latStep = (endLat - startLat) / rowsNumber

  const cells: GridCell[] = []

  for (let y = 0; y < rowsNumber; y++) {
    const rectLatStart = startLat + y * latStep
    const rectLatEnd = startLat + (y + 1) * latStep

    for (let x = 0; x < columnsNumber; x++) {
      const rectLngStart = startLng + x * lngStep
      const rectLngEnd = startLng + (x + 1) * lngStep
      const letter = geohashDict.charAt(columnsNumber * (rowsNumber - 1 - y) + x)

      cells.push({
        geohash: parentGeohash + letter,
        bounds: [
          [rectLatStart, rectLngStart],
          [rectLatEnd, rectLngEnd],
        ],
      })
    }
  }

  return cells
}

export default function GeohashMapContent({
  geohashes = [],
  feedEvents = [],
  onGeohashSelect,
  height = "24rem",
}: GeohashMapContentProps) {
  const mapRef = useRef<LeafletMap | null>(null)
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const gridLayerRef = useRef<L.LayerGroup | null>(null)
  const dotsLayerRef = useRef<L.LayerGroup | null>(null)
  const [hoveredGeohash, setHoveredGeohash] = useState<string>("")
  const [inputValue, setInputValue] = useState<string>("")
  const [isEditing, setIsEditing] = useState(false)

  // Extract geohashes from feed events (including location tags)
  const eventGeohashes = useMemo(() => {
    const geoMap = new Map<string, number>()
    feedEvents.forEach((event) => {
      // Get geohashes from both geohash tags and location tags
      const geohashes = getGeohashesFromEvent(event.tags)

      // Find the longest (highest resolution) geohash for this event
      if (geohashes.length > 0) {
        const longestGeohash = geohashes.reduce((longest, current) =>
          current.length > longest.length ? current : longest
        )
        geoMap.set(longestGeohash, (geoMap.get(longestGeohash) || 0) + 1)
      }
    })
    return geoMap
  }, [feedEvents])

  // Check if all geohashes are selected (means empty field / global view)
  const isGlobalView = useMemo(() => {
    const allGeohashes = "0123456789bcdefghjkmnpqrstuvwxyz".split("")
    return (
      geohashes.length === allGeohashes.length &&
      allGeohashes.every((gh) => geohashes.includes(gh))
    )
  }, [geohashes])

  // Determine the current active geohash to display
  const displayValue = useMemo(() => {
    if (isGlobalView) return ""
    if (geohashes.length === 1) return geohashes[0]
    if (geohashes.length > 1) return `${geohashes.length} selected`
    return ""
  }, [geohashes, isGlobalView])

  // Update input value when display value changes (unless actively typing)
  useEffect(() => {
    if (!isEditing) {
      setInputValue(displayValue)
    }
  }, [displayValue, isEditing])

  // Stop editing after a short delay to allow external updates
  useEffect(() => {
    if (isEditing) {
      const timer = setTimeout(() => {
        setIsEditing(false)
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [inputValue, isEditing])

  // Draw grid function
  const drawGrid = useCallback(() => {
    if (!gridLayerRef.current || !mapRef.current) return

    gridLayerRef.current.clearLayers()

    // Determine the precision level based on zoom
    const zoom = mapRef.current.getZoom()
    const targetPrecision = Math.min(Math.max(1, Math.floor((zoom + 2) / 3)), 6)

    // Start with the visible bounds
    const mapBounds = mapRef.current.getBounds()
    const viewBounds: [[number, number], [number, number]] = [
      [Math.max(-90, mapBounds.getSouth()), Math.max(-180, mapBounds.getWest())],
      [Math.min(90, mapBounds.getNorth()), Math.min(180, mapBounds.getEast())],
    ]

    // Build grid hierarchy from current view
    const gridCells: GridCell[] = []
    const queue: {bounds: [[number, number], [number, number]]; geohash: string}[] = [
      {
        bounds: [
          [-90, -180],
          [90, 180],
        ],
        geohash: "",
      },
    ]

    // For selected geohashes, we want to show their children too
    const selectedPrefixes = new Set<string>()
    geohashes.forEach((gh) => {
      for (let i = 1; i <= gh.length; i++) {
        selectedPrefixes.add(gh.substring(0, i))
      }
    })

    while (queue.length > 0) {
      const current = queue.shift()!

      // In global view, only show single-character geohashes
      if (isGlobalView) {
        if (current.geohash.length === 1) {
          // Check if this cell is visible
          const [[lat1, lng1], [lat2, lng2]] = current.bounds
          if (
            lat2 >= viewBounds[0][0] &&
            lat1 <= viewBounds[1][0] &&
            lng2 >= viewBounds[0][1] &&
            lng1 <= viewBounds[1][1]
          ) {
            gridCells.push({geohash: current.geohash, bounds: current.bounds})
          }
        }

        // Generate children only if we haven't reached single characters yet
        if (current.geohash.length < 1) {
          const children = getGeohashGrid(current.bounds, current.geohash)
          for (const child of children) {
            queue.push({bounds: child.bounds, geohash: child.geohash})
          }
        }
        continue
      }

      // Check if this geohash is exactly selected
      const isExactlySelected = geohashes.includes(current.geohash)
      // Check if any selected geohash starts with this one (this is a parent of selection)
      const isParentOfSelected = geohashes.some(
        (gh) => gh.startsWith(current.geohash) && gh !== current.geohash
      )
      // Check if this starts with any selected geohash (this is a child of selection)
      const isChildOfSelected = geohashes.some(
        (gh) => current.geohash.startsWith(gh) && current.geohash !== gh
      )

      let maxDepth
      if (isExactlySelected) {
        maxDepth = current.geohash.length + 1
      } else if (isParentOfSelected) {
        maxDepth = Math.max(
          ...geohashes
            .filter((gh) => gh.startsWith(current.geohash))
            .map((gh) => gh.length)
        )
      } else {
        maxDepth = targetPrecision
      }

      // Add this cell if it's at the right level or is related to selection
      if (
        current.geohash.length === targetPrecision ||
        isExactlySelected ||
        isChildOfSelected ||
        isParentOfSelected
      ) {
        // Check if this cell is visible
        const [[lat1, lng1], [lat2, lng2]] = current.bounds
        if (
          lat2 >= viewBounds[0][0] &&
          lat1 <= viewBounds[1][0] &&
          lng2 >= viewBounds[0][1] &&
          lng1 <= viewBounds[1][1]
        ) {
          gridCells.push({geohash: current.geohash, bounds: current.bounds})
        }
      }

      // Generate children if needed
      if (current.geohash.length < maxDepth) {
        const children = getGeohashGrid(current.bounds, current.geohash)
        for (const child of children) {
          // Only process children that might be visible
          const [[lat1, lng1], [lat2, lng2]] = child.bounds
          if (
            lat2 >= viewBounds[0][0] &&
            lat1 <= viewBounds[1][0] &&
            lng2 >= viewBounds[0][1] &&
            lng1 <= viewBounds[1][1]
          ) {
            queue.push({bounds: child.bounds, geohash: child.geohash})
          }
        }
      }
    }

    // Also add selected geohashes if they're not in the grid
    geohashes.forEach((gh) => {
      if (!gridCells.find((cell) => cell.geohash === gh)) {
        const bounds = decodeGeohash(gh)
        gridCells.push({
          geohash: gh,
          bounds: [
            [bounds[0], bounds[2]],
            [bounds[1], bounds[3]],
          ],
        })
      }
    })

    // Sort grid cells by geohash length (shortest first) so parents are drawn before children
    // This ensures children tiles are on top and clickable/hoverable
    const sortedCells = [...gridCells].sort((a, b) => a.geohash.length - b.geohash.length)

    // Draw the grid cells
    sortedCells.forEach(({geohash, bounds}) => {
      // Skip drawing parent tiles that are fully covered by their children
      const isParentOfSelected =
        !isGlobalView && geohashes.some((gh) => gh.startsWith(geohash) && gh !== geohash)

      if (isParentOfSelected) {
        // Check if all children of this parent are in the grid
        const childrenInGrid = gridCells.filter(
          (cell) =>
            cell.geohash.startsWith(geohash) && cell.geohash.length === geohash.length + 1
        )
        // If we have all 32 children (or 16 for odd levels), skip drawing the parent
        const expectedChildren = geohash.length % 2 === 0 ? 32 : 32
        if (childrenInGrid.length === expectedChildren) {
          return // Skip drawing this parent as it's fully covered
        }
      }

      const isSelected = !isGlobalView && geohashes.includes(geohash)
      const isHovered = hoveredGeohash === geohash
      const isChildOfSelected =
        !isGlobalView && geohashes.some((gh) => geohash.startsWith(gh) && geohash !== gh)

      let color = "#4a9eff"
      let weight = 0.5
      let fillOpacity = 0.02

      if (isSelected) {
        color = "#ff7800"
        weight = 3
        fillOpacity = 0.3
      } else if (isChildOfSelected) {
        // Sub-tiles of selected geohash
        color = "#ff7800"
        weight = 1
        fillOpacity = 0.05
      } else if (isParentOfSelected) {
        // Parent tiles - make them visually distinct but clickable
        color = "#ff7800"
        weight = 2
        fillOpacity = 0.1
      }

      if (isHovered) {
        fillOpacity = Math.min(fillOpacity + 0.15, 0.4)
        weight = Math.max(weight, 1.5)
      }

      const rect = L.rectangle(bounds, {
        color,
        weight,
        fillOpacity,
        fillColor: color,
      })

      rect.on("mouseover", () => setHoveredGeohash(geohash))
      rect.on("mouseout", () => setHoveredGeohash(""))
      rect.on("click", (e) => {
        L.DomEvent.stopPropagation(e)
        if (onGeohashSelect) {
          onGeohashSelect(geohash)
        }
      })

      rect.bindTooltip(geohash, {
        permanent: false,
        direction: "center",
      })

      rect.addTo(gridLayerRef.current!)
    })

    // Draw dots for event geohashes that are within selected areas
    if (dotsLayerRef.current) {
      dotsLayerRef.current.clearLayers()

      // Show dots for event geohashes
      eventGeohashes.forEach((count, eventGh) => {
        // When no geohash is selected (empty array), show all dots
        // When geohash is selected, only show dots within that area
        const shouldShowDot =
          geohashes.length === 0 || // No selection = show all
          isGlobalView || // Global view = show all
          geohashes.some((selectedGh) => eventGh.startsWith(selectedGh)) // Within selection

        if (shouldShowDot) {
          const bounds = decodeGeohash(eventGh)
          const lat = (bounds[0] + bounds[1]) / 2
          const lng = (bounds[2] + bounds[3]) / 2

          // Size based on number of events
          const radius = Math.min(3 + Math.log(count + 1) * 2, 10)

          const circle = L.circleMarker([lat, lng], {
            radius,
            fillColor: "#00ff00",
            fillOpacity: 0.7,
            color: "#00cc00",
            weight: 1,
          })

          circle.bindTooltip(`${eventGh} (${count} post${count > 1 ? "s" : ""})`, {
            permanent: false,
            direction: "top",
          })

          circle.on("click", (e) => {
            L.DomEvent.stopPropagation(e)
            if (onGeohashSelect) {
              onGeohashSelect(eventGh)
            }
          })

          circle.addTo(dotsLayerRef.current!)
        }
      })
    }
  }, [geohashes, hoveredGeohash, onGeohashSelect, eventGeohashes, isGlobalView])

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return

    const map = L.map(mapContainerRef.current, {
      center: [20, 0],
      zoom: 2,
      maxBounds: [
        [90, -180],
        [-90, 180],
      ],
      maxBoundsViscosity: 1.0,
      doubleClickZoom: false,
      attributionControl: false,
    })

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
    }).addTo(map)

    L.control
      .attribution({
        prefix: false,
      })
      .addTo(map)
      .addAttribution('© <a href="https://openstreetmap.org">OpenStreetMap</a>')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    L.geoJSON(worldGeoJSON as any, {
      style: {
        fillColor: "#e0e0e0",
        fillOpacity: 0.2,
        color: "#999",
        weight: 1,
      },
    }).addTo(map)

    gridLayerRef.current = L.layerGroup().addTo(map)
    dotsLayerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
      gridLayerRef.current = null
      dotsLayerRef.current = null
    }
  }, [])

  // Update grid on map changes and state changes
  useEffect(() => {
    if (!mapRef.current || !gridLayerRef.current) return

    drawGrid()

    // Set up event listeners
    const handleUpdate = () => drawGrid()

    mapRef.current.on("moveend", handleUpdate)
    mapRef.current.on("zoomend", handleUpdate)

    return () => {
      if (mapRef.current) {
        mapRef.current.off("moveend", handleUpdate)
        mapRef.current.off("zoomend", handleUpdate)
      }
    }
  }, [drawGrid])

  // Fit bounds only when geohashes actually change (not on every state update)
  useEffect(() => {
    if (!mapRef.current) return

    // If empty geohashes or global view, zoom to world view
    if (geohashes.length === 0 || isGlobalView) {
      mapRef.current.setView([0, 0], 1) // More zoomed out world view
      return
    }

    // Otherwise fit bounds to selected geohashes
    const bounds: L.LatLngBoundsExpression = []
    geohashes.forEach((gh) => {
      const [latMin, latMax, lonMin, lonMax] = decodeGeohash(gh)
      bounds.push([latMin, lonMin])
      bounds.push([latMax, lonMax])
    })
    mapRef.current.fitBounds(bounds, {padding: [50, 50]})
  }, [geohashes.join(","), isGlobalView]) // Only trigger when the actual geohash values change

  return (
    <div className="relative w-full overflow-hidden" style={{height}}>
      <div ref={mapContainerRef} className="w-full h-full" />
      {onGeohashSelect && (
        <div className="absolute bottom-4 left-4 z-[1000]">
          <div className="relative">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => {
                const value = e.target.value
                setInputValue(value)
                setIsEditing(true)

                const trimmed = value.trim().toLowerCase()
                if (trimmed === "") {
                  onGeohashSelect("*")
                } else if (/^[0-9bcdefghjkmnpqrstuvwxyz]{1,12}$/.test(trimmed)) {
                  onGeohashSelect(trimmed)
                }
              }}
              placeholder="geohash"
              maxLength={12}
              className="input w-36 text-sm bg-base-100/90 backdrop-blur-sm border-base-300 shadow-lg text-base-content pr-8"
            />
            {inputValue ? (
              <button
                className="absolute right-4 top-1/2 transform -translate-y-1/2 w-4 h-4 text-base-content/60 hover:text-base-content transition-colors"
                onClick={() => {
                  setInputValue("")
                  setIsEditing(true)
                  onGeohashSelect("*")
                }}
              >
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            ) : (
              <svg
                className="absolute right-4 top-1/2 transform -translate-y-1/2 w-4 h-4 text-base-content/60 pointer-events-none"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
