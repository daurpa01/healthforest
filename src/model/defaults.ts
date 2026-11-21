import type { BiaModel, GraphStyle, GraphTheme, HealthModel, MarkovSpec, MarkovState, Preferences, TreeNode } from '../engine/types'

export function freshId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`
}

export function themeGraph(theme: GraphTheme): GraphStyle {
  const shared = {
    theme,
    fontSize: 14,
    nodeScale: 1,
    rankSpacing: 210,
    nodeSpacing: 92,
    alignTerminals: true,
    show: { probability: true, payoffs: true, expectedValue: true, variables: false, nodeNames: true },
  }
  if (theme === 'dark') {
    return {
      ...shared,
      fontFamily: '"Source Sans 3", "Segoe UI", sans-serif',
      colors: {
        decision: '#2f9e72',
        chance: '#7eb0e0',
        terminal: '#e3a07a',
        markov: '#a9b6e6',
        logic: '#d2b0d8',
        clone: '#8fd0b8',
        background: '#121816',
        line: '#3e5148',
        optimal: '#e2b340',
        text: '#f4efe6',
        muted: '#b7c2ba',
      },
    }
  }
  if (theme === 'publication') {
    return {
      ...shared,
      fontFamily: 'Fraunces, Palatino, Georgia, serif',
      fontSize: 13,
      nodeScale: 0.96,
      colors: {
        decision: '#111111',
        chance: '#111111',
        terminal: '#111111',
        markov: '#111111',
        logic: '#111111',
        clone: '#111111',
        background: '#ffffff',
        line: '#222222',
        optimal: '#111111',
        text: '#111111',
        muted: '#444444',
      },
    }
  }
  return {
    ...shared,
    fontFamily: '"Source Sans 3", "Segoe UI", sans-serif',
    colors: {
      decision: '#1f6b4c',
      chance: '#1e4d7b',
      terminal: '#a33b24',
      markov: '#3c4f8a',
      logic: '#6d4c7d',
      clone: '#3f6f62',
      background: '#f3eee4',
      line: '#c9bba6',
      optimal: '#b5811a',
      text: '#1c1915',
      muted: '#6d655c',
    },
  }
}

export function defaultPreferences(theme: GraphTheme = 'light'): Preferences {
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
    microsimN: 400,
    microsimSeed: 1,
    wtpMin: 0,
    wtpMax: 80000,
    graph: themeGraph(theme),
  }
}

export function emptyBia(): BiaModel {
  return {
    horizonYears: 5,
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
  }
}

export function pay(cost = '0', effect = '0'): Record<string, string> {
  return { cost, effect }
}

export function makeNode(type: TreeNode['type'], name: string): TreeNode {
  const base: TreeNode = { id: freshId('n'), type, name, payoffs: pay(), branches: [] }
  if (type === 'terminal') return base
  if (type === 'logic') {
    return {
      ...base,
      condition: '1',
      branches: [
        { id: freshId('b'), label: 'Sí', probability: '1', payoffs: pay(), child: makeNode('terminal', 'Sí') },
        { id: freshId('b'), label: 'No', probability: '1', payoffs: pay(), child: makeNode('terminal', 'No') },
      ],
    }
  }
  if (type === 'markov') return { ...base, markov: defaultMarkov() }
  if (type === 'clone') return { ...base, cloneMasterId: '' }
  return base
}

export function defaultState(id: string, name: string, absorbing = false): MarkovState {
  return {
    id,
    name,
    absorbing,
    initial: pay('0', '0'),
    incremental: absorbing ? pay('0', '0') : pay('100', '0.8'),
    final: pay('0', '0'),
    startup: pay('0', '0'),
    cycle: absorbing ? pay('0', '0') : pay('100', '0.8'),
    event: pay('0', '0'),
    transitions: absorbing
      ? [{ to: id, probability: '1' }]
      : [
          { to: id, probability: '#' },
          { to: 's_dead', probability: '0.1' },
        ],
  }
}

export function defaultMarkov(): MarkovSpec {
  const alive = defaultState('s_alive', 'Vivo')
  const dead = defaultState('s_dead', 'Muerto', true)
  return {
    cycles: 10,
    cycleLength: 1,
    startAge: 55,
    method: 'wcc',
    discountTiming: 'start',
    discountRates: { cost: 0.03, effect: 0.03 },
    initialProbabilities: [
      { stateId: alive.id, probability: '1' },
      { stateId: dead.id, probability: '0' },
    ],
    states: [alive, dead],
    trackers: [],
  }
}

export function blankModel(): HealthModel {
  const a = makeNode('terminal', 'Estrategia A')
  a.payoffs = pay('100', '1')
  const b = makeNode('terminal', 'Estrategia B')
  b.payoffs = pay('180', '1.4')
  return {
    version: 1,
    name: 'Modelo sin título',
    description: '',
    payoffs: [
      { id: 'cost', label: 'Costo', role: 'cost' },
      { id: 'effect', label: 'Efecto', role: 'effect' },
    ],
    preferences: defaultPreferences(),
    variables: [],
    dirichlet: [],
    mvnormal: [],
    correlations: [],
    tables: [],
    clones: [],
    bia: emptyBia(),
    tree: {
      id: 'root',
      type: 'decision',
      name: 'Decisión',
      payoffs: pay(),
      branches: [
        { id: 'b_a', label: 'Estrategia A', probability: '1', payoffs: pay(), child: a },
        { id: 'b_b', label: 'Estrategia B', probability: '1', payoffs: pay(), child: b },
      ],
    },
  }
}

export function normalizeModel(input: unknown): HealthModel {
  if (!input || typeof input !== 'object') throw new Error('model')
  const raw = input as Partial<HealthModel>
  if (!raw.tree || typeof raw.tree !== 'object') throw new Error('tree')
  const blank = blankModel()
  const graph = {
    ...blank.preferences.graph,
    ...raw.preferences?.graph,
    show: { ...blank.preferences.graph.show, ...raw.preferences?.graph?.show },
    colors: { ...blank.preferences.graph.colors, ...raw.preferences?.graph?.colors },
  }
  return {
    ...blank,
    ...raw,
    version: 1,
    tree: raw.tree,
    payoffs: raw.payoffs?.length ? raw.payoffs : blank.payoffs,
    preferences: { ...blank.preferences, ...raw.preferences, graph },
    variables: raw.variables ?? [],
    dirichlet: raw.dirichlet ?? [],
    mvnormal: raw.mvnormal ?? [],
    correlations: raw.correlations ?? [],
    tables: raw.tables ?? [],
    clones: raw.clones ?? [],
    bia: { ...blank.bia, ...raw.bia, strategies: raw.bia?.strategies ?? [], uncertain: raw.bia?.uncertain ?? [] },
  }
}
