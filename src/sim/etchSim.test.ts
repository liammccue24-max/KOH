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
  marginEnabled: true,
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
  const col = Math.round((xUm - result.originXUm) / result.cellSizeXUm - 0.5)
  const row = Math.round((yUm - result.originYUm) / result.cellSizeYUm - 0.5)
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

  it('marginEnabled: false sizes the domain to the mask bbox exactly, ignoring marginFraction', () => {
    const L = 20
    const result = simulateEtch(squareOpening(L), { ...baseParams, marginFraction: 0.5, marginEnabled: false })
    expect(result.originXUm).toBeCloseTo(0, 6)
    expect(result.originYUm).toBeCloseTo(0, 6)
    expect(result.width * result.cellSizeXUm).toBeCloseTo(L, 6)
    expect(result.height * result.cellSizeYUm).toBeCloseTo(L, 6)
  })

  it('marginEnabled: false uses a local, overlapping boundary layer as the real margin', () => {
    const L = 20
    const boundary: Polygon[] = [
      [
        [-10, -10],
        [30, -10],
        [30, 30],
        [-10, 30],
      ],
    ]
    const result = simulateEtch(squareOpening(L), { ...baseParams, marginEnabled: false }, boundary)
    expect(result.originXUm).toBeCloseTo(-10, 6)
    expect(result.originYUm).toBeCloseTo(-10, 6)
    expect(result.width * result.cellSizeXUm).toBeCloseTo(40, 6)
    expect(result.height * result.cellSizeYUm).toBeCloseTo(40, 6)
  })

  it('marginEnabled: false caps a wafer-scale boundary layer instead of adopting it wholesale', () => {
    const L = 20
    const hugeWafer: Polygon[] = [
      [
        [0, 0],
        [100000, 0],
        [100000, 100000],
        [0, 100000],
      ],
    ]
    const result = simulateEtch(squareOpening(L), { ...baseParams, marginEnabled: false }, hugeWafer)
    // Capped at MAX_BOUNDARY_MARGIN_MULTIPLE (4) times the mask's own span
    // on each side -- far short of the wafer's real 100000um extent.
    expect(result.width * result.cellSizeXUm).toBeLessThan(200)
    expect(result.height * result.cellSizeYUm).toBeLessThan(200)
    expect(result.originXUm).toBeCloseTo(0, 6)
    expect(result.originYUm).toBeCloseTo(0, 6)
  })

  it('marginEnabled: false falls back to the tight mask bbox when no boundary polygon overlaps it', () => {
    const L = 20
    const disjointBoundary: Polygon[] = [
      [
        [1000, 1000],
        [1100, 1000],
        [1100, 1100],
        [1000, 1100],
      ],
    ]
    const result = simulateEtch(squareOpening(L), { ...baseParams, marginEnabled: false }, disjointBoundary)
    expect(result.originXUm).toBeCloseTo(0, 6)
    expect(result.originYUm).toBeCloseTo(0, 6)
    expect(result.width * result.cellSizeXUm).toBeCloseTo(L, 6)
    expect(result.height * result.cellSizeYUm).toBeCloseTo(L, 6)
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

describe('simulateEtch: domain is always sized to the mask geometry', () => {
  it('gives a tiny mask window full resolution regardless of how it will be displayed', () => {
    // A small window is the entire input; nothing should inflate the domain
    // beyond its own bounding box plus margin (e.g. a wafer-scale boundary
    // layer is handled entirely at the rendering layer, not here).
    const window: Polygon[] = [
      [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
    ]
    const result = simulateEtch(window, baseParams)
    const spanX = result.width * result.cellSizeXUm
    // Domain should track the ~4-unit window (plus marginFraction), not be
    // stretched out by anything else.
    expect(spanX).toBeLessThan(10)
  })

  it('resolves a narrow feature on an extremely elongated shape (anisotropic grid)', () => {
    // Mirrors a real reported file: one connected mask shape -- a long,
    // narrow column (500 x 16300um) with small 25x300um nubs at each end --
    // about 34x longer than it is wide. A single isotropic cell size tied
    // to the longer (Y) axis, as this tool used before, would size cells
    // off a ~17000um span even at max resolution (768), putting the 25um
    // nub at well under one grid cell wide -- reading as an unresolved
    // solid block instead of a real self-limiting etch profile.
    const body: Polygon = [
      [-250, -8150],
      [-250, 8150],
      [250, 8150],
      [250, -8150],
    ]
    const topNub: Polygon = [
      [-12.5, 8150],
      [-12.5, 8450],
      [12.5, 8450],
      [12.5, 8150],
    ]
    const result = simulateEtch([body, topNub], { ...baseParams, marginEnabled: true, marginFraction: 0.1, resolution: 256, undercutRateUmPerMin: 0 })

    // The narrow (X) axis must get close to the requested resolution's
    // worth of cells, not be starved by the ~34x-longer Y axis.
    expect(result.width).toBeGreaterThan(200)

    // The middle of the top nub should show real, non-trivial etch depth
    // (a self-limiting slope reaching toward sqrt2 * halfWidth), not
    // ~zero from an unresolved, effectively solid-blob mask.
    const nubDepth = sampleDepth(result, 0, 8300)
    const expectedNubDepth = Math.SQRT2 * 12.5
    expect(nubDepth).toBeGreaterThan(expectedNubDepth * 0.5)
  })
})
