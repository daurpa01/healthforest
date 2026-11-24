import type { BiaModel, Branch, GraphStyle, HealthModel, MarkovSpec, MarkovState, Preferences, TreeNode } from './types'

export const pay = (cost: string, effect: string): Record<string, string> => ({ cost, effect })

export function node(partial: Partial<TreeNode> & Pick<TreeNode, 'id' | 'type' | 'name'>): TreeNode {
  return {
    payoffs: pay('0', '0'),
    branches: [],
    ...partial,
  }
}

export function branch(id: string, label: string, probability: string, child: TreeNode, cost = '0', effect = '0'): Branch {
  return { id, label, probability, payoffs: pay(cost, effect), child }
}

export function state(partial: Partial<MarkovState> & Pick<MarkovState, 'id' | 'name'>): MarkovState {
  const zero = pay('0', '0')
  return {
    initial: { ...zero },
    incremental: { ...zero },
    final: { ...zero },
    startup: { ...zero },
    cycle: { ...zero },
    event: { ...zero },
    transitions: [],
    ...partial,
  }
}

export function markov(partial: Partial<MarkovSpec> & Pick<MarkovSpec, 'states'>): MarkovSpec {
  return {
    cycles: 1,
    cycleLength: 1,
    startAge: 40,
    method: 'traditional',
    discountTiming: 'start',
    discountRates: { cost: 0, effect: 0 },
    initialProbabilities: partial.states.map((item, index) => ({ stateId: item.id, probability: index === 0 ? '1' : '0' })),
    trackers: [],
    ...partial,
  }
}

const graph: GraphStyle = {
  theme: 'light',
  fontFamily: 'Source Sans 3, sans-serif',
  fontSize: 13,
  nodeScale: 1,
  rankSpacing: 180,
  nodeSpacing: 84,
  alignTerminals: true,
  show: { probability: true, payoffs: true, expectedValue: true, variables: false, nodeNames: true },
  colors: {
    decision: '#1f6b4c',
    chance: '#1e4d7b',
    terminal: '#a33b24',
    markov: '#3c4f8a',
    logic: '#6b4c7a',
    clone: '#3f6f62',
    background: '#f4f1ea',
    line: '#c4b8a5',
    optimal: '#c8960c',
    text: '#1e2420',
    muted: '#6b645b',
  },
}

export function preferences(partial: Partial<Preferences> = {}): Preferences {
  return {
    wtp: 20000,
    currency: 'USD',
    currencySymbol: '$',
    decimals: 2,
    probabilityDecimals: 2,
    decisionRule: 'nmb',
    normalizeProbabilities: false,
    psaTrials: 1000,
    psaSeed: 1,
    microsimN: 200,
    microsimSeed: 1,
    wtpMin: 0,
    wtpMax: 50000,
    graph,
    ...partial,
  }
}

export function bia(partial: Partial<BiaModel> = {}): BiaModel {
  return {
    horizonYears: 1,
    discountRate: 0,
    populationMode: 'prevalence',
    basePopulation: 1000,
    growthRate: 0,
    eligibleFraction: 1,
    treatmentDuration: 1,
    forceSharesToOne: true,
    strategies: [],
    currentShares: [],
    newShares: [],
    uncertain: [],
    ...partial,
  }
}

export function model(partial: Partial<HealthModel> & Pick<HealthModel, 'tree'>): HealthModel {
  return {
    version: 1,
    name: 'Prueba',
    description: '',
    payoffs: [
      { id: 'cost', label: 'Costo', role: 'cost' },
      { id: 'effect', label: 'Efecto', role: 'effect' },
    ],
    preferences: preferences(),
    variables: [],
    dirichlet: [],
    mvnormal: [],
    correlations: [],
    tables: [],
    clones: [],
    bia: bia(),
    ...partial,
  }
}
