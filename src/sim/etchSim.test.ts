import { describe, expect, it } from 'vitest'
import { simulateEtch } from './etchSim.ts'
import type { EtchParams, Polygon } from './types.ts'

const baseParams: EtchParams = {
  rate100UmPerMin: 1,
  undercutRateUmPerMin: 0,
  timeMin: 1000, // effectively unlimited, so geometry (not time) caps depth
  polarity: 'layerIsOpening',
  resolution: 200,
  marginFraction: 0.3,
}

function squareOpening(size: number): Polygon[] {
  return [
    [
      [0, 0],
      [size, 0],
      [size, size],
      [0, size],
    ],
  ]
}

function rectOpening(w: number, h: number): Polygon[] {
  return [
    [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ],
  ]
}

function sampleDepth(result: ReturnType<typeof simulateEtch>, xUm: number, yUm: number): number {
  const col = Math.round((xUm - result.originXUm) / result.cellSizeUm - 0.5)
  const row = Math.round((yUm - result.originYUm) / result.cellSizeUm - 0.5)
  const c = Math.min(result.width - 1, Math.max(0, col))
  const r = Math.min(result.height - 1, Math.max(0, row))
  return result.depthUm[r * result.width + c]
}

describe('simulateEtch: concave (self-limiting) geometry', () => {
  it('etches a square opening into a pyramid with apex depth = sqrt2 * L/2', () => {
    const L = 20
    const result = simulateEtch(squareOpening(L), { ...baseParams, undercutRateUmPerMin: 0 })
    const centerDepth = sampleDepth(result, L / 2, L / 2)
    const expected = Math.SQRT2 * (L / 2)
    expect(centerDepth).toBeGreaterThan(expected * 0.9)
    expect(centerDepth).toBeLessThanOrEqual(expected * 1.05)
  })

  it('caps depth by process time (rate * t) before the pyramid apex is reached', () => {
    const L = 40
    const shallow: EtchParams = { ...baseParams, timeMin: 2, undercutRateUmPerMin: 0 } // max depth = rate*t = 2um
    const result = simulateEtch(squareOpening(L), shallow)
    const centerDepth = sampleDepth(result, L / 2, L / 2)
    expect(centerDepth).toBeGreaterThan(1.7)
    expect(centerDepth).toBeLessThanOrEqual(2.05)
  })

  it('produces a flat-bottomed V-groove for an elongated opening (depth set by short axis)', () => {
    const w = 60
    const h = 10
    const result = simulateEtch(rectOpening(w, h), { ...baseParams, undercutRateUmPerMin: 0 })
    const midDepth = sampleDepth(result, w / 2, h / 2)
    const expected = Math.SQRT2 * (h / 2)
    expect(midDepth).toBeGreaterThan(expected * 0.85)
    expect(midDepth).toBeLessThanOrEqual(expected * 1.1)

    // Depth should be roughly flat along most of the long axis, away from the short ends.
    const quarterDepth = sampleDepth(result, w / 4, h / 2)
    expect(Math.abs(quarterDepth - midDepth) / midDepth).toBeLessThan(0.15)
  })

  it('leaves masked (protected) regions at zero depth when there is no undercut', () => {
    const L = 20
    const result = simulateEtch(squareOpening(L), { ...baseParams, marginFraction: 0.5, undercutRateUmPerMin: 0 })
    const outsideDepth = sampleDepth(result, -5, -5)
    expect(outsideDepth).toBe(0)
  })
})

// A mesa polygon plus two tiny far-corner markers, so the mesa sits strictly
// inside the simulation bbox (not glued to its edge) and is fully surrounded
// by open silicon within the drawn bounds -- otherwise, with a lone mesa
// polygon, the bbox == the mesa's own extent and every mesa corner would
// touch the always-protected padding margin, masking the effect we want to test.
function mesaWithClearance(mesaX: number, mesaY: number, size: number): Polygon[] {
  return [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    [
      [mesaX, mesaY],
      [mesaX + size, mesaY],
      [mesaX + size, mesaY + size],
      [mesaX, mesaY + size],
    ],
    [
      [80, 80],
      [81, 80],
      [81, 81],
      [80, 81],
    ],
  ]
}

describe('simulateEtch: convex-corner undercut', () => {
  it('does not undercut when undercutRateUmPerMin is 0', () => {
    // Polarity inverted: the drawn mesa polygon IS the protected mask, with open silicon around it.
    const result = simulateEtch(mesaWithClearance(30, 30, 20), {
      ...baseParams,
      polarity: 'layerIsProtect',
      undercutRateUmPerMin: 0,
      marginFraction: 0.1,
    })
    // Corner of the mesa should remain protected (depth 0).
    const cornerDepth = sampleDepth(result, 30.5, 30.5)
    expect(cornerDepth).toBe(0)
  })

  it('erodes mesa corners over time when undercutRateUmPerMin > 0', () => {
    const result = simulateEtch(mesaWithClearance(30, 30, 20), {
      ...baseParams,
      polarity: 'layerIsProtect',
      undercutRateUmPerMin: 2,
      timeMin: 3, // undercut radius = 6um
      marginFraction: 0.1,
    })
    // A point 2um in from the mesa's (30,30) corner along the diagonal should now be etched (undercut).
    const cornerDepth = sampleDepth(result, 32, 32)
    expect(cornerDepth).toBeGreaterThan(0)
    // The center of the mesa, far from any corner, should still be fully protected.
    const centerDepth = sampleDepth(result, 40, 40)
    expect(centerDepth).toBe(0)
  })

  it('grows the undercut region monotonically with time', () => {
    const paramsAt = (t: number): EtchParams => ({
      ...baseParams,
      polarity: 'layerIsProtect',
      undercutRateUmPerMin: 1,
      timeMin: t,
      marginFraction: 0.1,
    })
    const countOpen = (t: number) => {
      const r = simulateEtch(mesaWithClearance(30, 30, 20), paramsAt(t))
      let n = 0
      for (let i = 0; i < r.finalProtect.length; i++) if (!r.finalProtect[i]) n++
      return n
    }
    const early = countOpen(1)
    const later = countOpen(5)
    expect(later).toBeGreaterThan(early)
  })
})

function circlePolygon(cx: number, cy: number, r: number, n = 64): Polygon {
  const pts: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  return pts
}

describe('simulateEtch: optional wafer/die boundary layer', () => {
  it('marks cells outside the boundary and leaves them unetched', () => {
    // A round 150-unit-diameter wafer with one small etch window near the edge.
    const wafer = [circlePolygon(0, 0, 75)]
    const window: Polygon[] = [
      [
        [50, -5],
        [60, -5],
        [60, 5],
        [50, 5],
      ],
    ]
    const result = simulateEtch(window, baseParams, wafer)
    expect(result.outsideWafer).not.toBeNull()

    // Far outside the wafer circle (e.g. a corner of the padded rectangular grid).
    const farCorner = sampleOutside(result, result.originXUm + 1, result.originYUm + 1)
    expect(farCorner).toBe(1)

    // The window itself, well inside the wafer, should be etched and marked inside.
    const windowDepth = sampleDepth(result, 55, 0)
    expect(windowDepth).toBeGreaterThan(0)
  })

  it('is fully backward compatible when no boundary is given', () => {
    const result = simulateEtch(squareOpening(20), baseParams, null)
    expect(result.outsideWafer).toBeNull()
  })

  it('sizes the domain from the boundary, not just the mask geometry', () => {
    // A wafer much larger than the tiny mask window it contains.
    const wafer = [circlePolygon(0, 0, 75)]
    const window: Polygon[] = [
      [
        [-2, -2],
        [2, -2],
        [2, 2],
        [-2, 2],
      ],
    ]
    const result = simulateEtch(window, baseParams, wafer)
    const spanX = result.width * result.cellSizeUm
    // Domain should span roughly the wafer's 150-unit diameter (plus margin), not the ~4-unit window.
    expect(spanX).toBeGreaterThan(140)
  })
})

function sampleOutside(result: ReturnType<typeof simulateEtch>, xUm: number, yUm: number): number {
  const col = Math.round((xUm - result.originXUm) / result.cellSizeUm - 0.5)
  const row = Math.round((yUm - result.originYUm) / result.cellSizeUm - 0.5)
  const c = Math.min(result.width - 1, Math.max(0, col))
  const r = Math.min(result.height - 1, Math.max(0, row))
  return result.outsideWafer ? result.outsideWafer[r * result.width + c] : 0
}
