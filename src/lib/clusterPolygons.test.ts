import { describe, expect, it } from 'vitest'
import { clusterPolygons } from './clusterPolygons.ts'
import type { Polygon } from '../sim/types.ts'

function square(x: number, y: number, size: number): Polygon {
  return [
    [x, y],
    [x + size, y],
    [x + size, y + size],
    [x, y + size],
  ]
}

describe('clusterPolygons', () => {
  it('groups nearby polygons into one cluster', () => {
    const polys = [square(0, 0, 10), square(15, 0, 10)] // 5um gap
    const clusters = clusterPolygons(polys, 10) // gap tolerance covers it
    expect(clusters.length).toBe(1)
    expect(clusters[0].length).toBe(2)
  })

  it('splits far-apart polygons into separate clusters', () => {
    const polys = [square(0, 0, 10), square(100000, 100000, 10)]
    const clusters = clusterPolygons(polys, 10)
    expect(clusters.length).toBe(2)
  })

  it('chains transitively through an intermediate polygon', () => {
    const polys = [square(0, 0, 10), square(15, 0, 10), square(30, 0, 10)]
    const clusters = clusterPolygons(polys, 6)
    expect(clusters.length).toBe(1)
    expect(clusters[0].length).toBe(3)
  })

  it('returns one cluster per polygon when gap is zero and nothing touches', () => {
    const polys = [square(0, 0, 10), square(50, 0, 10), square(100, 0, 10)]
    const clusters = clusterPolygons(polys, 0)
    expect(clusters.length).toBe(3)
  })

  it('handles an empty input', () => {
    expect(clusterPolygons([], 10)).toEqual([])
  })
})
