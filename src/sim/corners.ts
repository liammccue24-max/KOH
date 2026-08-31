/**
 * Detects convex corners of the protected (masked) silicon region on a
 * rectilinear raster grid. A grid vertex is a convex protect-corner when
 * exactly one of its four surrounding cells is protected: physically, this
 * is a mesa/mask corner where silicon is exposed to KOH on 270 degrees
 * around the point, which real anisotropic etching undercuts (unlike a
 * concave corner of a simple opening, which is self-limiting).
 * Out-of-grid neighbors are treated as protected, so the padded domain
 * border never registers as a spurious corner.
 *
 * Returns the (col, row) of the single protected cell at each corner --
 * not the shared vertex's own (vx, vy) grid-line coordinate, which is a
 * half-cell removed from every cell center around it (a vertex sits
 * exactly on the boundary between its neighboring cells, equidistant from
 * both of their centers). An earlier version returned the vertex
 * coordinate directly and the caller clamped it into a cell index, which
 * silently reinterpreted a vertex position as a cell-center position --
 * always biased toward the same corner (higher x, higher y) by exactly
 * half a cell on each axis. That bias is small at typical resolutions, but
 * for a very elongated mask forced into a coarse per-axis grid (see
 * etchSim.ts's anisotropic domain sizing) half a cell can be tens of
 * microns -- comparable to or larger than the undercut radius actually
 * being modeled, distorting where the undercut disk is centered relative
 * to the real corner. Identifying and returning the actual protected
 * (mesa) cell itself has no such error: it's the real corner, not a
 * rounding of it.
 */
export function findConvexProtectCorners(
  protect: Uint8Array,
  width: number,
  height: number,
): { col: number; row: number }[] {
  const corners: { col: number; row: number }[] = []
  const get = (cx: number, cy: number): number => {
    if (cx < 0 || cy < 0 || cx >= width || cy >= height) return 1
    return protect[cy * width + cx]
  }
  for (let vy = 0; vy <= height; vy++) {
    for (let vx = 0; vx <= width; vx++) {
      const tl = get(vx - 1, vy - 1)
      const tr = get(vx, vy - 1)
      const bl = get(vx - 1, vy)
      const br = get(vx, vy)
      if (tl + tr + bl + br !== 1) continue
      const [dcol, drow] = tl ? [-1, -1] : tr ? [0, -1] : bl ? [-1, 0] : [0, 0]
      const col = vx + dcol
      const row = vy + drow
      if (col >= 0 && col < width && row >= 0 && row < height) corners.push({ col, row })
    }
  }
  return corners
}
