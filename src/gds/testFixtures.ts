// Minimal GDSII stream-format writer, used only to build fixtures for tests.
import { RecordType } from './binary.ts'

function encodeReal8(v: number): number[] {
  const bytes = new Array(8).fill(0)
  if (v === 0) return bytes
  const sign = v < 0 ? 1 : 0
  let av = Math.abs(v)
  let exponent = 64
  while (av >= 1) {
    av /= 16
    exponent++
  }
  while (av < 1 / 16) {
    av *= 16
    exponent--
  }
  let mantissa = Math.round(av * Math.pow(2, 56))
  if (mantissa >= Math.pow(2, 56)) {
    mantissa /= 16
    exponent++
  }
  bytes[0] = (sign << 7) | (exponent & 0x7f)
  for (let i = 6; i >= 0; i--) {
    bytes[1 + i] = mantissa % 256
    mantissa = Math.floor(mantissa / 256)
  }
  return bytes
}

class GdsWriter {
  chunks: number[][] = []

  record(type: number, dataType: number, payloadBytes: number[]) {
    const len = 4 + payloadBytes.length
    const header = [(len >> 8) & 0xff, len & 0xff, type & 0xff, dataType & 0xff]
    this.chunks.push(header.concat(payloadBytes))
  }

  noData(type: number) {
    this.record(type, 0x00, [])
  }

  i2(type: number, values: number[]) {
    const bytes: number[] = []
    for (const v of values) {
      const u = v < 0 ? v + 0x10000 : v
      bytes.push((u >> 8) & 0xff, u & 0xff)
    }
    this.record(type, 0x02, bytes)
  }

  i4(type: number, values: number[]) {
    const bytes: number[] = []
    for (const v of values) {
      const u = v < 0 ? v + 0x100000000 : v
      bytes.push((u >>> 24) & 0xff, (u >>> 16) & 0xff, (u >>> 8) & 0xff, u & 0xff)
    }
    this.record(type, 0x03, bytes)
  }

  r8(type: number, values: number[]) {
    const bytes: number[] = []
    for (const v of values) bytes.push(...encodeReal8(v))
    this.record(type, 0x05, bytes)
  }

  ascii(type: number, str: string) {
    const bytes = Array.from(new TextEncoder().encode(str))
    if (bytes.length % 2 !== 0) bytes.push(0)
    this.record(type, 0x06, bytes)
  }

  bitarray(type: number, bits: number) {
    this.record(type, 0x01, [(bits >> 8) & 0xff, bits & 0xff])
  }

  toBuffer(): ArrayBuffer {
    const flat = this.chunks.flat()
    return new Uint8Array(flat).buffer
  }
}

export function buildTestGds(): ArrayBuffer {
  const w = new GdsWriter()
  w.i2(RecordType.HEADER, [600])
  w.i2(RecordType.BGNLIB, new Array(12).fill(0))
  w.ascii(RecordType.LIBNAME, 'TESTLIB')
  w.r8(RecordType.UNITS, [0.001, 1e-9]) // 1 user unit (micron) = 1000 db units; db unit = 1nm

  // CHILD structure: a 10x4 db-unit rectangle on layer 1, and a triangle-ish shape on layer 2.
  w.i2(RecordType.BGNSTR, new Array(12).fill(0))
  w.ascii(RecordType.STRNAME, 'CHILD')
  w.noData(RecordType.BOUNDARY)
  w.i2(RecordType.LAYER, [1])
  w.i2(RecordType.DATATYPE, [0])
  w.i4(RecordType.XY, [0, 0, 10, 0, 10, 4, 0, 4, 0, 0])
  w.noData(RecordType.ENDEL)
  w.noData(RecordType.BOUNDARY)
  w.i2(RecordType.LAYER, [2])
  w.i2(RecordType.DATATYPE, [0])
  w.i4(RecordType.XY, [0, 0, 6, 0, 0, 6, 0, 0])
  w.noData(RecordType.ENDEL)
  w.noData(RecordType.ENDSTR)

  // TOP structure: references CHILD once with a 90deg rotation + translation,
  // and once with an X-axis reflection, plus a direct boundary of its own on layer 1.
  w.i2(RecordType.BGNSTR, new Array(12).fill(0))
  w.ascii(RecordType.STRNAME, 'TOP')

  w.noData(RecordType.BOUNDARY)
  w.i2(RecordType.LAYER, [1])
  w.i2(RecordType.DATATYPE, [0])
  w.i4(RecordType.XY, [100, 100, 105, 100, 105, 102, 100, 102, 100, 100])
  w.noData(RecordType.ENDEL)

  w.noData(RecordType.SREF)
  w.ascii(RecordType.SNAME, 'CHILD')
  w.bitarray(RecordType.STRANS, 0x0000)
  w.r8(RecordType.MAG, [1])
  w.r8(RecordType.ANGLE, [90])
  w.i4(RecordType.XY, [50, 0])
  w.noData(RecordType.ENDEL)

  w.noData(RecordType.SREF)
  w.ascii(RecordType.SNAME, 'CHILD')
  w.bitarray(RecordType.STRANS, 0x8000) // reflect about X axis before rotation
  w.r8(RecordType.MAG, [1])
  w.r8(RecordType.ANGLE, [0])
  w.i4(RecordType.XY, [0, -20])
  w.noData(RecordType.ENDEL)

  w.noData(RecordType.ENDSTR)
  w.noData(RecordType.ENDLIB)

  return w.toBuffer()
}
