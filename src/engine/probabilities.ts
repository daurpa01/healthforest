import type { ModelWarning } from './errors'
import { containsHash, evaluate, parseExpr, type EvalScope, type Expr } from './expr'

export interface ProbabilityResult {
  probs: number[]
  warnings: ModelWarning[]
  usedComplement: boolean
}

/** Resolve branch or transition probabilities. A bare or embedded "#" receives an equal share of the remainder. */
export function resolveProbabilities(expressions: string[], scope: EvalScope): ProbabilityResult {
  const asts: Expr[] = expressions.map((expression) => parseExpr(expression.trim() === '' ? '0' : expression.trim()))
  const hashed = asts.map((ast) => containsHash(ast))
  const probs = asts.map(() => 0)
  const warnings: ModelWarning[] = []
  let specified = 0
  for (let i = 0; i < asts.length; i++) {
    if (hashed[i]) continue
    probs[i] = evaluate(asts[i], scope)
    specified += probs[i]
    if (probs[i] < -1e-12) warnings.push({ code: 'negative-probability', detail: expressions[i] })
  }
  const hashCount = hashed.filter(Boolean).length
  if (hashCount > 0) {
    const share = (1 - specified) / hashCount
    const previous = scope.complement
    scope.complement = share
    try {
      for (let i = 0; i < asts.length; i++) {
        if (!hashed[i]) continue
        probs[i] = evaluate(asts[i], scope)
        if (probs[i] < -1e-12) warnings.push({ code: 'negative-probability', detail: expressions[i] })
      }
    } finally {
      scope.complement = previous
    }
  } else if (Math.abs(specified - 1) > 1e-6) {
    warnings.push({ code: 'probability-sum', detail: String(specified) })
  }
  return { probs, warnings, usedComplement: hashCount > 0 }
}
