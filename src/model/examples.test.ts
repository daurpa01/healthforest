import { describe, expect, it } from 'vitest'
import { analyzeCea } from '../engine/cea'
import { runBia } from '../engine/bia'
import { rollback } from '../engine/tree'
import { decisionExample, markovExample } from './examples'

describe('ejemplos incluidos', () => {
  it('abre el árbol simple con los valores calculados a mano', () => {
    const model = decisionExample()
    const result = rollback(model)
    const cea = analyzeCea(result.strategies, model.preferences)
    const by = Object.fromEntries(cea.strategies.map((strategy) => [strategy.id, strategy]))
    expect(by.no.cost).toBeCloseTo(200)
    expect(by.no.effect).toBeCloseTo(0.5)
    expect(by.std.cost).toBeCloseTo(1200)
    expect(by.std.effect).toBeCloseTo(0.7)
    expect(by.std.icer).toBeCloseTo(5000)
    expect(by.new.cost).toBeCloseTo(4800)
    expect(by.new.effect).toBeCloseTo(0.86)
    expect(by.new.icer).toBeCloseTo(22500)
    expect(by.bad.status).toBe('strong')
    expect(cea.optimalId).toBe('std')
    const bia = runBia(model.bia)
    expect(bia.years[0].impact).toBeCloseTo(0)
    expect(bia.years[1].impact).toBeCloseTo(4_750_000)
    expect(bia.years[2].impact).toBeCloseTo(9_500_000)
    expect(bia.cumulativeImpact).toBeCloseTo(14_250_000)
  })

  it('calcula el primer ciclo del Markov con tabla de vida y WCC', () => {
    const model = markovExample()
    const result = rollback(model)
    const estándar = result.markov.mk_est
    const nuevo = result.markov.mk_new
    expect(estándar.cycles[0].occupancy.estable).toBeCloseTo(1)
    expect(estándar.cycles[0].occupancyNext.estable).toBeCloseTo(0.872)
    expect(estándar.cycles[0].occupancyNext.prog).toBeCloseTo(0.12)
    expect(estándar.cycles[0].occupancyNext.dead).toBeCloseTo(0.008)
    expect(estándar.cycles[0].reward.cost).toBeCloseTo(608.4)
    expect(estándar.cycles[0].reward.effect).toBeCloseTo(0.7818)
    expect(nuevo.total.effect).toBeGreaterThan(estándar.total.effect)
    for (const row of estándar.cycles) {
      const sum = Object.values(row.occupancy).reduce((acc, value) => acc + value, 0)
      expect(sum).toBeCloseTo(1)
    }
    const again = rollback(model)
    expect(again.markov.mk_est.total.cost).toBeCloseTo(estándar.total.cost)
    expect(estándar.total.effect).toBeLessThan(estándar.totalUndiscounted.effect)
  })
})