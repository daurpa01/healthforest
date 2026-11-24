import { evaluate } from './expr'
import { EngineError, type ModelWarning } from './errors'
import { walkOutcomes } from './outcomes'
import { addPayoffs, payoffIds, scalePayoffs, zeroPayoffs } from './payoffs'
import { resolveProbabilities } from './probabilities'
import type { Rng } from './prng'
import { drawForRates, readPayoffs, withKeywords, withOverrides, type RuntimeScope } from './scope'
import type { HealthModel, MarkovMethod, MarkovSpec, MarkovState, PayoffMap } from './types'

export interface Slot {
  index: number
  stateIndex: number
  stateId: string
  tunnel: number
}

export interface CohortCycleRow {
  stage: number
  occupancy: Record<string, number>
  occupancyNext: Record<string, number>
  reward: PayoffMap
  discounted: PayoffMap
  discountFactor: number
  cumulative: PayoffMap
}

export interface MarkovCohortResult {
  method: MarkovMethod
  stagesRun: number
  cycles: CohortCycleRow[]
  finalOccupancy: Record<string, number>
  finalReward: PayoffMap
  finalDiscounted: PayoffMap
  total: PayoffMap
  totalUndiscounted: PayoffMap
  survival: number[]
  states: { id: string; name: string }[]
  warnings: ModelWarning[]
}

export interface TransitionOutcome {
  slot: number
  probability: number
  reward: PayoffMap
}

export interface SlotTransition {
  outcomes: TransitionOutcome[]
  probabilities: number[]
  expectedReward: PayoffMap
}

type RewardField = 'initial' | 'incremental' | 'final' | 'startup' | 'cycle' | 'event'
type DiscountKind = 'stage' | 'boundary' | 'final'

export function markovSlots(spec: MarkovSpec): Slot[] {
  const slots: Slot[] = []
  spec.states.forEach((state, stateIndex) => {
    const length = tunnelLength(state)
    if (!length) {
      slots.push({ index: slots.length, stateIndex, stateId: state.id, tunnel: 0 })
      return
    }
    for (let tunnel = 1; tunnel <= length; tunnel++) {
      slots.push({ index: slots.length, stateIndex, stateId: state.id, tunnel })
    }
  })
  return slots.map((slot, index) => ({ ...slot, index }))
}

/** Simpson's rule on `intervals` steps, plus a trapezoid on the last step when the count is odd. Weights sum to `intervals`. */
export function simpsonWeights(intervals: number): number[] {
  const n = Math.max(0, intervals)
  const w = Array(n + 1).fill(0)
  if (n === 0) return w
  if (n === 1) {
    w[0] = 0.5
    w[1] = 0.5
    return w
  }
  const even = n % 2 === 0 ? n : n - 1
  w[0] += 1 / 3
  w[even] += 1 / 3
  for (let i = 1; i < even; i++) w[i] += (i % 2 === 1 ? 4 : 2) / 3
  if (n % 2 === 1) {
    w[n - 1] += 0.5
    w[n] += 0.5
  }
  return w
}

export function applyHalfCycleCorrection(spec: MarkovSpec, payoffIdList?: string[]): MarkovSpec {
  const ids = payoffIdList ?? Object.keys(spec.states[0]?.incremental ?? { cost: '', effect: '' })
  return {
    ...spec,
    method: 'traditional',
    states: spec.states.map((state) => {
      if (state.absorbing) return state
      const initial = { ...state.initial }
      const final = { ...state.final }
      for (const id of ids) {
        const expr = state.incremental[id]?.trim() || '0'
        initial[id] = `0.5*(${expr})`
        final[id] = `0.5*(${expr})`
      }
      return { ...state, initial, final }
    }),
  }
}

export function convertMarkovMethod(spec: MarkovSpec, method: MarkovMethod): MarkovSpec {
  if (method === 'traditional') {
    return {
      ...spec,
      method,
      states: spec.states.map((state) => {
        const source = blankPay(state.cycle) ? state.incremental : state.cycle
        if (state.absorbing) return { ...state, incremental: { ...source } }
        const initial = { ...state.initial }
        const final = { ...state.final }
        for (const [id, expr] of Object.entries(source)) {
          const text = expr?.trim() || '0'
          initial[id] = `0.5*(${text})`
          final[id] = `0.5*(${text})`
        }
        return { ...state, incremental: { ...source }, initial, final }
      }),
    }
  }
  return {
    ...spec,
    method,
    states: spec.states.map((state) => ({
      ...state,
      cycle: blankPay(state.cycle) ? { ...state.incremental } : state.cycle,
    })),
  }
}

export function runMarkovCohort(
  spec: MarkovSpec,
  model: HealthModel,
  scope: RuntimeScope,
  options: { rng?: Rng } = {},
): MarkovCohortResult {
  if (!spec.states.length) throw new EngineError('markov-no-states')
  if (!(spec.cycles >= 1)) throw new EngineError('markov-cycles')
  const ids = payoffIds(model.payoffs)
  const slots = markovSlots(spec)
  const warnings: ModelWarning[] = []
  let occ = startingWeights(spec, model, scope, slots, warnings)
  const steps: Step[] = []

  for (let stage = 0; stage < spec.cycles; stage++) {
    const scoped = scopeAt(spec, model, scope, options.rng, stage, occ, slots, 0)
    if (spec.termination && evaluate(spec.termination, scoped.eval) !== 0) break
    const matrix = cohortTransition(spec, model, scoped, slots, occ, ids, stage, warnings)
    const occNext = multiply(occ, matrix.probabilities)
    steps.push({
      stage,
      occupancy: occ,
      next: occNext,
      traditional: dotReward(spec, scoped, slots, occ, ids, stage, stage === 0 ? 'initial' : 'incremental'),
      cycleValue: dotReward(spec, scoped, slots, occ, ids, stage, 'cycle'),
      startup: dotReward(spec, scoped, slots, occ, ids, stage, 'startup'),
      eventState: dotReward(spec, scoped, slots, occ, ids, stage, 'event'),
      transitionReward: matrix.reward,
    })
    occ = occNext
  }

  const finalStage = steps.length
  const finalScope = scopeAt(spec, model, scope, options.rng, finalStage, occ, slots, 0)
  const finalCycle = dotReward(spec, finalScope, slots, occ, ids, finalStage, 'cycle')
  const finalReward = spec.method === 'traditional' ? dotReward(spec, finalScope, slots, occ, ids, finalStage, 'final') : zeroPayoffs(ids)

  let total = zeroPayoffs(ids)
  let undiscounted = zeroPayoffs(ids)
  const boundaryWeights = spec.method === 'simpson' ? simpsonWeights(steps.length) : []
  const boundaries = spec.method === 'simpson' ? [...steps.map((step) => step.cycleValue), finalCycle] : []
  if (spec.method === 'simpson') {
    boundaries.forEach((value, index) => {
      const weighted = scalePayoffs(value, boundaryWeights[index] ?? 0, ids)
      undiscounted = addPayoffs(undiscounted, weighted, ids)
      total = addPayoffs(total, discountMap(weighted, index, spec, ids, 'boundary'), ids)
    })
  }

  let running = zeroPayoffs(ids)
  const rows: CohortCycleRow[] = steps.map((step, index) => {
    const reward = stageReward(spec, step, index, steps, finalCycle, ids, boundaryWeights)
    const discounted = discountMap(reward, step.stage, spec, ids, 'stage')
    if (spec.method !== 'simpson') {
      total = addPayoffs(total, discounted, ids)
      undiscounted = addPayoffs(undiscounted, reward, ids)
    } else {
      const extra = addPayoffs(step.transitionReward, step.eventState, ids)
      const withStartup = index === 0 ? addPayoffs(extra, step.startup, ids) : extra
      const extraDiscounted = discountMap(withStartup, step.stage, spec, ids, 'stage')
      total = addPayoffs(total, extraDiscounted, ids)
      undiscounted = addPayoffs(undiscounted, withStartup, ids)
    }
    running = addPayoffs(running, spec.method === 'simpson' ? discountMap(reward, step.stage, spec, ids, 'stage') : discounted, ids)
    return {
      stage: step.stage,
      occupancy: logical(step.occupancy, slots, spec),
      occupancyNext: logical(step.next, slots, spec),
      reward,
      discounted: spec.method === 'simpson' ? discountMap(reward, step.stage, spec, ids, 'stage') : discounted,
      discountFactor: payoffDiscount(step.stage, spec.discountRates[ids[0]] ?? 0, spec, 'stage'),
      cumulative: { ...running },
    }
  })

  const finalDiscounted = spec.method === 'traditional' ? discountMap(finalReward, finalStage, spec, ids, 'final') : zeroPayoffs(ids)
  if (spec.method === 'traditional') {
    total = addPayoffs(total, finalDiscounted, ids)
    undiscounted = addPayoffs(undiscounted, finalReward, ids)
    running = addPayoffs(running, finalDiscounted, ids)
  }

  const survival = [
    ...steps.map((step) => survivalOf(logical(step.occupancy, slots, spec), spec)),
    survivalOf(logical(occ, slots, spec), spec),
  ]

  return {
    method: spec.method,
    stagesRun: steps.length,
    cycles: rows,
    finalOccupancy: logical(occ, slots, spec),
    finalReward,
    finalDiscounted,
    total,
    totalUndiscounted: undiscounted,
    survival,
    states: spec.states.map((state) => ({ id: state.id, name: state.name })),
    warnings,
  }
}

export function startingWeights(spec: MarkovSpec, model: HealthModel, scope: RuntimeScope, slots: Slot[], warnings: ModelWarning[]): number[] {
  const expressions = spec.states.map((state) => {
    const row = spec.initialProbabilities.find((item) => item.stateId === state.id)
    return row?.probability?.trim() ? row.probability : '0'
  })
  const opened = scopeAt(spec, model, scope, undefined, 0, Array(slots.length).fill(0), slots, 1)
  const resolved = resolveProbabilities(expressions, opened.eval)
  for (const warning of resolved.warnings) warnings.push(warning)
  const weights = Array(slots.length).fill(0)
  spec.states.forEach((state, stateIndex) => {
    const mine = slots.filter((slot) => slot.stateIndex === stateIndex)
    if (state.distributeInitial && mine.length > 1) {
      const share = opened.eval.complement
      mine.forEach((slot) => {
        const scoped = scopeAt(spec, model, scope, undefined, 0, weights, slots, slot.tunnel)
        scoped.eval.complement = share
        weights[slot.index] = evaluate(expressions[stateIndex].trim() || '0', scoped.eval)
      })
    } else if (mine[0]) {
      weights[mine[0].index] = resolved.probs[stateIndex] ?? 0
    }
  })
  const sum = weights.reduce((acc, value) => acc + value, 0)
  if (sum <= 0) throw new EngineError('initial-probability', String(sum))
  if (Math.abs(sum - 1) > 1e-6) warnings.push({ code: 'initial-probability-sum', detail: String(sum) })
  return weights.map((value) => value / sum)
}

export function transitionOfSlot(
  spec: MarkovSpec,
  model: HealthModel,
  scope: RuntimeScope,
  slots: Slot[],
  slot: Slot,
  ids: string[],
  warnings: ModelWarning[],
): SlotTransition {
  const state = spec.states[slot.stateIndex]
  const zero = zeroPayoffs(ids)
  if (state.absorbing) {
    return packed([{ slot: slot.index, probability: 1, reward: zero }], slots.length, ids)
  }
  const length = tunnelLength(state)
  if (state.tunnelMode === 'hold' && length > 0 && slot.tunnel > 0 && slot.tunnel < length) {
    const next = slots.find((item) => item.stateId === state.id && item.tunnel === slot.tunnel + 1)
    if (!next) throw new EngineError('unknown-state', state.id)
    return packed([{ slot: next.index, probability: 1, reward: zero }], slots.length, ids)
  }
  return packed(destinationsToSlots(rawDestinations(state, spec, model, scope, ids, warnings), slots, state, slot), slots.length, ids)
}

export function slotKeywords(spec: MarkovSpec, stage: number, tunnel: number): Record<string, number> {
  return {
    _stage: stage,
    _stage_mid: stage + 0.5,
    _cycle: stage + 1,
    _age: spec.startAge + stage * spec.cycleLength,
    _time: stage * spec.cycleLength,
    _tunnel: tunnel,
  }
}

export function payoffDiscount(stage: number, rate: number, spec: MarkovSpec, kind: DiscountKind): number {
  if (!rate) return 1
  const offset = kind === 'final' ? 0 : spec.discountTiming === 'mid' ? 0.5 : spec.discountTiming === 'end' ? 1 : 0
  return 1 / Math.pow(1 + rate, (stage + offset) * spec.cycleLength)
}

function stageReward(spec: MarkovSpec, step: Step, index: number, steps: Step[], finalCycle: PayoffMap, ids: string[], boundaryWeights: number[]): PayoffMap {
  if (spec.method === 'traditional') return addPayoffs(step.traditional, step.transitionReward, ids)
  if (spec.method === 'wcc') {
    const nextCycle = index + 1 < steps.length ? steps[index + 1].cycleValue : finalCycle
    let reward = scalePayoffs(addPayoffs(step.cycleValue, nextCycle, ids), 0.5, ids)
    reward = addPayoffs(reward, step.eventState, ids)
    reward = addPayoffs(reward, step.transitionReward, ids)
    if (index === 0) reward = addPayoffs(reward, step.startup, ids)
    return reward
  }
  const weighted = scalePayoffs(step.cycleValue, boundaryWeights[index] ?? 0, ids)
  let reward = addPayoffs(weighted, step.transitionReward, ids)
  reward = addPayoffs(reward, step.eventState, ids)
  if (index === 0) reward = addPayoffs(reward, step.startup, ids)
  return reward
}

function destinationsToSlots(
  raw: { to: string; probability: number; reward: PayoffMap }[],
  slots: Slot[],
  state: MarkovState,
  slot: Slot,
): TransitionOutcome[] {
  return raw.map((dest) => ({
    slot: destinationSlot(slots, state, slot, dest.to),
    probability: dest.probability,
    reward: dest.reward,
  }))
}

function packed(outcomes: TransitionOutcome[], n: number, ids: string[]): SlotTransition {
  const probabilities = Array(n).fill(0)
  let expectedReward = zeroPayoffs(ids)
  for (const outcome of outcomes) {
    probabilities[outcome.slot] += outcome.probability
    expectedReward = addPayoffs(expectedReward, scalePayoffs(outcome.reward, outcome.probability, ids), ids)
  }
  return { outcomes, probabilities, expectedReward }
}

function rawDestinations(
  state: MarkovState,
  spec: MarkovSpec,
  model: HealthModel,
  scope: RuntimeScope,
  ids: string[],
  warnings: ModelWarning[],
): { to: string; probability: number; reward: PayoffMap }[] {
  if (state.transitionTree) {
    const paths = walkOutcomes(state.transitionTree, model, scope, ids)
    const grouped: { to: string; probability: number; reward: PayoffMap }[] = []
    let sum = 0
    for (const path of paths) {
      const to = path.jumpTo || state.id
      if (!spec.states.some((item) => item.id === to)) throw new EngineError('unknown-state', to)
      grouped.push({ to, probability: path.probability, reward: path.payoffs })
      sum += path.probability
    }
    if (sum < 1 - 1e-8) {
      grouped.push({ to: state.id, probability: 1 - sum, reward: zeroPayoffs(ids) })
      warnings.push({ code: 'prob-remainder-stay', detail: state.name })
    } else if (sum > 1 + 1e-8 && sum > 0) {
      for (const item of grouped) item.probability /= sum
      warnings.push({ code: 'prob-renormalized', detail: state.name })
    }
    return grouped
  }
  const resolved = state.transitions.length
    ? resolveProbabilities(
        state.transitions.map((transition) => transition.probability),
        scope.eval,
      )
    : { probs: [] as number[], warnings: [] as ModelWarning[], usedComplement: false }
  for (const warning of resolved.warnings) warnings.push({ ...warning, detail: warning.detail ?? state.name })
  const out: { to: string; probability: number; reward: PayoffMap }[] = []
  let sum = 0
  state.transitions.forEach((transition, index) => {
    if (!spec.states.some((item) => item.id === transition.to)) throw new EngineError('unknown-state', transition.to)
    const probability = resolved.probs[index] ?? 0
    sum += probability
    out.push({ to: transition.to, probability, reward: readPayoffs(transition.payoffs, ids, scope.eval) })
  })
  if (!state.transitions.length) {
    out.push({ to: state.id, probability: 1, reward: zeroPayoffs(ids) })
    return out
  }
  if (!resolved.usedComplement && sum < 1 - 1e-8) {
    out.push({ to: state.id, probability: 1 - sum, reward: zeroPayoffs(ids) })
    warnings.push({ code: 'prob-remainder-stay', detail: state.name })
  } else if (!resolved.usedComplement && sum > 1 + 1e-8 && sum > 0) {
    for (const item of out) item.probability /= sum
    warnings.push({ code: 'prob-renormalized', detail: state.name })
  }
  return out
}

function destinationSlot(slots: Slot[], state: MarkovState, slot: Slot, to: string): number {
  const length = tunnelLength(state)
  if (to === state.id && length > 0 && state.tunnelMode !== 'hold' && slot.tunnel > 0) {
    const nextTunnel = Math.min(slot.tunnel + 1, length)
    const found = slots.find((item) => item.stateId === to && item.tunnel === nextTunnel)
    if (!found) throw new EngineError('unknown-state', to)
    return found.index
  }
  const first = slots.find((item) => item.stateId === to && (item.tunnel === 0 || item.tunnel === 1))
  if (!first) throw new EngineError('unknown-state', to)
  return first.index
}

interface Step {
  stage: number
  occupancy: number[]
  next: number[]
  traditional: PayoffMap
  cycleValue: PayoffMap
  startup: PayoffMap
  eventState: PayoffMap
  transitionReward: PayoffMap
}

function cohortTransition(
  spec: MarkovSpec,
  model: HealthModel,
  scope: RuntimeScope,
  slots: Slot[],
  occ: number[],
  ids: string[],
  stage: number,
  warnings: ModelWarning[],
): { probabilities: number[][]; reward: PayoffMap } {
  const probabilities = Array.from({ length: slots.length }, () => Array(slots.length).fill(0))
  let reward = zeroPayoffs(ids)
  for (const slot of slots) {
    const scoped = withKeywords(scope, slotKeywords(spec, stage, slot.tunnel))
    const transition = transitionOfSlot(spec, model, scoped, slots, slot, ids, warnings)
    probabilities[slot.index] = transition.probabilities
    if (occ[slot.index]) reward = addPayoffs(reward, scalePayoffs(transition.expectedReward, occ[slot.index], ids), ids)
  }
  return { probabilities, reward }
}

function dotReward(spec: MarkovSpec, scope: RuntimeScope, slots: Slot[], occ: number[], ids: string[], stage: number, field: RewardField): PayoffMap {
  let total = zeroPayoffs(ids)
  for (const slot of slots) {
    const weight = occ[slot.index] ?? 0
    if (!weight) continue
    const formulas = spec.states[slot.stateIndex][field]
    const scoped = withKeywords(scope, slotKeywords(spec, stage, slot.tunnel))
    total = addPayoffs(total, scalePayoffs(readPayoffs(formulas, ids, scoped.eval), weight, ids), ids)
  }
  return total
}

function multiply(occ: number[], matrix: number[][]): number[] {
  const next = Array(occ.length).fill(0)
  for (let i = 0; i < occ.length; i++) {
    if (!occ[i]) continue
    const row = matrix[i]
    for (let j = 0; j < next.length; j++) next[j] += occ[i] * (row[j] ?? 0)
  }
  return next
}

function logical(occ: number[], slots: Slot[], spec: MarkovSpec): Record<string, number> {
  const out: Record<string, number> = {}
  for (const state of spec.states) out[state.id] = 0
  slots.forEach((slot, index) => {
    out[slot.stateId] += occ[index] ?? 0
  })
  return out
}

function survivalOf(occupancy: Record<string, number>, spec: MarkovSpec): number {
  if (!spec.states.some((state) => state.absorbing)) return 1
  const dead = spec.states.filter((state) => state.absorbing).reduce((sum, state) => sum + (occupancy[state.id] ?? 0), 0)
  return 1 - dead
}

function scopeAt(
  spec: MarkovSpec,
  model: HealthModel,
  scope: RuntimeScope,
  rng: Rng | undefined,
  stage: number,
  occ: number[],
  slots: Slot[],
  tunnel: number,
): RuntimeScope {
  let scoped = withKeywords(scope, {
    ...occupancyKeywords(spec, logical(occ, slots, spec)),
    ...slotKeywords(spec, stage, tunnel),
  })
  if (rng) {
    const drawn = drawForRates(model, ['stage'], rng, scoped)
    if (Object.keys(drawn).length) scoped = withOverrides(scoped, drawn)
  }
  return scoped
}

function occupancyKeywords(spec: MarkovSpec, occupancy: Record<string, number>): Record<string, number> {
  const keywords: Record<string, number> = {}
  for (const state of spec.states) {
    const p = occupancy[state.id] ?? 0
    if (isIdent(state.id)) keywords[`_p_${state.id}`] = p
    if (isIdent(state.name)) keywords[`_p_${state.name}`] = p
  }
  return keywords
}

function discountMap(pay: PayoffMap, stage: number, spec: MarkovSpec, ids: string[], kind: DiscountKind): PayoffMap {
  const out: PayoffMap = {}
  for (const id of ids) out[id] = (pay[id] ?? 0) * payoffDiscount(stage, spec.discountRates[id] ?? 0, spec, kind)
  return out
}

function tunnelLength(state: MarkovState): number {
  return state.tunnelCycles && state.tunnelCycles > 0 ? Math.floor(state.tunnelCycles) : 0
}

function blankPay(map: Record<string, string> | undefined): boolean {
  if (!map) return true
  return Object.values(map).every((value) => !value || value.trim() === '' || value.trim() === '0')
}

function isIdent(value: string): boolean {
  return /^[\p{L}_][\p{L}\p{N}_]*$/u.test(value)
}
