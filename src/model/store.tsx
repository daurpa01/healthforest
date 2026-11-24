import { createContext, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react'
import { analyzeCea, type CeaResult } from '../engine/cea'
import { runBia, type BiaResult } from '../engine/bia'
import { rollback, type RollbackResult } from '../engine/tree'
import type { HealthModel } from '../engine/types'
import type { Lang } from '../format'
import { blankModel, normalizeModel, themeGraph } from './defaults'
import type { Focus } from './treeops'

export type View = 'home' | 'tree' | 'results' | 'markov' | 'sensitivity' | 'psa' | 'bia' | 'settings'
export type Selection = { nodeId: string; branchId?: string } | null

export type Analysis =
  | { ok: true; roll: RollbackResult; cea: CeaResult; bia: BiaResult }
  | { ok: false; error: unknown }

interface State {
  model: HealthModel
  past: HealthModel[]
  future: HealthModel[]
  view: View
  lang: Lang
  selection: Selection
  focus: Focus
  collapsed: string[]
  help: boolean
  saved: boolean
}

type Action =
  | { type: 'edit'; recipe: (model: HealthModel) => HealthModel; push: boolean }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'load'; model: HealthModel; view?: View }
  | { type: 'view'; view: View }
  | { type: 'lang'; lang: Lang }
  | { type: 'select'; selection: Selection }
  | { type: 'focus'; focus: Focus }
  | { type: 'collapse'; id: string }
  | { type: 'help'; help: boolean }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'edit': {
      const model = action.recipe(state.model)
      return {
        ...state,
        model,
        past: action.push ? [...state.past, state.model].slice(-60) : state.past,
        future: action.push ? [] : state.future,
      }
    }
    case 'undo': {
      const previous = state.past[state.past.length - 1]
      if (!previous) return state
      return { ...state, model: previous, past: state.past.slice(0, -1), future: [state.model, ...state.future] }
    }
    case 'redo': {
      const next = state.future[0]
      if (!next) return state
      return { ...state, model: next, past: [...state.past, state.model], future: state.future.slice(1) }
    }
    case 'load':
      return { ...state, model: action.model, past: [], future: [], selection: null, focus: { kind: 'main' }, collapsed: [], view: action.view ?? 'tree' }
    case 'view':
      return { ...state, view: action.view }
    case 'lang':
      return { ...state, lang: action.lang }
    case 'select':
      return { ...state, selection: action.selection }
    case 'focus':
      return { ...state, focus: action.focus, selection: null }
    case 'collapse': {
      const collapsed = state.collapsed.includes(action.id) ? state.collapsed.filter((id) => id !== action.id) : [...state.collapsed, action.id]
      return { ...state, collapsed }
    }
    case 'help':
      return { ...state, help: action.help }
    default:
      return state
  }
}

interface Api extends State {
  analysis: Analysis
  edit: (recipe: (model: HealthModel) => HealthModel, record?: boolean) => void
  undo: () => void
  redo: () => void
  load: (model: HealthModel, view?: View) => void
  setView: (view: View) => void
  setLang: (lang: Lang) => void
  setSelection: (selection: Selection) => void
  setFocus: (focus: Focus) => void
  toggleCollapse: (id: string) => void
  setHelp: (help: boolean) => void
  setTheme: (theme: HealthModel['preferences']['graph']['theme']) => void
}

const Ctx = createContext<Api | null>(null)
const STORAGE = 'healthforest.model.v1'

export function StoreProvider({ children }: { children: ReactNode }) {
  const saved = readSaved()
  const [state, dispatch] = useReducer(reducer, {
    model: blankModel(),
    past: [],
    future: [],
    view: 'home',
    lang: (localStorage.getItem('healthforest.lang') as Lang) || 'es',
    selection: null,
    focus: { kind: 'main' },
    collapsed: [],
    help: false,
    saved: Boolean(saved),
  })
  const last = useRef(0)
  const analysis = useMemo<Analysis>(() => {
    try {
      const roll = rollback(state.model)
      return { ok: true, roll, cea: analyzeCea(roll.strategies, state.model.preferences), bia: runBia(state.model.bia) }
    } catch (error) {
      return { ok: false, error }
    }
  }, [state.model])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE, JSON.stringify(state.model))
      } catch {
        /* private mode or file:// */
      }
    }, 350)
    return () => window.clearTimeout(timer)
  }, [state.model])

  useEffect(() => {
    try {
      localStorage.setItem('healthforest.lang', state.lang)
    } catch {
      /* ignore */
    }
    document.documentElement.lang = state.lang
    document.documentElement.dataset.theme = state.model.preferences.graph.theme
  }, [state.lang, state.model.preferences.graph.theme])

  const api: Api = {
    ...state,
    analysis,
    edit: (recipe, record = true) => {
      const now = Date.now()
      const push = record && now - last.current > 450
      if (push) last.current = now
      dispatch({ type: 'edit', recipe, push })
    },
    undo: () => dispatch({ type: 'undo' }),
    redo: () => dispatch({ type: 'redo' }),
    load: (model, view) => dispatch({ type: 'load', model, view }),
    setView: (view) => dispatch({ type: 'view', view }),
    setLang: (lang) => dispatch({ type: 'lang', lang }),
    setSelection: (selection) => dispatch({ type: 'select', selection }),
    setFocus: (focus) => dispatch({ type: 'focus', focus }),
    toggleCollapse: (id) => dispatch({ type: 'collapse', id }),
    setHelp: (help) => dispatch({ type: 'help', help }),
    setTheme: (theme) =>
      dispatch({
        type: 'edit',
        push: true,
        recipe: (model) => ({ ...model, preferences: { ...model.preferences, graph: themeGraph(theme) } }),
      }),
  }
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

export function useApp(): Api {
  const value = useContext(Ctx)
  if (!value) throw new Error('store')
  return value
}

export function readSaved(): HealthModel | null {
  try {
    const raw = localStorage.getItem(STORAGE)
    if (!raw) return null
    return normalizeModel(JSON.parse(raw))
  } catch {
    return null
  }
}
