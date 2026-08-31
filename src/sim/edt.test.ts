import { describe, expect, it } from 'vitest'
import { squaredDistanceTransform } from './edt.ts'

describe('squaredDistanceTransform', () => {
  it('gives zero at seed cells', () => {
    const w = 5
    const h = 5
    const seeds = new Uint8Array(w * h)
    seeds[2 * w + 2] = 1
    const d = squaredDistanceTransform(seeds, w, h, 1, 1)
    expect(d[2 * w + 2]).toBe(0)
  })

  it('matches known distances from a single seed', () => {
    const w = 7
    const h = 7
    const seeds = new Uint8Array(w * h)
    seeds[3 * w + 3] = 1 // seed at (3,3)
    const d = squaredDistanceTransform(seeds, w, h, 1, 1)
    expect(d[3 * w + 4]).toBeCloseTo(1, 6) // one cell right
    expect(d[4 * w + 4]).toBeCloseTo(2, 6) // diagonal neighbor
    expect(d[3 * w + 6]).toBeCloseTo(9, 6) // 3 cells right
  })

  it('takes the minimum distance across multiple seeds', () => {
    const w = 10
    const h = 1
    const seeds = new Uint8Array(w * h)
    seeds[0] = 1
    seeds[9] = 1
    const d = squaredDistanceTransform(seeds, w, h, 1, 1)
    expect(d[4]).toBeCloseTo(16, 6) // closer to seed at 0
    expect(d[5]).toBeCloseTo(16, 6) // closer to seed at 9
  })

  it('scales each axis independently for non-square cells', () => {
    const w = 5
    const h = 5
    const seeds = new Uint8Array(w * h)
    seeds[2 * w + 2] = 1 // seed at (2,2)
    // 3 microns per cell in x, 10 microns per cell in y.
    const d = squaredDistanceTransform(seeds, w, h, 3, 10)
    expect(d[2 * w + 3]).toBeCloseTo(3 * 3, 6) // one cell right: 3um in x
    expect(d[3 * w + 2]).toBeCloseTo(10 * 10, 6) // one cell down: 10um in y
    expect(d[3 * w + 3]).toBeCloseTo(3 * 3 + 10 * 10, 6) // diagonal: combines both physically
  })
})
