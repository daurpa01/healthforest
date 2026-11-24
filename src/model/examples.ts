import type { HealthModel, MarkovSpec, TreeNode } from '../engine/types'
import { defaultPreferences, emptyBia, pay } from './defaults'

function terminal(id: string, name: string, cost: string, effect: string): TreeNode {
  return { id, type: 'terminal', name, payoffs: pay(cost, effect), branches: [] }
}

export function decisionExample(): HealthModel {
  const tree: TreeNode = {
    id: 'root',
    type: 'decision',
    name: 'Elección de tratamiento',
    payoffs: pay(),
    branches: [
      { id: 'no', label: 'No tratar', probability: '1', payoffs: pay(), child: terminal('n_no', 'No tratar', '200', '0.50') },
      {
        id: 'std',
        label: 'Estándar',
        probability: '1',
        payoffs: pay(),
        child: {
          id: 'ch_std',
          type: 'chance',
          name: 'Respuesta estándar',
          payoffs: pay(),
          branches: [
            { id: 'std_ok', label: 'Responde', probability: '0.60', payoffs: pay(), child: terminal('t_std_ok', 'Responde', '1200', '0.90') },
            { id: 'std_no', label: 'No responde', probability: '#', payoffs: pay(), child: terminal('t_std_no', 'No responde', '1200', '0.40') },
          ],
        },
      },
      {
        id: 'new',
        label: 'Nuevo',
        probability: '1',
        payoffs: pay(),
        child: {
          id: 'ch_new',
          type: 'chance',
          name: 'Respuesta nueva',
          payoffs: pay(),
          branches: [
            { id: 'new_ok', label: 'Responde', probability: 'p_resp', payoffs: pay(), child: terminal('t_new_ok', 'Responde', 'c_nuevo', '0.95') },
            { id: 'new_no', label: 'No responde', probability: '#', payoffs: pay(), child: terminal('t_new_no', 'No responde', 'c_nuevo', '0.50') },
          ],
        },
      },
      { id: 'bad', label: 'Combinada', probability: '1', payoffs: pay(), child: terminal('n_bad', 'Combinada', '6000', '0.62') },
    ],
  }
  return {
    version: 1,
    name: 'Fármaco: árbol simple',
    description:
      'Tres estrategias y una dominada. Con un umbral de 20.000 el estándar es óptimo; súbalo a 50.000 para que lo sea el tratamiento nuevo. El RCEI del nuevo frente al estándar es 22.500.',
    payoffs: [
      { id: 'cost', label: 'Costo', role: 'cost' },
      { id: 'effect', label: 'AVAC', role: 'effect' },
    ],
    preferences: { ...defaultPreferences(), wtp: 20000, referenceStrategyId: 'no' },
    variables: [
      {
        name: 'p_resp',
        expression: '0.8',
        description: 'Probabilidad de respuesta al tratamiento nuevo',
        low: 0.5,
        high: 0.95,
        sampleRate: 'trial',
        distribution: { type: 'beta', args: ['40', '10'] },
      },
      {
        name: 'c_nuevo',
        expression: '4800',
        description: 'Costo del tratamiento nuevo',
        low: 2000,
        high: 8000,
        sampleRate: 'trial',
        distribution: { type: 'gammaMeanSd', args: ['4800', '600'] },
      },
    ],
    dirichlet: [],
    mvnormal: [],
    correlations: [],
    tables: [],
    clones: [],
    tree,
    bia: {
      ...emptyBia(),
      horizonYears: 3,
      basePopulation: 5000,
      growthRate: 0,
      strategies: [
        { id: 'A', name: 'No tratar', annualCost: 200, linkedStrategyId: 'no' },
        { id: 'B', name: 'Estándar', annualCost: 1200, linkedStrategyId: 'std' },
        { id: 'C', name: 'Nuevo', annualCost: 4800, linkedStrategyId: 'new' },
      ],
      currentShares: [
        [0.25, 0.75, 0],
        [0.25, 0.75, 0],
        [0.25, 0.75, 0],
      ],
      newShares: [
        [0.25, 0.75, 0],
        [0.2, 0.55, 0.25],
        [0.15, 0.35, 0.5],
      ],
      uncertain: [{ parameter: 'basePopulation', distribution: { type: 'uniform', args: ['4000', '6000'] }, low: 4000, high: 6000 }],
    },
  }
}

function chronicMarkov(kind: 'est' | 'new'): MarkovSpec {
  return {
    cycles: 10,
    cycleLength: 1,
    startAge: 60,
    method: 'wcc',
    discountTiming: 'start',
    discountRates: { cost: 0.03, effect: 0.03 },
    termination: '',
    trackers: [{ name: 'anios', initial: '0', update: 'anios+1', description: 'Ciclos acumulados' }],
    initialProbabilities: [
      { stateId: 'estable', probability: '1' },
      { stateId: 'prog', probability: '0' },
      { stateId: 'dead', probability: '0' },
    ],
    states: [
      {
        id: 'estable',
        name: 'Estable',
        initial: pay('0', '0'),
        incremental: pay('c_farmaco', 'u_estable'),
        final: pay('0', '0'),
        startup: pay('0', '0'),
        cycle: pay('c_farmaco', 'u_estable'),
        event: pay('0', '0'),
        transitions: [
          { to: 'prog', probability: 'p_prog' },
          { to: 'dead', probability: 'lookup("mortalidad", _age)' },
          { to: 'estable', probability: '#' },
        ],
      },
      {
        id: 'prog',
        name: 'Progresión',
        initial: pay('0', '0'),
        incremental: pay('c_farmaco+c_prog', 'u_prog'),
        final: pay('0', '0'),
        startup: pay('0', '0'),
        cycle: pay('c_farmaco+c_prog', 'u_prog'),
        event: pay('0', '0'),
        transitions: [
          { to: 'dead', probability: 'p_muerte_prog' },
          { to: 'prog', probability: '#' },
        ],
      },
      {
        id: 'dead',
        name: 'Muerte',
        absorbing: true,
        initial: pay('0', '0'),
        incremental: pay('0', '0'),
        final: pay('0', '0'),
        startup: pay('0', '0'),
        cycle: pay('0', '0'),
        event: pay('0', '0'),
        transitions: [{ to: 'dead', probability: '1' }],
      },
    ],
  }
  void kind
}

export function markovExample(): HealthModel {
  const estándar: TreeNode = {
    id: 'mk_est',
    type: 'markov',
    name: 'Estándar',
    payoffs: pay(),
    branches: [],
    markov: chronicMarkov('est'),
    definitions: [
      { name: 'p_prog', expression: 'p_prog_est' },
      { name: 'c_farmaco', expression: 'c_est' },
    ],
  }
  const nuevo: TreeNode = {
    id: 'mk_new',
    type: 'markov',
    name: 'Nuevo',
    payoffs: pay(),
    branches: [],
    markov: chronicMarkov('new'),
    definitions: [
      { name: 'p_prog', expression: 'p_prog_nuevo' },
      { name: 'c_farmaco', expression: 'c_nuevo' },
    ],
  }
  const rows = Array.from({ length: 21 }, (_, i) => [60 + i, 0.008 + i * 0.001])
  return {
    version: 1,
    name: 'Enfermedad crónica: Markov',
    description:
      'Cohorte de 10 años con corrección dentro del ciclo (WCC), descuento del 3 % y mortalidad por edad leída de una tabla. El tratamiento nuevo cuesta más y retrasa la progresión. Puede lanzar la microsimulación y el Monte Carlo desde sus pestañas.',
    payoffs: [
      { id: 'cost', label: 'Costo', role: 'cost' },
      { id: 'effect', label: 'AVAC', role: 'effect' },
    ],
    preferences: { ...defaultPreferences(), wtp: 30000, referenceStrategyId: 'est', microsimN: 400 },
    variables: [
      { name: 'p_prog', expression: '0.12', description: 'Progresión anual por defecto' },
      {
        name: 'p_prog_est',
        expression: '0.12',
        description: 'Progresión con tratamiento estándar',
        low: 0.05,
        high: 0.2,
        sampleRate: 'trial',
        distribution: { type: 'beta', args: ['12', '88'] },
      },
      {
        name: 'p_prog_nuevo',
        expression: '0.05',
        description: 'Progresión con tratamiento nuevo',
        low: 0.02,
        high: 0.1,
        sampleRate: 'trial',
        distribution: { type: 'beta', args: ['5', '95'] },
      },
      { name: 'c_est', expression: '400', description: 'Costo anual del fármaco estándar', low: 200, high: 800 },
      {
        name: 'c_nuevo',
        expression: '2200',
        description: 'Costo anual del fármaco nuevo',
        low: 1000,
        high: 4000,
        sampleRate: 'trial',
        distribution: { type: 'gammaMeanSd', args: ['2200', '400'] },
      },
      { name: 'c_farmaco', expression: '400' },
      { name: 'c_prog', expression: '3500', description: 'Costo anual adicional en progresión', low: 2000, high: 5000 },
      {
        name: 'u_estable',
        expression: '0.80',
        description: 'Utilidad en estado estable. En la microsimulación varía entre pacientes.',
        sampleRate: 'individual',
        distribution: { type: 'uniform', args: ['0.70', '0.90'] },
      },
      { name: 'u_prog', expression: '0.55' },
      { name: 'p_muerte_prog', expression: '0.20', low: 0.1, high: 0.3 },
    ],
    dirichlet: [],
    mvnormal: [],
    correlations: [],
    tables: [{ name: 'mortalidad', columns: ['edad', 'qx'], rows, interpolate: true }],
    clones: [],
    tree: {
      id: 'root',
      type: 'decision',
      name: 'Tratamiento',
      payoffs: pay(),
      branches: [
        { id: 'est', label: 'Estándar', probability: '1', payoffs: pay(), child: estándar },
        { id: 'new', label: 'Nuevo', probability: '1', payoffs: pay(), child: nuevo },
      ],
    },
    bia: {
      ...emptyBia(),
      horizonYears: 5,
      basePopulation: 2000,
      growthRate: 0.02,
      eligibleFraction: 1,
      strategies: [
        { id: 'est', name: 'Estándar', annualCost: 400, linkedStrategyId: 'est' },
        { id: 'new', name: 'Nuevo', annualCost: 2200, linkedStrategyId: 'new' },
      ],
      currentShares: Array.from({ length: 5 }, () => [1, 0]),
      newShares: [
        [0.9, 0.1],
        [0.75, 0.25],
        [0.6, 0.4],
        [0.5, 0.5],
        [0.4, 0.6],
      ],
    },
  }
}
