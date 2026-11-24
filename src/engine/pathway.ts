import { evaluate } from './expr'
import { addPayoffs, scalePayoffs, zeroPayoffs } from './payoffs'
import { resolveProbabilities } from './probabilities'
import { applyDefinitions, compileScope, readPayoffs, type RuntimeScope } from './scope'
import type { HealthModel, PayoffMap, TreeNode } from './types'

export interface PathwayRow {
  probability: number
  payoffs: PayoffMap
  weighted: PayoffMap
  labels: string[]
}

/** Root-to-terminal paths. Payoffs on intermediate nodes count for every path through them. */
export function pathwayReport(model: HealthModel, node: TreeNode = model.tree): PathwayRow[] {
  const scope = compileScope(model)
  const ids = model.payoffs.map((item) => item.id)
  return walk(node, model, scope, ids, 1, zeroPayoffs(ids), [], [])
}

function walk(
  node: TreeNode,
  model: HealthModel,
  scope: RuntimeScope,
  ids: string[],
  pathP: number,
  carried: PayoffMap,
  labels: string[],
  stack: string[],
): PathwayRow[] {
  if (node.type === 'markov') return []
  const local = applyDefinitions(node.definitions, scope)
  const here = addPayoffs(carried, readPayoffs(node.payoffs, ids, local.eval), ids)
  if (node.type === 'clone') {
    const master = find(model.tree, node.cloneMasterId)
    if (!master || stack.includes(master.id)) return []
    return walk(master, model, local, ids, pathP, here, labels, [...stack, master.id])
  }
  if (node.type === 'terminal' || node.branches.length === 0) {
    return [row(pathP, here, labels, ids)]
  }
  if (node.type === 'decision') {
    return node.branches.flatMap((branch) =>
      walk(branch.child, model, local, ids, pathP, addPayoffs(here, readPayoffs(branch.payoffs, ids, local.eval), ids), [...labels, branch.label], stack),
    )
  }
  const resolved = resolveProbabilities(
    node.branches.map((branch) => branch.probability),
    local.eval,
  )
  return node.branches.flatMap((branch, index) =>
    walk(
      branch.child,
      model,
      local,
      ids,
      pathP * (resolved.probs[index] ?? 0),
      addPayoffs(here, readPayoffs(branch.payoffs, ids, local.eval), ids),
      [...labels, branch.label],
      stack,
    ),
  )
}

function row(probability: number, payoffs: PayoffMap, labels: string[], ids: string[]): PathwayRow {
  return {
    probability,
    payoffs,
    weighted: scalePayoffs(payoffs, probability, ids),
    labels,
  }
}

function find(node: TreeNode, masterId?: string): TreeNode | undefined {
  if (!masterId) return undefined
  if (node.masterId === masterId || node.id === masterId) return node
  for (const branch of node.branches) {
    const found = find(branch.child, masterId)
    if (found) return found
  }
  return undefined
}

export function pathwayTotal(rows: PathwayRow[], ids: string[]): PayoffMap {
  return rows.reduce((acc, row) => addPayoffs(acc, row.weighted, ids), zeroPayoffs(ids))
}

export function numericExpression(expression: string, model: HealthModel): number {
  return evaluate(expression, compileScope(model).eval)
}
