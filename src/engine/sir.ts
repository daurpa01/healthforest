export interface SirStep {
  day: number
  susceptible: number
  infected: number
  recovered: number
  entered: number
}

export interface SirInput {
  susceptible: number
  infected: number
  recovered: number
  /** Transmission coefficient. New infections = beta * susceptible * infected / population. */
  beta: number
  /** Recovery probability per step. */
  gamma: number
  days: number
  /** People added to the susceptible pool at the start of each day. */
  entryPerDay?: number
  /** From this day on, beta is replaced. */
  betaAfter?: { day: number; beta: number }
}

/** A non-coherent SIR step. Counts are not forced to sum to 1. */
export function runSir(input: SirInput): SirStep[] {
  let s = input.susceptible
  let i = input.infected
  let r = input.recovered
  const rows: SirStep[] = []
  for (let day = 0; day < input.days; day++) {
    const entered = input.entryPerDay ?? 0
    s += entered
    const beta = input.betaAfter && day >= input.betaAfter.day ? input.betaAfter.beta : input.beta
    const population = Math.max(s + i + r, 1e-9)
    const infections = Math.min(s, beta * s * i / population)
    const recoveries = Math.min(i, input.gamma * i)
    s -= infections
    i += infections - recoveries
    r += recoveries
    rows.push({ day, susceptible: s, infected: i, recovered: r, entered })
  }
  return rows
}
