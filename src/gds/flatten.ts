import type { FlatPolygon, GdsLibrary, RawPoint } from './types.ts'

interface Xform {
  /** Maps a local (child-structure) point to the flattened top-level point, in database units. */
  apply(p: RawPoint): RawPoint
}

const IDENTITY: Xform = { apply: (p) => p }

function compose(outer: Xform, reflect: boolean, mag: number, angleDeg: number, tx: number, ty: number): Xform {
  const theta = (angleDeg * Math.PI) / 180
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  return {
    apply([x, y]: RawPoint): RawPoint {
      let px = x
      let py = reflect ? -y : y
      px *= mag
      py *= mag
      const rx = px * cos - py * sin
      const ry = px * sin + py * cos
      return outer.apply([rx + tx, ry + ty])
    },
  }
}

function pathToRectangles(xy: RawPoint[], width: number, pathtype: number): RawPoint[][] {
  const half = width / 2
  const ext = pathtype === 0 ? 0 : half // approximate 'round' (1) and 'extended' (2) as square extension
  const rects: RawPoint[][] = []
  for (let i = 0; i + 1 < xy.length; i++) {
    const [x0, y0] = xy[i]
    const [x1, y1] = xy[i + 1]
    const dx = x1 - x0
    const dy = y1 - y0
    const len = Math.hypot(dx, dy)
    if (len === 0) continue
    const ux = dx / len
    const uy = dy / len
    // perpendicular unit vector
    const px = -uy
    const py = ux
    const sx0 = x0 - ux * ext
    const sy0 = y0 - uy * ext
    const sx1 = x1 + ux * ext
    const sy1 = y1 + uy * ext
    rects.push([
      [sx0 + px * half, sy0 + py * half],
      [sx1 + px * half, sy1 + py * half],
      [sx1 - px * half, sy1 - py * half],
      [sx0 - px * half, sy0 - py * half],
    ])
  }
  return rects
}

const MAX_POLYGONS = 500_000

/**
 * Flattens a structure (and its SREF/AREF children) into absolute polygons on
 * the requested layer, in database units. Recursion depth is bounded to guard
 * against malformed/circular references.
 */
export function flattenLayer(lib: GdsLibrary, topName: string, layer: number, datatype?: number): FlatPolygon[] {
  const out: FlatPolygon[] = []
  const visitedStack = new Set<string>()

  function visit(structName: string, xform: Xform, depth: number) {
    if (depth > 64) return
    if (visitedStack.has(structName)) return // guard against reference cycles
    const struct = lib.structures.get(structName)
    if (!struct) return
    visitedStack.add(structName)

    for (const el of struct.elements) {
      if (out.length > MAX_POLYGONS) break
      switch (el.kind) {
        case 'boundary':
        case 'box': {
          if (el.layer !== layer) break
          if (datatype !== undefined && el.datatype !== datatype) break
          out.push({ layer: el.layer, datatype: el.datatype, points: el.xy.map((p) => xform.apply(p)) })
          break
        }
        case 'path': {
          if (el.layer !== layer) break
          if (datatype !== undefined && el.datatype !== datatype) break
          for (const rect of pathToRectangles(el.xy, el.width, el.pathtype)) {
            out.push({ layer: el.layer, datatype: el.datatype, points: rect.map((p) => xform.apply(p)) })
          }
          break
        }
        case 'sref': {
          const childXform = compose(xform, el.reflect, el.mag, el.angle, el.x, el.y)
          visit(el.sname, childXform, depth + 1)
          break
        }
        case 'aref': {
          const [origin, colEnd, rowEnd] = el.xy
          const colVec: RawPoint = [(colEnd[0] - origin[0]) / el.cols, (colEnd[1] - origin[1]) / el.cols]
          const rowVec: RawPoint = [(rowEnd[0] - origin[0]) / el.rows, (rowEnd[1] - origin[1]) / el.rows]
          for (let j = 0; j < el.rows; j++) {
            for (let i = 0; i < el.cols; i++) {
              const ox = origin[0] + i * colVec[0] + j * rowVec[0]
              const oy = origin[1] + i * colVec[1] + j * rowVec[1]
              const instXform = compose(xform, el.reflect, el.mag, el.angle, ox, oy)
              visit(el.sname, instXform, depth + 1)
              if (out.length > MAX_POLYGONS) return
            }
          }
          break
        }
      }
    }
    visitedStack.delete(structName)
  }

  visit(topName, IDENTITY, 0)
  return out
}

/** Collects the set of (layer, datatype) pairs used anywhere beneath a top structure. */
export function collectLayers(lib: GdsLibrary, topName: string): { layer: number; datatype: number }[] {
  const seen = new Map<string, { layer: number; datatype: number }>()
  const visitedStack = new Set<string>()

  function visit(structName: string, depth: number) {
    if (depth > 64 || visitedStack.has(structName)) return
    const struct = lib.structures.get(structName)
    if (!struct) return
    visitedStack.add(structName)
    for (const el of struct.elements) {
      if (el.kind === 'boundary' || el.kind === 'box' || el.kind === 'path') {
        seen.set(`${el.layer}:${el.datatype}`, { layer: el.layer, datatype: el.datatype })
      } else if (el.kind === 'sref') {
        visit(el.sname, depth + 1)
      } else if (el.kind === 'aref') {
        visit(el.sname, depth + 1)
      }
    }
    visitedStack.delete(structName)
  }

  visit(topName, 0)
  return [...seen.values()].sort((a, b) => a.layer - b.layer || a.datatype - b.datatype)
}
