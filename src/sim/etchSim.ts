import { findConvexProtectCorners } from './corners.ts'
import { squaredDistanceTransform } from './edt.ts'
import { rasterizePolygons, type GridSpec } from './raster.ts'
import { computeBoundingBox, SQRT2, type BoundingBox, type EtchParams, type EtchResult, type Polygon } from './types.ts'

const MAX_GRID_CELLS = 768

// When marginEnabled is off and a boundary/outline layer is supplied, that
// layer's own drawn geometry defines the margin instead of a percentage
// guess. But a boundary layer can legitimately be wafer-scale (e.g. a
// single 150mm outline shared by several scattered windows), and blindly
// adopting its full bounding box would reintroduce the exact "domain sized
// to the wafer" resolution bug this tool was already fixed to avoid. So
// the boundary's contribution is capped at this multiple of the mask's own
// span on each side -- generous enough for a realistic per-die outline
// (typically a few times larger than its window), but bounded regardless
// of how large the boundary shape actually is.
const MAX_BOUNDARY_MARGIN_MULTIPLE = 4

function boxesOverlap(a: BoundingBox, b: BoundingBox): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY
}

function intersectBox(a: BoundingBox, b: BoundingBox): BoundingBox {
  return { minX: Math.max(a.minX, b.minX), minY: Math.max(a.minY, b.minY), maxX: Math.min(a.maxX, b.maxX), maxY: Math.min(a.maxY, b.maxY) }
}

/**
 * Domain box to simulate, in the same units as the mask polygons.
 *
 * - marginEnabled: pad the mask bbox by a fraction of its own longer span,
 *   uniformly assumed protected (today's synthetic margin).
 * - !marginEnabled, with a boundary layer whose geometry actually overlaps
 *   this mask cluster: use that geometry's own bounding box as the margin
 *   (clamped to MAX_BOUNDARY_MARGIN_MULTIPLE so a wafer-scale outline can't
 *   blow up resolution), since a real drawn boundary is a more accurate
 *   source of "how far does protected silicon extend here" than a guess.
 * - !marginEnabled, no usable boundary geometry: no margin at all -- the
 *   domain is exactly the mask's own bounding box, trusting that the mask
 *   layer was already drawn with whatever spacing/compensation it needs.
 */
function computeDomainBox(maskBox: BoundingBox, params: EtchParams, boundaryPolygons: readonly Polygon[] | undefined): BoundingBox {
  const spanX = Math.max(maskBox.maxX - maskBox.minX, 1e-6)
  const spanY = Math.max(maskBox.maxY - maskBox.minY, 1e-6)
  const longerSpan = Math.max(spanX, spanY)

  if (params.marginEnabled) {
    const margin = longerSpan * params.marginFraction
    return { minX: maskBox.minX - margin, minY: maskBox.minY - margin, maxX: maskBox.maxX + margin, maxY: maskBox.maxY + margin }
  }

  if (boundaryPolygons && boundaryPolygons.length > 0) {
    const overlapping = boundaryPolygons.filter((p) => boxesOverlap(computeBoundingBox([p]), maskBox))
    if (overlapping.length > 0) {
      const boundaryBox = computeBoundingBox(overlapping)
      const cap = {
        minX: maskBox.minX - longerSpan * MAX_BOUNDARY_MARGIN_MULTIPLE,
        minY: maskBox.minY - longerSpan * MAX_BOUNDARY_MARGIN_MULTIPLE,
        maxX: maskBox.maxX + longerSpan * MAX_BOUNDARY_MARGIN_MULTIPLE,
        maxY: maskBox.maxY + longerSpan * MAX_BOUNDARY_MARGIN_MULTIPLE,
      }
      // The boundary must still fully contain the mask itself even after
      // capping -- intersect only the *margin*, not the mask's own extent.
      const clamped = intersectBox(boundaryBox, cap)
      return {
        minX: Math.min(clamped.minX, maskBox.minX),
        minY: Math.min(clamped.minY, maskBox.minY),
        maxX: Math.max(clamped.maxX, maskBox.maxX),
        maxY: Math.max(clamped.maxY, maskBox.maxY),
      }
    }
  }

  return maskBox
}

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
 * itself, never around a larger wafer/die outline: the {111} sidewall slope
 * only spans a few tens of microns even for a fairly deep etch, so sizing
 * the grid to a wafer-scale domain would spread that slope across a
 * fraction of a single cell and collapse it into an unresolved, wrongly-
 * colored cliff. The mask's own bbox is padded by `marginFraction` (when
 * `marginEnabled`) or, if not, by the locally-overlapping portion of an
 * optional boundary/outline layer's real geometry (see computeDomainBox) --
 * either way the padding never exceeds a small multiple of the mask's own
 * span. A wafer/die outline layer is separately rendered in full as flat
 * context around this tightly-resolved patch -- see WaferScene's
 * buildContextGeometry.
 */
export function simulateEtch(polygons: readonly Polygon[], params: EtchParams, boundaryPolygons?: readonly Polygon[]): EtchResult {
  const maskBox = computeBoundingBox(polygons)
  const domainBox = computeDomainBox(maskBox, params, boundaryPolygons)

  const paddedMinX = domainBox.minX
  const paddedMinY = domainBox.minY
  const paddedSpanX = Math.max(domainBox.maxX - domainBox.minX, 1e-6)
  const paddedSpanY = Math.max(domainBox.maxY - domainBox.minY, 1e-6)
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
