import { sampleDistribution } from './distributions'
import { mulberry32 } from './prng'
import type { BiaModel, BiaStrategy, DistributionSpec, UptakeShape } from './types'

export interface BiaYear {
  year: number
  population: number
  incident: number
  currentCost: number
  newCost: number
  impact: number
  cumulative: number
  discountedImpact: number
  discountedCumulative: number
  currentByStrategy: number[]
  newByStrategy: number[]
}

export interface BiaResult {
  years: BiaYear[]
  cumulativeImpact: number
  discountedCumulativeImpact: number
  totalCurrent: number
  totalNew: number
}

export interface MixTarget {
  start: number
  end: number
  shape: Exclude<UptakeShape, 'manual'>
}

export function mixOverTime(horizon: number, targets: MixTarget[], forceOne: boolean): number[][] {
  const years = Math.max(1, horizon)
  const rows: number[][] = []
  for (let year = 0; year < years; year++) {
    const row = targets.map((target) => curve(target.shape, year, years, target.start, target.end))
    rows.push(forceOne ? renormalize(row) : row)
  }
  return rows
}

/** New intervention takes share from the others in proportion to a baseline mix. */
export function displace(baseline: number[], incomingIndex: number, share: number): number[] {
  const next = baseline.map((value, index) => (index === incomingIndex ? 0 : value))
  const others = next.reduce((sum, value) => sum + value, 0)
  const room = Math.max(0, 1 - share)
  return next.map((value, index) => (index === incomingIndex ? share : others > 0 ? (value / others) * room : 0))
}

export function runBia(bia: BiaModel): BiaResult {
  const horizon = Math.max(1, Math.floor(bia.horizonYears))
  const strategies = bia.strategies
  const years: BiaYear[] = []
  let cumulative = 0
  let discountedCumulative = 0
  const startersCurrent: number[][] = []
  const startersNew: number[][] = []
  for (let year = 0; year < horizon; year++) {
    const incident = bia.basePopulation * Math.pow(1 + bia.growthRate, year) * bia.eligibleFraction
    const currentShares = shareRow(bia.currentShares, year, strategies.length, bia.forceSharesToOne)
    const newShares = shareRow(bia.newShares, year, strategies.length, bia.forceSharesToOne)
    let population = incident
    let currentBy = strategies.map(() => 0)
    let newBy = strategies.map(() => 0)
    if (bia.populationMode === 'prevalence') {
      population = incident
      currentBy = strategies.map((strategy, index) => population * currentShares[index] * strategy.annualCost)
      newBy = strategies.map((strategy, index) => population * newShares[index] * strategy.annualCost)
    } else {
      startersCurrent.push(currentShares.map((share) => incident * share))
      startersNew.push(newShares.map((share) => incident * share))
      currentBy = stockCost(startersCurrent, strategies, year, bia.treatmentDuration)
      newBy = stockCost(startersNew, strategies, year, bia.treatmentDuration)
      population = stockSize(startersNew, year, bia.treatmentDuration)
    }
    const currentCost = sum(currentBy)
    const newCost = sum(newBy)
    const impact = newCost - currentCost
    const factor = bia.discountRate ? 1 / Math.pow(1 + bia.discountRate, year) : 1
    cumulative += impact
    discountedCumulative += impact * factor
    years.push({
      year,
      population,
      incident,
      currentCost,
      newCost,
      impact,
      cumulative,
      discountedImpact: impact * factor,
      discountedCumulative,
      currentByStrategy: currentBy,
      newByStrategy: newBy,
    })
  }
  return {
    years,
    cumulativeImpact: cumulative,
    discountedCumulativeImpact: discountedCumulative,
    totalCurrent: sum(years.map((year) => year.currentCost)),
    totalNew: sum(years.map((year) => year.newCost)),
  }
}

export function biaOneWay(bia: BiaModel, parameter: string, low: number, high: number, steps = 7): { x: number; cumulative: number }[] {
  const count = Math.max(2, steps)
  const points: { x: number; cumulative: number }[] = []
  for (let i = 0; i < count; i++) {
    const x = low + ((high - low) * i) / (count - 1)
    points.push({ x, cumulative: runBia(applyBiaOverride(bia, parameter, x)).cumulativeImpact })
  }
  return points
}

export function biaPsa(
  bia: BiaModel,
  trials: number,
  seed: number,
  onTrial?: (index: number, total: number) => void,
): { samples: number[]; mean: number; sd: number; p2_5: number; p97_5: number } {
  const rng = mulberry32(seed >>> 0)
  const samples: number[] = []
  const n = Math.max(1, Math.floor(trials))
  for (let i = 0; i < n; i++) {
    let next = bia
    for (const item of bia.uncertain) {
      const draw = sampleDistribution(item.distribution, numericArgs(item.distribution), rng)
      next = applyBiaOverride(next, item.parameter, draw)
    }
    samples.push(runBia(next).cumulativeImpact)
    if (i % 10 === 0) onTrial?.(i, n)
  }
  const sorted = [...samples].sort((a, b) => a - b)
  const mu = samples.reduce((sum, value) => sum + value, 0) / samples.length
  const sd = samples.length < 2 ? 0 : Math.sqrt(samples.reduce((sum, value) => sum + (value - mu) ** 2, 0) / (samples.length - 1))
  return { samples, mean: mu, sd, p2_5: quantile(sorted, 0.025), p97_5: quantile(sorted, 0.975) }
}

export function applyBiaOverride(bia: BiaModel, parameter: string, value: number): BiaModel {
  if (parameter === 'basePopulation') return { ...bia, basePopulation: value }
  if (parameter === 'growthRate') return { ...bia, growthRate: value }
  if (parameter === 'eligibleFraction') return { ...bia, eligibleFraction: value }
  if (parameter === 'discountRate') return { ...bia, discountRate: value }
  if (parameter.startsWith('cost:')) {
    const id = parameter.slice(5)
    return {
      ...bia,
      strategies: bia.strategies.map((strategy) => (strategy.id === id ? { ...strategy, annualCost: value } : strategy)),
    }
  }
  return bia
}

function stockCost(starters: number[][], strategies: BiaStrategy[], year: number, duration: number): number[] {
  return strategies.map((strategy, index) => {
    let patients = 0
    for (let age = 0; age < duration; age++) {
      const cohort = year - age
      if (cohort < 0) continue
      patients += starters[cohort]?.[index] ?? 0
    }
    return patients * strategy.annualCost
  })
}

function stockSize(starters: number[][], year: number, duration: number): number {
  let patients = 0
  for (let age = 0; age < duration; age++) {
    const cohort = year - age
    if (cohort < 0) continue
    patients += (starters[cohort] ?? []).reduce((sum, value) => sum + value, 0)
  }
  return patients
}

function shareRow(matrix: number[][], year: number, n: number, force: boolean): number[] {
  const source = matrix.length ? matrix[Math.min(year, matrix.length - 1)] : []
  const row = Array.from({ length: n }, (_, index) => source?.[index] ?? 0)
  return force ? renormalize(row) : row
}

function curve(shape: Exclude<UptakeShape, 'manual'>, year: number, horizon: number, start: number, end: number): number {
  const x = horizon <= 1 ? 1 : year / (horizon - 1)
  if (shape === 'linear') return start + (end - start) * x
  if (shape === 'exponential') {
    const k = 3
    const num = 1 - Math.exp(-k * x)
    const den = 1 - Math.exp(-k)
    return start + (end - start) * (num / den)
  }
  const k = 8
  const s = 1 / (1 + Math.exp(-k * (x - 0.5)))
  const s0 = 1 / (1 + Math.exp(k * 0.5))
  const s1 = 1 / (1 + Math.exp(-k * 0.5))
  const n = (s - s0) / (s1 - s0)
  return start + (end - start) * n
}

function renormalize(row: number[]): number[] {
  const total = row.reduce((sum, value) => sum + value, 0)
  if (total <= 0) return row.map(() => 0)
  return row.map((value) => value / total)
}

function sum(values: number[]): number {
  return values.reduce((acc, value) => acc + value, 0)
}

function quantile(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  const index = (sorted.length - 1) * p
  const lo = Math.floor(index)
  const hi = Math.ceil(index)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo)
}

function numericArgs(spec: DistributionSpec): number[] {
  return spec.args.map((arg) => Number(arg))
}
