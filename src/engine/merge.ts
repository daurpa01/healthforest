/** Membership-weighted combination of several Markov processes inside one strategy. */
export function mergeOccupancy(parts: { weight: number; occupancy: Record<string, number> }[]): Record<string, number> {
  const total = parts.reduce((sum, part) => sum + part.weight, 0) || 1
  const out: Record<string, number> = {}
  for (const part of parts) {
    for (const [state, value] of Object.entries(part.occupancy)) {
      out[state] = (out[state] ?? 0) + (part.weight / total) * value
    }
  }
  return out
}
