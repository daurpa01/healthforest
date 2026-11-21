import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { importTrex } from './engine/trex'
import { normalizeModel } from './model/defaults'
import { readTree } from './model/treeops'
import { StoreProvider, useApp, type View } from './model/store'
import { downloadBlob, svgToPdf, svgToPng } from './export'
import { t, tError } from './i18n'
import { TreeCanvas } from './components/TreeCanvas'
import { DataPanel, Inspector, Outline } from './components/panels'
import { HomeView } from './components/home'

const ResultsView = lazy(() => import('./components/views').then((module) => ({ default: module.ResultsView })))
const MarkovView = lazy(() => import('./components/views').then((module) => ({ default: module.MarkovView })))
const SensitivityView = lazy(() => import('./components/views').then((module) => ({ default: module.SensitivityView })))
const PsaView = lazy(() => import('./components/views').then((module) => ({ default: module.PsaView })))
const BiaView = lazy(() => import('./components/views').then((module) => ({ default: module.BiaView })))
const SettingsView = lazy(() => import('./components/views').then((module) => ({ default: module.SettingsView })))

export function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  )
}

function Shell() {
  const app = useApp()
  const lang = app.lang
  const fileRef = useRef<HTMLInputElement>(null)
  const [tab, setTab] = useState<'outline' | 'data'>('outline')
  const [readyMs, setReadyMs] = useState<number | null>(null)
  useEffect(() => {
    setReadyMs(Math.round(performance.now()))
  }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) app.redo()
        else app.undo()
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        app.redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [app])
  const tree = readTree(app.model, app.focus)
  const optimal = new Set<string>()
  if (app.analysis.ok && app.focus.kind === 'main') markOptimal(app.model.tree, app.analysis.roll.chosenBranch, true, optimal)
  const views: { id: View; label: string; icon: string }[] = [
    { id: 'home', label: t(lang, 'navHome'), icon: '⌂' },
    { id: 'tree', label: t(lang, 'navTree'), icon: '⎇' },
    { id: 'results', label: t(lang, 'navResults'), icon: '◈' },
    { id: 'markov', label: t(lang, 'navMarkov'), icon: '↻' },
    { id: 'sensitivity', label: t(lang, 'navSens'), icon: '≋' },
    { id: 'psa', label: t(lang, 'navPsa'), icon: '✺' },
    { id: 'bia', label: t(lang, 'navBia'), icon: '▤' },
    { id: 'settings', label: t(lang, 'navSettings'), icon: '⚙' },
  ]
  return (
    <div className="app">
      <aside className="rail">
        <button className="brand" onClick={() => app.setView('home')} title="HealthForest">
          <Logo />
        </button>
        <nav>
          {views.map((view) => (
            <button key={view.id} className={app.view === view.id ? 'active' : ''} onClick={() => app.setView(view.id)} title={view.label}>
              <span aria-hidden="true">{view.icon}</span>
              {view.label}
            </button>
          ))}
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="brand-lockup">
            <strong>Health<em>Forest</em></strong>
            <small>{t(lang, 'tagline')}</small>
          </div>
          <input className="model-name" aria-label={t(lang, 'modelName')} value={app.model.name} onChange={(event) => app.edit((model) => ({ ...model, name: event.target.value }), false)} />
          <span className={`status-pill${app.analysis.ok ? '' : ' bad'}`}>{app.analysis.ok ? t(lang, 'calculated') : t(lang, 'notCalculated')}</span>
          <div className="spacer" />
          <button className="btn-ghost" onClick={() => app.undo()} title={t(lang, 'undo')}>{t(lang, 'undo')}</button>
          <button className="btn-ghost" onClick={() => app.redo()} title={t(lang, 'redo')}>{t(lang, 'redo')}</button>
          <button className="btn-ghost" onClick={() => fileRef.current?.click()}>{t(lang, 'open')}</button>
          <button className="btn" onClick={() => downloadBlob(`${safeName(app.model.name)}.healthforest.json`, new Blob([JSON.stringify(app.model, null, 2)], { type: 'application/json' }))}>{t(lang, 'save')}</button>
          {app.view === 'tree' && (
            <>
              <button className="btn-ghost" onClick={() => exportTree('svg')}>SVG</button>
              <button className="btn-ghost" onClick={() => exportTree('png')}>PNG</button>
              <button className="btn-ghost" onClick={() => exportTree('pdf')}>PDF</button>
            </>
          )}
          <button className="btn-ghost" onClick={() => app.setTheme(app.model.preferences.graph.theme === 'light' ? 'dark' : app.model.preferences.graph.theme === 'dark' ? 'publication' : 'light')}>
            {app.model.preferences.graph.theme === 'light' ? t(lang, 'themeDark') : app.model.preferences.graph.theme === 'dark' ? t(lang, 'themePub') : t(lang, 'themeLight')}
          </button>
          <button className="btn-gold" onClick={() => app.setLang(lang === 'es' ? 'en' : 'es')}>{lang === 'es' ? 'EN' : 'ES'}</button>
          <button className="btn-ghost" onClick={() => app.setHelp(true)} title={t(lang, 'help')}>?</button>
          <input ref={fileRef} type="file" accept=".json,.trex,.xml,application/json" hidden onChange={async (event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (!file) return
            try {
              const text = await file.text()
              if (file.name.toLowerCase().endsWith('.trex') || text.includes('<tree:Tree') || text.includes('NodeType=')) {
                const model = importTrex(text)
                model.name = file.name.replace(/\.trex$/i, '')
                app.load(model)
              } else app.load(normalizeModel(JSON.parse(text)))
            } catch (error) {
              window.alert(error instanceof Error ? error.message : 'archivo')
            }
          }} />
        </header>
        {!app.analysis.ok && app.view !== 'home' && (
          <div className="banner">{tError(lang, app.analysis.error && typeof app.analysis.error === 'object' && 'code' in app.analysis.error ? String((app.analysis.error as { code: string }).code) : 'syntax', app.analysis.error instanceof Error ? app.analysis.error.message : '')}</div>
        )}
        <div className="content">
          {app.view === 'home' && <HomeView />}
          {app.view === 'tree' && (
            <div className="workspace">
              <aside className="side">
                <div className="side-tabs">
                  <button className={tab === 'outline' ? 'active' : ''} onClick={() => setTab('outline')}>{t(lang, 'tabOutline')}</button>
                  <button className={tab === 'data' ? 'active' : ''} onClick={() => setTab('data')}>{t(lang, 'tabData')}</button>
                </div>
                <div className="scroll">{tab === 'outline' ? <Outline /> : <DataPanel />}</div>
              </aside>
              <div className="canvas-host">
                {app.focus.kind === 'transition' && (
                  <div className="crumb">
                    <button className="btn btn-tiny" onClick={() => app.setFocus({ kind: 'main' })}>{t(lang, 'backToTree')}</button>
                    <div>{t(lang, 'editingTransition')}</div>
                  </div>
                )}
                <TreeCanvas
                  tree={tree}
                  graph={app.model.preferences.graph}
                  nodePayoffs={app.analysis.ok ? app.analysis.roll.nodePayoffs : {}}
                  optimal={optimal}
                  selectedNode={app.selection?.nodeId}
                  selectedBranch={app.selection?.branchId}
                  collapsed={new Set(app.collapsed)}
                  lang={lang}
                  symbol={app.model.preferences.currencySymbol}
                  decimals={app.model.preferences.decimals}
                  onSelectNode={(nodeId) => app.setSelection({ nodeId })}
                  onSelectBranch={(branchId, parentId) => app.setSelection({ nodeId: parentId, branchId })}
                  onToggle={(id) => app.toggleCollapse(id)}
                />
              </div>
              <aside className="side right"><div className="scroll"><Inspector /></div></aside>
            </div>
          )}
          <Suspense fallback={<div className="solo-view"><p className="help">{t(lang, 'running')}</p></div>}>
            {app.view === 'results' && <ResultsView />}
            {app.view === 'markov' && <MarkovView />}
            {app.view === 'sensitivity' && <SensitivityView />}
            {app.view === 'psa' && <PsaView />}
            {app.view === 'bia' && <BiaView />}
            {app.view === 'settings' && <SettingsView />}
          </Suspense>
        </div>
        <footer className="foot">{readyMs !== null ? t(lang, 'readyMs', { ms: readyMs }) : ''}</footer>
      </div>
      {app.help && (
        <div className="modal-back" onClick={() => app.setHelp(false)}>
          <div className="card modal" onClick={(event) => event.stopPropagation()}>
            <h3>{t(lang, 'help')}</h3>
            <p>{t(lang, 'helpBody')}</p>
            <p className="help">{t(lang, 'formulaHint')}</p>
            <p className="help">{t(lang, 'hintProb')}</p>
            <button className="btn" onClick={() => app.setHelp(false)}>{t(lang, 'close')}</button>
          </div>
        </div>
      )}
    </div>
  )
}

function Logo() {
  return (
    <svg width="36" height="36" viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="#14382c" />
      <circle cx="32" cy="24" r="11" fill="#3eae7a" />
      <circle cx="22" cy="31" r="8" fill="#1f6b4c" />
      <circle cx="43" cy="30" r="7" fill="#d7efe3" />
      <rect x="30" y="34" width="5" height="15" rx="2" fill="#e2b340" />
    </svg>
  )
}

async function exportTree(kind: 'svg' | 'png' | 'pdf') {
  const svg = document.getElementById('tree-svg')
  if (!(svg instanceof SVGSVGElement)) return
  if (kind === 'svg') {
    downloadBlob('arbol.svg', new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }))
    return
  }
  if (kind === 'png') {
    downloadBlob('arbol.png', await svgToPng(svg, 2))
    return
  }
  downloadBlob('arbol.pdf', await svgToPdf(svg, 'HealthForest'))
}

function safeName(name: string): string {
  return name.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-|-$/g, '') || 'healthforest'
}

function markOptimal(node: import('./engine/types').TreeNode, chosen: Record<string, string>, active: boolean, acc: Set<string>) {
  if (!active) return
  if (node.type === 'decision') {
    const pick = chosen[node.id]
    for (const branch of node.branches) {
      if (branch.id === pick) {
        acc.add(branch.id)
        markOptimal(branch.child, chosen, true, acc)
      }
    }
    return
  }
  for (const branch of node.branches) {
    acc.add(branch.id)
    markOptimal(branch.child, chosen, true, acc)
  }
}
