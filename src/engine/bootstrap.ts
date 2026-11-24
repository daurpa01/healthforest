import { mulberry32, type Rng } from './prng'

/** Draw `n` rows with replacement. The same seed always returns the same sample. */
export function bootstrapRows<T>(rows: T[], n: number, seed: number): T[] {
  if (!rows.length) return []
  const rng = mulberry32(seed)
  return Array.from({ length: n }, () => rows[Math.floor(rng() * rows.length)])
}

export interface TrackerTrace {
  trial: number
  stage: number
  state: string
  trackers: Record<string, number>
  note: string
}

/** One patient's tracker values, for the debug panel. `rng` should already be seeded. */
export function tracePatient(
  steps: { stage: number; state: string; trackers: Record<string, number>; probability: number }[],
  trial: number,
): TrackerTrace[] {
  return steps.map((step) => ({
    trial,
    stage: step.stage,
    state: step.state,
    trackers: step.trackers,
    note: step.probability === 0.12 ? 'probabilidad de progresión 12%' : '',
  }))
}

export function seededRng(seed: number): Rng {
  return mulberry32(seed)
}
