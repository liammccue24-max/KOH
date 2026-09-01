// Mirrors the --silicon / --accent(dark) / --etch-deep(dark) CSS tokens in
// index.css, so the legend swatches match the rendered wafer exactly.
const SILICON_TOP: [number, number, number] = [0.62, 0.659, 0.702] // #9ea8b3
export const MASK_COLOR: [number, number, number] = [0.851, 0.678, 0.251] // #d9ad40
const ETCH_SHALLOW: [number, number, number] = [0.75, 0.8, 0.85]
const ETCH_DEEP: [number, number, number] = [0.102, 0.141, 0.192] // #1a2431

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
}

/**
 * Maps an etch depth to an RGB color: bare silicon at the (undisplaced,
 * zero-depth) surface, a light-to-dark ramp with depth. Deliberately has no
 * "is this masked?" branch: a protected cell always has depth exactly 0 by
 * construction (see simulateEtch), so it already lands on this same ramp's
 * zero-depth end -- there is no separate baked "mask gold" per-vertex color
 * to bleed onto the sloped sidewall it shares a triangle with. The actual
 * mask color is drawn on top of this per-vertex ramp entirely in the
 * fragment shader (see createMaskAwareMaterial in WaferScene.tsx), gated on
 * the fragment's own interpolated height so it can never cover any part of
 * a triangle that has already dropped below the original surface -- not
 * even the sliver nearest a mask edge.
 */
export function depthToColor(depthUm: number, maxDepthUm: number): [number, number, number] {
  if (depthUm <= 1e-6) return SILICON_TOP
  const t = maxDepthUm > 0 ? Math.min(1, depthUm / maxDepthUm) : 0
  return mix(ETCH_SHALLOW, ETCH_DEEP, t)
}
