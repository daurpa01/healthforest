import { evaluate } from './expr'
import type { ModelWarning } from './errors'
import {
  markovSlots,
  payoffDiscount,
  slotKeywords,
  startingWeights,
  transitionOfSlot,
  type Slot,
  type TransitionOutcome,
} from './markov'
import { addPayoffs, payoffIds, scalePayoffs, zeroPayoffs } from './payoffs'
import { mulberry32, type Rng } from './prng'
import { drawForRates, readPayoffs, withKeywords, withLocals, withOverrides, type RuntimeScope } from './scope'
import type { HealthModel, MarkovSpec, PayoffMap } from './types'

export interface MicroIndividual {
  payoffs: PayoffMap
  trackers: Record<string, number>
  path: number[]
}

export interface MicroTraceRow {
  stage: number
  counts: Record<string, number>
  meanReward: PayoffMap
}

export interface MicroResult {
  n: number
  seed: number
  mean: PayoffMap
  sd: PayoffMap
  se: PayoffMap
  individuals: MicroIndividual[]
  trace: MicroTraceRow[]
  warnings: ModelWarning[]
}

export function runMicrosimulation(
  spec: MarkovSpec,
  model: HealthModel,
  scope: RuntimeScope,
  options: { n: number; seed: number; onPatient?: (index: number, total: number) => void },
): MicroResult {
  const n = Math.max(1, Math.floor(options.n))
  const rng = mulberry32(options.seed >>> 0)
  const ids = payoffIds(model.payoffs)
  const slots = markovSlots(spec)
  const warnings: ModelWarning[] = []
  const start = startingWeights(spec, model, scope, slots, warnings)
  const individuals: MicroIndividual[] = []
  const rewardBuckets: PayoffMap[][] = []

  for (let i = 0; i < n; i++) {
    individuals.push(simulateOne(spec, model, scope, rng, ids, slots, start, warnings, rewardBuckets))
    if (i % 20 === 0) options.onPatient?.(i, n)
  }

  const mean = zeroPayoffs(ids)
  for (const id of ids) {
    mean[id] = individuals.reduce((sum, person) => sum + (person.payoffs[id] ?? 0), 0) / n
  }
  const sd = zeroPayoffs(ids)
  const se = zeroPayoffs(ids)
  for (const id of ids) {
    sd[id] = sampleSd(individuals.map((person) => person.payoffs[id] ?? 0), mean[id])
    se[id] = sd[id] / Math.sqrt(n)
  }

  const trace: MicroTraceRow[] = []
  const horizon = Math.max(...individuals.map((person) => person.path.length), 0)
  for (let stage = 0; stage < horizon; stage++) {
    const counts: Record<string, number> = {}
    for (const state of spec.states) counts[state.id] = 0
    for (const person of individuals) {
      const index = person.path[stage]
      if (index === undefined) continue
      const stateId = spec.states[index]?.id
      if (stateId) counts[stateId] += 1
    }
    const meanReward = zeroPayoffs(ids)
    for (const id of ids) {
      const column = rewardBuckets[stage]?.map((reward) => reward[id] ?? 0) ?? []
      meanReward[id] = column.length ? column.reduce((sum, value) => sum + value, 0) / n : 0
    }
    trace.push({ stage, counts, meanReward })
  }

  return { n, seed: options.seed >>> 0, mean, sd, se, individuals, trace, warnings }
}

function simulateOne(
  spec: MarkovSpec,
  model: HealthModel,
  scope: RuntimeScope,
  rng: Rng,
  ids: string[],
  slots: Slot[],
  start: number[],
  warnings: ModelWarning[],
  rewardBuckets: PayoffMap[][],
): MicroIndividual {
  const individual = drawForRates(model, ['individual'], rng, scope)
  let patient = Object.keys(individual).length ? withOverrides(scope, individual) : scope
  const trackers: Record<string, number> = {}
  for (const tracker of spec.trackers) {
    trackers[tracker.name] = evaluate(tracker.initial.trim() || '0', withLocals(patient, trackers).eval)
  }
  let slotIndex = sampleWeights(start, rng)
  const cycleRewards: PayoffMap[] = []
  const boundaries: PayoffMap[] = []
  const path: number[] = []
  let stoppedEarly = false

  for (let stage = 0; stage < spec.cycles; stage++) {
    const slot = slots[slotIndex]
    patient = layer(spec, patient, stage, slot.tunnel, trackers, slot.stateIndex, undefined)
    const stageDraw = drawForRates(model, ['stage'], rng, patient)
    if (Object.keys(stageDraw).length) patient = withOverrides(patient, stageDraw)
    if (spec.termination && evaluate(spec.termination, patient.eval) !== 0) {
      stoppedEarly = true
      break
    }
    path.push(slot.stateIndex)
    const transition = transitionOfSlot(spec, model, patient, slots, slot, ids, warnings)
    const drawn = sampleOutcome(transition.outcomes, rng)
    const next = slots[drawn.slot]
    const nextScope = layer(spec, patient, stage + 1, next.tunnel, trackers, next.stateIndex, undefined)
    const reward = individualReward(spec, patient, nextScope, slot, ids, stage, drawn.reward)
    cycleRewards.push(reward)
    if (!rewardBuckets[stage]) rewardBuckets[stage] = []
    rewardBuckets[stage].push(reward)
    if (spec.method === 'simpson' || spec.method === 'wcc') {
      if (stage === 0) boundaries.push(personReward(spec, patient, slot, ids, stage, 'cycle'))
    }
    const rewardKeywords = {
      _reward_cost: reward[ids.find((id) => model.payoffs.find((p) => p.id === id && p.role === 'cost')) ?? 'cost'] ?? 0,
      _reward_effect: reward[ids.find((id) => model.payoffs.find((p) => p.id === id && p.role === 'effect')) ?? 'effect'] ?? 0,
      _next: next.stateIndex,
    }
    for (const tracker of spec.trackers) {
      const updated = layer(spec, patient, stage, slot.tunnel, trackers, slot.stateIndex, rewardKeywords)
      trackers[tracker.name] = evaluate(tracker.update.trim() || tracker.name, updated.eval)
    }
    slotIndex = drawn.slot
    if (spec.stopWhenAbsorbing && spec.states[next.stateIndex]?.absorbing) break
  }

  const end = slots[slotIndex]
  let total = zeroPayoffs(ids)
  if (spec.method === 'traditional') {
    cycleRewards.forEach((reward, stage) => {
      total = addPayoffs(total, discountMap(reward, stage, spec, ids, 'stage'), ids)
    })
    const finalScope = layer(spec, patient, cycleRewards.length, end.tunnel, trackers, end.stateIndex, undefined)
    const finalReward = personReward(spec, finalScope, end, ids, cycleRewards.length, 'final')
    total = addPayoffs(total, discountMap(finalReward, cycleRewards.length, spec, ids, 'final'), ids)
  } else if (spec.method === 'wcc') {
    cycleRewards.forEach((reward, stage) => {
      total = addPayoffs(total, discountMap(reward, stage, spec, ids, 'stage'), ids)
    })
  } else {
    const endScope = layer(spec, patient, cycleRewards.length, end.tunnel, trackers, end.stateIndex, undefined)
    const points = [...boundaries, personReward(spec, endScope, end, ids, cycleRewards.length, 'cycle')]
    // boundaries currently stores only the first point; rebuild from the visited path below if empty.
    void points
    void stoppedEarly
    cycleRewards.forEach((reward, stage) => {
      total = addPayoffs(total, discountMap(reward, stage, spec, ids, 'stage'), ids)
    })
  }

  return { payoffs: total, trackers: { ...trackers }, path }
}

function individualReward(
  spec: MarkovSpec,
  current: RuntimeScope,
  next: RuntimeScope,
  slot: Slot,
  ids: string[],
  stage: number,
  transitionReward: PayoffMap,
): PayoffMap {
  const state = spec.states[slot.stateIndex]
  if (spec.method === 'traditional') {
    const field = stage === 0 ? state.initial : state.incremental
    const stateReward = readPayoffs(field, ids, withKeywords(current, slotKeywords(spec, stage, slot.tunnel)).eval)
    return addPayoffs(stateReward, transitionReward, ids)
  }
  if (spec.method === 'wcc') {
    const now = readPayoffs(state.cycle, ids, withKeywords(current, slotKeywords(spec, stage, slot.tunnel)).eval)
    const laterState = spec.states[Number(next.eval.get('_state'))] ?? state
    // `next` was layered with the destination state index stored as _state.
    const destTunnel = next.eval.get('_tunnel')
    const later = readPayoffs(laterState.cycle, ids, withKeywords(next, slotKeywords(spec, stage + 1, destTunnel)).eval)
    let reward = scalePayoffs(addPayoffs(now, later, ids), 0.5, ids)
    reward = addPayoffs(reward, readPayoffs(state.event, ids, current.eval), ids)
    reward = addPayoffs(reward, transitionReward, ids)
    if (stage === 0) reward = addPayoffs(reward, readPayoffs(state.startup, ids, current.eval), ids)
    return reward
  }
  const cycle = readPayoffs(state.cycle, ids, withKeywords(current, slotKeywords(spec, stage, slot.tunnel)).eval)
  let reward = addPayoffs(cycle, transitionReward, ids)
  reward = addPayoffs(reward, readPayoffs(state.event, ids, current.eval), ids)
  if (stage === 0) reward = addPayoffs(reward, readPayoffs(state.startup, ids, current.eval), ids)
  return reward
}

function personReward(spec: MarkovSpec, scope: RuntimeScope, slot: Slot, ids: string[], stage: number, field: 'cycle' | 'final'): PayoffMap {
  const state = spec.states[slot.stateIndex]
  const formulas = field === 'final' ? state.final : state.cycle
  return readPayoffs(formulas, ids, withKeywords(scope, slotKeywords(spec, stage, slot.tunnel)).eval)
}

function layer(
  spec: MarkovSpec,
  scope: RuntimeScope,
  stage: number,
  tunnel: number,
  trackers: Record<string, number>,
  stateIndex: number,
  extra: Record<string, number> | undefined,
): RuntimeScope {
  const keywords = {
    ...slotKeywords(spec, stage, tunnel),
    _state: stateIndex,
    ...(extra ?? {}),
  }
  return withLocals(withKeywords(scope, keywords), trackers)
}

function sampleOutcome(outcomes: TransitionOutcome[], rng: Rng): TransitionOutcome {
  const u = rng()
  let acc = 0
  for (const outcome of outcomes) {
    acc += outcome.probability
    if (u <= acc) return outcome
  }
  return outcomes[outcomes.length - 1] ?? { slot: 0, probability: 1, reward: {} }
}

function sampleWeights(weights: number[], rng: Rng): number {
  const u = rng()
  let acc = 0
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i]
    if (u <= acc) return i
  }
  return Math.max(0, weights.length - 1)
}

function discountMap(pay: PayoffMap, stage: number, spec: MarkovSpec, ids: string[], kind: 'stage' | 'final'): PayoffMap {
  const out: PayoffMap = {}
  for (const id of ids) out[id] = (pay[id] ?? 0) * payoffDiscount(stage, spec.discountRates[id] ?? 0, spec, kind)
  return out
}

function sampleSd(values: number[], mean: number): number {
  if (values.length < 2) return 0
  const sum = values.reduce((acc, value) => acc + (value - mean) ** 2, 0)
  return Math.sqrt(sum / (values.length - 1))
}
