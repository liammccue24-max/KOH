import { findConvexProtectCorners } from './corners.ts'
import { squaredDistanceTransform } from './edt.ts'
import { rasterizePolygons, type GridSpec } from './raster.ts'
import { computeBoundingBox, SQRT2, type EtchParams, type EtchResult, type Polygon } from './types.ts'

const MAX_GRID_CELLS = 768

/**
 * Simulates anisotropic KOH etching of a (100) silicon wafer under a
 * Manhattan mask, for a given elapsed process time.
 *
 * Physical model:
 *  - Concave corners of the etch opening (i.e. a simple rectangular/
 *    rectilinear cavity) are geometrically stable: {111} sidewalls retreat
 *    inward at a fixed 54.74 deg from the (100) surface. For a point a
 *    perpendicular/Euclidean distance `s` inside the opening from the
 *    nearest mask edge, the etch front reaches it at depth d = s * sqrt(2)
 *    (since tan(54.74 deg) = sqrt(2)), capped by the vertical rate * time.
 *    This is exactly a scaled Euclidean distance transform of the mask,
 *    and naturally reproduces self-terminating inverted-pyramid pits and
 *    flat-bottomed V-grooves.
 *  - Convex corners of the protected (masked) silicon are NOT stable in
 *    real KOH etching: faster-etching planes are exposed there, undercutting
 *    the mask. This is approximated as a growing lateral "undercut disk"
 *    seeded at each convex mask corner (detected once from the as-drawn
 *    mask), which erodes the protect mask before the final depth pass.
 *
 * This is a geometric approximation for visualization/design intuition, not
 * a crystallographically-exact process simulator.
 *
 * The simulation domain is always sized tightly around the mask geometry
 * itself (its bounding box plus `marginFraction`), never around a larger
 * wafer/die outline: the {111} sidewall slope only spans a few tens of
 * microns even for a fairly deep etch, so sizing the grid to a wafer-scale
 * domain would spread that slope across a fraction of a single cell and
 * collapse it into an unresolved, wrongly-colored cliff. A wafer/die
 * outline layer is instead rendered separately, as flat context around
 * this tightly-resolved patch -- see WaferScene's buildContextGeometry.
 */
export function simulateEtch(polygons: readonly Polygon[], params: EtchParams): EtchResult {
  const bbox = computeBoundingBox(polygons)
  const spanX = Math.max(bbox.maxX - bbox.minX, 1e-6)
  const spanY = Math.max(bbox.maxY - bbox.minY, 1e-6)
  const longerSpan = Math.max(spanX, spanY)
  const margin = longerSpan * params.marginFraction

  const paddedMinX = bbox.minX - margin
  const paddedMinY = bbox.minY - margin
  const paddedSpanX = spanX + 2 * margin
  const paddedSpanY = spanY + 2 * margin
  const paddedLongerSpan = Math.max(paddedSpanX, paddedSpanY)

  const resolution = Math.min(Math.max(params.resolution, 16), MAX_GRID_CELLS)
  const cellSizeUm = paddedLongerSpan / resolution
  const width = Math.max(4, Math.round(paddedSpanX / cellSizeUm))
  const height = Math.max(4, Math.round(paddedSpanY / cellSizeUm))

  const grid: GridSpec = { width, height, cellSizeUm, originXUm: paddedMinX, originYUm: paddedMinY }
  const insideMask = rasterizePolygons(polygons, grid)

  // Undrawn area (including the padded margin ring) defaults to whichever
  // state "nothing drawn here" naturally means for the chosen polarity: when
  // the layer's shapes ARE the etch openings, undrawn silicon stays
  // protected; when the layer's shapes ARE the protective mask, undrawn
  // silicon is bare and etches. This also makes a lone protected-island
  // polygon (drawn on its own layer, nothing else nearby) behave correctly:
  // the rest of the wafer around it is open, so its convex corners can be
  // undercut instead of being artificially walled in by a forced-protected
  // margin.
  const baseOpen = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) {
    const drawn = insideMask[i] === 1
    baseOpen[i] = (params.polarity === 'layerIsOpening' ? drawn : !drawn) ? 1 : 0
  }

  const baseProtect = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) baseProtect[i] = baseOpen[i] ? 0 : 1

  // --- Convex-corner undercut ---
  const corners = findConvexProtectCorners(baseProtect, width, height)
  const cornerSeeds = new Uint8Array(width * height)
  for (const { vx, vy } of corners) {
    const col = Math.min(width - 1, Math.max(0, vx))
    const row = Math.min(height - 1, Math.max(0, vy))
    cornerSeeds[row * width + col] = 1
  }
  const distToCornerSq = corners.length > 0 ? squaredDistanceTransform(cornerSeeds, width, height) : null

  const undercutRadiusUm = Math.max(0, params.undercutRateUmPerMin) * params.timeMin
  const undercutRadiusCellsSq = (undercutRadiusUm / cellSizeUm) ** 2

  const finalOpen = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) {
    if (baseOpen[i]) {
      finalOpen[i] = 1
      continue
    }
    const undercut = distToCornerSq !== null && distToCornerSq[i] <= undercutRadiusCellsSq
    finalOpen[i] = undercut ? 1 : 0
  }

  const finalProtect = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) finalProtect[i] = finalOpen[i] ? 0 : 1

  // --- Depth field: scaled Euclidean distance to nearest protected cell ---
  const distToProtectSq = squaredDistanceTransform(finalProtect, width, height)
  const maxPossibleDepthUm = Math.max(0, params.rate100UmPerMin) * params.timeMin

  const depthUm = new Float32Array(width * height)
  let maxActualDepthUm = 0
  for (let i = 0; i < width * height; i++) {
    if (!finalOpen[i]) continue
    const distUm = Math.sqrt(distToProtectSq[i]) * cellSizeUm
    const d = Math.min(maxPossibleDepthUm, SQRT2 * distUm)
    depthUm[i] = d
    if (d > maxActualDepthUm) maxActualDepthUm = d
  }

  return {
    width,
    height,
    cellSizeUm,
    originXUm: paddedMinX,
    originYUm: paddedMinY,
    depthUm,
    finalProtect,
    maxPossibleDepthUm,
    maxActualDepthUm,
  }
}
