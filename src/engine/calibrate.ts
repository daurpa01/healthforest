export interface CalibrationInput {
  start: number
  low: number
  high: number
  /** Model output at a candidate input. */
  evaluate: (value: number) => number
  target: number
  iterations?: number
}

export interface CalibrationResult {
  value: number
  output: number
  objective: number
}

/** One-parameter calibration by shrinking the interval around the smallest squared error. */
export function calibrate(input: CalibrationInput): CalibrationResult {
  let low = input.low
  let high = input.high
  let best = input.start
  let bestOut = input.evaluate(best)
  let bestObj = (bestOut - input.target) ** 2
  const steps = input.iterations ?? 24
  for (let i = 0; i < steps; i++) {
    const candidates = [low, high, (low + high) / 2, best]
    for (const candidate of candidates) {
      const output = input.evaluate(candidate)
      const objective = (output - input.target) ** 2
      if (objective < bestObj) {
        best = candidate
        bestOut = output
        bestObj = objective
      }
    }
    const span = (high - low) / 3
    low = Math.max(input.low, best - span)
    high = Math.min(input.high, best + span)
  }
  return { value: best, output: bestOut, objective: bestObj }
}
