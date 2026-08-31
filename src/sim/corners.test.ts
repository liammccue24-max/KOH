import { describe, expect, it } from 'vitest'
import { findConvexProtectCorners } from './corners.ts'

describe('findConvexProtectCorners', () => {
  it('returns the actual protected cell at each corner, not an unconditional vertex-to-cell guess', () => {
    // A 2x2 protected island surrounded by open silicon, on a 4x4 grid.
    // Its 4 outer vertices are textbook convex mask corners (a single
    // protected cell exposed on 270 degrees). An earlier version returned
    // the shared vertex's own (vx, vy) coordinate and the caller clamped it
    // directly into a cell index -- equivalent to always assuming the
    // protected neighbor is the bottom-right one. That assumption only
    // holds for one of this island's 4 corners; for the other 3, it lands
    // on an open (non-mask) cell entirely, seeding the undercut distance
    // field from a point that isn't part of the mask at all.
    // prettier-ignore
    const protect = new Uint8Array([
      0, 0, 0, 0,
      0, 1, 1, 0,
      0, 1, 1, 0,
      0, 0, 0, 0,
    ])
    const width = 4
    const height = 4

    const corners = findConvexProtectCorners(protect, width, height)
    expect(corners).toHaveLength(4)

    // Every reported corner must itself be a genuinely protected cell.
    for (const { col, row } of corners) {
      expect(protect[row * width + col]).toBe(1)
    }

    // And specifically, the 4 island cells themselves (order-independent).
    const found = new Set(corners.map(({ col, row }) => `${col},${row}`))
    expect(found).toEqual(new Set(['1,1', '2,1', '1,2', '2,2']))
  })

  it('treats the padded domain border as protected, so no spurious corner is found there', () => {
    const protect = new Uint8Array(4 * 4).fill(1)
    const corners = findConvexProtectCorners(protect, 4, 4)
    expect(corners).toHaveLength(0)
  })
})
