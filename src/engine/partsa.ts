import type { PayoffMap } from './types'

export type SurvivalKind = 'exponential' | 'weibull' | 'lognormal'

export interface SurvivalCurve {
  kind: SurvivalKind
  /** Exponential rate, or Weibull shape, or lognormal mu. */
  a: number
  /** Weibull scale, or lognormal sigma. Ignored for the exponential. */
  b?: number
}

/** S(t) for a parametric time-to-event distribution. */
export function survival(curve: SurvivalCurve, time: number): number {
  const t = Math.max(0, time)
  if (curve.kind === 'exponential') return Math.exp(-curve.a * t)
  if (curve.kind === 'weibull') {
    const shape = curve.a
    const scale = curve.b ?? 1
    return Math.exp(-Math.pow(t / scale, shape))
  }
  const mu = curve.a
  const sigma = curve.b ?? 1
  if (t === 0) return 1
  return 1 - normalCdf((Math.log(t) - mu) / sigma)
}

export interface PartsaInput {
  pfs: SurvivalCurve
  os: SurvivalCurve
  cycles: number
  cycleLength: number
  /** Reward per year while progression-free, progressed, and dead. */
  rewards: { pf: PayoffMap; progressed: PayoffMap; dead: PayoffMap }
  discountRate: number
  payoffIds: string[]
}

export interface PartsaResult {
  cycles: { stage: number; pf: number; progressed: number; dead: number; cost: number; effect: number }[]
  total: PayoffMap
}

/** Area between the progression-free and overall survival curves, one row per period. */
export function runPartsa(input: PartsaInput): PartsaResult {
  const ids = input.payoffIds
  const total = zero(ids)
  const cycles = []
  for (let stage = 0; stage < input.cycles; stage++) {
    const t = (stage + 0.5) * input.cycleLength
    const pf = clamp01(survival(input.pfs, t))
    const alive = clamp01(survival(input.os, t))
    const progressed = Math.max(0, alive - pf)
    const dead = Math.max(0, 1 - alive)
    const factor = input.discountRate ? 1 / Math.pow(1 + input.discountRate, t) : 1
    const reward = zero(ids)
    addScaled(reward, input.rewards.pf, pf * input.cycleLength, ids)
    addScaled(reward, input.rewards.progressed, progressed * input.cycleLength, ids)
    addScaled(reward, input.rewards.dead, dead * input.cycleLength, ids)
    for (const id of ids) {
      reward[id] *= factor
      total[id] += reward[id]
    }
    cycles.push({ stage, pf, progressed, dead, cost: reward.cost ?? 0, effect: reward.effect ?? 0 })
  }
  return { cycles, total }
}

function zero(ids: string[]): PayoffMap {
  return Object.fromEntries(ids.map((id) => [id, 0]))
}

function addScaled(target: PayoffMap, source: PayoffMap, scale: number, ids: string[]) {
  for (const id of ids) target[id] += (source[id] ?? 0) * scale
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function normalCdf(x: number): number {
  const sign = x < 0 ? -1 : 1
  const z = Math.abs(x) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * z)
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z)
  return 0.5 * (1 + sign * y)
}
