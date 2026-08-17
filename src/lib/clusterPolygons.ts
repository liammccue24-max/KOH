import { computeBoundingBox, type BoundingBox, type Polygon } from '../sim/types.ts'

function expand(b: BoundingBox, byUm: number): BoundingBox {
  return { minX: b.minX - byUm, minY: b.minY - byUm, maxX: b.maxX + byUm, maxY: b.maxY + byUm }
}

function overlaps(a: BoundingBox, b: BoundingBox): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY
}

/**
 * Groups polygons into spatially-separate clusters, so each can later be
 * simulated at full grid resolution on its own tight bounding box instead
 * of one grid spread thinly across widely-separated features (e.g. several
 * small etch windows scattered across a large wafer) -- which would waste
 * almost all of the resolution budget on the empty space between them.
 *
 * Two polygons join the same cluster if their bounding boxes, each
 * expanded by `gapUm`, overlap (transitively, via union-find).
 */
export function clusterPolygons(polygons: readonly Polygon[], gapUm: number): Polygon[][] {
  const n = polygons.length
  if (n === 0) return []
  const boxes = polygons.map((p) => computeBoundingBox([p]))
  const parent = Array.from({ length: n }, (_, i) => i)

  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]
      x = parent[x]
    }
    return x
  }
  function union(a: number, b: number) {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[ra] = rb
  }

  for (let i = 0; i < n; i++) {
    const expanded = expand(boxes[i], gapUm)
    for (let j = i + 1; j < n; j++) {
      if (overlaps(expanded, boxes[j])) union(i, j)
    }
  }

  const groups = new Map<number, Polygon[]>()
  for (let i = 0; i < n; i++) {
    const root = find(i)
    let group = groups.get(root)
    if (!group) {
      group = []
      groups.set(root, group)
    }
    group.push(polygons[i])
  }
  return [...groups.values()]
}
