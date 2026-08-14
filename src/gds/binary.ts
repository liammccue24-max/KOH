// Low-level GDSII stream-format record reader.
// Spec reference: Stream Format Manual (Calma/Cadence), record header = 2-byte
// big-endian length (incl. header) + 1-byte record type + 1-byte data type.

export const RecordType = {
  HEADER: 0x00,
  BGNLIB: 0x01,
  LIBNAME: 0x02,
  UNITS: 0x03,
  ENDLIB: 0x04,
  BGNSTR: 0x05,
  STRNAME: 0x06,
  ENDSTR: 0x07,
  BOUNDARY: 0x08,
  PATH: 0x09,
  SREF: 0x0a,
  AREF: 0x0b,
  TEXT: 0x0c,
  LAYER: 0x0d,
  DATATYPE: 0x0e,
  WIDTH: 0x0f,
  XY: 0x10,
  ENDEL: 0x11,
  SNAME: 0x12,
  COLROW: 0x13,
  TEXTNODE: 0x14,
  NODE: 0x15,
  TEXTTYPE: 0x16,
  PRESENTATION: 0x17,
  STRING: 0x19,
  STRANS: 0x1a,
  MAG: 0x1b,
  ANGLE: 0x1c,
  REFLIBS: 0x1f,
  FONTS: 0x20,
  PATHTYPE: 0x21,
  GENERATIONS: 0x22,
  ATTRTABLE: 0x23,
  NODETYPE: 0x2a,
  PROPATTR: 0x2b,
  PROPVALUE: 0x2c,
  BOX: 0x2d,
  BOXTYPE: 0x2e,
} as const

const DataType = {
  NONE: 0x00,
  BITARRAY: 0x01,
  I2: 0x02,
  I4: 0x03,
  R4: 0x04,
  R8: 0x05,
  ASCII: 0x06,
} as const

export interface GdsRecord {
  type: number
  dataType: number
  /** Decoded payload; shape depends on dataType. */
  data: number[] | string | null
}

/** Decode an 8-byte GDSII "excess-64" floating point real (not IEEE-754). */
function readReal8(view: DataView, offset: number): number {
  const b0 = view.getUint8(offset)
  const sign = b0 & 0x80 ? -1 : 1
  const exponent = b0 & 0x7f
  let mantissa = 0
  for (let i = 1; i < 8; i++) {
    mantissa = mantissa * 256 + view.getUint8(offset + i)
  }
  // mantissa is a 56-bit fraction; value = sign * 16^(exponent-64) * mantissa / 16^14 (2^56)
  return sign * mantissa * Math.pow(16, exponent - 64 - 14)
}

function readReal4(view: DataView, offset: number): number {
  const b0 = view.getUint8(offset)
  const sign = b0 & 0x80 ? -1 : 1
  const exponent = b0 & 0x7f
  let mantissa = 0
  for (let i = 1; i < 4; i++) {
    mantissa = mantissa * 256 + view.getUint8(offset + i)
  }
  return sign * mantissa * Math.pow(16, exponent - 64 - 6)
}

/** Parses the flat sequence of GDSII stream records from a raw file buffer. */
export function* readGdsRecords(buffer: ArrayBuffer): Generator<GdsRecord> {
  const view = new DataView(buffer)
  let offset = 0
  const len = buffer.byteLength
  while (offset + 4 <= len) {
    const recLen = view.getUint16(offset, false)
    if (recLen < 4) break // malformed / padding
    const type = view.getUint8(offset + 2)
    const dataType = view.getUint8(offset + 3)
    const dataStart = offset + 4
    const dataEnd = offset + recLen
    let data: number[] | string | null = null

    switch (dataType) {
      case DataType.NONE:
        data = null
        break
      case DataType.BITARRAY: {
        data = [view.getUint16(dataStart, false)]
        break
      }
      case DataType.I2: {
        const arr: number[] = []
        for (let p = dataStart; p + 2 <= dataEnd; p += 2) {
          arr.push(view.getInt16(p, false))
        }
        data = arr
        break
      }
      case DataType.I4: {
        const arr: number[] = []
        for (let p = dataStart; p + 4 <= dataEnd; p += 4) {
          arr.push(view.getInt32(p, false))
        }
        data = arr
        break
      }
      case DataType.R4: {
        const arr: number[] = []
        for (let p = dataStart; p + 4 <= dataEnd; p += 4) {
          arr.push(readReal4(view, p))
        }
        data = arr
        break
      }
      case DataType.R8: {
        const arr: number[] = []
        for (let p = dataStart; p + 8 <= dataEnd; p += 8) {
          arr.push(readReal8(view, p))
        }
        data = arr
        break
      }
      case DataType.ASCII: {
        const bytes = new Uint8Array(buffer, dataStart, dataEnd - dataStart)
        let str = new TextDecoder('ascii').decode(bytes)
        // Strip trailing NUL padding (GDS strings are padded to even length).
        const nul = str.indexOf('\0')
        if (nul >= 0) str = str.slice(0, nul)
        data = str
        break
      }
      default:
        data = null
    }

    yield { type, dataType, data }
    offset = dataEnd
  }
}
