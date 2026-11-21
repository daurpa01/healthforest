import { EngineError } from './errors'
import type { DataTable } from './types'

export type Expr =
  | { t: 'num'; v: number }
  | { t: 'name'; name: string }
  | { t: 'str'; v: string }
  | { t: 'hash' }
  | { t: 'unary'; op: '-' | 'not'; x: Expr }
  | { t: 'bin'; op: string; l: Expr; r: Expr }
  | { t: 'call'; name: string; args: Expr[] }

export interface EvalScope {
  get(name: string): number
  /** Bound only while a complement probability is being resolved. */
  complement?: number
  tables: Map<string, DataTable>
  warnings?: { code: string; detail?: string }[]
}

const OPS_CMP = new Set(['<', '>', '<=', '>=', '=', '==', '<>', '!='])

export function parseExpr(input: string): Expr {
  const parser = new Parser(input)
  const expr = parser.parseOr()
  parser.skip()
  if (!parser.eof()) {
    throw new EngineError('syntax', parser.rest())
  }
  return expr
}

export function tryParse(input: string): { ok: true; ast: Expr } | { ok: false; error: string } {
  try {
    return { ok: true, ast: parseExpr(input) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export function containsHash(ast: Expr): boolean {
  switch (ast.t) {
    case 'hash':
      return true
    case 'unary':
      return containsHash(ast.x)
    case 'bin':
      return containsHash(ast.l) || containsHash(ast.r)
    case 'call':
      return ast.args.some(containsHash)
    default:
      return false
  }
}

export function freeNames(ast: Expr, out = new Set<string>()): Set<string> {
  switch (ast.t) {
    case 'name':
      out.add(ast.name)
      break
    case 'unary':
      freeNames(ast.x, out)
      break
    case 'bin':
      freeNames(ast.l, out)
      freeNames(ast.r, out)
      break
    case 'call':
      if (ast.name === 'lookup' || ast.name === 'tabla') {
        ast.args.slice(1).forEach((a) => freeNames(a, out))
      } else {
        ast.args.forEach((a) => freeNames(a, out))
      }
      break
    default:
      break
  }
  return out
}

export function evaluate(expr: Expr | string, scope: EvalScope): number {
  const ast = typeof expr === 'string' ? parseExpr(expr.trim() === '' ? '0' : expr) : expr
  return evalAst(ast, scope)
}

function evalAst(ast: Expr, scope: EvalScope): number {
  switch (ast.t) {
    case 'num':
      return ast.v
    case 'str':
      throw new EngineError('syntax', ast.v)
    case 'hash':
      if (scope.complement === undefined) throw new EngineError('hash-outside-probability')
      return scope.complement
    case 'name':
      return scope.get(ast.name)
    case 'unary': {
      const v = evalAst(ast.x, scope)
      return ast.op === '-' ? -v : v === 0 ? 1 : 0
    }
    case 'bin':
      return evalBin(ast.op, ast.l, ast.r, scope)
    case 'call':
      return evalCall(ast.name, ast.args, scope)
    default:
      throw new EngineError('syntax')
  }
}

function evalBin(op: string, l: Expr, r: Expr, scope: EvalScope): number {
  if (op === 'and' || op === '&&') {
    return evalAst(l, scope) !== 0 && evalAst(r, scope) !== 0 ? 1 : 0
  }
  if (op === 'or' || op === '||') {
    return evalAst(l, scope) !== 0 || evalAst(r, scope) !== 0 ? 1 : 0
  }
  const lv = evalAst(l, scope)
  const rv = evalAst(r, scope)
  switch (op) {
    case '+':
      return lv + rv
    case '-':
      return lv - rv
    case '*':
      return lv * rv
    case '/':
      return lv / rv
    case '^':
      return Math.pow(lv, rv)
    case '<':
      return lv < rv ? 1 : 0
    case '>':
      return lv > rv ? 1 : 0
    case '<=':
      return lv <= rv ? 1 : 0
    case '>=':
      return lv >= rv ? 1 : 0
    case '=':
    case '==':
      return lv === rv ? 1 : 0
    case '<>':
    case '!=':
      return lv !== rv ? 1 : 0
    default:
      throw new EngineError('syntax', op)
  }
}

function evalCall(name: string, args: Expr[], scope: EvalScope): number {
  const fn = name.toLowerCase()
  if (fn === 'if' || fn === 'si') {
    if (args.length !== 3) throw new EngineError('arity', name)
    return evalAst(args[0], scope) !== 0 ? evalAst(args[1], scope) : evalAst(args[2], scope)
  }
  if (fn === 'lookup' || fn === 'tabla') {
    return evalLookup(args, scope)
  }
  const values = args.map((a) => evalAst(a, scope))
  switch (fn) {
    case 'min':
      return Math.min(...values)
    case 'max':
      return Math.max(...values)
    case 'abs':
      return Math.abs(need(values, 1, name))
    case 'sqrt':
      return Math.sqrt(need(values, 1, name))
    case 'exp':
      return Math.exp(need(values, 1, name))
    case 'ln':
    case 'log':
      return Math.log(need(values, 1, name))
    case 'log10':
      return Math.log10(need(values, 1, name))
    case 'round':
      return Math.round(need(values, 1, name))
    case 'floor':
      return Math.floor(need(values, 1, name))
    case 'ceil':
    case 'ceiling':
      return Math.ceil(need(values, 1, name))
    case 'pow':
      return Math.pow(need(values, 2, name), values[1])
    case 'clamp':
      return Math.min(values[2], Math.max(values[1], need(values, 3, name)))
    case 'mod':
      return need(values, 2, name) % values[1]
    case 'discount':
    case 'descuento': {
      const value = need(values, 3, name)
      const rate = values[1]
      const time = values[2]
      return value / Math.pow(1 + rate, time)
    }
    case 'annuity':
    case 'anualidad': {
      const rate = need(values, 2, name)
      const periods = values[1]
      if (Math.abs(rate) < 1e-12) return periods
      // TreeAge Annuity(rate; periods): present value of 1 per period for `periods` periods.
      return (1 - Math.pow(1 + rate, -periods)) / rate
    }
    default:
      throw new EngineError('unknown-function', name)
  }
}

function need(values: number[], n: number, name: string): number {
  if (values.length < n) throw new EngineError('arity', name)
  return values[0]
}

function evalLookup(args: Expr[], scope: EvalScope): number {
  if (args.length < 2) throw new EngineError('arity', 'lookup')
  const tableName = literalName(args[0])
  const table = scope.tables.get(tableName)
  if (!table) throw new EngineError('unknown-table', tableName)
  const key = evalAst(args[1], scope)
  let col = 1
  if (args.length >= 3) {
    const colName = literalName(args[2])
    const idx = table.columns.indexOf(colName)
    if (idx < 0) throw new EngineError('unknown-column', colName)
    col = idx
  }
  const rows = [...table.rows].sort((a, b) => a[0] - b[0])
  if (rows.length === 0) throw new EngineError('empty-table', tableName)
  for (const row of rows) {
    if (Math.abs(row[0] - key) <= 1e-9) return row[col] ?? 0
  }
  if (!table.interpolate || rows.length === 1 || key <= rows[0][0]) return rows[0][col] ?? 0
  if (key >= rows[rows.length - 1][0]) return rows[rows.length - 1][col] ?? 0
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i]
    const b = rows[i + 1]
    if (key >= a[0] && key <= b[0]) {
      const span = b[0] - a[0]
      const t = span === 0 ? 0 : (key - a[0]) / span
      return (a[col] ?? 0) + t * ((b[col] ?? 0) - (a[col] ?? 0))
    }
  }
  return rows[rows.length - 1][col] ?? 0
}

function literalName(ast: Expr): string {
  if (ast.t === 'str' || ast.t === 'name') return ast.t === 'str' ? ast.v : ast.name
  throw new EngineError('syntax', 'lookup')
}

class Parser {
  private i = 0
  constructor(private readonly s: string) {}

  eof(): boolean {
    return this.i >= this.s.length
  }
  rest(): string {
    return this.s.slice(this.i, this.i + 24)
  }
  skip(): void {
    while (this.i < this.s.length && /\s/u.test(this.s[this.i])) this.i++
  }
  parseOr(): Expr {
    let left = this.parseAnd()
    for (;;) {
      this.skip()
      if (this.keyword('or') || this.op('||')) left = { t: 'bin', op: 'or', l: left, r: this.parseAnd() }
      else break
    }
    return left
  }
  parseAnd(): Expr {
    let left = this.parseNot()
    for (;;) {
      this.skip()
      if (this.keyword('and') || this.op('&&')) left = { t: 'bin', op: 'and', l: left, r: this.parseNot() }
      else break
    }
    return left
  }
  parseNot(): Expr {
    this.skip()
    if (this.keyword('not') || this.op('!')) return { t: 'unary', op: 'not', x: this.parseNot() }
    return this.parseCmp()
  }
  parseCmp(): Expr {
    let left = this.parseAdd()
    this.skip()
    const op = this.matchCmp()
    if (!op) return left
    return { t: 'bin', op, l: left, r: this.parseAdd() }
  }
  parseAdd(): Expr {
    let left = this.parseMul()
    for (;;) {
      this.skip()
      if (this.eat('+')) left = { t: 'bin', op: '+', l: left, r: this.parseMul() }
      else if (this.eat('-')) left = { t: 'bin', op: '-', l: left, r: this.parseMul() }
      else break
    }
    return left
  }
  parseMul(): Expr {
    let left = this.parsePow()
    for (;;) {
      this.skip()
      if (this.eat('*')) left = { t: 'bin', op: '*', l: left, r: this.parsePow() }
      else if (this.eat('/')) left = { t: 'bin', op: '/', l: left, r: this.parsePow() }
      else break
    }
    return left
  }
  parsePow(): Expr {
    const left = this.parseUnary()
    this.skip()
    if (this.eat('^')) return { t: 'bin', op: '^', l: left, r: this.parsePow() }
    return left
  }
  parseUnary(): Expr {
    this.skip()
    if (this.eat('-')) return { t: 'unary', op: '-', x: this.parseUnary() }
    if (this.eat('+')) return this.parseUnary()
    return this.parsePrimary()
  }
  parsePrimary(): Expr {
    this.skip()
    if (this.eat('(')) {
      const inner = this.parseOr()
      this.skip()
      if (!this.eat(')')) throw new EngineError('syntax', ')')
      return inner
    }
    if (this.eat('#')) return { t: 'hash' }
    if (this.s[this.i] === '"' || this.s[this.i] === "'") return { t: 'str', v: this.string() }
    if (this.isNumStart()) return { t: 'num', v: this.number() }
    if (this.isIdentStart()) {
      const name = this.ident()
      this.skip()
      if (this.eat('(')) {
        const args: Expr[] = []
        this.skip()
        if (!this.eat(')')) {
          for (;;) {
            args.push(this.parseOr())
            this.skip()
            if (this.eat(',')) continue
            if (this.eat(')')) break
            throw new EngineError('syntax', ',')
          }
        }
        return { t: 'call', name, args }
      }
      if (this.eat('[')) {
        const key = this.parseOr()
        this.skip()
        if (!this.eat(']')) throw new EngineError('syntax', ']')
        return { t: 'call', name: 'lookup', args: [{ t: 'str', v: name }, key] }
      }
      return { t: 'name', name }
    }
    throw new EngineError('syntax', this.rest())
  }

  private matchCmp(): string | null {
    const two = this.s.slice(this.i, this.i + 2)
    if (OPS_CMP.has(two) && two.length === 2) {
      this.i += 2
      return two
    }
    const one = this.s[this.i]
    if (one === '<' || one === '>' || one === '=') {
      this.i += 1
      return one
    }
    return null
  }
  private keyword(word: string): boolean {
    this.skip()
    if (this.s.slice(this.i, this.i + word.length).toLowerCase() !== word) return false
    const after = this.s[this.i + word.length]
    if (after && /[\p{L}\p{N}_]/u.test(after)) return false
    this.i += word.length
    return true
  }
  private op(token: string): boolean {
    this.skip()
    if (this.s.startsWith(token, this.i)) {
      this.i += token.length
      return true
    }
    return false
  }
  private eat(ch: string): boolean {
    this.skip()
    if (this.s.startsWith(ch, this.i)) {
      this.i += ch.length
      return true
    }
    return false
  }
  private isNumStart(): boolean {
    const c = this.s[this.i]
    if (c >= '0' && c <= '9') return true
    return c === '.' && this.s[this.i + 1] >= '0' && this.s[this.i + 1] <= '9'
  }
  private isIdentStart(): boolean {
    return /[\p{L}_]/u.test(this.s[this.i] ?? '')
  }
  private ident(): string {
    const start = this.i
    this.i++
    while (this.i < this.s.length && /[\p{L}\p{N}_]/u.test(this.s[this.i])) this.i++
    return this.s.slice(start, this.i)
  }
  private number(): number {
    const start = this.i
    while (this.i < this.s.length && /[0-9.]/.test(this.s[this.i])) this.i++
    if (this.s[this.i] === 'e' || this.s[this.i] === 'E') {
      this.i++
      if (this.s[this.i] === '+' || this.s[this.i] === '-') this.i++
      while (this.i < this.s.length && /[0-9]/.test(this.s[this.i])) this.i++
    }
    const v = Number(this.s.slice(start, this.i))
    if (!Number.isFinite(v)) throw new EngineError('syntax', this.s.slice(start, this.i))
    return v
  }
  private string(): string {
    const q = this.s[this.i++]
    let out = ''
    while (this.i < this.s.length && this.s[this.i] !== q) {
      if (this.s[this.i] === '\\') {
        this.i++
        out += this.s[this.i] ?? ''
        this.i++
      } else {
        out += this.s[this.i++]
      }
    }
    if (this.s[this.i] !== q) throw new EngineError('syntax', 'string')
    this.i++
    return out
  }
}
