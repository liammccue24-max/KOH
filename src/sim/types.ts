export type Polygon = readonly (readonly [number, number])[]

export type MaskPolarity = 'layerIsOpening' | 'layerIsProtect'

export interface EtchParams {
  /** (100)/{111} vertical etch rate, micrometers per minute. */
  rate100UmPerMin: number
  /** Approximate lateral undercut rate at convex mask corners, micrometers per minute. */
  undercutRateUmPerMin: number
  /** Total elapsed etch time, minutes. */
  timeMin: number
  /** How the drawn GDS layer maps to the KOH mask. */
  polarity: MaskPolarity
  /** Target number of grid cells along the longer bounding-box axis. */
  resolution: number
  /** Extra protected (unetched) margin around the drawn geometry, as a fraction of the bbox's longer side. */
  marginFraction: number
}

export const SQRT2 = Math.SQRT2

export interface EtchResult {
  width: number
  height: number
  cellSizeUm: number
  originXUm: number
  originYUm: number
  /** Etch depth in microns, one entry per cell (row-major, y increasing with row). Positive = etched down. */
  depthUm: Float32Array
  /** 1 = silicon still protected by mask at the end of the etch, 0 = exposed/etched region. */
  finalProtect: Uint8Array
  maxPossibleDepthUm: number
  maxActualDepthUm: number
}

export interface BoundingBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function computeBoundingBox(polygons: readonly Polygon[]): BoundingBox {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const poly of polygons) {
    for (const [x, y] of poly) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 1, maxY: 1 }
  return { minX, minY, maxX, maxY }
}
