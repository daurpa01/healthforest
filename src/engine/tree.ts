import { EngineError, type ModelWarning } from './errors'
import { addPayoffs, costId, decisionScore, effectId, payoffIds, scalePayoffs, zeroPayoffs } from './payoffs'
import { resolveProbabilities } from './probabilities'
import type { Rng } from './prng'
import { applyDefinitions, compileScope, readPayoffs, withKeywords, type RuntimeScope } from './scope'
import type { Branch, HealthModel, PayoffMap, SampleRate, TreeNode } from './types'
import { runMarkovCohort, type MarkovCohortResult } from './markov'
import { runMicrosimulation, type MicroResult } from './microsim'

export interface StrategyValue {
  id: string
  nodeId: string
  name: string
  payoffs: PayoffMap
  cost: number
  effect: number
}

export interface RollbackResult {
  payoffs: PayoffMap
  nodePayoffs: Record<string, PayoffMap>
  chosenBranch: Record<string, string>
  strategies: StrategyValue[]
  warnings: ModelWarning[]
  markov: Record<string, MarkovCohortResult>
  microsim: Record<string, MicroResult>
}

export interface RollbackOptions {
  scope?: RuntimeScope
  fixed?: Record<string, number>
  rng?: Rng
  rates?: SampleRate[]
  keywords?: Record<string, number>
  markovMode?: 'cohort' | 'microsim'
  microsimN?: number
  microsimSeed?: number
}

interface Ctx {
  model: HealthModel
  ids: string[]
  cost: string
  effect: string
  warnings: ModelWarning[]
  nodePayoffs: Record<string, PayoffMap>
  chosenBranch: Record<string, string>
  markov: Record<string, MarkovCohortResult>
  microsim: Record<string, MicroResult>
  stack: string[]
  markovMode: 'cohort' | 'microsim'
  microsimN: number
  microsimSeed: number
  rng?: Rng
}

export function rollback(model: HealthModel, options: RollbackOptions = {}): RollbackResult {
  let scope = options.scope ?? compileScope(model, { fixed: options.fixed, rng: options.rng, rates: options.rates })
  if (options.keywords) scope = withKeywords(scope, options.keywords)
  const ids = payoffIds(model.payoffs)
  const ctx: Ctx = {
    model,
    ids,
    cost: costId(model.payoffs),
    effect: effectId(model.payoffs),
    warnings: [...scope.warnings],
    nodePayoffs: {},
    chosenBranch: {},
    markov: {},
    microsim: {},
    stack: [],
    markovMode: options.markovMode ?? 'cohort',
    microsimN: options.microsimN ?? model.preferences.microsimN,
    microsimSeed: options.microsimSeed ?? model.preferences.microsimSeed,
    rng: options.rng,
  }
  const root = evalNode(model.tree, ctx, scope, true)
  const strategies =
    model.tree.type === 'decision'
      ? strategyList(model.tree, ctx, scope)
      : [toStrategy(model.tree.id, model.tree.id, model.tree.name, root, ctx)]
  return {
    payoffs: root,
    nodePayoffs: ctx.nodePayoffs,
    chosenBranch: ctx.chosenBranch,
    strategies,
    warnings: ctx.warnings,
    markov: ctx.markov,
    microsim: ctx.microsim,
  }
}

function strategyList(node: TreeNode, ctx: Ctx, scope: RuntimeScope): StrategyValue[] {
  const local = applyDefinitions(node.definitions, scope)
  const own = readPayoffs(node.payoffs, ctx.ids, local.eval)
  return node.branches.map((branch) => {
    const branchPay = readPayoffs(branch.payoffs, ctx.ids, local.eval)
    const child = evalNode(branch.child, ctx, local, false)
    const total = addPayoffs(addPayoffs(own, branchPay, ctx.ids), child, ctx.ids)
    return toStrategy(branch.id, branch.child.id, branch.label || branch.child.name, total, ctx)
  })
}

function toStrategy(id: string, nodeId: string, name: string, payoffs: PayoffMap, ctx: Ctx): StrategyValue {
  return { id, nodeId, name, payoffs, cost: payoffs[ctx.cost] ?? 0, effect: payoffs[ctx.effect] ?? 0 }
}

function evalNode(node: TreeNode, ctx: Ctx, scope: RuntimeScope, atRoot: boolean): PayoffMap {
  if (node.type === 'decision' && atRoot) {
    const values = strategyList(node, ctx, scope)
    const best = bestIndex(values.map((item) => item.payoffs), ctx)
    ctx.chosenBranch[node.id] = node.branches[best]?.id ?? ''
    const total = values[best]?.payoffs ?? zeroPayoffs(ctx.ids)
    ctx.nodePayoffs[node.id] = total
    return total
  }
  const local = applyDefinitions(node.definitions, scope)
  const own = readPayoffs(node.payoffs, ctx.ids, local.eval)
  let downstream = zeroPayoffs(ctx.ids)
  if (node.type === 'terminal' || (node.type !== 'markov' && node.type !== 'clone' && node.branches.length === 0 && node.type !== 'logic')) {
    downstream = zeroPayoffs(ctx.ids)
  } else {
    switch (node.type) {
      case 'chance':
        downstream = evalChance(node, ctx, local)
        break
      case 'decision':
        downstream = evalDecision(node, ctx, local)
        break
      case 'logic':
        downstream = evalLogic(node, ctx, local)
        break
      case 'clone':
        downstream = evalClone(node, ctx, local)
        break
      case 'markov':
        downstream = evalMarkov(node, ctx, local)
        break
      default:
        downstream = zeroPayoffs(ctx.ids)
    }
  }
  const total = addPayoffs(own, downstream, ctx.ids)
  ctx.nodePayoffs[node.id] = total
  return total
}

function evalChance(node: TreeNode, ctx: Ctx, scope: RuntimeScope): PayoffMap {
  const resolved = resolveProbabilities(
    node.branches.map((branch) => branch.probability),
    scope.eval,
  )
  for (const warning of resolved.warnings) ctx.warnings.push({ ...warning, nodeId: node.id })
  let probs = resolved.probs
  const sum = probs.reduce((acc, value) => acc + value, 0)
  if (!resolved.usedComplement && ctx.model.preferences.normalizeProbabilities && sum > 0 && Math.abs(sum - 1) > 1e-8) {
    probs = probs.map((value) => value / sum)
    ctx.warnings.push({ code: 'probability-normalized', nodeId: node.id, detail: String(sum) })
  }
  let acc = zeroPayoffs(ctx.ids)
  node.branches.forEach((branch, index) => {
    const branchPay = readPayoffs(branch.payoffs, ctx.ids, scope.eval)
    const child = evalNode(branch.child, ctx, scope, false)
    const weighted = scalePayoffs(addPayoffs(branchPay, child, ctx.ids), probs[index] ?? 0, ctx.ids)
    acc = addPayoffs(acc, weighted, ctx.ids)
  })
  return acc
}

function evalDecision(node: TreeNode, ctx: Ctx, scope: RuntimeScope): PayoffMap {
  const totals = node.branches.map((branch) => branchTotal(branch, ctx, scope))
  const best = bestIndex(totals, ctx)
  ctx.chosenBranch[node.id] = node.branches[best]?.id ?? ''
  return totals[best] ?? zeroPayoffs(ctx.ids)
}

function evalLogic(node: TreeNode, ctx: Ctx, scope: RuntimeScope): PayoffMap {
  if (node.branches.length < 2) throw new EngineError('logic-branches', node.name)
  const condition = evaluateSafe(node.condition, scope)
  const branch = condition !== 0 ? node.branches[0] : node.branches[1]
  return branchTotal(branch, ctx, scope)
}

function evalClone(node: TreeNode, ctx: Ctx, scope: RuntimeScope): PayoffMap {
  const master = findMaster(ctx.model, node.cloneMasterId)
  if (!master) throw new EngineError('unknown-clone', node.cloneMasterId)
  if (ctx.stack.includes(master.id)) throw new EngineError('clone-cycle', master.id)
  ctx.stack.push(master.id)
  try {
    return evalNode(master, ctx, scope, false)
  } finally {
    ctx.stack.pop()
  }
}

function evalMarkov(node: TreeNode, ctx: Ctx, scope: RuntimeScope): PayoffMap {
  if (!node.markov) throw new EngineError('markov-missing', node.name)
  if (ctx.markovMode === 'microsim') {
    const result = runMicrosimulation(node.markov, ctx.model, scope, {
      n: ctx.microsimN,
      seed: hashSeed(ctx.microsimSeed, node.id),
    })
    ctx.microsim[node.id] = result
    for (const warning of result.warnings) ctx.warnings.push(warning)
    return result.mean
  }
  const result = runMarkovCohort(node.markov, ctx.model, scope, { rng: ctx.rng })
  ctx.markov[node.id] = result
  for (const warning of result.warnings) ctx.warnings.push({ ...warning, nodeId: node.id })
  return result.total
}

function branchTotal(branch: Branch, ctx: Ctx, scope: RuntimeScope): PayoffMap {
  const branchPay = readPayoffs(branch.payoffs, ctx.ids, scope.eval)
  const child = evalNode(branch.child, ctx, scope, false)
  return addPayoffs(branchPay, child, ctx.ids)
}

function bestIndex(totals: PayoffMap[], ctx: Ctx): number {
  const rule = ctx.model.preferences.decisionRule
  const wtp = ctx.model.preferences.wtp
  let best = 0
  let bestScore = -Infinity
  totals.forEach((pay, index) => {
    const score = decisionScore(pay[ctx.cost] ?? 0, pay[ctx.effect] ?? 0, rule, wtp)
    if (score > bestScore + 1e-12) {
      bestScore = score
      best = index
    }
  })
  return best
}

function evaluateSafe(expression: string | undefined, scope: RuntimeScope): number {
  return readPayoffs({ v: expression ?? '0' }, ['v'], scope.eval).v ?? 0
}

export function findMaster(model: HealthModel, masterId: string | undefined): TreeNode | undefined {
  if (!masterId) return undefined
  const inTree = findBy((node) => node.masterId === masterId, model.tree)
  if (inTree) return inTree
  return model.clones.find((clone) => clone.id === masterId)?.node
}

function findBy(pred: (node: TreeNode) => boolean, node: TreeNode): TreeNode | undefined {
  if (pred(node)) return node
  for (const branch of node.branches) {
    const found = findBy(pred, branch.child)
    if (found) return found
  }
  return undefined
}

function hashSeed(seed: number, id: string): number {
  let h = seed >>> 0
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x5bd1e995)
  return h >>> 0
}

