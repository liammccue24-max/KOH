// Generates public/sample-koh-mask.gds: a small illustrative GDSII mask with
// three layers demonstrating different KOH etch behaviors.
import { writeFileSync } from 'node:fs'

function encodeReal8(v) {
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
  chunks = []
  record(type, dataType, payloadBytes) {
    const len = 4 + payloadBytes.length
    const header = [(len >> 8) & 0xff, len & 0xff, type & 0xff, dataType & 0xff]
    this.chunks.push(header.concat(payloadBytes))
  }
  noData(type) {
    this.record(type, 0x00, [])
  }
  i2(type, values) {
    const bytes = []
    for (const v of values) {
      const u = v < 0 ? v + 0x10000 : v
      bytes.push((u >> 8) & 0xff, u & 0xff)
    }
    this.record(type, 0x02, bytes)
  }
  i4(type, values) {
    const bytes = []
    for (const v of values) {
      const u = v < 0 ? v + 0x100000000 : v
      bytes.push((u >>> 24) & 0xff, (u >>> 16) & 0xff, (u >>> 8) & 0xff, u & 0xff)
    }
    this.record(type, 0x03, bytes)
  }
  r8(type, values) {
    const bytes = []
    for (const v of values) bytes.push(...encodeReal8(v))
    this.record(type, 0x05, bytes)
  }
  ascii(type, str) {
    const bytes = Array.from(new TextEncoder().encode(str))
    if (bytes.length % 2 !== 0) bytes.push(0)
    this.record(type, 0x06, bytes)
  }
  toBuffer() {
    return Buffer.from(this.chunks.flat())
  }
}

const RT = {
  HEADER: 0x00,
  BGNLIB: 0x01,
  LIBNAME: 0x02,
  UNITS: 0x03,
  ENDLIB: 0x04,
  BGNSTR: 0x05,
  STRNAME: 0x06,
  ENDSTR: 0x07,
  BOUNDARY: 0x08,
  LAYER: 0x0d,
  DATATYPE: 0x0e,
  XY: 0x10,
  ENDEL: 0x11,
}

function rect(w, x0, y0, x1, y1, layer) {
  w.noData(RT.BOUNDARY)
  w.i2(RT.LAYER, [layer])
  w.i2(RT.DATATYPE, [0])
  w.i4(RT.XY, [x0, y0, x1, y0, x1, y1, x0, y1, x0, y0])
  w.noData(RT.ENDEL)
}

const w = new GdsWriter()
w.i2(RT.HEADER, [600])
w.i2(RT.BGNLIB, new Array(12).fill(0))
w.ascii(RT.LIBNAME, 'KOH_SAMPLE')
w.r8(RT.UNITS, [0.001, 1e-9]) // 1000 db units per micron, 1nm db unit

w.i2(RT.BGNSTR, new Array(12).fill(0))
w.ascii(RT.STRNAME, 'TOP')

// Layer 1: 80x80um square opening -> self-terminating inverted pyramid.
rect(w, -140000, -40000, -60000, 40000, 1)

// Layer 2: 200x30um elongated opening -> flat-bottomed V-groove.
rect(w, -100000, 60000, 100000, 90000, 2)

// Layer 3: isolated 40x40um square -- select "drawn shapes = protective mask"
// polarity on this layer to see convex-corner undercut eating the mesa.
rect(w, 60000, -40000, 100000, 0, 3)

// Layer 4: an 80x80um square opening with a 20x20um square mesa island in
// its center, joined to the outer boundary by a zero-width keyhole slit so
// it is a single valid GDS ring. Demonstrates a concave self-limiting
// cavity that etches around a protected mesa (e.g. a released membrane
// support post).
w.noData(RT.BOUNDARY)
w.i2(RT.LAYER, [4])
w.i2(RT.DATATYPE, [0])
w.i4(RT.XY, [
  60000, 40000, // A
  90000, 40000, // M (slit start, on outer bottom edge)
  90000, 70000, // P (hole bottom-left)
  110000, 70000, // Q (hole bottom-right)
  110000, 90000, // R (hole top-right)
  90000, 90000, // S (hole top-left)
  90000, 70000, // P again (close hole ring)
  90000, 40000, // M again (back down the slit)
  140000, 40000, // B
  140000, 120000, // C
  60000, 120000, // D
  60000, 40000, // A (close outer ring)
])
w.noData(RT.ENDEL)

w.noData(RT.ENDSTR)
w.noData(RT.ENDLIB)

writeFileSync(new URL('../public/sample-koh-mask.gds', import.meta.url), w.toBuffer())
console.log('wrote public/sample-koh-mask.gds')
