import { analyzeCea } from './cea'
import { netMonetaryBenefit } from './payoffs'
import { rollback, type StrategyValue } from './tree'
import type { HealthModel } from './types'

export type OutcomeKind = 'cost' | 'effect' | 'nmb' | 'icer'

export interface OneWayPoint {
  x: number
  values: Record<string, number>
}

export function oneWay(
  model: HealthModel,
  variable: string,
  low: number,
  high: number,
  steps: number,
  outcome: OutcomeKind,
  strategyId?: string,
): OneWayPoint[] {
  const count = Math.max(2, steps)
  const points: OneWayPoint[] = []
  for (let i = 0; i < count; i++) {
    const x = low + ((high - low) * i) / (count - 1)
    points.push({ x, values: outcomesAt(model, { [variable]: x }, outcome, strategyId) })
  }
  return points
}

export interface TornadoBar {
  variable: string
  low: number
  high: number
  atLow: number
  atHigh: number
  swing: number
}

export function tornado(model: HealthModel, outcome: OutcomeKind, strategyId?: string): TornadoBar[] {
  const bars: TornadoBar[] = []
  for (const variable of model.variables) {
    if (variable.low === undefined || variable.high === undefined) continue
    const atLow = single(model, { [variable.name]: variable.low }, outcome, strategyId)
    const atHigh = single(model, { [variable.name]: variable.high }, outcome, strategyId)
    bars.push({
      variable: variable.name,
      low: variable.low,
      high: variable.high,
      atLow,
      atHigh,
      swing: Math.abs(atHigh - atLow),
    })
  }
  return bars.sort((a, b) => b.swing - a.swing)
}

export interface TwoWayCell {
  x: number
  y: number
  value: number
  bestId: string
}

export function twoWay(
  model: HealthModel,
  xName: string,
  xLow: number,
  xHigh: number,
  yName: string,
  yLow: number,
  yHigh: number,
  steps: number,
  outcome: OutcomeKind,
  strategyId?: string,
): TwoWayCell[] {
  const count = Math.max(2, steps)
  const cells: TwoWayCell[] = []
  for (let i = 0; i < count; i++) {
    const x = xLow + ((xHigh - xLow) * i) / (count - 1)
    for (let j = 0; j < count; j++) {
      const y = yLow + ((yHigh - yLow) * j) / (count - 1)
      const result = rollback(model, { fixed: { [xName]: x, [yName]: y } })
      const cea = analyzeCea(result.strategies, model.preferences)
      const focus = strategyId ?? cea.optimalId
      cells.push({
        x,
        y,
        value: readOutcome(result.strategies, cea, focus, outcome, model.preferences.wtp),
        bestId: cea.optimalId,
      })
    }
  }
  return cells
}

export function threshold(
  model: HealthModel,
  variable: string,
  low: number,
  high: number,
  strategyA: string,
  strategyB: string,
  steps = 40,
): number | null {
  const points = oneWay(model, variable, low, high, steps, 'nmb')
  for (let i = 1; i < points.length; i++) {
    const prev = (points[i - 1].values[strategyA] ?? 0) - (points[i - 1].values[strategyB] ?? 0)
    const next = (points[i].values[strategyA] ?? 0) - (points[i].values[strategyB] ?? 0)
    if (prev === 0) return points[i - 1].x
    if (prev > 0 !== next > 0) {
      const span = next - prev
      const t = span === 0 ? 0 : (0 - prev) / span
      return points[i - 1].x + t * (points[i].x - points[i - 1].x)
    }
  }
  return null
}

function outcomesAt(model: HealthModel, fixed: Record<string, number>, outcome: OutcomeKind, strategyId?: string): Record<string, number> {
  const result = rollback(model, { fixed })
  const cea = analyzeCea(result.strategies, model.preferences)
  const values: Record<string, number> = {}
  for (const strategy of result.strategies) {
    values[strategy.id] = readOutcome(result.strategies, cea, strategyId ?? strategy.id, outcome, model.preferences.wtp, strategy.id)
  }
  return values
}

function single(model: HealthModel, fixed: Record<string, number>, outcome: OutcomeKind, strategyId?: string): number {
  const result = rollback(model, { fixed })
  const cea = analyzeCea(result.strategies, model.preferences)
  const focus = strategyId ?? cea.optimalId
  return readOutcome(result.strategies, cea, focus, outcome, model.preferences.wtp)
}

function readOutcome(
  strategies: StrategyValue[],
  cea: ReturnType<typeof analyzeCea>,
  focus: string,
  outcome: OutcomeKind,
  wtp: number,
  rowId = focus,
): number {
  const strategy = strategies.find((item) => item.id === rowId) ?? strategies.find((item) => item.id === focus)
  if (!strategy) return 0
  if (outcome === 'cost') return strategy.cost
  if (outcome === 'effect') return strategy.effect
  if (outcome === 'nmb') return netMonetaryBenefit(strategy.effect, strategy.cost, wtp)
  const row = cea.strategies.find((item) => item.id === strategy.id)
  return row?.icer ?? row?.icerVsReference ?? 0
}
