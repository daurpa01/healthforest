import { blankModel, pay } from '../model/defaults'
import type { HealthModel, TreeNode } from './types'

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
  return out
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
      if (def.attrs.Variable) variableValues.set(def.attrs.Variable, def.attrs.Value ?? '0')
    }
  }
  const variables = childrenNamed(treeEl, 'Variable').map((variable) => {
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
  const variableNames = new Set(variables.map((item) => item.name))
  const model = blankModel()
  model.name = options.name ?? rootNode.attrs.Label ?? rootNode.attrs.NameID ?? 'TreeAge'
  model.description =
    'Importado de TreeAge (.trex). Las funciones annuity y discount se evalúan como valor presente. El archivo no trae un umbral de pago.'
  model.tree = convertNode(rootNode, variableNames, true)
  model.variables = variables
  model.preferences.currencySymbol = preferences.get('currencySymbol') || '$'
  model.preferences.decimals = Number(preferences.get('forPayoff1evDecPlaces') ?? 2)
  model.preferences.psaTrials = Number(preferences.get('monteNumTrials') ?? model.preferences.psaTrials) || model.preferences.psaTrials
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
  return {
    id: safeId(el.attrs['xmi:id'] || el.attrs.NameID || 'nodo'),
    type,
    name: labelOf(el),
    payoffs,
    branches,
    definitions: definitions.length ? definitions : undefined,
    notes: el.attrs.Comment || undefined,
  }
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
