import { describe, expect, it } from 'vitest'
import { buildTestGds } from './testFixtures.ts'
import { parseGds } from './parser.ts'
import { collectLayers, flattenLayer } from './flatten.ts'

function bboxOf(points: readonly (readonly [number, number])[]) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of points) {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  return { minX, minY, maxX, maxY }
}

describe('parseGds', () => {
  it('reads library units and structures', () => {
    const lib = parseGds(buildTestGds())
    expect(lib.name).toBe('TESTLIB')
    expect(lib.dbUnitInMeters).toBeCloseTo(1e-9, 12)
    expect([...lib.structures.keys()].sort()).toEqual(['CHILD', 'TOP'])
  })

  it('identifies TOP as the only top-level (unreferenced) structure', () => {
    const lib = parseGds(buildTestGds())
    expect(lib.topLevelCandidates).toEqual(['TOP'])
  })
})

describe('flattenLayer', () => {
  it('collects layers used anywhere beneath TOP, including inside CHILD', () => {
    const lib = parseGds(buildTestGds())
    const layers = collectLayers(lib, 'TOP')
    expect(layers.map((l) => l.layer).sort()).toEqual([1, 2])
  })

  it('places TOPs own boundary unmodified', () => {
    const lib = parseGds(buildTestGds())
    const polys = flattenLayer(lib, 'TOP', 1)
    const own = polys.find((p) => {
      const b = bboxOf(p.points)
      return b.minX === 100 && b.minY === 100
    })
    expect(own).toBeTruthy()
    const b = bboxOf(own!.points)
    expect(b).toEqual({ minX: 100, minY: 100, maxX: 105, maxY: 102 })
  })

  it('applies a 90 degree rotation + translation to an SREF instance', () => {
    const lib = parseGds(buildTestGds())
    const polys = flattenLayer(lib, 'TOP', 1)
    // CHILD's 10x4 rect rotated 90deg CCW -> 4x10, then translated by (50,0).
    const rotated = polys.find((p) => {
      const b = bboxOf(p.points)
      return Math.abs(b.minX - 46) < 1e-6 && Math.abs(b.maxX - 50) < 1e-6
    })
    expect(rotated).toBeTruthy()
    const b = bboxOf(rotated!.points)
    expect(b.minY).toBeCloseTo(0, 6)
    expect(b.maxY).toBeCloseTo(10, 6)
  })

  it('applies an X-axis reflection + translation to an SREF instance', () => {
    const lib = parseGds(buildTestGds())
    const polys = flattenLayer(lib, 'TOP', 1)
    // CHILD's 10x4 rect reflected about X (y -> -y), then translated by (0,-20).
    const reflected = polys.find((p) => {
      const b = bboxOf(p.points)
      return Math.abs(b.minY - -24) < 1e-6
    })
    expect(reflected).toBeTruthy()
    const b = bboxOf(reflected!.points)
    expect(b.minX).toBeCloseTo(0, 6)
    expect(b.maxX).toBeCloseTo(10, 6)
    expect(b.maxY).toBeCloseTo(-20, 6)
  })

  it('flattens both SREF instances of the layer-2 triangle from CHILD', () => {
    const lib = parseGds(buildTestGds())
    const polys = flattenLayer(lib, 'TOP', 2)
    expect(polys.length).toBe(2)
  })

  it('returns nothing for a layer that does not exist', () => {
    const lib = parseGds(buildTestGds())
    const polys = flattenLayer(lib, 'TOP', 99)
    expect(polys.length).toBe(0)
  })
})
