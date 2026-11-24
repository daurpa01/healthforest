import {
  correlationToCovariance,
  distributionMean,
  marginalOf,
  sampleDirichlet,
  sampleDistribution,
  sampleGaussianCopula,
  sampleMultivariateNormal,
} from './distributions'
import { EngineError, type ModelWarning } from './errors'
import { evaluate, freeNames, parseExpr, type EvalScope, type Expr } from './expr'
import type { Rng } from './prng'
import type { DataTable, HealthModel, PayoffMap, SampleRate, Variable } from './types'

const DYNAMIC_NAMES = new Set([
  '_stage',
  '_stage_mid',
  '_cycle',
  '_age',
  '_time',
  '_tunnel',
  '_trial',
  '_reward_cost',
  '_reward_effect',
  '_state',
  '_next',
])

export interface RuntimeScope {
  warnings: ModelWarning[]
  tables: Map<string, DataTable>
  eval: EvalScope
}

interface ScopeState {
  model: HealthModel
  tables: Map<string, DataTable>
  warnings: ModelWarning[]
  overrides: Record<string, number>
  locals: Record<string, number>
  keywords: Record<string, number>
  dynamic: Set<string>
  ast: Map<string, Expr>
  argAst: Map<string, Expr[]>
  cache: Map<string, number>
  visiting: Set<string>
}

export function tableMap(model: HealthModel): Map<string, DataTable> {
  return new Map(model.tables.map((table) => [table.name, table]))
}

export function compileScope(
  model: HealthModel,
  options: { fixed?: Record<string, number>; rng?: Rng; rates?: SampleRate[] } = {},
): RuntimeScope {
  const state = blankState(model)
  if (options.fixed) state.overrides = { ...options.fixed }
  if (options.rng && options.rates?.length) {
    const preliminary = bind(state)
    const drawn = drawForRates(model, options.rates, options.rng, preliminary)
    state.overrides = { ...state.overrides, ...drawn }
    state.cache.clear()
  }
  return bind(state)
}

export function withLocals(scope: RuntimeScope, locals: Record<string, number>): RuntimeScope {
  const state = unwrap(scope)
  const next: ScopeState = { ...state, locals: { ...state.locals, ...locals }, cache: new Map(), visiting: new Set() }
  return bind(next)
}

export function withKeywords(scope: RuntimeScope, keywords: Record<string, number>): RuntimeScope {
  const state = unwrap(scope)
  const next: ScopeState = {
    ...state,
    keywords: { ...state.keywords, ...keywords },
    cache: new Map(),
    visiting: new Set(),
  }
  return bind(next)
}

export function withOverrides(scope: RuntimeScope, overrides: Record<string, number>): RuntimeScope {
  const state = unwrap(scope)
  const next: ScopeState = {
    ...state,
    overrides: { ...state.overrides, ...overrides },
    cache: new Map(),
    visiting: new Set(),
  }
  return bind(next)
}

export function drawForRates(model: HealthModel, rates: SampleRate[], rng: Rng, scope: RuntimeScope): Record<string, number> {
  const out: Record<string, number> = {}
  const sampled = new Set<string>()
  const argsOf = (variable: Variable) =>
    (variable.distribution?.args ?? []).map((arg) => evaluate(arg.trim() || '0', scope.eval))

  for (const group of model.correlations) {
    const active = group.names.filter((name) => {
      const variable = model.variables.find((item) => item.name === name)
      return Boolean(variable?.distribution) && rates.includes(variable?.sampleRate ?? 'trial') && !isJointTarget(model, name)
    })
    if (active.length < 2) continue
    const marginals = active.map((name) => {
      const variable = model.variables.find((item) => item.name === name)!
      return marginalOf(variable.distribution!, argsOf(variable))
    })
    const matrix = submatrix(
      group.names,
      group.matrix,
      active,
    )
    try {
      const draw = sampleGaussianCopula(marginals, matrix, rng)
      active.forEach((name, index) => {
        out[name] = draw[index]
        sampled.add(name)
      })
    } catch {
      scope.warnings.push({ code: 'correlation-not-positive', detail: active.join(', ') })
    }
  }

  for (const variable of model.variables) {
    if (!variable.distribution || sampled.has(variable.name) || isJointTarget(model, variable.name)) continue
    if (!rates.includes(variable.sampleRate ?? 'trial')) continue
    out[variable.name] = sampleDistribution(variable.distribution, argsOf(variable), rng)
    sampled.add(variable.name)
  }

  for (const joint of model.dirichlet) {
    if (!rates.includes(joint.sampleRate ?? 'trial')) continue
    const alphas = joint.alphas.map((arg) => evaluate(arg.trim() || '0', scope.eval))
    const draw = sampleDirichlet(alphas, rng)
    joint.targets.forEach((name, index) => {
      out[name] = draw[index] ?? 0
    })
  }

  for (const joint of model.mvnormal) {
    if (!rates.includes(joint.sampleRate ?? 'trial')) continue
    const means = joint.means.map((arg) => evaluate(arg.trim() || '0', scope.eval))
    const sds = joint.sds.map((arg) => evaluate(arg.trim() || '0', scope.eval))
    try {
      const draw = sampleMultivariateNormal(means, correlationToCovariance(sds, joint.correlation), rng)
      joint.targets.forEach((name, index) => {
        out[name] = draw[index] ?? means[index] ?? 0
      })
    } catch {
      scope.warnings.push({ code: 'correlation-not-positive', detail: joint.name })
      joint.targets.forEach((name, index) => {
        out[name] = means[index] ?? 0
      })
    }
  }

  return out
}

export function readPayoffs(formulas: Record<string, string> | undefined, ids: string[], scope: EvalScope): PayoffMap {
  const out: PayoffMap = {}
  for (const id of ids) {
    const text = formulas?.[id]
    out[id] = text && text.trim() !== '' ? evaluate(text, scope) : 0
  }
  return out
}

export function applyDefinitions(
  definitions: { name: string; expression: string }[] | undefined,
  scope: RuntimeScope,
): RuntimeScope {
  if (!definitions?.length) return scope
  let current = scope
  const locals: Record<string, number> = {}
  for (const def of definitions) {
    locals[def.name] = evaluate(def.expression.trim() || '0', current.eval)
    current = withLocals(current, { ...locals })
  }
  return current
}

const STATES = new WeakMap<RuntimeScope, ScopeState>()

function blankState(model: HealthModel): ScopeState {
  const dynamic = new Set<string>()
  const ast = new Map<string, Expr>()
  const argAst = new Map<string, Expr[]>()
  for (const variable of model.variables) {
    const text = variable.expression?.trim() ?? ''
    if (text) ast.set(variable.name, parseExpr(text))
    const args = (variable.distribution?.args ?? []).map((arg) => parseExpr(arg.trim() || '0'))
    if (args.length) argAst.set(variable.name, args)
    const names = new Set<string>()
    if (ast.get(variable.name)) freeNames(ast.get(variable.name)!, names)
    for (const arg of args) freeNames(arg, names)
    if ([...names].some((name) => DYNAMIC_NAMES.has(name) || name.startsWith('_'))) dynamic.add(variable.name)
  }
  return {
    model,
    tables: tableMap(model),
    warnings: [],
    overrides: {},
    locals: {},
    keywords: {},
    dynamic,
    ast,
    argAst,
    cache: new Map(),
    visiting: new Set(),
  }
}

function bind(state: ScopeState): RuntimeScope {
  const scope = { warnings: state.warnings, tables: state.tables } as RuntimeScope
  const evalScope: EvalScope = {
    tables: state.tables,
    warnings: state.warnings,
    get(name: string) {
      if (name in state.keywords) return state.keywords[name]
      const folded = name.toLowerCase()
      if (folded in state.keywords) return state.keywords[folded]
      if (name in state.locals) return state.locals[name]
      if (name in state.overrides) return state.overrides[name]
      if (!state.dynamic.has(name) && state.cache.has(name)) return state.cache.get(name)!
      const variable = state.model.variables.find((item) => item.name === name)
      if (!variable) throw new EngineError('undefined-name', name)
      if (state.visiting.has(name)) throw new EngineError('circular-variable', name)
      state.visiting.add(name)
      try {
        const value = valueOf(variable, state, evalScope)
        if (!state.dynamic.has(name)) state.cache.set(name, value)
        return value
      } finally {
        state.visiting.delete(name)
      }
    },
  }
  scope.eval = evalScope
  STATES.set(scope, state)
  return scope
}

function valueOf(variable: Variable, state: ScopeState, evalScope: EvalScope): number {
  const expression = variable.expression?.trim() ?? ''
  if (variable.distribution && expression === '') {
    const args = (state.argAst.get(variable.name) ?? []).map((ast) => evaluate(ast, evalScope))
    return distributionMean(variable.distribution, args)
  }
  const ast = state.ast.get(variable.name)
  if (!ast) return 0
  return evaluate(ast, evalScope)
}

function unwrap(scope: RuntimeScope): ScopeState {
  const state = STATES.get(scope)
  if (!state) throw new EngineError('internal', 'scope')
  return state
}

function isJointTarget(model: HealthModel, name: string): boolean {
  return model.dirichlet.some((item) => item.targets.includes(name)) || model.mvnormal.some((item) => item.targets.includes(name))
}

function submatrix(names: string[], matrix: number[][], keep: string[]): number[][] {
  const index = keep.map((name) => names.indexOf(name))
  return index.map((i) => index.map((j) => (i === j ? (matrix[i]?.[j] ?? 1) : (matrix[i]?.[j] ?? 0))))
}
