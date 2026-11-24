import { EngineError, type ModelWarning } from './errors'
import { addPayoffs, costId, decisionScore, effectId, scalePayoffs, zeroPayoffs } from './payoffs'
import { resolveProbabilities } from './probabilities'
import { applyDefinitions, readPayoffs, type RuntimeScope } from './scope'
import type { HealthModel, PayoffMap, TreeNode } from './types'

export interface PathOutcome {
  probability: number
  payoffs: PayoffMap
  jumpTo?: string
}

/** Every terminal of a transition tree, with the probability of the path and the payoffs accumulated along it. */
export function walkOutcomes(node: TreeNode, model: HealthModel, scope: RuntimeScope, ids: string[]): PathOutcome[] {
  return walk(node, model, scope, ids, 1, zeroPayoffs(ids), [])
}

function walk(
  node: TreeNode,
  model: HealthModel,
  scope: RuntimeScope,
  ids: string[],
  pathP: number,
  incoming: PayoffMap,
  stack: string[],
): PathOutcome[] {
  const local = applyDefinitions(node.definitions, scope)
  const carried = addPayoffs(incoming, readPayoffs(node.payoffs, ids, local.eval), ids)
  if (node.type === 'markov') throw new EngineError('nested-markov', node.name)
  if (node.type === 'clone') {
    const master = findMaster(model, node.cloneMasterId)
    if (!master) throw new EngineError('unknown-clone', node.cloneMasterId)
    if (stack.includes(master.id)) throw new EngineError('clone-cycle', master.id)
    return walk(master, model, local, ids, pathP, carried, [...stack, master.id])
  }
  if (node.type === 'terminal' || (node.branches.length === 0 && node.type !== 'logic' && node.type !== 'decision')) {
    return [{ probability: pathP, payoffs: carried, jumpTo: node.jumpTo }]
  }
  if (node.type === 'logic') {
    if (node.branches.length < 2) throw new EngineError('logic-branches', node.name)
    const condition = readPayoffs({ v: node.condition ?? '0' }, ['v'], local.eval).v ?? 0
    const branch = condition !== 0 ? node.branches[0] : node.branches[1]
    const next = addPayoffs(carried, readPayoffs(branch.payoffs, ids, local.eval), ids)
    return walk(branch.child, model, local, ids, pathP, next, stack)
  }
  if (node.type === 'decision') {
    if (!node.branches.length) return [{ probability: pathP, payoffs: carried }]
    let best = 0
    let bestScore = -Infinity
    const wtp = model.preferences.wtp
    const cost = costId(model.payoffs)
    const effect = effectId(model.payoffs)
    node.branches.forEach((branch, index) => {
      const preview = walk(
        branch.child,
        model,
        local,
        ids,
        1,
        addPayoffs(carried, readPayoffs(branch.payoffs, ids, local.eval), ids),
        stack,
      )
      const ev = preview.reduce((acc, item) => addPayoffs(acc, scalePayoffs(item.payoffs, item.probability, ids), ids), zeroPayoffs(ids))
      const score = decisionScore(ev[cost] ?? 0, ev[effect] ?? 0, model.preferences.decisionRule, wtp)
      if (score > bestScore) {
        bestScore = score
        best = index
      }
    })
    const branch = node.branches[best]
    const next = addPayoffs(carried, readPayoffs(branch.payoffs, ids, local.eval), ids)
    return walk(branch.child, model, local, ids, pathP, next, stack)
  }
  const resolved = resolveProbabilities(
    node.branches.map((branch) => branch.probability),
    local.eval,
  )
  const out: PathOutcome[] = []
  node.branches.forEach((branch, index) => {
    const next = addPayoffs(carried, readPayoffs(branch.payoffs, ids, local.eval), ids)
    out.push(...walk(branch.child, model, local, ids, pathP * (resolved.probs[index] ?? 0), next, stack))
  })
  return out
}

export function outcomeWarnings(resolvedSum: number): ModelWarning[] {
  if (Math.abs(resolvedSum - 1) > 1e-6) return [{ code: 'probability-sum', detail: String(resolvedSum) }]
  return []
}

function findMaster(model: HealthModel, masterId: string | undefined): TreeNode | undefined {
  if (!masterId) return undefined
  const found = search(model.tree, masterId)
  if (found) return found
  return model.clones.find((clone) => clone.id === masterId)?.node
}

function search(node: TreeNode, masterId: string): TreeNode | undefined {
  if (node.masterId === masterId) return node
  for (const branch of node.branches) {
    const found = search(branch.child, masterId)
    if (found) return found
  }
  if (node.markov) {
    for (const state of node.markov.states) {
      if (state.transitionTree) {
        const found = search(state.transitionTree, masterId)
        if (found) return found
      }
    }
  }
  return undefined
}
