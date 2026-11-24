import { EngineError } from './errors'
import type { Rng } from './prng'
import { betaInv, cholesky, clamp01, gammaPInv, lgamma, normalCdf, normalInv } from './stats'
import type { DistributionSpec, DistType } from './types'

export interface Marginal {
  type: DistType
  args: number[]
  table?: { value: number; p: number }[]
}

export function distributionMean(spec: DistributionSpec, args: number[]): number {
  const table = normalizeTable(spec)
  switch (spec.type) {
    case 'normal':
      return arg(args, 0)
    case 'uniform':
      return (arg(args, 0) + arg(args, 1)) / 2
    case 'triangular':
      return (arg(args, 0) + arg(args, 1) + arg(args, 2)) / 3
    case 'beta':
      return arg(args, 0) / (arg(args, 0) + arg(args, 1))
    case 'gamma':
      return arg(args, 0) * arg(args, 1)
    case 'gammaMeanSd':
      return arg(args, 0)
    case 'lognormal':
      return Math.exp(arg(args, 0) + (arg(args, 1) * arg(args, 1)) / 2)
    case 'lognormalMeanSd':
      return arg(args, 0)
    case 'exponential':
      return 1 / arg(args, 0)
    case 'pert': {
      const [min, mode, max] = args
      return (min + 4 * mode + max) / 6
    }
    case 'poisson':
      return arg(args, 0)
    case 'weibull':
      return arg(args, 1) * Math.exp(lgamma(1 + 1 / arg(args, 0)))
    case 'table': {
      if (!table.length) return 0
      return table.reduce((s, row) => s + row.value * row.p, 0)
    }
    default:
      return arg(args, 0)
  }
}

export function sampleDistribution(spec: DistributionSpec, args: number[], rng: Rng): number {
  return sampleMarginal({ type: spec.type, args, table: normalizeTable(spec) }, rng)
}

export function sampleMarginal(m: Marginal, rng: Rng): number {
  return inverseMarginal(m, rng())
}

export function inverseMarginal(m: Marginal, uRaw: number): number {
  const u = clamp01(uRaw)
  const a = m.args
  switch (m.type) {
    case 'uniform':
      return a[0] + u * (a[1] - a[0])
    case 'normal':
      return a[0] + a[1] * normalInv(u)
    case 'lognormal':
      return Math.exp(a[0] + a[1] * normalInv(u))
    case 'lognormalMeanSd': {
      const { mu, sigma } = lognormalFromMeanSd(a[0], a[1])
      return Math.exp(mu + sigma * normalInv(u))
    }
    case 'triangular':
      return triangularInv(u, a[0], a[1], a[2])
    case 'beta':
      return betaInv(u, a[0], a[1])
    case 'gamma':
      return gammaPInv(a[0], u) * a[1]
    case 'gammaMeanSd': {
      const { shape, scale } = gammaFromMeanSd(a[0], a[1])
      return gammaPInv(shape, u) * scale
    }
    case 'exponential':
      return -Math.log(1 - u) / a[0]
    case 'pert': {
      const [min, mode, max] = a
      const span = max - min
      if (span <= 0) return min
      const alpha = 1 + (4 * (mode - min)) / span
      const beta = 1 + (4 * (max - mode)) / span
      return min + span * betaInv(u, alpha, beta)
    }
    case 'poisson':
      return poissonInv(u, a[0])
    case 'weibull':
      return a[1] * Math.pow(-Math.log(1 - u), 1 / a[0])
    case 'table':
      return tableInv(m.table ?? [], u)
    default:
      throw new EngineError('unknown-distribution', m.type)
  }
}

export function sampleStandardNormal(rng: Rng): number {
  // Box-Muller, consuming two uniforms so the stream stays deterministic.
  let u = 0
  let v = 0
  while (u <= 1e-12) u = rng()
  v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

export function sampleMultivariateNormal(means: number[], covariance: number[][], rng: Rng): number[] {
  const L = cholesky(covariance)
  const z = means.map(() => sampleStandardNormal(rng))
  return means.map((mean, i) => mean + L[i].reduce((s, l, k) => s + l * z[k], 0))
}

export function correlationToCovariance(sds: number[], correlation: number[][]): number[][] {
  return correlation.map((row, i) => row.map((c, j) => c * sds[i] * sds[j]))
}

export function sampleGaussianCopula(marginals: Marginal[], correlation: number[][], rng: Rng): number[] {
  const z = marginals.map(() => sampleStandardNormal(rng))
  const L = cholesky(correlation)
  return marginals.map((m, i) => {
    const zc = L[i].reduce((s, l, k) => s + l * z[k], 0)
    return inverseMarginal(m, normalCdf(zc))
  })
}

export function sampleGamma(rng: Rng, shape: number, scale = 1): number {
  if (!(shape > 0) || !(scale > 0)) throw new EngineError('distribution-parameter', 'gamma')
  if (shape < 1) {
    return sampleGamma(rng, shape + 1, scale) * Math.pow(rng(), 1 / shape)
  }
  const d = shape - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  for (;;) {
    let x = 0
    let v = 0
    do {
      x = sampleStandardNormal(rng)
      v = 1 + c * x
    } while (v <= 0)
    v = v * v * v
    const u = rng()
    if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v * scale
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * scale
  }
}

export function sampleDirichlet(alphas: number[], rng: Rng): number[] {
  const draws = alphas.map((alpha) => sampleGamma(rng, alpha, 1))
  const sum = draws.reduce((s, v) => s + v, 0)
  if (sum <= 0) return alphas.map(() => 1 / alphas.length)
  return draws.map((v) => v / sum)
}

export function gammaFromMeanSd(mean: number, sd: number): { shape: number; scale: number } {
  if (mean <= 0 || sd <= 0) throw new EngineError('distribution-parameter', 'gamma')
  const shape = (mean * mean) / (sd * sd)
  const scale = (sd * sd) / mean
  return { shape, scale }
}

export function lognormalFromMeanSd(mean: number, sd: number): { mu: number; sigma: number } {
  if (mean <= 0 || sd <= 0) throw new EngineError('distribution-parameter', 'lognormal')
  const v = Math.log(1 + (sd * sd) / (mean * mean))
  const sigma = Math.sqrt(v)
  const mu = Math.log(mean) - v / 2
  return { mu, sigma }
}

function arg(args: number[], i: number): number {
  const v = args[i]
  if (v === undefined || Number.isNaN(v)) throw new EngineError('distribution-parameter')
  return v
}

function triangularInv(u: number, min: number, mode: number, max: number): number {
  if (max <= min) return min
  const f = (mode - min) / (max - min)
  if (u < f) return min + Math.sqrt(u * (max - min) * (mode - min))
  return max - Math.sqrt((1 - u) * (max - min) * (max - mode))
}

function poissonInv(u: number, lambda: number): number {
  if (lambda < 0) throw new EngineError('distribution-parameter', 'poisson')
  if (lambda === 0) return 0
  const target = u
  let k = 0
  let p = Math.exp(-lambda)
  let cdf = p
  while (cdf < target && k < lambda + 20 * Math.sqrt(lambda) + 40) {
    k++
    p *= lambda / k
    cdf += p
  }
  return k
}

function tableInv(rows: { value: number; p: number }[], u: number): number {
  if (!rows.length) return 0
  let acc = 0
  for (const row of rows) {
    acc += row.p
    if (u <= acc) return row.value
  }
  return rows[rows.length - 1].value
}

function normalizeTable(spec: DistributionSpec): { value: number; p: number }[] {
  if (spec.type !== 'table') return []
  const rows = spec.table ?? []
  if (!rows.length) return []
  const weights = rows.map((r) => (r.p === undefined ? 1 : r.p))
  const sum = weights.reduce((s, w) => s + w, 0)
  if (sum <= 0) throw new EngineError('distribution-parameter', 'table')
  return rows.map((r, i) => ({ value: r.value, p: weights[i] / sum }))
}

export function marginalOf(spec: DistributionSpec, args: number[]): Marginal {
  return { type: spec.type, args, table: normalizeTable(spec) }
}
