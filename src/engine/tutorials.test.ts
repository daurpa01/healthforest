import { describe, expect, it } from 'vitest'
import { blankModel, pay } from '../model/defaults'
import { analyzeCea } from './cea'
import { calibrate } from './calibrate'
import { diagramToMarkov, markovToDiagram } from './diagram'
import { accrue, simulateDesPatient } from './des'
import { kiboModel } from './kiboModel'
import { applyHalfCycleCorrection, runMarkovCohort } from './markov'
import { mergeOccupancy } from './merge'
import { pathwayReport, pathwayTotal } from './pathway'
import { costsByPeriod } from './periods'
import { mulberry32 } from './prng'
import { runPartsa } from './partsa'
import { bootstrapRows } from './bootstrap'
import { compileScope } from './scope'
import { runSir } from './sir'
import { threshold } from './sensitivity'
import { rollback } from './tree'
import type { HealthModel, MarkovState, TreeNode } from './types'

describe('ejemplos de los tutoriales', () => {
  it('el Markov de Kibo a los 40 años coincide con el Excel', () => {
    const model = kiboModel({ startAge: 40, cycles: 71 })
    const result = rollback(model)
    const oldDrug = result.strategies.find((row) => row.name === 'Fármaco viejo')!
    const newDrug = result.strategies.find((row) => row.name === 'Fármaco nuevo')!
    expect(relativeGap(oldDrug.cost, 378797.51981865556)).toBeLessThan(1e-6)
    expect(relativeGap(oldDrug.effect, 11.598514335044538)).toBeLessThan(1e-6)
    expect(relativeGap(newDrug.cost, 687945.7982281554)).toBeLessThan(1e-6)
    expect(relativeGap(newDrug.effect, 12.246668291899137)).toBeLessThan(1e-6)
    const icer = (newDrug.cost - oldDrug.cost) / (newDrug.effect - oldDrug.effect)
    expect(relativeGap(icer, 476967.35496262804)).toBeLessThan(1e-5)
  })

  it('el trazo del cáncer con medio ciclo da 83/15/2 y 10.000 en el ciclo 0', () => {
    const local: MarkovState = state('local', 'Local', { cost: '20000', effect: '0' })
    const met: MarkovState = state('met', 'Metástasis', { cost: '50000', effect: '0' })
    const dead: MarkovState = { ...state('dead', 'Muerto', { cost: '0', effect: '0' }), absorbing: true, transitions: [{ to: 'dead', probability: '1' }] }
    local.transitions = [
      { to: 'local', probability: '0.83' },
      { to: 'met', probability: '0.15' },
      { to: 'dead', probability: '0.02' },
    ]
    met.transitions = [
      { to: 'met', probability: '0.9' },
      { to: 'dead', probability: '0.1' },
    ]
    const spec = applyHalfCycleCorrection({
      cycles: 3,
      cycleLength: 1,
      startAge: 60,
      method: 'traditional',
      discountTiming: 'start',
      discountRates: { cost: 0, effect: 0 },
      initialProbabilities: [
        { stateId: 'local', probability: '1' },
        { stateId: 'met', probability: '0' },
        { stateId: 'dead', probability: '0' },
      ],
      states: [local, met, dead],
      trackers: [],
    })
    const model = blankModel()
    const cohort = runMarkovCohort(spec, model, compileScope(model))
    expect(cohort.cycles[0].reward.cost).toBeCloseTo(10000, 4)
    expect(cohort.cycles[0].occupancyNext.local).toBeCloseTo(0.83, 6)
    expect(cohort.cycles[0].occupancyNext.met).toBeCloseTo(0.15, 6)
    expect(cohort.cycles[0].occupancyNext.dead).toBeCloseTo(0.02, 6)
    expect(cohort.cycles[1].occupancy.met * 50000).toBeCloseTo(7500, 4)
    const deadAfter = cohort.cycles[1].occupancyNext.dead
    expect(deadAfter).toBeCloseTo(0.02 + 0.83 * 0.02 + 0.15 * 0.1, 6)
  })

  it('el árbol del robot da un RCEI de 20.000 y el umbral en 0,375', () => {
    const model = robotModel()
    model.variables = [{ name: 'p', expression: '0.25', low: 0, high: 1 }]
    const result = rollback(model)
    const a = result.strategies.find((row) => row.name === 'Robot A')!
    const b = result.strategies.find((row) => row.name === 'Robot B')!
    expect((b.cost - a.cost) / (b.effect - a.effect)).toBeCloseTo(20000, 4)
    const cea = analyzeCea(result.strategies, model.preferences)
    expect(cea.optimalId).toBe(b.id)
    const cut = threshold(model, 'p', 0, 1, a.id, b.id, 80)
    expect(cut).toBeCloseTo(0.375, 2)
  })

  it('dos Markov en una estrategia se mezclan 0,8 y 0,2', () => {
    const merged = mergeOccupancy([
      { weight: 0.8, occupancy: { dead: 0.767 } },
      { weight: 0.2, occupancy: { dead: 0.742 } },
    ])
    expect(merged.dead).toBeCloseTo(0.762, 6)
  })

  it('la supervivencia particionada integra el área entre las curvas', () => {
    const result = runPartsa({
      pfs: { kind: 'exponential', a: 0.2 },
      os: { kind: 'exponential', a: 0.1 },
      cycles: 120,
      cycleLength: 1 / 12,
      rewards: {
        pf: { cost: 12000, effect: 0.8 },
        progressed: { cost: 24000, effect: 0.5 },
        dead: { cost: 0, effect: 0 },
      },
      discountRate: 0,
      payoffIds: ['cost', 'effect'],
    })
    const pfYears = result.cycles.reduce((sum, row) => sum + row.pf * (1 / 12), 0)
    expect(pfYears).toBeGreaterThan(4)
    expect(pfYears).toBeLessThan(6)
    expect(result.total.effect).toBeGreaterThan(0)
  })

  it('un evento discreto acumula el tiempo de espera', () => {
    expect(accrue(2000, 3.5)).toBe(7000)
    expect(accrue(1000, 3.8)).toBe(3800)
    const patient = simulateDesPatient(
      [
        {
          name: 'estable',
          costPerYear: 1000,
          effectPerYear: 1,
          events: [{ name: 'progresión', rate: 0.2, cost: 6000, next: 'tarde' }],
        },
        {
          name: 'tarde',
          costPerYear: 0,
          effectPerYear: 0,
          events: [{ name: 'muerte', rate: 0.16, stop: true }],
        },
      ],
      mulberry32(7),
      20,
    )
    expect(patient.time).toBeGreaterThan(0)
    expect(patient.time).toBeLessThanOrEqual(20)
    expect(patient.cost).toBeGreaterThan(6000)
  })

  it('un SIR no coherente crece con los infectados y admite una entrada', () => {
    const rows = runSir({ susceptible: 1000, infected: 1, recovered: 0, beta: 0.4, gamma: 0.1, days: 3, entryPerDay: 10 })
    expect(rows[0].susceptible).toBeCloseTo(1000 + 10 - (0.4 * 1010 * 1) / 1011, 6)
    expect(rows[0].infected).toBeGreaterThan(1)
    expect(rows[2].susceptible + rows[2].infected + rows[2].recovered).toBeCloseTo(1000 + 1 + 30, 6)
    const slowed = runSir({
      susceptible: 1000,
      infected: 50,
      recovered: 0,
      beta: 0.8,
      gamma: 0.05,
      days: 80,
      betaAfter: { day: 60, beta: 0.05 },
    })
    expect(slowed[70].infected).toBeLessThan(slowed[59].infected)
  })

  it('la calibración acerca la supervivencia a 5 años al objetivo', () => {
    const fitted = calibrate({
      start: 0.15,
      low: 0.05,
      high: 0.3,
      target: 0.45,
      evaluate: (probability) => (1 - probability) ** 5,
    })
    expect(fitted.output).toBeCloseTo(0.45, 3)
    expect(fitted.value).toBeGreaterThan(0.12)
    expect(fitted.value).toBeLessThan(0.18)
  })

  it('los pagos aguas arriba entran en el informe de caminos', () => {
    const model = blankModel()
    model.tree = {
      id: 'd',
      type: 'decision',
      name: 'Caso',
      payoffs: pay('100', '0'),
      branches: [
        {
          id: 's',
          label: 'Estrategia',
          probability: '1',
          payoffs: pay(),
          child: {
            id: 'c',
            type: 'chance',
            name: 'Juicio',
            payoffs: pay('50', '0'),
            branches: [
              { id: 'a', label: 'Alto', probability: '0.4', payoffs: pay(), child: term('t1', '9900000') },
              { id: 'b', label: 'Bajo', probability: '0.6', payoffs: pay(), child: term('t2', '0') },
            ],
          },
        },
      ],
    }
    const rows = pathwayReport(model, model.tree.branches[0].child)
    expect(rows).toHaveLength(2)
    expect(rows[0].payoffs.cost).toBeCloseTo(50 + 9900000, 4)
    const total = pathwayTotal(rows, ['cost', 'effect'])
    expect(total.cost).toBeCloseTo(0.4 * 9900050 + 0.6 * 50, 4)
  })

  it('los costos por periodo respetan el medio ciclo del primer año', () => {
    const rows = costsByPeriod([
      { stage: 0, occupancy: {}, occupancyNext: {}, reward: { cost: 10000, effect: 0 }, discounted: { cost: 10000, effect: 0 }, discountFactor: 1, cumulative: { cost: 10000, effect: 0 } },
      { stage: 1, occupancy: {}, occupancyNext: {}, reward: { cost: 20000, effect: 0 }, discounted: { cost: 20000, effect: 0 }, discountFactor: 1, cumulative: { cost: 30000, effect: 0 } },
    ])
    expect(rows[0].cost).toBe(10000)
    expect(rows[1].cost).toBe(20000)
  })

  it('el diagrama de estados vuelve al Markov', () => {
    const spec = kiboModel({ startAge: 60, cycles: 5 }).tree.branches[0].child.markov!
    const diagram = markovToDiagram(spec)
    expect(diagram.states.map((state) => state.name)).toEqual(['healthy', 'disease', 'dead'])
    const back = diagramToMarkov(diagram, spec)
    expect(back.states.find((state) => state.id === 'healthy')?.incremental.cost).toBe('c_old_drug_disc')
    expect(back.cycles).toBe(5)
  })

  it('el remuestreo con semilla es repetible', () => {
    const rows = [{ age: 60 }, { age: 70 }, { age: 80 }]
    expect(bootstrapRows(rows, 5, 11)).toEqual(bootstrapRows(rows, 5, 11))
  })
})

function relativeGap(actual: number, expected: number): number {
  return Math.abs(actual - expected) / Math.abs(expected)
}

function state(id: string, name: string, reward: { cost: string; effect: string }): MarkovState {
  return {
    id,
    name,
    initial: { ...reward },
    incremental: { ...reward },
    final: { cost: '0', effect: '0' },
    startup: { cost: '0', effect: '0' },
    cycle: { ...reward },
    event: { cost: '0', effect: '0' },
    transitions: [],
  }
}

function term(id: string, cost: string): TreeNode {
  return { id, type: 'terminal', name: id, payoffs: pay(cost, '1'), branches: [] }
}

function robotModel(): HealthModel {
  const model = blankModel()
  model.preferences.wtp = 50000
  const arm = (id: string, name: string, noBleedCost: string, bleedCost: string, noBleedQ: string, bleedQ: string, probability: string): TreeNode => ({
    id,
    type: 'chance',
    name,
    payoffs: pay(),
    branches: [
      { id: `${id}_n`, label: 'Sin hemorragia', probability: '#', payoffs: pay(), child: { id: `${id}_nt`, type: 'terminal', name: 'Sin hemorragia', payoffs: pay(noBleedCost, noBleedQ), branches: [] } },
      { id: `${id}_h`, label: 'Hemorragia', probability, payoffs: pay(), child: { id: `${id}_ht`, type: 'terminal', name: 'Hemorragia', payoffs: pay(bleedCost, bleedQ), branches: [] } },
    ],
  })
  model.tree = {
    id: 'd',
    type: 'decision',
    name: 'Robot',
    payoffs: pay(),
    branches: [
      { id: 'a', label: 'Robot A', probability: '1', payoffs: pay(), child: arm('a', 'A', '10000', '10000', '1', '1', '0.5') },
      { id: 'b', label: 'Robot B', probability: '1', payoffs: pay(), child: arm('b', 'B', '15000', '25000', '1.775', '0.175', 'p') },
    ],
  }
  return model
}
