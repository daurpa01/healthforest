import type { Rng } from './prng'

/** Cost or utility accumulated at a constant yearly rate over a waiting time. */
export function accrue(ratePerYear: number, years: number): number {
  return ratePerYear * years
}

export interface CompetingEvent {
  name: string
  rate: number
}

/** The first of several exponential clocks. Time is in years. */
export function nextExponentialEvent(events: CompetingEvent[], rng: Rng): { name: string; time: number } {
  let best = { name: events[0]?.name ?? '', time: Infinity }
  for (const event of events) {
    const time = event.rate <= 0 ? Infinity : -Math.log(1 - rng()) / event.rate
    if (time < best.time) best = { name: event.name, time }
  }
  return best
}

export interface DesPatientResult {
  time: number
  cost: number
  effect: number
  events: string[]
}

/**
 * One patient walks a list of stages. Each stage samples competing exponential events,
 * accrues `costPerYear` and `effectPerYear` until the event, pays `eventCost`, then moves on.
 * `stop` ends the path. Time is capped at `horizon`.
 */
export function simulateDesPatient(
  stages: {
    name: string
    costPerYear: number
    effectPerYear: number
    events: { name: string; rate: number; cost?: number; next?: string; stop?: boolean }[]
  }[],
  rng: Rng,
  horizon: number,
): DesPatientResult {
  let time = 0
  let cost = 0
  let effect = 0
  const seen: string[] = []
  let stage = stages[0]
  while (stage && time < horizon) {
    const draw = nextExponentialEvent(
      stage.events.map((event) => ({ name: event.name, rate: event.rate })),
      rng,
    )
    const wait = Math.min(draw.time, horizon - time)
    cost += accrue(stage.costPerYear, wait)
    effect += accrue(stage.effectPerYear, wait)
    time += wait
    if (wait < draw.time - 1e-12 || !Number.isFinite(draw.time)) break
    const chosen = stage.events.find((event) => event.name === draw.name)
    seen.push(draw.name)
    cost += chosen?.cost ?? 0
    if (!chosen || chosen.stop) break
    const next = stages.find((item) => item.name === chosen.next) ?? stages.find((item) => item.name !== stage.name)
    if (!next) break
    stage = next
  }
  return { time, cost, effect, events: seen }
}
