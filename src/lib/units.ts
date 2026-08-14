import type { RawPoint } from '../gds/types.ts'

/** Converts a polygon's raw GDSII database-unit points to micrometers. */
export function toMicrons(points: readonly RawPoint[], dbUnitInMeters: number): [number, number][] {
  const scale = dbUnitInMeters * 1e6
  return points.map(([x, y]) => [x * scale, y * scale])
}
