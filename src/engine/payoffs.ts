import type { DecisionRule, PayoffDef, PayoffMap } from './types'

export function payoffIds(payoffs: PayoffDef[]): string[] {
  return payoffs.map((p) => p.id)
}

export function zeroPayoffs(ids: string[]): PayoffMap {
  const out: PayoffMap = {}
  for (const id of ids) out[id] = 0
  return out
}

export function addPayoffs(a: PayoffMap, b: PayoffMap, ids: string[]): PayoffMap {
  const out: PayoffMap = {}
  for (const id of ids) out[id] = (a[id] ?? 0) + (b[id] ?? 0)
  return out
}

export function scalePayoffs(a: PayoffMap, k: number, ids: string[]): PayoffMap {
  const out: PayoffMap = {}
  for (const id of ids) out[id] = (a[id] ?? 0) * k
  return out
}

export function costId(payoffs: PayoffDef[]): string {
  return payoffs.find((p) => p.role === 'cost')?.id ?? 'cost'
}

export function effectId(payoffs: PayoffDef[]): string {
  return payoffs.find((p) => p.role === 'effect')?.id ?? 'effect'
}

export function netMonetaryBenefit(effect: number, cost: number, wtp: number): number {
  return effect * wtp - cost
}

export function netHealthBenefit(effect: number, cost: number, wtp: number): number {
  if (wtp === 0) return effect
  return effect - cost / wtp
}

export function decisionScore(cost: number, effect: number, rule: DecisionRule, wtp: number): number {
  switch (rule) {
    case 'cost':
      return -cost
    case 'effect':
      return effect
    case 'nhb':
      return netHealthBenefit(effect, cost, wtp)
    case 'nmb':
    default:
      return netMonetaryBenefit(effect, cost, wtp)
  }
}
