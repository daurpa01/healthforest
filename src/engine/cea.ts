import { netHealthBenefit, netMonetaryBenefit } from './payoffs'
import type { DecisionRule, Preferences } from './types'
import type { StrategyValue } from './tree'

export type DominanceStatus = 'undominated' | 'strong' | 'extended' | 'reference'

export interface CeaStrategy extends StrategyValue {
  incrementalCost: number | null
  incrementalEffect: number | null
  icer: number | null
  incrementalCostVsReference: number | null
  incrementalEffectVsReference: number | null
  icerVsReference: number | null
  status: DominanceStatus
  dominatedBy?: string
  nmb: number
  nhb: number
  rank: number
  onFrontier: boolean
}

export interface CeaResult {
  wtp: number
  referenceId: string
  optimalId: string
  frontierIds: string[]
  strategies: CeaStrategy[]
}

const EPS = 1e-9

export function analyzeCea(strategies: StrategyValue[], preferences: Pick<Preferences, 'wtp' | 'decisionRule' | 'referenceStrategyId'>): CeaResult {
  const wtp = preferences.wtp
  const decorated = strategies.map((strategy) => ({ ...strategy }))
  const strong = new Map<string, string>()
  for (const strategy of decorated) {
    for (const other of decorated) {
      if (other.id === strategy.id) continue
      if (dominates(other, strategy)) {
        strong.set(strategy.id, other.name)
        break
      }
    }
  }
  let active = decorated
    .filter((strategy) => !strong.has(strategy.id))
    .sort((a, b) => a.effect - b.effect || a.cost - b.cost)
  const extended = new Set<string>()
  let guard = active.length + 2
  let changed = true
  while (changed && guard-- > 0) {
    changed = false
    for (let i = 1; i < active.length - 1; i++) {
      const prev = active[i - 1]
      const current = active[i]
      const next = active[i + 1]
      if (current.effect <= prev.effect + EPS) {
        active.splice(i, 1)
        extended.add(current.id)
        changed = true
        break
      }
      const dePrev = current.effect - prev.effect
      const deNext = next.effect - current.effect
      if (dePrev <= EPS || deNext <= EPS) continue
      const icerPrev = (current.cost - prev.cost) / dePrev
      const icerNext = (next.cost - current.cost) / deNext
      if (icerNext < icerPrev - 1e-8) {
        active.splice(i, 1)
        extended.add(current.id)
        changed = true
        break
      }
    }
  }
  const frontier = new Set(active.map((strategy) => strategy.id))
  const frontierOrder = active.slice()
  const reference = decorated.find((strategy) => strategy.id === preferences.referenceStrategyId) ?? decorated[0]
  const rows: CeaStrategy[] = decorated.map((strategy) => {
    const previous = previousFrontier(strategy, frontierOrder)
    const delta = previous ? diff(strategy, previous) : { cost: null, effect: null, icer: null }
    const versus = reference && reference.id !== strategy.id ? diff(strategy, reference) : { cost: null, effect: null, icer: null }
    let status: DominanceStatus = 'undominated'
    if (strong.has(strategy.id)) status = 'strong'
    else if (extended.has(strategy.id)) status = 'extended'
    else if (reference && strategy.id === reference.id) status = 'reference'
    return {
      ...strategy,
      incrementalCost: delta.cost,
      incrementalEffect: delta.effect,
      icer: delta.icer,
      incrementalCostVsReference: versus.cost,
      incrementalEffectVsReference: versus.effect,
      icerVsReference: versus.icer,
      status,
      dominatedBy: strong.get(strategy.id),
      nmb: netMonetaryBenefit(strategy.effect, strategy.cost, wtp),
      nhb: netHealthBenefit(strategy.effect, strategy.cost, wtp),
      rank: 0,
      onFrontier: frontier.has(strategy.id),
    }
  })
  const ranked = rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => b.row.nmb - a.row.nmb || a.index - b.index)
  ranked.forEach((item, rank) => {
    item.row.rank = rank + 1
  })
  const optimalId = pickOptimal(rows, preferences.decisionRule, strategies)
  return {
    wtp,
    referenceId: reference?.id ?? '',
    optimalId,
    frontierIds: frontierOrder.map((strategy) => strategy.id),
    strategies: rows,
  }
}

function pickOptimal(rows: CeaStrategy[], rule: DecisionRule, original: StrategyValue[]): string {
  let best = original[0]?.id ?? ''
  let bestScore = -Infinity
  for (const strategy of original) {
    const row = rows.find((item) => item.id === strategy.id)
    if (!row) continue
    const score =
      rule === 'cost' ? -row.cost : rule === 'effect' ? row.effect : rule === 'nhb' ? row.nhb : row.nmb
    if (score > bestScore + 1e-12) {
      bestScore = score
      best = row.id
    }
  }
  return best
}

function previousFrontier(strategy: StrategyValue, frontier: StrategyValue[]): StrategyValue | undefined {
  const index = frontier.findIndex((item) => item.id === strategy.id)
  if (index <= 0) return undefined
  return frontier[index - 1]
}

function diff(strategy: StrategyValue, baseline: StrategyValue): { cost: number | null; effect: number | null; icer: number | null } {
  const cost = strategy.cost - baseline.cost
  const effect = strategy.effect - baseline.effect
  if (Math.abs(effect) < EPS) return { cost, effect, icer: null }
  return { cost, effect, icer: cost / effect }
}

function dominates(winner: StrategyValue, loser: StrategyValue): boolean {
  const cheaper = winner.cost <= loser.cost + 1e-9
  const better = winner.effect >= loser.effect - 1e-9
  const strict = winner.cost < loser.cost - 1e-9 || winner.effect > loser.effect + 1e-9
  return cheaper && better && strict
}
