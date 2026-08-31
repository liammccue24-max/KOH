export interface GridSpec {
  width: number
  height: number
  /** Physical cell size, independent per axis -- see simulateEtch/squaredDistanceTransform for why these can differ. */
  cellSizeXUm: number
  cellSizeYUm: number
  /** Micron coordinates of grid cell (0,0)'s lower-left corner. */
  originXUm: number
  originYUm: number
}

/** Rasterizes a set of polygons (microns) onto a boolean grid via even-odd scanline fill. Cells covered by any polygon are set to 1 (union across all polygons/rings). */
export function rasterizePolygons(polygons: readonly (readonly (readonly [number, number])[])[], grid: GridSpec): Uint8Array {
  const { width, height, cellSizeXUm, cellSizeYUm, originXUm, originYUm } = grid
  const out = new Uint8Array(width * height)

  for (const poly of polygons) {
    if (poly.length < 3) continue
    // Convert to grid space (cell-index units) once.
    const pts = poly.map(([x, y]) => [(x - originXUm) / cellSizeXUm, (y - originYUm) / cellSizeYUm] as const)

    let minY = Infinity
    let maxY = -Infinity
    for (const [, y] of pts) {
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    const rowStart = Math.max(0, Math.floor(minY))
    const rowEnd = Math.min(height - 1, Math.ceil(maxY))

    for (let row = rowStart; row <= rowEnd; row++) {
      const scanY = row + 0.5
      const xs: number[] = []
      for (let i = 0; i < pts.length; i++) {
        const [x0, y0] = pts[i]
        const [x1, y1] = pts[(i + 1) % pts.length]
        if (y0 === y1) continue
        if ((scanY >= y0 && scanY < y1) || (scanY >= y1 && scanY < y0)) {
          const t = (scanY - y0) / (y1 - y0)
          xs.push(x0 + t * (x1 - x0))
        }
      }
      xs.sort((a, b) => a - b)
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const colStart = Math.max(0, Math.round(xs[i]))
        const colEnd = Math.min(width - 1, Math.round(xs[i + 1]) - 1)
        for (let col = colStart; col <= colEnd; col++) {
          out[row * width + col] = 1
        }
      }
    }
  }

  return out
}
