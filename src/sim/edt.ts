// Exact 2D squared Euclidean distance transform of a binary "seed" grid,
// via the two-pass lower-envelope-of-parabolas algorithm of
// Felzenszwalt & Huttenlocher, "Distance Transforms of Sampled Functions" (2004).
// Runs in O(width*height), exact (not an approximation/chamfer distance).

const INF = 1e20

/** 1D squared distance transform of `f` (0 at seeds, INF elsewhere). */
function dt1d(f: Float64Array, n: number, out: Float64Array): void {
  const v = new Int32Array(n)
  const z = new Float64Array(n + 1)
  let k = 0
  v[0] = 0
  z[0] = -Infinity
  z[1] = Infinity
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    while (s <= z[k]) {
      k--
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = Infinity
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++
    const d = q - v[k]
    out[q] = d * d + f[v[k]]
  }
}

/**
 * Computes the squared Euclidean distance (in grid-cell units) from every
 * cell to the nearest "seed" cell (where `seeds[i]` is truthy).
 * If no seeds are present, every output is INF.
 */
export function squaredDistanceTransform(seeds: ArrayLike<number>, width: number, height: number): Float64Array {
  const f = new Float64Array(width * height)
  for (let i = 0; i < width * height; i++) f[i] = seeds[i] ? 0 : INF

  // Pass 1: transform each column.
  const colBuf = new Float64Array(height)
  const colOut = new Float64Array(height)
  const tmp = new Float64Array(width * height)
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) colBuf[y] = f[y * width + x]
    dt1d(colBuf, height, colOut)
    for (let y = 0; y < height; y++) tmp[y * width + x] = colOut[y]
  }

  // Pass 2: transform each row of the column-transformed result.
  const rowBuf = new Float64Array(width)
  const rowOut = new Float64Array(width)
  const out = new Float64Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) rowBuf[x] = tmp[y * width + x]
    dt1d(rowBuf, width, rowOut)
    for (let x = 0; x < width; x++) out[y * width + x] = rowOut[x]
  }

  return out
}
