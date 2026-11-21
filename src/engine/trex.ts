import { blankModel, pay } from '../model/defaults'
import type { DistributionSpec, HealthModel, MarkovState, TreeNode, Variable } from './types'

export interface TrexImportNotes {
  warnings: string[]
  monteCarlo: { trials: number; runTrials: boolean; samples: number }
  distributions: number
}

interface XmlEl {
  name: string
  attrs: Record<string, string>
  children: XmlEl[]
}

const NODE_TYPES: Record<string, TreeNode['type']> = {
  DecisionNode: 'decision',
  ChanceNode: 'chance',
  TerminalNode: 'terminal',
  MarkovNode: 'markov',
  LogicNode: 'logic',
  BooleanNode: 'logic',
  CloneNode: 'clone',
}

/** TreeAge separates function arguments with semicolons. */
export function translateTreeAgeFormula(source: string): string {
  let depth = 0
  let out = ''
  for (const char of source.trim()) {
    if (char === '(') depth += 1
    if (char === ')') depth = Math.max(0, depth - 1)
    out += char === ';' && depth > 0 ? ',' : char
  }
  return out.replace(/_STAGE\b/g, '_stage')
}

export function importTrex(xml: string, options: { name?: string } = {}): HealthModel {
  const root = parseXml(xml)
  const treeEl = findFirst(root, 'Tree') ?? root
  const notes: string[] = []
  const preferences = new Map<string, string>()
  for (const pref of findAll(treeEl, 'Preference')) {
    if (pref.attrs.Name) preferences.set(pref.attrs.Name, pref.attrs.Value ?? '')
  }
  const variableValues = new Map<string, string>()
  const rootNode = childrenNamed(treeEl, 'Node')[0]
  if (rootNode) {
    for (const def of childrenNamed(rootNode, 'Definition')) {
      if (def.attrs.Variable) variableValues.set(def.attrs.Variable, translateTreeAgeFormula(def.attrs.Value ?? '0'))
    }
  }
  const variables: Variable[] = childrenNamed(treeEl, 'Variable').map((variable) => {
    const name = variable.attrs.NameID || variable.attrs.Variable || 'v'
    const range = childrenNamed(variable, 'SensitivityRange')[0]
    const low = range?.attrs.LowValue
    const high = range?.attrs.HighValue
    return {
      name,
      expression: variableValues.get(name) ?? variable.attrs.Value ?? '0',
      description: [variable.attrs.Label, variable.attrs.Comment].filter(Boolean).join(' — ') || undefined,
      low: low !== undefined && low !== '' ? Number(low) : undefined,
      high: high !== undefined && high !== '' ? Number(high) : undefined,
    }
  })
  for (const [name, value] of variableValues) {
    if (!variables.some((item) => item.name === name)) variables.push({ name, expression: value, description: undefined, low: undefined, high: undefined })
  }
  if (!rootNode) throw new Error('trex-no-tree')
  const distributions = childrenNamed(treeEl, 'Distribution').map(convertDistribution)
  for (const dist of distributions) {
    if (!variables.some((item) => item.name === dist.name)) {
      variables.push({ name: dist.name, expression: '', description: dist.type, low: undefined, high: undefined, distribution: dist.spec })
    }
  }
  for (const variable of variables) {
    const hit = distributions.find((dist) => dist.name === variable.expression)
    if (hit) variable.distribution = hit.spec
  }
  const variableNames = new Set(variables.map((item) => item.name))
  const model = blankModel()
  model.name = options.name ?? rootNode.attrs.Label ?? rootNode.attrs.NameID ?? 'TreeAge'
  model.description =
    'Importado de TreeAge (.trex). annuity y discount son valor presente. Las tablas se consultan con nombre[edad].'
  model.tree = convertNode(rootNode, variableNames, true)
  model.variables = variables
  model.tables = childrenNamed(treeEl, 'Table').map(convertTable)
  model.preferences.currencySymbol = preferences.get('currencySymbol') || '$'
  model.preferences.decimals = Number(preferences.get('forPayoff1evDecPlaces') ?? 2)
  const samples = Number(preferences.get('monteNumSamples') || preferences.get('monteNumTrials') || 0)
  if (samples > 0) model.preferences.psaTrials = samples
  model.preferences.wtp = 5000
  model.preferences.referenceStrategyId = model.tree.branches[0]?.id
  const payoff2 = preferences.get('forPayoff2unitsText')
  if (payoff2 && payoff2 !== 'None') {
    const effect = model.payoffs.find((item) => item.role === 'effect')
    if (effect) effect.label = payoff2
  }
  model.payoffs.find((item) => item.role === 'cost')!.label = 'Costo'
  void notes
  return model
}

export function trexNotes(xml: string): TrexImportNotes {
  const root = parseXml(xml)
  const treeEl = findFirst(root, 'Tree') ?? root
  const preferences = new Map<string, string>()
  for (const pref of findAll(treeEl, 'Preference')) preferences.set(pref.attrs.Name ?? '', pref.attrs.Value ?? '')
  const distributions = countNamed(treeEl, 'Distribution')
  return {
    warnings: distributions === 0 ? ['El archivo no define distribuciones. El Monte Carlo del .trex no está activado.'] : [],
    monteCarlo: {
      trials: Number(preferences.get('monteNumTrials') ?? 0),
      runTrials: preferences.get('monteRunTrials') === 'true',
      samples: Number(preferences.get('monteNumSamples') ?? 0),
    },
    distributions,
  }
}

function convertNode(el: XmlEl, variableNames: Set<string>, isRoot: boolean): TreeNode {
  const type = NODE_TYPES[el.attrs.NodeType ?? ''] ?? 'chance'
  if (type === 'markov') return convertMarkov(el, variableNames)
  const definitions = childrenNamed(el, 'Definition')
    .filter((def) => !(isRoot && variableNames.has(def.attrs.Variable ?? '')))
    .map((def) => ({ name: def.attrs.Variable ?? 'x', expression: translateTreeAgeFormula(def.attrs.Value ?? '0') }))
  const payoffs = payoffMap(el)
  const branches = childrenNamed(el, 'Node').map((child) => {
    const prob = childrenNamed(child, 'Prob')[0]
    const probability = type === 'decision' ? '1' : translateTreeAgeFormula(prob?.attrs.Value ?? '0')
    return {
      id: safeId(prob?.attrs['xmi:id'] || `${child.attrs['xmi:id'] ?? child.attrs.NameID}_b`),
      label: labelOf(child),
      probability,
      payoffs: pay(),
      child: convertNode(child, variableNames, false),
    }
  })
  const node: TreeNode = {
    id: safeId(el.attrs['xmi:id'] || el.attrs.NameID || 'nodo'),
    type,
    name: labelOf(el),
    payoffs,
    branches,
    definitions: definitions.length ? definitions : undefined,
    notes: el.attrs.Comment || undefined,
  }
  const data = markovData(el)
  const jump = data?.attrs.MarkovJumpState
  if (jump) node.jumpTo = stateKey(jump)
  for (const reward of childrenNamed(data ?? { name: '', attrs: {}, children: [] }, 'TransitionReward')) {
    const set = reward.attrs.Set ?? '1'
    const key = set === '1' ? 'cost' : set === '2' ? 'effect' : `payoff${set}`
    node.payoffs[key] = formulaOf(reward)
  }
  return node
}

function convertMarkov(el: XmlEl, variableNames: Set<string>): TreeNode {
  const termination = translateTreeAgeFormula(childrenNamed(el, 'Termination')[0]?.attrs.Value ?? '')
  const cycles = Number(termination.match(/_stage\s*=\s*(\d+(?:\.\d+)?)/)?.[1] ?? 10)
  const states = childrenNamed(el, 'Node').filter(isMarkovState).map((child) => convertState(child, variableNames))
  return {
    id: safeId(el.attrs['xmi:id'] || el.attrs.NameID || 'markov'),
    type: 'markov',
    name: labelOf(el),
    payoffs: pay(),
    branches: [],
    markov: {
      cycles: Number.isFinite(cycles) && cycles > 0 ? cycles : 10,
      cycleLength: 1,
      startAge: 0,
      method: 'traditional',
      discountTiming: 'start',
      discountRates: { cost: 0, effect: 0 },
      termination: termination || undefined,
      initialProbabilities: states.map((state) => ({ stateId: state.id, probability: state.probability })),
      states: states.map(({ probability: _probability, ...state }) => state),
      trackers: [],
    },
  }
}

function isMarkovState(el: XmlEl): boolean {
  const data = markovData(el)
  return Boolean(data) || el.attrs.NodeType === 'TerminalNode'
}

function convertState(el: XmlEl, variableNames: Set<string>): MarkovState & { probability: string } {
  const id = stateKey(labelOf(el))
  const data = markovData(el)
  const kind = data?.attrs['xsi:type'] ?? ''
  const absorbing = kind.includes('MarkovStateData') && !kind.includes('NonAbsorbing')
  const rewards = rewardFields(data)
  const probability = translateTreeAgeFormula(childrenNamed(el, 'Prob')[0]?.attrs.Value ?? '0')
  const transitionNodes = childrenNamed(el, 'Node')
  return {
    id,
    name: labelOf(el),
    absorbing: absorbing || transitionNodes.length === 0,
    probability,
    initial: rewards.initial,
    incremental: rewards.incremental,
    final: rewards.final,
    startup: pay(),
    cycle: pay(),
    event: pay(),
    transitions: [],
    transitionTree: transitionNodes.length ? transitionRoot(el, variableNames) : undefined,
  }
}

function transitionRoot(state: XmlEl, variableNames: Set<string>): TreeNode {
  const node = convertNode({ ...state, attrs: { ...state.attrs, NodeType: 'ChanceNode' } }, variableNames, false)
  node.payoffs = pay()
  return node
}

function rewardFields(data: XmlEl | undefined): { initial: Record<string, string>; incremental: Record<string, string>; final: Record<string, string> } {
  const initial = pay()
  const incremental = pay()
  const final = pay()
  if (!data) return { initial, incremental, final }
  for (const reward of childrenNamed(data, 'StateReward')) {
    const set = reward.attrs.Set ?? '1'
    const key = set === '1' ? 'cost' : set === '2' ? 'effect' : `payoff${set}`
    initial[key] = formulaOf(childrenNamed(reward, 'Init')[0])
    incremental[key] = formulaOf(childrenNamed(reward, 'Incr')[0])
    final[key] = formulaOf(childrenNamed(reward, 'Final')[0])
  }
  return { initial, incremental, final }
}

function formulaOf(el: XmlEl | undefined): string {
  return translateTreeAgeFormula(el?.attrs.Value ?? '0')
}

function markovData(el: XmlEl): XmlEl | undefined {
  return el.children.find((child) => child.name === 'MarkovData')
}

function convertTable(el: XmlEl) {
  const rows = childrenNamed(el, 'Row').map((row) => [Number(row.attrs.Index), ...String(row.attrs.Values ?? '0').split(';').map(Number)])
  return {
    name: el.attrs.NameID || 'tabla',
    columns: ['index', 'value'],
    rows,
    interpolate: (el.attrs.LookupMethod ?? '').toLowerCase().includes('interpolat'),
  }
}

function convertDistribution(el: XmlEl): { name: string; type: string; spec: DistributionSpec } {
  const params = new Map(childrenNamed(el, 'Parameter').map((item) => [item.attrs.Name ?? '', translateTreeAgeFormula(item.attrs.Value ?? '0')]))
  const declared = (el.attrs.Type ?? '').toLowerCase()
  const name = el.attrs.NameID || 'dist'
  if (declared === 'beta' || params.has('alpha') && params.has('beta') && !params.has('lambda')) {
    return { name, type: 'beta', spec: { type: 'beta', args: [params.get('alpha') ?? '1', params.get('beta') ?? '1'] } }
  }
  if (declared === 'gamma' || params.has('lambda') || (params.has('alpha') && !params.has('mean'))) {
    const alpha = params.get('alpha') ?? '1'
    const lambda = params.get('lambda') ?? '1'
    return { name, type: 'gamma', spec: { type: 'gamma', args: [alpha, `(1/(${lambda}))`] } }
  }
  return { name, type: declared || 'normal', spec: { type: 'normal', args: [params.get('mean') ?? '0', params.get('stddev') ?? params.get('sd') ?? '1'] } }
}

function stateKey(label: string): string {
  const slug = label.trim().toLowerCase().replace(/\s+/g, '_')
  return /^[A-Za-z_]/.test(slug) ? slug : `s_${slug}`
}

function payoffMap(el: XmlEl): Record<string, string> {
  const result = pay()
  for (const payoff of childrenNamed(el, 'Payoff')) {
    const set = payoff.attrs.Set ?? '1'
    const formula = translateTreeAgeFormula(payoff.attrs.Value ?? '0')
    if (set === '1') result.cost = formula
    else if (set === '2') result.effect = formula
    else result[`payoff${set}`] = formula
  }
  return result
}

function labelOf(el: XmlEl): string {
  return el.attrs.Label || el.attrs.NameID || 'Nodo'
}

function safeId(value: string): string {
  const cleaned = value.replace(/[^\w.-]+/g, '_')
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `n_${cleaned}`
}

function childrenNamed(el: XmlEl, name: string): XmlEl[] {
  return el.children.filter((child) => child.name === name)
}

function findAll(el: XmlEl, name: string, acc: XmlEl[] = []): XmlEl[] {
  if (el.name === name) acc.push(el)
  for (const child of el.children) findAll(child, name, acc)
  return acc
}

function findFirst(el: XmlEl, name: string): XmlEl | undefined {
  if (el.name === name) return el
  for (const child of el.children) {
    const found = findFirst(child, name)
    if (found) return found
  }
  return undefined
}

function countNamed(el: XmlEl, name: string): number {
  return (el.name === name ? 1 : 0) + el.children.reduce((sum, child) => sum + countNamed(child, name), 0)
}

function parseXml(source: string): XmlEl {
  const tokens = tokenize(source)
  let index = 0
  const root: XmlEl = { name: '#root', attrs: {}, children: [] }
  const stack: XmlEl[] = [root]
  while (index < tokens.length) {
    const token = tokens[index++]
    if (token.kind === 'open') {
      const el: XmlEl = { name: localName(token.name), attrs: token.attrs, children: [] }
      stack[stack.length - 1].children.push(el)
      if (!token.selfClosing) stack.push(el)
    } else if (token.kind === 'close') {
      const name = localName(token.name)
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].name === name) {
          stack.splice(i)
          break
        }
      }
    }
  }
  return root.children.length === 1 ? root.children[0] : root
}

function localName(name: string): string {
  const cut = name.lastIndexOf(':')
  return cut >= 0 ? name.slice(cut + 1) : name
}

type Token =
  | { kind: 'open'; name: string; attrs: Record<string, string>; selfClosing: boolean }
  | { kind: 'close'; name: string }

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  const text = source.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '')
  const pattern = /<\/?([^\s/>]+)([^>]*)>/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    const closing = match[0].startsWith('</')
    const selfClosing = /\/>$/.test(match[0])
    if (closing) tokens.push({ kind: 'close', name: match[1] })
    else tokens.push({ kind: 'open', name: match[1], attrs: attrs(match[2]), selfClosing })
  }
  return tokens
}

function attrs(raw: string): Record<string, string> {
  const result: Record<string, string> = {}
  const pattern = /([\w:.-]+)\s*=\s*"([^"]*)"/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(raw))) result[match[1]] = decodeXml(match[2])
  return result
}

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}
