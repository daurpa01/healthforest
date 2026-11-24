/** Special functions used by distributions. Coefficients are the standard Lanczos / Acklam constants. */

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843696540789e-6, 1.5056327351493116e-7,
]

export function lgamma(z: number): number {
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z)
  }
  let x = LANCZOS[0]
  const zg = z - 1
  for (let i = 1; i < LANCZOS.length; i++) x += LANCZOS[i] / (zg + i)
  const t = zg + LANCZOS.length - 1.5
  return 0.5 * Math.log(2 * Math.PI) + (zg + 0.5) * Math.log(t) - t + Math.log(x)
}

export function betacf(a: number, b: number, x: number): number {
  const MAX = 200
  const EPS = 3e-12
  const qab = a + b
  const qap = a + 1
  const qam = a - 1
  let c = 1
  let d = 1 - (qab * x) / qap
  if (Math.abs(d) < 1e-30) d = 1e-30
  d = 1 / d
  let h = d
  for (let m = 1; m <= MAX; m++) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < 1e-30) d = 1e-30
    c = 1 + aa / c
    if (Math.abs(c) < 1e-30) c = 1e-30
    d = 1 / d
    h *= d * c
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2))
    d = 1 + aa * d
    if (Math.abs(d) < 1e-30) d = 1e-30
    c = 1 + aa / c
    if (Math.abs(c) < 1e-30) c = 1e-30
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < EPS) break
  }
  return h
}

export function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const lnBeta = lgamma(a) + lgamma(b) - lgamma(a + b)
  if (x < (a + 1) / (a + b + 2)) {
    const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnBeta) / a
    return front * betacf(a, b, x)
  }
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnBeta) / b
  return 1 - front * betacf(b, a, 1 - x)
}

/** Lower regularized gamma P(s, x). */
export function gammaP(s: number, x: number): number {
  if (x <= 0) return 0
  if (x < s + 1) {
    let sum = 1 / s
    let term = 1 / s
    for (let n = 1; n < 400; n++) {
      term *= x / (s + n)
      sum += term
      if (Math.abs(term) < Math.abs(sum) * 1e-14) break
    }
    return sum * Math.exp(-x + s * Math.log(x) - lgamma(s))
  }
  let b = x + 1 - s
  let c = 1 / 1e-30
  let d = 1 / b
  let h = d
  for (let i = 1; i <= 400; i++) {
    const an = -i * (i - s)
    b += 2
    d = an * d + b
    if (Math.abs(d) < 1e-30) d = 1e-30
    c = b + an / c
    if (Math.abs(c) < 1e-30) c = 1e-30
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < 1e-12) break
  }
  const q = Math.exp(-x + s * Math.log(x) - lgamma(s)) * h
  return Math.min(1, Math.max(0, 1 - q))
}

export function gammaPInv(shape: number, p: number): number {
  if (p <= 0) return 0
  if (p >= 1) return Infinity
  let lo = 0
  let hi = Math.max(1, shape * 2)
  let guard = 0
  while (gammaP(shape, hi) < p && guard < 80) {
    hi *= 2
    guard++
  }
  for (let i = 0; i < 80; i++) {
    const mid = 0.5 * (lo + hi)
    if (gammaP(shape, mid) < p) lo = mid
    else hi = mid
  }
  return 0.5 * (lo + hi)
}

export function betaInv(p: number, a: number, b: number): number {
  if (p <= 0) return 0
  if (p >= 1) return 1
  let lo = 0
  let hi = 1
  for (let i = 0; i < 80; i++) {
    const mid = 0.5 * (lo + hi)
    if (regularizedBeta(mid, a, b) < p) lo = mid
    else hi = mid
  }
  return 0.5 * (lo + hi)
}

/** Acklam's rational approximation of the standard normal quantile. */
export function normalInv(p: number): number {
  if (p <= 0) return -Infinity
  if (p >= 1) return Infinity
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1,
    2.506628277459239,
  ]
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1]
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968,
    2.938163982698783,
  ]
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]
  const plow = 0.02425
  const phigh = 1 - plow
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    )
  }
  if (p > phigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p))
    return (
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    )
  }
  const q = p - 0.5
  const r = q * q
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  )
}

/** Abramowitz and Stegun 26.2.17. */
export function normalCdf(x: number): number {
  const ax = Math.abs(x)
  const t = 1 / (1 + 0.2316419 * ax)
  const d = 0.3989422804014327 * Math.exp(-0.5 * x * x)
  const p =
    d *
    t *
    (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  return x >= 0 ? 1 - p : p
}

export function cholesky(matrix: number[][]): number[][] {
  const n = matrix.length
  const L = Array.from({ length: n }, () => Array(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0
      for (let k = 0; k < j; k++) sum += L[i][k] * L[j][k]
      if (i === j) {
        const v = matrix[i][i] - sum
        if (v <= 1e-12) {
          throw new Error('correlation-not-positive')
        }
        L[i][j] = Math.sqrt(Math.max(v, 0))
      } else {
        L[i][j] = (matrix[i][j] - sum) / L[j][j]
      }
    }
  }
  return L
}

export function clamp01(u: number): number {
  if (u <= 1e-12) return 1e-12
  if (u >= 1 - 1e-12) return 1 - 1e-12
  return u
}
