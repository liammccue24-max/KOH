/**
 * Detects convex corners of the protected (masked) silicon region on a
 * rectilinear raster grid. A grid vertex is a convex protect-corner when
 * exactly one of its four surrounding cells is protected: physically, this
 * is a mesa/mask corner where silicon is exposed to KOH on 270 degrees
 * around the point, which real anisotropic etching undercuts (unlike a
 * concave corner of a simple opening, which is self-limiting).
 * Out-of-grid neighbors are treated as protected, so the padded domain
 * border never registers as a spurious corner.
 */
export function findConvexProtectCorners(
  protect: Uint8Array,
  width: number,
  height: number,
): { vx: number; vy: number }[] {
  const corners: { vx: number; vy: number }[] = []
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
      if (tl + tr + bl + br === 1) corners.push({ vx, vy })
    }
  }
  return corners
}
