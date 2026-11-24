import type { Branch, HealthModel, TreeNode } from '../engine/types'
import { freshId, makeNode, pay } from './defaults'

export type Focus = { kind: 'main' } | { kind: 'transition'; nodeId: string; stateId: string }

export function findNode(tree: TreeNode, id: string): TreeNode | undefined {
  if (tree.id === id) return tree
  for (const branch of tree.branches) {
    const found = findNode(branch.child, id)
    if (found) return found
  }
  return undefined
}

export function findBranch(tree: TreeNode, branchId: string): { parent: TreeNode; branch: Branch; index: number } | undefined {
  for (let index = 0; index < tree.branches.length; index++) {
    const branch = tree.branches[index]
    if (branch.id === branchId) return { parent: tree, branch, index }
    const nested = findBranch(branch.child, branchId)
    if (nested) return nested
  }
  return undefined
}

export function mapNode(tree: TreeNode, id: string, fn: (node: TreeNode) => TreeNode): TreeNode {
  if (tree.id === id) return fn(tree)
  let changed = false
  const branches = tree.branches.map((branch) => {
    const child = mapNode(branch.child, id, fn)
    if (child !== branch.child) changed = true
    return child === branch.child ? branch : { ...branch, child }
  })
  return changed ? { ...tree, branches } : tree
}

export function readTree(model: HealthModel, focus: Focus): TreeNode {
  if (focus.kind === 'main') return model.tree
  const node = findNode(model.tree, focus.nodeId)
  return node?.markov?.states.find((state) => state.id === focus.stateId)?.transitionTree ?? makeNode('chance', 'Transición')
}

export function writeTree(model: HealthModel, focus: Focus, next: TreeNode): HealthModel {
  if (focus.kind === 'main') return { ...model, tree: next }
  return {
    ...model,
    tree: mapNode(model.tree, focus.nodeId, (node) => {
      if (!node.markov) return node
      return {
        ...node,
        markov: {
          ...node.markov,
          states: node.markov.states.map((state) => (state.id === focus.stateId ? { ...state, transitionTree: next } : state)),
        },
      }
    }),
  }
}

export function updateNode(tree: TreeNode, id: string, patch: Partial<TreeNode>): TreeNode {
  return mapNode(tree, id, (node) => ({ ...node, ...patch, id: node.id }))
}

export function updateBranch(tree: TreeNode, branchId: string, patch: Partial<Branch>): TreeNode {
  const apply = (node: TreeNode): TreeNode => ({
    ...node,
    branches: node.branches.map((branch) => {
      const child = apply(branch.child)
      if (branch.id === branchId) return { ...branch, ...patch, id: branch.id, child }
      return child === branch.child ? branch : { ...branch, child }
    }),
  })
  return apply(tree)
}

export function addBranch(tree: TreeNode, parentId: string, type: TreeNode['type'], label?: string): TreeNode {
  const child = makeNode(type, label || defaultChildName(type))
  const branch: Branch = {
    id: freshId('b'),
    label: label || child.name,
    probability: '#',
    payoffs: pay(),
    child,
  }
  return mapNode(tree, parentId, (node) => {
    const hasHash = node.branches.some((item) => item.probability.trim() === '#')
    const probability = node.branches.length === 0 ? '1' : hasHash ? '0' : '#'
    return {
      ...node,
      type: node.type === 'terminal' ? 'chance' : node.type,
      branches: [...node.branches, { ...branch, probability }],
    }
  })
}

export function removeBranch(tree: TreeNode, branchId: string): TreeNode {
  const apply = (node: TreeNode): TreeNode => ({
    ...node,
    branches: node.branches.filter((branch) => branch.id !== branchId).map((branch) => ({ ...branch, child: apply(branch.child) })),
  })
  return apply(tree)
}

export function moveBranch(tree: TreeNode, branchId: string, direction: -1 | 1): TreeNode {
  const apply = (node: TreeNode): TreeNode => {
    const index = node.branches.findIndex((branch) => branch.id === branchId)
    const branches = node.branches.map((branch) => ({ ...branch, child: apply(branch.child) }))
    if (index < 0) return { ...node, branches }
    const target = index + direction
    if (target < 0 || target >= branches.length) return { ...node, branches }
    const [item] = branches.splice(index, 1)
    branches.splice(target, 0, item)
    return { ...node, branches }
  }
  return apply(tree)
}

export function duplicateBranch(tree: TreeNode, branchId: string): TreeNode {
  const apply = (node: TreeNode): TreeNode => {
    const branches: Branch[] = []
    for (const branch of node.branches) {
      const child = apply(branch.child)
      const current = child === branch.child ? branch : { ...branch, child }
      branches.push(current)
      if (branch.id === branchId) {
        branches.push({ ...cloneBranch(branch), label: `${branch.label} copia` })
      }
    }
    return { ...node, branches }
  }
  return apply(tree)
}

export function cloneBranch(branch: Branch): Branch {
  return { ...structuredClone(branch), id: freshId('b'), child: regenerate(branch.child) }
}

function regenerate(node: TreeNode): TreeNode {
  let markov = node.markov
  if (markov) {
    const ids = new Map(markov.states.map((item) => [item.id, freshId('s')]))
    markov = {
      ...markov,
      initialProbabilities: markov.initialProbabilities.map((item) => ({
        ...item,
        stateId: ids.get(item.stateId) ?? item.stateId,
      })),
      states: markov.states.map((item) => ({
        ...item,
        id: ids.get(item.id) ?? item.id,
        transitions: item.transitions.map((transition) => ({ ...transition, to: ids.get(transition.to) ?? transition.to })),
        transitionTree: item.transitionTree ? remapJumps(regenerate(item.transitionTree), ids) : undefined,
      })),
    }
  }
  return {
    ...node,
    id: freshId('n'),
    masterId: undefined,
    branches: node.branches.map((branch) => ({ ...branch, id: freshId('b'), child: regenerate(branch.child) })),
    markov,
  }
}

function remapJumps(node: TreeNode, ids: Map<string, string>): TreeNode {
  return {
    ...node,
    jumpTo: node.jumpTo ? ids.get(node.jumpTo) ?? node.jumpTo : undefined,
    branches: node.branches.map((branch) => ({ ...branch, child: remapJumps(branch.child, ids) })),
  }
}

function defaultChildName(type: TreeNode['type']): string {
  switch (type) {
    case 'decision':
      return 'Decisión'
    case 'chance':
      return 'Azar'
    case 'markov':
      return 'Markov'
    case 'logic':
      return 'Condición'
    case 'clone':
      return 'Clon'
    default:
      return 'Resultado'
  }
}

export function listMasters(tree: TreeNode, acc: TreeNode[] = []): TreeNode[] {
  if (tree.masterId) acc.push(tree)
  for (const branch of tree.branches) listMasters(branch.child, acc)
  return acc
}
