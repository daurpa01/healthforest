import type { CohortCycleRow } from './markov'

export interface PeriodCost {
  period: number
  cost: number
  effect: number
  cycles: number[]
}

/**
 * Group a Markov cohort trace into calendar periods.
 * `cycleLength` and `periodLength` are in years. Half-cycle correction, when used,
 * changes the first and last period because those cycles carry half a state reward.
 */
export function costsByPeriod(cycles: CohortCycleRow[], cycleLength = 1, periodLength = 1): PeriodCost[] {
  const periods = new Map<number, PeriodCost>()
  for (const row of cycles) {
    const period = Math.floor((row.stage * cycleLength) / periodLength) + 1
    const current = periods.get(period) ?? { period, cost: 0, effect: 0, cycles: [] }
    current.cost += row.reward.cost ?? 0
    current.effect += row.reward.effect ?? 0
    current.cycles.push(row.stage)
    periods.set(period, current)
  }
  return [...periods.values()]
}

export function periodCsv(rows: PeriodCost[]): string {
  const lines = ['periodo,costo,efecto,ciclos']
  for (const row of rows) lines.push(`${row.period},${row.cost},${row.effect},"${row.cycles.join(' ')}"`)
  return lines.join('\n')
}
