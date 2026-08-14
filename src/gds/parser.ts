import { readGdsRecords, RecordType } from './binary.ts'
import type {
  ArefElement,
  BoundaryElement,
  BoxElement,
  GdsElement,
  GdsLibrary,
  GdsStructure,
  PathElement,
  RawPoint,
  SrefElement,
} from './types.ts'

function toPoints(nums: number[]): RawPoint[] {
  const pts: RawPoint[] = []
  for (let i = 0; i + 1 < nums.length; i += 2) {
    pts.push([nums[i], nums[i + 1]])
  }
  return pts
}

const STRANS_REFLECT_BIT = 0x8000

/** Parses a GDSII stream file into a library of structures with raw (unflattened) elements. */
export function parseGds(buffer: ArrayBuffer): GdsLibrary {
  const structures = new Map<string, GdsStructure>()
  const referenced = new Set<string>()

  let libName = ''
  let dbUnitInMeters = 1e-9 // sane fallback if UNITS record is missing

  let currentStruct: GdsStructure | null = null
  let currentElement: Partial<GdsElement> & { kind?: GdsElement['kind'] } = {}
  let pendingStrans: { reflect: boolean; mag: number; angle: number } | null = null

  const finishElement = () => {
    if (!currentStruct || !currentElement.kind) {
      currentElement = {}
      pendingStrans = null
      return
    }
    currentStruct.elements.push(currentElement as GdsElement)
    if (currentElement.kind === 'sref' || currentElement.kind === 'aref') {
      referenced.add((currentElement as SrefElement | ArefElement).sname)
    }
    currentElement = {}
    pendingStrans = null
  }

  for (const rec of readGdsRecords(buffer)) {
    switch (rec.type) {
      case RecordType.LIBNAME:
        libName = (rec.data as string) ?? ''
        break
      case RecordType.UNITS: {
        const nums = rec.data as number[]
        // UNITS gives [user-units-per-db-unit, meters-per-db-unit]
        if (nums && nums.length >= 2) dbUnitInMeters = nums[1]
        break
      }
      case RecordType.BGNSTR:
        currentStruct = { name: '', elements: [] }
        break
      case RecordType.STRNAME:
        if (currentStruct) currentStruct.name = (rec.data as string) ?? ''
        break
      case RecordType.ENDSTR:
        if (currentStruct) structures.set(currentStruct.name, currentStruct)
        currentStruct = null
        break

      case RecordType.BOUNDARY:
        currentElement = { kind: 'boundary', layer: 0, datatype: 0, xy: [] }
        break
      case RecordType.BOX:
        currentElement = { kind: 'box', layer: 0, datatype: 0, xy: [] }
        break
      case RecordType.PATH:
        currentElement = { kind: 'path', layer: 0, datatype: 0, width: 0, pathtype: 0, xy: [] }
        break
      case RecordType.SREF:
        currentElement = { kind: 'sref', sname: '', x: 0, y: 0, reflect: false, mag: 1, angle: 0 }
        break
      case RecordType.AREF:
        currentElement = {
          kind: 'aref',
          sname: '',
          xy: [
            [0, 0],
            [0, 0],
            [0, 0],
          ],
          cols: 1,
          rows: 1,
          reflect: false,
          mag: 1,
          angle: 0,
        }
        break

      case RecordType.LAYER:
        if ('layer' in currentElement) (currentElement as BoundaryElement).layer = (rec.data as number[])[0]
        break
      case RecordType.DATATYPE:
        if ('datatype' in currentElement) (currentElement as BoundaryElement).datatype = (rec.data as number[])[0]
        break
      case RecordType.WIDTH:
        if (currentElement.kind === 'path') (currentElement as PathElement).width = Math.abs((rec.data as number[])[0])
        break
      case RecordType.PATHTYPE:
        if (currentElement.kind === 'path') (currentElement as PathElement).pathtype = (rec.data as number[])[0]
        break
      case RecordType.SNAME:
        if (currentElement.kind === 'sref' || currentElement.kind === 'aref') {
          ;(currentElement as SrefElement | ArefElement).sname = (rec.data as string) ?? ''
        }
        break
      case RecordType.COLROW:
        if (currentElement.kind === 'aref') {
          const [cols, rows] = rec.data as number[]
          ;(currentElement as ArefElement).cols = cols
          ;(currentElement as ArefElement).rows = rows
        }
        break
      case RecordType.STRANS: {
        const bits = (rec.data as number[])[0]
        pendingStrans = { reflect: (bits & STRANS_REFLECT_BIT) !== 0, mag: 1, angle: 0 }
        break
      }
      case RecordType.MAG:
        if (pendingStrans) pendingStrans.mag = (rec.data as number[])[0]
        break
      case RecordType.ANGLE:
        if (pendingStrans) pendingStrans.angle = (rec.data as number[])[0]
        break
      case RecordType.XY: {
        const pts = toPoints(rec.data as number[])
        if (currentElement.kind === 'boundary' || currentElement.kind === 'box') {
          ;(currentElement as BoundaryElement | BoxElement).xy = pts
        } else if (currentElement.kind === 'path') {
          ;(currentElement as PathElement).xy = pts
        } else if (currentElement.kind === 'sref') {
          const [x, y] = pts[0] ?? [0, 0]
          ;(currentElement as SrefElement).x = x
          ;(currentElement as SrefElement).y = y
        } else if (currentElement.kind === 'aref') {
          const arefEl = currentElement as ArefElement
          arefEl.xy = [pts[0] ?? [0, 0], pts[1] ?? [0, 0], pts[2] ?? [0, 0]]
        }
        break
      }
      case RecordType.ENDEL:
        if (currentElement.kind === 'sref' || currentElement.kind === 'aref') {
          const el = currentElement as SrefElement | ArefElement
          if (pendingStrans) {
            el.reflect = pendingStrans.reflect
            el.mag = pendingStrans.mag
            el.angle = pendingStrans.angle
          }
        }
        finishElement()
        break
      default:
        break
    }
  }

  const topLevelCandidates = [...structures.keys()].filter((name) => !referenced.has(name))

  return {
    name: libName,
    dbUnitInMeters,
    structures,
    topLevelCandidates: topLevelCandidates.length > 0 ? topLevelCandidates : [...structures.keys()],
  }
}
