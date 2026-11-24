import { describe, expect, it } from 'vitest'
import { analyzeCea } from './cea'
import { sampleDirichlet, sampleDistribution, sampleGaussianCopula, sampleMultivariateNormal, correlationToCovariance } from './distributions'
import { evaluate, parseExpr } from './expr'
import { bia, branch, markov, model, node, pay, preferences, state } from './fixture'
import { runMarkovCohort, simpsonWeights } from './markov'
import { runMicrosimulation } from './microsim'
import { biaOneWay, biaPsa, mixOverTime, runBia } from './bia'
import { evppiBinned, runPSA, summarizePSA } from './psa'
import { mulberry32 } from './prng'
import { normalCdf, normalInv } from './stats'
import { oneWay, threshold, tornado } from './sensitivity'
import { compileScope } from './scope'
import { rollback } from './tree'
import type { PSATrial } from './psa'

const close = (value: number, expected: number, tol = 1e-8) => {
  expect(value).toBeCloseTo(expected, Math.max(0, Math.round(-Math.log10(tol))))
}

describe('expresiones', () => {
  const scope = {
    tables: new Map(),
    get: (name: string) => {
      const values: Record<string, number> = { a: 2, b: 5, _stage: 2 }
      if (!(name in values)) throw new Error(name)
      return values[name]
    },
  }

  it('respeta la precedencia y las funciones', () => {
    expect(evaluate('1+2*3', scope)).toBe(7)
    expect(evaluate('(1+2)*3', scope)).toBe(9)
    expect(evaluate('2^3', scope)).toBe(8)
    expect(evaluate('if(1>0, 5, 9)', scope)).toBe(5)
    expect(evaluate('if(1<0, 5, 9)', scope)).toBe(9)
    expect(evaluate('min(3,1,2)', scope)).toBe(1)
    expect(evaluate('sqrt(9)', scope)).toBe(3)
    expect(evaluate('abs(-4)', scope)).toBe(4)
    expect(evaluate('a+b', scope)).toBe(7)
    expect(evaluate('10*(1+_stage)', scope)).toBe(30)
  })

  it('evalúa variables en orden y tablas', () => {
    const m = model({
      tree: node({ id: 't', type: 'terminal', name: 'T', payoffs: pay('c', '0') }),
      variables: [
        { name: 'a', expression: '2' },
        { name: 'b', expression: 'a+3' },
        { name: 'c', expression: 'b*2' },
      ],
      tables: [{ name: 'vida', columns: ['edad', 'qx'], rows: [[40, 0.1], [42, 0.3]], interpolate: true }],
    })
    const result = rollback(m)
    expect(result.payoffs.cost).toBe(10)
    const s = compileScope(m)
    expect(evaluate('lookup("vida", 40)', s.eval)).toBeCloseTo(0.1)
    expect(evaluate('lookup("vida", 41)', s.eval)).toBeCloseTo(0.2)
  })
})

describe('rollback y costo-efectividad', () => {
  const tree = node({
    id: 'root',
    type: 'decision',
    name: 'Elección',
    branches: [
      branch('no', 'No tratar', '1', node({ id: 'n1', type: 'terminal', name: 'No tratar', payoffs: pay('200', '0.5') })),
      branch(
        'std',
        'Estándar',
        '1',
        node({
          id: 'ch1',
          type: 'chance',
          name: 'Respuesta',
          branches: [
            branch('s1', 'Éxito', '0.6', node({ id: 't1', type: 'terminal', name: 'Éxito', payoffs: pay('1200', '0.9') })),
            branch('s2', 'Fracaso', '#', node({ id: 't2', type: 'terminal', name: 'Fracaso', payoffs: pay('1200', '0.4') })),
          ],
        }),
      ),
      branch(
        'new',
        'Nuevo',
        '1',
        node({
          id: 'ch2',
          type: 'chance',
          name: 'Respuesta nueva',
          branches: [
            branch('n1b', 'Éxito', 'p_resp', node({ id: 't3', type: 'terminal', name: 'Éxito', payoffs: pay('c_nuevo', '0.95') })),
            branch('n2b', 'Fracaso', '#', node({ id: 't4', type: 'terminal', name: 'Fracaso', payoffs: pay('c_nuevo', '0.5') })),
          ],
        }),
      ),
      branch('bad', 'Combinada', '1', node({ id: 'bad', type: 'terminal', name: 'Combinada', payoffs: pay('6000', '0.62') })),
    ],
  })

  const m = model({
    tree,
    variables: [
      { name: 'p_resp', expression: '0.8', low: 0.5, high: 0.95 },
      { name: 'c_nuevo', expression: '4800', low: 2000, high: 8000 },
    ],
    preferences: preferences({ wtp: 20000 }),
  })

  it('calcula el valor esperado y el complemento', () => {
    const result = rollback(m)
    const byName = Object.fromEntries(result.strategies.map((strategy) => [strategy.name, strategy]))
    close(byName['No tratar'].cost, 200)
    close(byName['No tratar'].effect, 0.5)
    close(byName['Estándar'].cost, 1200)
    close(byName['Estándar'].effect, 0.7)
    close(byName['Nuevo'].cost, 4800)
    close(byName['Nuevo'].effect, 0.86)
    close(byName['Combinada'].effect, 0.62)
  })

  it('marca dominancia, RCEI y el óptimo según el umbral', () => {
    const low = analyzeCea(rollback(m).strategies, m.preferences)
    const std = low.strategies.find((strategy) => strategy.name === 'Estándar')!
    const nuevo = low.strategies.find((strategy) => strategy.name === 'Nuevo')!
    const bad = low.strategies.find((strategy) => strategy.name === 'Combinada')!
    expect(bad.status).toBe('strong')
    expect(std.icer).toBeCloseTo(5000)
    expect(nuevo.icer).toBeCloseTo(22500)
    expect(low.optimalId).toBe('std')
    const high = analyzeCea(rollback(m).strategies, { ...m.preferences, wtp: 50000 })
    expect(high.optimalId).toBe('new')
    expect(high.strategies.find((strategy) => strategy.id === 'new')!.nmb).toBeCloseTo(50000 * 0.86 - 4800)
  })

  it('detecta dominancia extendida', () => {
    const strategies = [
      { id: 'a', nodeId: 'a', name: 'A', cost: 100, effect: 1, payoffs: { cost: 100, effect: 1 } },
      { id: 'b', nodeId: 'b', name: 'B', cost: 300, effect: 2, payoffs: { cost: 300, effect: 2 } },
      { id: 'c', nodeId: 'c', name: 'C', cost: 360, effect: 3, payoffs: { cost: 360, effect: 3 } },
      { id: 'd', nodeId: 'd', name: 'D', cost: 400, effect: 1.5, payoffs: { cost: 400, effect: 1.5 } },
    ]
    const cea = analyzeCea(strategies, preferences({ wtp: 10000 }))
    expect(cea.strategies.find((s) => s.id === 'd')!.status).toBe('strong')
    expect(cea.strategies.find((s) => s.id === 'b')!.status).toBe('extended')
    expect(cea.frontierIds).toEqual(['a', 'c'])
    expect(cea.strategies.find((s) => s.id === 'c')!.icer).toBeCloseTo(130)
    expect(cea.optimalId).toBe('c')
  })

  it('resuelve un nodo lógico y un clon', () => {
    const master = node({ id: 'master', type: 'terminal', name: 'Maestro', masterId: 'M', payoffs: pay('15', '2') })
    const logical = model({
      variables: [{ name: 'edad', expression: '60' }],
      tree: node({
        id: 'L',
        type: 'logic',
        name: 'Edad',
        condition: 'edad >= 65',
        branches: [
          branch('yes', 'Sí', '1', node({ id: 'y', type: 'terminal', name: 'Mayor', payoffs: pay('9', '2') })),
          branch('no', 'No', '1', node({ id: 'n', type: 'terminal', name: 'Menor', payoffs: pay('5', '1') })),
        ],
      }),
    })
    expect(rollback(logical).payoffs.cost).toBe(5)
    expect(rollback({ ...logical, variables: [{ name: 'edad', expression: '70' }] }).payoffs.cost).toBe(9)
    const cloned = model({
      tree: node({
        id: 'D',
        type: 'decision',
        name: 'D',
        branches: [
          branch('a', 'Clon', '1', node({ id: 'c', type: 'clone', name: 'Clon', cloneMasterId: 'M' })),
          branch('b', 'Cero', '1', node({ id: 'z', type: 'terminal', name: 'Cero', payoffs: pay('0', '0') })),
          branch('m', 'Maestro', '1', master),
        ],
      }),
    })
    const result = rollback(cloned)
    expect(result.strategies.find((s) => s.name === 'Clon')!.cost).toBe(15)
    expect(result.strategies.find((s) => s.name === 'Clon')!.effect).toBe(2)
  })
})

describe('Markov', () => {
  it('acumula recompensa inicial, incremental y final', () => {
    const alive = state({
      id: 'alive',
      name: 'Vivo',
      initial: pay('10', '1'),
      incremental: pay('100', '1'),
      final: pay('7', '0'),
      transitions: [{ to: 'alive', probability: '1' }],
    })
    const spec = markov({ cycles: 3, states: [alive] })
    const result = runMarkovCohort(spec, model({ tree: node({ id: 'x', type: 'terminal', name: 'x' }) }), compileScope(model({ tree: node({ id: 'x', type: 'terminal', name: 'x' }) })))
    expect(result.total.cost).toBeCloseTo(217)
    expect(result.total.effect).toBeCloseTo(3)
    expect(result.cycles).toHaveLength(3)
    expect(result.cycles[0].reward.cost).toBeCloseTo(10)
    expect(result.cycles[1].reward.cost).toBeCloseTo(100)
  })

  it('descuenta al inicio del ciclo', () => {
    const alive = state({
      id: 'alive',
      name: 'Vivo',
      initial: pay('100', '0'),
      incremental: pay('100', '0'),
      transitions: [{ to: 'alive', probability: '1' }],
    })
    const spec = markov({ cycles: 3, discountRates: { cost: 1, effect: 0 }, states: [alive] })
    const result = runMarkovCohort(spec, carrier(), compileScope(carrier()))
    expect(result.total.cost).toBeCloseTo(175)
  })

  it('aplica la corrección dentro del ciclo', () => {
    const alive = state({
      id: 'alive',
      name: 'Vivo',
      cycle: pay('0', '100'),
      transitions: [{ to: 'alive', probability: '#' }, { to: 'dead', probability: '1' }],
    })
    const dead = state({ id: 'dead', name: 'Muerto', absorbing: true, cycle: pay('0', '0'), transitions: [{ to: 'dead', probability: '1' }] })
    const spec = markov({
      method: 'wcc',
      cycles: 3,
      states: [alive, dead],
      initialProbabilities: [
        { stateId: 'alive', probability: '1' },
        { stateId: 'dead', probability: '0' },
      ],
    })
    const result = runMarkovCohort(spec, carrier(), compileScope(carrier()))
    expect(result.total.effect).toBeCloseTo(50)
    expect(result.cycles[0].occupancyNext.dead).toBeCloseTo(1)
  })

  it('integra una recompensa constante con Simpson', () => {
    const alive = state({ id: 'alive', name: 'Vivo', cycle: pay('100', '0'), transitions: [{ to: 'alive', probability: '1' }] })
    const spec = markov({ method: 'simpson', cycles: 4, states: [alive] })
    const result = runMarkovCohort(spec, carrier(), compileScope(carrier()))
    expect(result.totalUndiscounted.cost).toBeCloseTo(400)
    expect(simpsonWeights(4).reduce((s, v) => s + v, 0)).toBeCloseTo(4)
    expect(simpsonWeights(3).reduce((s, v) => s + v, 0)).toBeCloseTo(3)
  })

  it('usa _stage, la edad y una tabla', () => {
    const m = carrier()
    m.tables = [{ name: 'm', columns: ['edad', 'qx'], rows: [[40, 0.1], [41, 0.2]], interpolate: false }]
    const alive = state({
      id: 'alive',
      name: 'Vivo',
      initial: pay('0', '1'),
      incremental: pay('0', '1'),
      transitions: [
        { to: 'alive', probability: '#' },
        { to: 'dead', probability: 'lookup("m", _age)' },
      ],
    })
    const dead = state({ id: 'dead', name: 'Muerto', absorbing: true, transitions: [{ to: 'dead', probability: '1' }] })
    const spec = markov({
      cycles: 2,
      startAge: 40,
      states: [alive, dead],
      initialProbabilities: [
        { stateId: 'alive', probability: '1' },
        { stateId: 'dead', probability: '0' },
      ],
    })
    const result = runMarkovCohort(spec, m, compileScope(m))
    expect(result.total.effect).toBeCloseTo(1.9)
    expect(result.cycles[0].occupancyNext.alive).toBeCloseTo(0.9)
    expect(result.cycles[1].occupancy.alive).toBeCloseTo(0.9)
  })

  it('suma el costo de un subárbol de transición y respeta el túnel', () => {
    const transitionTree = node({
      id: 'ch',
      type: 'chance',
      name: 'Evento',
      branches: [
        branch('die', 'Muere', '0.25', node({ id: 'td', type: 'terminal', name: 'Muere', jumpTo: 'dead' }), '40', '0'),
        branch('live', 'Vive', '#', node({ id: 'tl', type: 'terminal', name: 'Vive', jumpTo: 'alive' })),
      ],
    })
    const alive = state({
      id: 'alive',
      name: 'Vivo',
      initial: pay('0', '1'),
      incremental: pay('0', '1'),
      transitionTree,
      transitions: [],
    })
    const dead = state({ id: 'dead', name: 'Muerto', absorbing: true, transitions: [{ to: 'dead', probability: '1' }] })
    const spec = markov({
      cycles: 2,
      states: [alive, dead],
      initialProbabilities: [
        { stateId: 'alive', probability: '1' },
        { stateId: 'dead', probability: '0' },
      ],
    })
    const result = runMarkovCohort(spec, carrier(), compileScope(carrier()))
    expect(result.total.effect).toBeCloseTo(1.75)
    expect(result.total.cost).toBeCloseTo(17.5)
    expect(result.cycles[0].occupancyNext.alive).toBeCloseTo(0.75)

    const tunnel = state({
      id: 'tunnel',
      name: 'Túnel',
      tunnelCycles: 2,
      tunnelMode: 'track',
      initial: pay('0', '_tunnel'),
      incremental: pay('0', '_tunnel'),
      transitions: [{ to: 'tunnel', probability: '1' }],
    })
    const tracked = runMarkovCohort(markov({ cycles: 2, states: [tunnel] }), carrier(), compileScope(carrier()))
    expect(tracked.total.effect).toBeCloseTo(3)
  })

  it('la microsimulación determinista coincide con la cohorte', () => {
    const alive = state({
      id: 'alive',
      name: 'Vivo',
      initial: pay('100', '1'),
      incremental: pay('100', '1'),
      final: pay('0', '0'),
      transitions: [{ to: 'alive', probability: '1' }],
    })
    const spec = markov({ cycles: 3, states: [alive], discountRates: { cost: 0.03, effect: 0.03 } })
    const m = carrier()
    const scope = compileScope(m)
    const cohort = runMarkovCohort(spec, m, scope)
    const micro = runMicrosimulation(spec, m, scope, { n: 1, seed: 7 })
    expect(micro.mean.cost).toBeCloseTo(cohort.total.cost)
    expect(micro.mean.effect).toBeCloseTo(cohort.total.effect)
    const again = runMicrosimulation(spec, m, scope, { n: 4, seed: 7 })
    expect(again.mean.cost).toBeCloseTo(micro.mean.cost)
    const other = runMicrosimulation(
      markov({
        cycles: 8,
        states: [
          state({
            id: 'alive',
            name: 'Vivo',
            initial: pay('0', '1'),
            incremental: pay('0', '1'),
            transitions: [
              { to: 'alive', probability: '#' },
              { to: 'dead', probability: '0.5' },
            ],
          }),
          state({ id: 'dead', name: 'Muerto', absorbing: true, transitions: [{ to: 'dead', probability: '1' }] }),
        ],
        initialProbabilities: [
          { stateId: 'alive', probability: '1' },
          { stateId: 'dead', probability: '0' },
        ],
        trackers: [{ name: 'hits', initial: '0', update: 'hits+1' }],
      }),
      m,
      scope,
      { n: 400, seed: 3 },
    )
    expect(other.individuals[0].trackers.hits).toBe(8)
    const expected = Array.from({ length: 8 }, (_, t) => 0.5 ** t).reduce((s, v) => s + v, 0)
    expect(other.mean.effect).toBeGreaterThan(expected - 0.35)
    expect(other.mean.effect).toBeLessThan(expected + 0.35)
    expect(runMicrosimulation(markov({ cycles: 2, states: [alive] }), m, scope, { n: 5, seed: 9 }).mean.cost).toBe(
      runMicrosimulation(markov({ cycles: 2, states: [alive] }), m, scope, { n: 5, seed: 9 }).mean.cost,
    )
  })
})

describe('incertidumbre', () => {
  it('repite el muestreo con la misma semilla', () => {
    const rng = mulberry32(42)
    const a = [sampleDistribution({ type: 'normal', args: ['0', '1'] }, [0, 1], rng)]
    const rng2 = mulberry32(42)
    const b = [sampleDistribution({ type: 'normal', args: ['0', '1'] }, [0, 1], rng2)]
    expect(a[0]).toBe(b[0])
    expect(normalInv(0.975)).toBeCloseTo(1.95996398454, 5)
    expect(normalCdf(0)).toBeCloseTo(0.5, 5)
    const dir = sampleDirichlet([1, 1, 1], mulberry32(1))
    expect(dir.reduce((s, v) => s + v, 0)).toBeCloseTo(1)
    const draws = Array.from({ length: 4000 }, () => sampleDistribution({ type: 'normal', args: [] }, [10, 2], mulberry32(1 + Math.floor(Math.random() * 100000))))
    // The loop above is NOT deterministic because of Math.random. Use one stream instead.
    const stream = mulberry32(11)
    const sample = Array.from({ length: 4000 }, () => sampleDistribution({ type: 'normal', args: [] }, [10, 2], stream))
    const mu = sample.reduce((s, v) => s + v, 0) / sample.length
    expect(mu).toBeGreaterThan(9.85)
    expect(mu).toBeLessThan(10.15)
    void draws
  })

  it('conserva la correlación de una normal multivariada y de una cópula', () => {
    const rng = mulberry32(5)
    const rows = Array.from({ length: 3000 }, () => sampleMultivariateNormal([0, 0], correlationToCovariance([1, 1], [[1, 0.85], [0.85, 1]]), rng))
    expect(corr(rows.map((row) => row[0]), rows.map((row) => row[1]))).toBeGreaterThan(0.75)
    const copula = mulberry32(6)
    const paired = Array.from({ length: 2000 }, () =>
      sampleGaussianCopula(
        [
          { type: 'uniform', args: [0, 1] },
          { type: 'uniform', args: [0, 1] },
        ],
        [
          [1, 0.9],
          [0.9, 1],
        ],
        copula,
      ),
    )
    expect(corr(paired.map((row) => row[0]), paired.map((row) => row[1]))).toBeGreaterThan(0.75)
  })

  it('el PSA es reproducible y calcula CEAC, CEAF y EVPI', () => {
    const hand: PSATrial[] = [0, 1, 2, 3].map((index) => ({
      index,
      parameters: {},
      strategies: [
        { id: 'A', name: 'A', cost: 0, effect: index < 2 ? 1 : 0 },
        { id: 'B', name: 'B', cost: 0, effect: index < 2 ? 0 : 1 },
      ],
    }))
    const summary = summarizePSA(hand, [1], 1, 'A')
    expect(summary.ceac[0].probability.A).toBeCloseTo(0.5)
    expect(summary.ceac[0].probability.B).toBeCloseTo(0.5)
    expect(summary.evpi[0].value).toBeCloseTo(0.5)
    expect(summary.ceaf[0].probability).toBeCloseTo(0.5)
    const phi = [-1, -1, -1, -1, 1, 1, 1, 1]
    const nmb = phi.map((value) => [0, value])
    expect(evppiBinned(phi, nmb, 2)).toBeCloseTo(0.5)

    const m = model({
      variables: [{ name: 'c', expression: '100', distribution: { type: 'normal', args: ['100', '10'] }, sampleRate: 'trial' }],
      tree: node({
        id: 'D',
        type: 'decision',
        name: 'D',
        branches: [
          branch('A', 'A', '1', node({ id: 'a', type: 'terminal', name: 'A', payoffs: pay('c', '1') })),
          branch('B', 'B', '1', node({ id: 'b', type: 'terminal', name: 'B', payoffs: pay('50', '0') })),
        ],
      }),
    })
    const first = runPSA(m, { trials: 30, seed: 99, wtpGrid: [0, 100] })
    const second = runPSA(m, { trials: 30, seed: 99, wtpGrid: [0, 100] })
    expect(first.trials.map((trial) => trial.strategies[0].cost)).toEqual(second.trials.map((trial) => trial.strategies[0].cost))
    expect(first.summary.strategies[0].meanCost).toBeGreaterThan(90)
    expect(first.summary.strategies[0].meanCost).toBeLessThan(110)
  })

  it('encuentra el umbral donde cambia la estrategia', () => {
    const m = model({
      variables: [{ name: 'c', expression: '40', low: 0, high: 100 }],
      preferences: preferences({ wtp: 50 }),
      tree: node({
        id: 'D',
        type: 'decision',
        name: 'D',
        branches: [
          branch('A', 'A', '1', node({ id: 'a', type: 'terminal', name: 'A', payoffs: pay('c', '1') })),
          branch('B', 'B', '1', node({ id: 'b', type: 'terminal', name: 'B', payoffs: pay('100', '2') })),
        ],
      }),
    })
    const cut = threshold(m, 'c', 0, 100, 'A', 'B', 21)
    expect(cut).toBeCloseTo(50, 1)
    const line = oneWay(m, 'c', 0, 100, 3, 'nmb', 'A')
    expect(line[0].values.A).toBeCloseTo(50)
    expect(line[2].values.A).toBeCloseTo(-50)
    const bars = tornado(m, 'cost', 'A')
    expect(bars[0].variable).toBe('c')
    expect(bars[0].swing).toBeCloseTo(100)
  })
})

describe('impacto presupuestal', () => {
  it('resta el mundo actual del mundo nuevo', () => {
    const result = runBia(
      bia({
        horizonYears: 2,
        populationMode: 'prevalence',
        basePopulation: 1000,
        growthRate: 0,
        strategies: [
          { id: 'A', name: 'A', annualCost: 100 },
          { id: 'B', name: 'B', annualCost: 300 },
        ],
        currentShares: [
          [1, 0],
          [1, 0],
        ],
        newShares: [
          [0.5, 0.5],
          [0, 1],
        ],
      }),
    )
    expect(result.years[0].impact).toBeCloseTo(100000)
    expect(result.years[1].impact).toBeCloseTo(200000)
    expect(result.cumulativeImpact).toBeCloseTo(300000)
  })

  it('hace crecer la población y acumula cohortes incidentes', () => {
    const grown = runBia(
      bia({
        horizonYears: 2,
        basePopulation: 1000,
        growthRate: 0.1,
        strategies: [
          { id: 'A', name: 'A', annualCost: 100 },
          { id: 'B', name: 'B', annualCost: 300 },
        ],
        currentShares: [
          [1, 0],
          [1, 0],
        ],
        newShares: [
          [0.5, 0.5],
          [0, 1],
        ],
      }),
    )
    expect(grown.years[1].population).toBeCloseTo(1100)
    expect(grown.years[1].impact).toBeCloseTo(220000)

    const incident = runBia(
      bia({
        horizonYears: 3,
        populationMode: 'incidence',
        basePopulation: 100,
        treatmentDuration: 2,
        strategies: [{ id: 'F', name: 'Fármaco', annualCost: 50 }],
        currentShares: [[0], [0], [0]],
        newShares: [[1], [1], [1]],
      }),
    )
    expect(incident.years[0].impact).toBeCloseTo(5000)
    expect(incident.years[1].impact).toBeCloseTo(10000)
    expect(incident.years[2].impact).toBeCloseTo(10000)
  })

  it('la curva lineal llega a los extremos y la sensibilidad escala', () => {
    const rows = mixOverTime(5, [{ start: 0, end: 1, shape: 'linear' }], false)
    expect(rows[0][0]).toBeCloseTo(0)
    expect(rows[4][0]).toBeCloseTo(1)
    expect(rows[2][0]).toBeCloseTo(0.5)
    const base = bia({
      horizonYears: 1,
      basePopulation: 1000,
      strategies: [{ id: 'A', name: 'A', annualCost: 10 }],
      currentShares: [[0]],
      newShares: [[1]],
    })
    const points = biaOneWay(base, 'basePopulation', 0, 1000, 3)
    expect(points[0].cumulative).toBeCloseTo(0)
    expect(points[2].cumulative).toBeCloseTo(10000)
    const psa = biaPsa(
      {
        ...base,
        uncertain: [{ parameter: 'basePopulation', distribution: { type: 'uniform', args: ['500', '1500'] } }],
      },
      200,
      4,
    )
    expect(psa.mean).toBeGreaterThan(8000)
    expect(psa.mean).toBeLessThan(12000)
    expect(biaPsa({ ...base, uncertain: [{ parameter: 'basePopulation', distribution: { type: 'uniform', args: ['500', '1500'] } }] }, 200, 4).samples).toEqual(psa.samples)
  })
})

function carrier() {
  return model({ tree: node({ id: 'x', type: 'terminal', name: 'x' }) })
}

function corr(xs: number[], ys: number[]): number {
  const n = xs.length
  const mx = xs.reduce((s, v) => s + v, 0) / n
  const my = ys.reduce((s, v) => s + v, 0) / n
  let num = 0
  let dx = 0
  let dy = 0
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx
    const b = ys[i] - my
    num += a * b
    dx += a * a
    dy += b * b
  }
  return num / Math.sqrt(dx * dy)
}

void parseExpr
