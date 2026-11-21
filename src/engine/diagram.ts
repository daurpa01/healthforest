import { pay } from '../model/defaults'
import type { MarkovSpec, MarkovState, TreeNode } from './types'

export interface DiagramState {
  id: string
  name: string
  absorbing?: boolean
}

export interface DiagramTransition {
  from: string
  to: string
  probability: string
}

export interface StateDiagram {
  states: DiagramState[]
  transitions: DiagramTransition[]
  cycles: number
}

/** A Markov specification drawn as states and arrows. */
export function markovToDiagram(spec: MarkovSpec): StateDiagram {
  const transitions: DiagramTransition[] = []
  for (const state of spec.states) {
    if (state.transitions.length) {
      for (const transition of state.transitions) transitions.push({ from: state.id, to: transition.to, probability: transition.probability })
    } else if (state.transitionTree) {
      collectJumps(state.transitionTree, state.id, transitions)
    }
  }
  return {
    cycles: spec.cycles,
    states: spec.states.map((state) => ({ id: state.id, name: state.name, absorbing: state.absorbing })),
    transitions,
  }
}

function collectJumps(node: TreeNode, from: string, acc: DiagramTransition[]) {
  for (const branch of node.branches) {
    if (branch.child.jumpTo) acc.push({ from, to: branch.child.jumpTo, probability: branch.probability })
    else collectJumps(branch.child, from, acc)
  }
}

/** The same diagram turned back into a cohort model. Rewards are kept when a previous spec is passed. */
export function diagramToMarkov(diagram: StateDiagram, previous?: MarkovSpec): MarkovSpec {
  const states: MarkovState[] = diagram.states.map((state) => {
    const prior = previous?.states.find((item) => item.id === state.id)
    return {
      id: state.id,
      name: state.name,
      absorbing: state.absorbing,
      initial: prior?.initial ?? pay(),
      incremental: prior?.incremental ?? pay(),
      final: prior?.final ?? pay(),
      startup: prior?.startup ?? pay(),
      cycle: prior?.cycle ?? pay(),
      event: prior?.event ?? pay(),
      transitions: diagram.transitions
        .filter((item) => item.from === state.id)
        .map((item) => ({ to: item.to, probability: item.probability })),
    }
  })
  return {
    cycles: diagram.cycles,
    cycleLength: previous?.cycleLength ?? 1,
    startAge: previous?.startAge ?? 0,
    method: previous?.method ?? 'traditional',
    discountTiming: previous?.discountTiming ?? 'start',
    discountRates: previous?.discountRates ?? {},
    termination: previous?.termination,
    initialProbabilities: states.map((state, index) => ({
      stateId: state.id,
      probability: previous?.initialProbabilities.find((item) => item.stateId === state.id)?.probability ?? (index === 0 ? '1' : '0'),
    })),
    states,
    trackers: previous?.trackers ?? [],
  }
}
