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
 * Computes the squared Euclidean distance from every cell to the nearest
 * "seed" cell (where `seeds[i]` is truthy), in physical units² given each
 * axis's physical cell size (`cellSizeXUm`, `cellSizeYUm` -- pass 1,1 to
 * get plain grid-cell-unit squared distance instead). If no seeds are
 * present, every output is INF.
 *
 * Non-square cells (cellSizeXUm !== cellSizeYUm) work via a simple
 * rescaling trick, not a separate algorithm: dt1d computes
 * min_p[(q-p)^2 + f(p)] by construction, so substituting f' = f/h^2 and
 * multiplying its result by h^2 gives min_p[h^2*(q-p)^2 + f(p)] exactly --
 * the physically-correct anisotropic term for that axis, accumulated into
 * the next pass. This is what lets a grid stay well-resolved across a
 * narrow axis even when the other axis is, say, 30x longer (an elongated
 * design with fine detail only at its ends): resolution is no longer tied
 * to one shared cell size sized off whichever axis happens to be longer.
 */
export function squaredDistanceTransform(seeds: ArrayLike<number>, width: number, height: number, cellSizeXUm: number, cellSizeYUm: number): Float64Array {
  const f = new Float64Array(width * height)
  for (let i = 0; i < width * height; i++) f[i] = seeds[i] ? 0 : INF

  const hy2 = cellSizeYUm * cellSizeYUm
  const hx2 = cellSizeXUm * cellSizeXUm

  // Pass 1: transform each column (y-direction), scaled to physical microns².
  const colBuf = new Float64Array(height)
  const colOut = new Float64Array(height)
  const tmp = new Float64Array(width * height)
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) colBuf[y] = f[y * width + x] / hy2
    dt1d(colBuf, height, colOut)
    for (let y = 0; y < height; y++) tmp[y * width + x] = colOut[y] * hy2
  }

  // Pass 2: transform each row (x-direction) of the column-transformed
  // result, combining with its already-physical y-contribution.
  const rowBuf = new Float64Array(width)
  const rowOut = new Float64Array(width)
  const out = new Float64Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) rowBuf[x] = tmp[y * width + x] / hx2
    dt1d(rowBuf, width, rowOut)
    for (let x = 0; x < width; x++) out[y * width + x] = rowOut[x] * hx2
  }

  return out
}
