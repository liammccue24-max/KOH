/** A polygon ring in database units (raw GDSII integer grid units). */
export type RawPoint = readonly [x: number, y: number]

export interface BoundaryElement {
  kind: 'boundary'
  layer: number
  datatype: number
  xy: RawPoint[]
}

export interface PathElement {
  kind: 'path'
  layer: number
  datatype: number
  width: number
  pathtype: number
  xy: RawPoint[]
}

export interface BoxElement {
  kind: 'box'
  layer: number
  datatype: number
  xy: RawPoint[]
}

export interface SrefElement {
  kind: 'sref'
  sname: string
  x: number
  y: number
  reflect: boolean
  mag: number
  angle: number
}

export interface ArefElement {
  kind: 'aref'
  sname: string
  /** [origin, colEndPoint, rowEndPoint] in parent database units. */
  xy: [RawPoint, RawPoint, RawPoint]
  cols: number
  rows: number
  reflect: boolean
  mag: number
  angle: number
}

export type GdsElement =
  | BoundaryElement
  | PathElement
  | BoxElement
  | SrefElement
  | ArefElement

export interface GdsStructure {
  name: string
  elements: GdsElement[]
}

export interface GdsLibrary {
  name: string
  /** Database unit expressed in meters (size of one integer grid step). */
  dbUnitInMeters: number
  structures: Map<string, GdsStructure>
  /** Structures not referenced by any SREF/AREF anywhere in the library. */
  topLevelCandidates: string[]
}

/** A flattened, layer-tagged polygon in micrometers, ready for rasterization. */
export interface FlatPolygon {
  layer: number
  datatype: number
  /** Vertices in microns. Not guaranteed closed (first !== last). */
  points: RawPoint[]
}
