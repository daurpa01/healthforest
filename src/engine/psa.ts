import { netMonetaryBenefit } from './payoffs'
import { mulberry32, spawnSeed } from './prng'
import { compileScope, drawForRates, withKeywords, withOverrides } from './scope'
import { rollback } from './tree'
import type { HealthModel } from './types'

export interface TrialStrategy {
  id: string
  name: string
  cost: number
  effect: number
}

export interface PSATrial {
  index: number
  strategies: TrialStrategy[]
  parameters: Record<string, number>
}

export interface PSASummary {
  trials: number
  referenceId: string
  strategies: {
    id: string
    name: string
    meanCost: number
    meanEffect: number
    sdCost: number
    sdEffect: number
    meanNmb: number
  }[]
  ceac: { wtp: number; probability: Record<string, number> }[]
  ceaf: { wtp: number; strategyId: string; probability: number }[]
  evpi: { wtp: number; value: number }[]
  scatter: { strategyId: string; incrementalCost: number; incrementalEffect: number }[]
  convergence: { n: number; meanIncrementalCost: number; meanIncrementalEffect: number }[]
  incrementalStats: {
    strategyId: string
    meanIncrementalCost: number
    meanIncrementalEffect: number
    medianIcer: number | null
    probabilityCostEffective: number
  }[]
}

export interface PSAOptions {
  trials: number
  seed: number
  wtpGrid?: number[]
  markovMode?: 'cohort' | 'microsim'
  microsimN?: number
  onTrial?: (index: number, trial: PSATrial) => void
}

export function runPSA(model: HealthModel, options: PSAOptions): { trials: PSATrial[]; summary: PSASummary } {
  const trials = collectTrials(model, options)
  const grid = options.wtpGrid ?? defaultGrid(model.preferences.wtpMin, model.preferences.wtpMax)
  return { trials, summary: summarizePSA(trials, grid, model.preferences.wtp, model.preferences.referenceStrategyId) }
}

export function collectTrials(model: HealthModel, options: PSAOptions): PSATrial[] {
  const rng = mulberry32(options.seed >>> 0)
  const base = compileScope(model)
  const once = drawForRates(model, ['once'], rng, base)
  const trials: PSATrial[] = []
  const n = Math.max(1, Math.floor(options.trials))
  for (let index = 0; index < n; index++) {
    const trialScope = withOverrides(base, once)
    const drawn = drawForRates(model, ['trial'], rng, trialScope)
    const parameters = { ...once, ...drawn }
    const scope = withKeywords(withOverrides(base, parameters), { _trial: index })
    const result = rollback(model, {
      scope,
      markovMode: options.markovMode ?? 'cohort',
      microsimN: options.microsimN ?? model.preferences.microsimN,
      microsimSeed: spawnSeed(rng),
    })
    const trial: PSATrial = {
      index,
      parameters,
      strategies: result.strategies.map((strategy) => ({
        id: strategy.id,
        name: strategy.name,
        cost: strategy.cost,
        effect: strategy.effect,
      })),
    }
    trials.push(trial)
    options.onTrial?.(index, trial)
  }
  return trials
}

export function summarizePSA(trials: PSATrial[], wtpGrid: number[], wtp: number, referenceId?: string): PSASummary {
  if (!trials.length) {
    return {
      trials: 0,
      referenceId: referenceId ?? '',
      strategies: [],
      ceac: [],
      ceaf: [],
      evpi: [],
      scatter: [],
      convergence: [],
      incrementalStats: [],
    }
  }
  const names = trials[0].strategies
  const ref = names.find((strategy) => strategy.id === referenceId) ?? names[0]
  const strategies = names.map((strategy) => {
    const costs = trials.map((trial) => valueOf(trial, strategy.id).cost)
    const effects = trials.map((trial) => valueOf(trial, strategy.id).effect)
    const nmb = trials.map((trial) => {
      const row = valueOf(trial, strategy.id)
      return netMonetaryBenefit(row.effect, row.cost, wtp)
    })
    return {
      id: strategy.id,
      name: strategy.name,
      meanCost: mean(costs),
      meanEffect: mean(effects),
      sdCost: sampleSd(costs),
      sdEffect: sampleSd(effects),
      meanNmb: mean(nmb),
    }
  })
  const ceac = wtpGrid.map((threshold) => ({ wtp: threshold, probability: acceptability(trials, threshold) }))
  const ceaf = ceac.map((row) => {
    const best = strategies
      .map((strategy) => ({
        id: strategy.id,
        nmb: mean(trials.map((trial) => {
          const value = valueOf(trial, strategy.id)
          return netMonetaryBenefit(value.effect, value.cost, row.wtp)
        })),
      }))
      .sort((a, b) => b.nmb - a.nmb || names.findIndex((item) => item.id === a.id) - names.findIndex((item) => item.id === b.id))[0]
    return { wtp: row.wtp, strategyId: best?.id ?? '', probability: row.probability[best?.id ?? ''] ?? 0 }
  })
  const evpi = wtpGrid.map((threshold) => ({ wtp: threshold, value: expectedValueOfPerfectInformation(trials, threshold) }))
  const scatter = trials.flatMap((trial) =>
    trial.strategies
      .filter((strategy) => strategy.id !== ref.id)
      .map((strategy) => ({
        strategyId: strategy.id,
        incrementalCost: strategy.cost - valueOf(trial, ref.id).cost,
        incrementalEffect: strategy.effect - valueOf(trial, ref.id).effect,
      })),
  )
  const convergence: PSASummary['convergence'] = []
  let costAcc = 0
  let effectAcc = 0
  const step = Math.max(1, Math.floor(trials.length / 200))
  trials.forEach((trial, index) => {
    const focus = trial.strategies.find((strategy) => strategy.id !== ref.id) ?? trial.strategies[0]
    const base = valueOf(trial, ref.id)
    costAcc += focus.cost - base.cost
    effectAcc += focus.effect - base.effect
    if (index % step === 0 || index === trials.length - 1) {
      convergence.push({
        n: index + 1,
        meanIncrementalCost: costAcc / (index + 1),
        meanIncrementalEffect: effectAcc / (index + 1),
      })
    }
  })
  const incrementalStats = names
    .filter((strategy) => strategy.id !== ref.id)
    .map((strategy) => {
      const dCost = trials.map((trial) => valueOf(trial, strategy.id).cost - valueOf(trial, ref.id).cost)
      const dEffect = trials.map((trial) => valueOf(trial, strategy.id).effect - valueOf(trial, ref.id).effect)
      const icers = dCost
        .map((cost, index) => (dEffect[index] > 1e-8 ? cost / dEffect[index] : null))
        .filter((value): value is number => value !== null)
        .sort((a, b) => a - b)
      return {
        strategyId: strategy.id,
        meanIncrementalCost: mean(dCost),
        meanIncrementalEffect: mean(dEffect),
        medianIcer: icers.length ? icers[Math.floor((icers.length - 1) / 2)] : null,
        probabilityCostEffective: acceptability(trials, wtp)[strategy.id] ?? 0,
      }
    })
  return {
    trials: trials.length,
    referenceId: ref.id,
    strategies,
    ceac,
    ceaf,
    evpi,
    scatter,
    convergence,
    incrementalStats,
  }
}

export function evppiBinned(parameter: number[], nmb: number[][], bins = 20): number {
  const n = parameter.length
  if (!n || !nmb.length) return 0
  const order = parameter.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value)
  const count = nmb[0].length
  const overall = Array(count).fill(0)
  for (const row of nmb) row.forEach((value, index) => (overall[index] += value))
  for (let index = 0; index < count; index++) overall[index] /= n
  const groups = Math.max(1, Math.min(bins, n))
  const size = Math.ceil(n / groups)
  let acc = 0
  for (let group = 0; group < groups; group++) {
    const slice = order.slice(group * size, Math.min(n, (group + 1) * size))
    if (!slice.length) continue
    const means = Array(count).fill(0)
    for (const item of slice) {
      for (let s = 0; s < count; s++) means[s] += nmb[item.index][s]
    }
    for (let s = 0; s < count; s++) means[s] /= slice.length
    acc += Math.max(...means) * slice.length
  }
  return acc / n - Math.max(...overall)
}

export function evppiNested(
  model: HealthModel,
  parameter: string,
  outer: number,
  inner: number,
  seed: number,
  wtp = model.preferences.wtp,
): number {
  const rng = mulberry32(seed >>> 0)
  const base = compileScope(model)
  let maxMean = -Infinity
  const strategyTotals: number[] = []
  let expectedMax = 0
  let used = 0
  for (let o = 0; o < outer; o++) {
    const outerDraw = drawForRates(model, ['trial'], rng, base)
    const fixed = outerDraw[parameter]
    if (fixed === undefined) continue
    const totals = new Map<string, number>()
    for (let i = 0; i < inner; i++) {
      const innerDraw = drawForRates(model, ['trial'], rng, withOverrides(base, { [parameter]: fixed }))
      innerDraw[parameter] = fixed
      const result = rollback(model, { scope: withOverrides(base, innerDraw) })
      for (const strategy of result.strategies) {
        const nmb = netMonetaryBenefit(strategy.effect, strategy.cost, wtp)
        totals.set(strategy.id, (totals.get(strategy.id) ?? 0) + nmb)
      }
    }
    const means = [...totals.values()].map((value) => value / inner)
    if (!means.length) continue
    expectedMax += Math.max(...means)
    means.forEach((value, index) => {
      strategyTotals[index] = (strategyTotals[index] ?? 0) + value
    })
    used++
  }
  if (!used) return 0
  const overall = strategyTotals.map((value) => value / used)
  maxMean = Math.max(...overall)
  return expectedMax / used - maxMean
}

export function acceptability(trials: PSATrial[], wtp: number): Record<string, number> {
  const counts: Record<string, number> = {}
  const ids = trials[0]?.strategies.map((strategy) => strategy.id) ?? []
  for (const id of ids) counts[id] = 0
  for (const trial of trials) {
    const scored = trial.strategies.map((strategy) => ({ id: strategy.id, nmb: netMonetaryBenefit(strategy.effect, strategy.cost, wtp) }))
    const best = Math.max(...scored.map((row) => row.nmb))
    const winners = scored.filter((row) => Math.abs(row.nmb - best) <= 1e-8)
    for (const winner of winners) counts[winner.id] += 1 / winners.length
  }
  const n = trials.length || 1
  for (const id of ids) counts[id] /= n
  return counts
}

export function expectedValueOfPerfectInformation(trials: PSATrial[], wtp: number): number {
  if (!trials.length) return 0
  const ids = trials[0].strategies.map((strategy) => strategy.id)
  const means = ids.map((id) => mean(trials.map((trial) => {
    const row = valueOf(trial, id)
    return netMonetaryBenefit(row.effect, row.cost, wtp)
  })))
  const meanOfMax = mean(
    trials.map((trial) => Math.max(...trial.strategies.map((strategy) => netMonetaryBenefit(strategy.effect, strategy.cost, wtp)))),
  )
  return meanOfMax - Math.max(...means)
}

function valueOf(trial: PSATrial, id: string): TrialStrategy {
  const found = trial.strategies.find((strategy) => strategy.id === id)
  if (!found) throw new Error(`missing strategy ${id}`)
  return found
}

function mean(values: number[]): number {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function sampleSd(values: number[]): number {
  if (values.length < 2) return 0
  const mu = mean(values)
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mu) ** 2, 0) / (values.length - 1))
}

function defaultGrid(min: number, max: number): number[] {
  const steps = 21
  const lo = Math.min(min, max)
  const hi = Math.max(min, max)
  return Array.from({ length: steps }, (_, index) => lo + ((hi - lo) * index) / (steps - 1))
}

export function strategyNmbTable(trials: PSATrial[], wtp: number): number[][] {
  return trials.map((trial) => trial.strategies.map((strategy) => netMonetaryBenefit(strategy.effect, strategy.cost, wtp)))
}
