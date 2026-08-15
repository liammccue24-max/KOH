// Mirrors the --silicon / --accent(dark) / --etch-deep(dark) CSS tokens in
// index.css, so the legend swatches match the rendered wafer exactly.
const SILICON_TOP: [number, number, number] = [0.62, 0.659, 0.702] // #9ea8b3
const MASK_COLOR: [number, number, number] = [0.851, 0.678, 0.251] // #d9ad40
const ETCH_SHALLOW: [number, number, number] = [0.75, 0.8, 0.85]
const ETCH_DEEP: [number, number, number] = [0.102, 0.141, 0.192] // #1a2431

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
}

/** Maps an etch depth to an RGB color: mask color at the original surface, a light-to-dark ramp with depth. */
export function depthToColor(depthUm: number, maxDepthUm: number, isProtected: boolean): [number, number, number] {
  if (isProtected) return MASK_COLOR
  if (depthUm <= 1e-6) return SILICON_TOP
  const t = maxDepthUm > 0 ? Math.min(1, depthUm / maxDepthUm) : 0
  return mix(ETCH_SHALLOW, ETCH_DEEP, t)
}
