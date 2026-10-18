// LOESS as used by the R app: predict(loess(freq ~ period, span = s)) with R's defaults
// (degree 2, family "gaussian", surface "interpolate", cell 0.2), for one predictor.
// R (netlib loess, ehg126/ehg124/ehg127/ehg128) computes the local quadratic fit only at the vertices of a k-d
// tree and blends between vertices with cubic Hermite interpolation, using the fitted value and slope at each
// vertex. This file follows that algorithm in 1-D:
//   - bounding box: [min - mu, max + mu], mu = 0.005 * range;
//   - cells are split at their median point while they hold more than fc = floor(n * span * cell) points
//     (and the median is not on the cell's own bound); the vertices are the box ends and all split values;
//   - local fit at x0: the q = floor(n * span) nearest points, tricube weights with bandwidth = distance to the
//     q-th nearest point, weighted least squares on (1, u, u^2), u = x - x0; value = b0, slope = b1;
//   - between vertices v0 < v1: Hermite cubic through (f0, s0) and (f1, s1).
// surface: 'interpolate' (R's default, used by the app) or 'direct' (local fit at every point).

function localFit(xs, ys, x0, q) {
  const n = xs.length
  const d = xs.map(x => Math.abs(x - x0))
  const sortedD = [...d].sort((a, b) => a - b)
  const h = sortedD[q - 1]
  // weighted sums for the normal equations of y ~ b0 + b1 u + b2 u^2 (u scaled by h for conditioning)
  let S = Array.from({ length: 3 }, () => [0, 0, 0]), T = [0, 0, 0]
  for (let i = 0; i < n; i++) {
    if (!(d[i] < h)) continue
    const r = d[i] / h, w = (1 - r * r * r) ** 3
    const u = (xs[i] - x0) / h, phi = [1, u, u * u]
    for (let a = 0; a < 3; a++) { T[a] += w * phi[a] * ys[i]; for (let b = 0; b < 3; b++) S[a][b] += w * phi[a] * phi[b] }
  }
  const b = solve3(S, T)
  return { value: b[0], slope: b[1] / h }
}

// 3x3 solve with partial pivoting; falls back to a lower-degree fit when the system is singular
function solve3(A, y) {
  const M = A.map((row, i) => [...row, y[i]])
  const n = 3
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    if (Math.abs(M[p][c]) < 1e-12 * (Math.abs(M[0][0]) || 1)) {
      // singular: drop the quadratic term (local linear) — only happens with fewer than 3 weighted points
      const A2 = [[A[0][0], A[0][1]], [A[1][0], A[1][1]]], det = A2[0][0] * A2[1][1] - A2[0][1] * A2[1][0]
      if (Math.abs(det) < 1e-12) return [y[0] / (A[0][0] || 1), 0, 0]
      return [(y[0] * A2[1][1] - A2[0][1] * y[1]) / det, (A2[0][0] * y[1] - y[0] * A2[1][0]) / det, 0]
    }
    ;[M[c], M[p]] = [M[p], M[c]]
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k] }
  }
  const x = [0, 0, 0]
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / M[r][r] }
  return x
}

export function loess(xs, ys, span, surface = 'interpolate', cell = 0.2) {
  const n = xs.length
  const q = Math.floor(n * span)
  if (surface === 'direct') return xs.map(x0 => localFit(xs, ys, x0, q).value)
  // k-d tree vertices (1-D); xs assumed sorted ascending (the app's periods are)
  const lo = Math.min(...xs), hi = Math.max(...xs)
  const mu = 0.005 * Math.max(hi - lo, 1e-10 * Math.max(Math.abs(lo), Math.abs(hi)) + 1e-30)
  const vertices = [lo - mu, hi + mu]
  const fc = Math.floor(n * span * cell)
  // ehg124: a cell (points l..u, bounds vlo..vhi) is split at its median point x[m], m = (l + u) / 2
  // (Fortran integer division, 1-based); it stays a leaf if it has <= fc points or if x[m] lies on one of
  // its own bounds
  const split = (l, u, vlo, vhi) => {     // 0-based inclusive point index range
    if (u - l + 1 <= fc) return
    const m = Math.floor((l + u) / 2)
    const t = xs[m]
    if (t === vlo || t === vhi) return
    vertices.push(t)
    split(l, m, vlo, t); split(m + 1, u, t, vhi)
  }
  split(0, n - 1, vertices[0], vertices[1])
  vertices.sort((a, b) => a - b)
  const fits = vertices.map(v => localFit(xs, ys, v, q))
  return xs.map(x => {
    let k = 0; while (k < vertices.length - 2 && x > vertices[k + 1]) k++
    const v0 = vertices[k], v1 = vertices[k + 1], h = v1 - v0, t = (x - v0) / h
    const f0 = fits[k].value, f1 = fits[k + 1].value, s0 = fits[k].slope, s1 = fits[k + 1].slope
    const phi0 = (1 - t) ** 2 * (1 + 2 * t), phi1 = t * t * (3 - 2 * t), psi0 = t * (1 - t) ** 2, psi1 = -t * t * (1 - t)
    return phi0 * f0 + phi1 * f1 + (psi0 * s0 + psi1 * s1) * h
  })
}

// the app's smoothing (R chronoNgrams): span 0.1 = no smoothing; NA -> 0; negative fitted values -> 0
export function smoothSeries(periods, values, span) {
  if (span <= 0.1) return values
  const y = values.map(v => (Number.isFinite(v) ? v : 0))
  return loess(periods, y, span).map(v => (v < 0 ? 0 : v))
}
