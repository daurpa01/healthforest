import { useMemo, useState } from 'react'
import { oneWay, threshold, tornado, twoWay } from '../engine/sensitivity'
import { evppiBinned, strategyNmbTable, type PSASummary, type PSATrial } from '../engine/psa'
import { biaOneWay, runBia } from '../engine/bia'
import { markovToDiagram } from '../engine/diagram'
import { pathwayReport } from '../engine/pathway'
import { costsByPeriod, periodCsv } from '../engine/periods'
import { runPartsa } from '../engine/partsa'
import type { MicroResult } from '../engine/microsim'
import { useApp } from '../model/store'
import { downloadBlob, toCsv } from '../export'
import { formatIcer, formatMoney, formatNum } from '../format'
import { t, tError } from '../i18n'
import { CeacChart, FrontierChart, GroupedBars, HeatGrid, LineChart, ScatterPlane, StackedArea, TornadoChart, strategyColor } from './charts'
import type { TreeNode } from '../engine/types'
import { useJob } from '../workers/useJob'
import { StepLabel, Wizard, attachMarkov, markovFromPreset } from './wizards'

export function ResultsView() {
  const app = useApp()
  const lang = app.lang
  const prefs = app.model.preferences
  if (!app.analysis.ok) return <ErrorNote />
  const { cea } = app.analysis
  const money = (value: number) => formatMoney(value, prefs.currencySymbol, prefs.decimals, lang)
  const optimal = cea.strategies.find((strategy) => strategy.id === cea.optimalId)
  const statusLabel = (status: string) => {
    if (status === 'strong') return t(lang, 'dominated')
    if (status === 'extended') return t(lang, 'extended')
    if (status === 'reference') return t(lang, 'reference')
    return t(lang, 'undominated')
  }
  return (
    <div className="solo-view">
      <div className="view-head">
        <div>
          <p className="kicker">{t(lang, 'resultsTitle')}</p>
          <h2>{app.model.name}</h2>
        </div>
        <button
          className="btn"
          onClick={() =>
            downloadBlob(
              'resultados.csv',
              new Blob([toCsv(cea.strategies.map((row) => ({ strategy: row.name, cost: row.cost, effect: row.effect, icer: row.icer, nmb: row.nmb, status: row.status })), lang)], { type: 'text/csv' }),
            )
          }
        >
          {t(lang, 'exportCsv')}
        </button>
      </div>
      {optimal && <p className="sentence">{t(lang, 'sentence', { wtp: money(cea.wtp), name: optimal.name, nmb: money(optimal.nmb) })}</p>}
      <div className="kpi-row">
        <div className="kpi"><span className="kicker">{t(lang, 'optimalIs')}</span><b>{optimal?.name}</b></div>
        <div className="kpi"><span className="kicker">{t(lang, 'wtp')}</span><b>{money(prefs.wtp)}</b></div>
        <div className="kpi"><span className="kicker">{t(lang, 'nmb')}</span><b>{optimal ? money(optimal.nmb) : '—'}</b></div>
      </div>
      <label className="field" style={{ maxWidth: 360 }}>
        <span>{t(lang, 'wtp')} ({money(prefs.wtp)} {t(lang, 'perQaly')})</span>
        <input type="range" min={prefs.wtpMin} max={prefs.wtpMax} value={prefs.wtp} onChange={(event) => app.edit((model) => ({ ...model, preferences: { ...model.preferences, wtp: Number(event.target.value) } }), false)} />
      </label>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t(lang, 'strategy')}</th>
              <th className="num">{t(lang, 'cost')}</th>
              <th className="num">{t(lang, 'effect')}</th>
              <th className="num">{t(lang, 'deltaCost')}</th>
              <th className="num">{t(lang, 'deltaEffect')}</th>
              <th className="num">{t(lang, 'icer')}</th>
              <th className="num">{t(lang, 'nmb')}</th>
              <th className="num">{t(lang, 'nhb')}</th>
              <th>{t(lang, 'rank')}</th>
            </tr>
          </thead>
          <tbody>
            {cea.strategies.map((row) => (
              <tr key={row.id} className={row.id === cea.optimalId ? 'optimal' : row.onFrontier ? '' : 'dim'}>
                <td>{row.name}</td>
                <td className="num">{money(row.cost)}</td>
                <td className="num">{formatNum(row.effect, prefs.decimals, lang)}</td>
                <td className="num">{row.incrementalCost === null ? '—' : money(row.incrementalCost)}</td>
                <td className="num">{row.incrementalEffect === null ? '—' : formatNum(row.incrementalEffect, prefs.decimals, lang)}</td>
                <td className="num">{row.status === 'strong' || row.status === 'extended' ? statusLabel(row.status) : formatIcer(row.icer, prefs.currencySymbol, prefs.decimals, lang)}</td>
                <td className="num">{money(row.nmb)}</td>
                <td className="num">{formatNum(row.nhb, prefs.decimals, lang)}</td>
                <td><span className={`tag${row.status === 'strong' ? ' bad' : row.status === 'extended' ? ' ext' : ''}`}>{statusLabel(row.status)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="chart-card" style={{ marginTop: 14 }}>
        <h3>{t(lang, 'frontier')}</h3>
        <FrontierChart cea={cea} wtp={prefs.wtp} formatX={(value) => formatNum(value, 2, lang)} formatY={money} xLabel={t(lang, 'effect')} yLabel={t(lang, 'cost')} />
      </div>
      <PathwayTable />
      {app.analysis.ok && app.analysis.roll.warnings.length > 0 && (
        <div className="banner">{app.analysis.roll.warnings.map((warning) => tError(lang, warning.code, warning.detail ?? '')).join(' ')}</div>
      )}
    </div>
  )
}

export function MarkovView() {
  const app = useApp()
  const lang = app.lang
  const job = useJob()
  const nodes = collectMarkov(app.model.tree)
  const [id, setId] = useState(nodes[0]?.id ?? '')
  const [micro, setMicro] = useState<MicroResult | null>(null)
  const [preset, setPreset] = useState<'simple' | 'chronic'>('chronic')
  const [cycles, setCycles] = useState(10)
  const [discount, setDiscount] = useState(0.03)
  const node = nodes.find((item) => item.id === id) ?? nodes[0]
  const guide = (
    <Wizard title={t(lang, 'guide')} lead={t(lang, 'wizardMarkovLead')} startOpen={!node?.markov}>
      <StepLabel lang={lang} n={1} />
      <div className="choice-row">
        <button type="button" className={preset === 'simple' ? 'choice active' : 'choice'} onClick={() => setPreset('simple')}>{t(lang, 'presetSimple')}</button>
        <button type="button" className={preset === 'chronic' ? 'choice active' : 'choice'} onClick={() => setPreset('chronic')}>{t(lang, 'presetChronic')}</button>
      </div>
      <StepLabel lang={lang} n={2} />
      <div className="btn-row">
        <label className="field"><span>{t(lang, 'cycles')}</span><input value={cycles} onChange={(event) => setCycles(Number(event.target.value))} /></label>
        <label className="field"><span>{t(lang, 'discountCost')}</span><input value={discount} onChange={(event) => setDiscount(Number(event.target.value))} /></label>
      </div>
      <button className="btn-gold" type="button" onClick={() => app.edit((model) => attachMarkov(model, markovFromPreset(preset, cycles, discount)))}>{t(lang, 'wizardApply')}</button>
    </Wizard>
  )
  if (!node?.markov) return <div className="solo-view">{guide}</div>
  if (!app.analysis.ok) return <div className="solo-view">{guide}<ErrorNote /></div>
  const cohort = app.analysis.roll.markov[node.id]
  if (!cohort) return <div className="solo-view"><p>{t(lang, 'noMarkov')}</p></div>
  const series = cohort.states.map((state, index) => ({
    id: state.id,
    name: state.name,
    color: strategyColor(index),
    values: cohort.cycles.map((row) => row.occupancy[state.id] ?? 0),
  }))
  return (
    <div className="solo-view">
      {guide}
      <div className="view-head">
        <div>
          <p className="kicker">{t(lang, 'navMarkov')}</p>
          <h2>{node.name}</h2>
        </div>
        <label className="field">
          <span>{t(lang, 'selectMarkov')}</span>
          <select value={node.id} onChange={(event) => { setId(event.target.value); setMicro(null) }}>
            {nodes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
      </div>
      <div className="kpi-row">
        <div className="kpi"><span className="kicker">{t(lang, 'cost')}</span><b>{formatMoney(cohort.total.cost, app.model.preferences.currencySymbol, 2, lang)}</b></div>
        <div className="kpi"><span className="kicker">{t(lang, 'effect')}</span><b>{formatNum(cohort.total.effect, 3, lang)}</b></div>
        <div className="kpi"><span className="kicker">{t(lang, 'cycles')}</span><b>{cohort.stagesRun}</b></div>
      </div>
      <div className="chart-card">
        <h3>{t(lang, 'trace')}</h3>
        <StackedArea stages={cohort.cycles.map((row) => row.stage)} series={series} />
      </div>
      <div className="chart-card" style={{ marginTop: 12 }}>
        <h3>{t(lang, 'survival')}</h3>
        <LineChart series={[{ name: t(lang, 'survival'), color: '#1f6b4c', points: cohort.survival.map((value, index) => ({ x: index, y: value })) }]} yFormat={(value) => formatNum(value, 2, lang)} />
      </div>
      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table>
          <thead>
            <tr>
              <th>{t(lang, 'stage')}</th>
              {cohort.states.map((state) => <th key={state.id} className="num">{state.name}</th>)}
              <th className="num">{t(lang, 'cost')}</th>
              <th className="num">{t(lang, 'effect')}</th>
            </tr>
          </thead>
          <tbody>
            {cohort.cycles.map((row) => (
              <tr key={row.stage}>
                <td>{row.stage}</td>
                {cohort.states.map((state) => <td key={state.id} className="num">{formatNum(row.occupancy[state.id] ?? 0, 3, lang)}</td>)}
                <td className="num">{formatNum(row.reward.cost ?? 0, 2, lang)}</td>
                <td className="num">{formatNum(row.reward.effect ?? 0, 3, lang)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="section">
        <h3>{t(lang, 'stateDiagram')}</h3>
        <StateDiagram spec={node.markov} />
      </div>
      <PeriodCosts cycles={cohort.cycles} />
      <PartsaPanel />
      <div className="btn-row" style={{ marginTop: 12 }}>
        <button
          className="btn-gold"
          disabled={job.running}
          onClick={() => {
            void job.start({ kind: 'micro', model: app.model, spec: node.markov, n: app.model.preferences.microsimN, seed: app.model.preferences.microsimSeed }).then((result) => setMicro(result as MicroResult))
          }}
        >
          {job.running ? t(lang, 'running') : t(lang, 'runMicro')}
        </button>
        {job.running && (
          <button className="btn" onClick={job.cancel}>{t(lang, 'cancel')}</button>
        )}
        <span className="help">{t(lang, 'patients')}: {app.model.preferences.microsimN}</span>
      </div>
      {job.running && <progress className="job" max={1} value={job.progress} aria-label={t(lang, 'progress')} />}
      {micro && (
        <div className="kpi-row">
          <div className="kpi"><span className="kicker">{t(lang, 'microMean')} {t(lang, 'cost')}</span><b>{formatNum(micro.mean.cost, 2, lang)}</b></div>
          <div className="kpi"><span className="kicker">{t(lang, 'microMean')} {t(lang, 'effect')}</span><b>{formatNum(micro.mean.effect, 3, lang)}</b></div>
          <div className="kpi"><span className="kicker">{t(lang, 'sd')}</span><b>{formatNum(micro.sd.effect, 3, lang)}</b></div>
        </div>
      )}
    </div>
  )
}


function StateDiagram({ spec }: { spec: NonNullable<TreeNode['markov']> }) {
  const diagram = markovToDiagram(spec)
  const n = Math.max(diagram.states.length, 1)
  const cx = 280
  const cy = 150
  const r = 100
  const pos = (index: number) => {
    const angle = (index / n) * Math.PI * 2 - Math.PI / 2
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) }
  }
  return (
    <svg viewBox="0 0 560 300" className="plot" role="img">
      {diagram.transitions.map((transition, index) => {
        if (transition.from === transition.to) return null
        const a = diagram.states.findIndex((state) => state.id === transition.from)
        const b = diagram.states.findIndex((state) => state.id === transition.to)
        if (a < 0 || b < 0) return null
        const p1 = pos(a)
        const p2 = pos(b)
        return <line key={`${transition.from}-${transition.to}-${index}`} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#c9bba6" />
      })}
      {diagram.states.map((state, index) => {
        const p = pos(index)
        return (
          <g key={state.id}>
            <circle cx={p.x} cy={p.y} r="28" fill={state.absorbing ? '#a33b24' : '#1f6b4c'} />
            <text x={p.x} y={p.y + 4} textAnchor="middle" fill="white" fontSize="11">{state.name}</text>
          </g>
        )
      })}
    </svg>
  )
}

function PathwayTable() {
  const app = useApp()
  const lang = app.lang
  const rows = useMemo(() => {
    try {
      return pathwayReport(app.model).filter((row) => row.labels.length).slice(0, 8)
    } catch {
      return []
    }
  }, [app.model])
  if (rows.length < 2) return null
  return (
    <div className="table-wrap" style={{ marginTop: 14 }}>
      <h3>{t(lang, 'pathways')}</h3>
      <table>
        <thead><tr><th>{t(lang, 'strategy')}</th><th className="num">{t(lang, 'probability')}</th><th className="num">{t(lang, 'cost')}</th><th className="num">{t(lang, 'effect')}</th></tr></thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              <td>{row.labels.join(' · ')}</td>
              <td className="num">{formatNum(row.probability, 3, lang)}</td>
              <td className="num">{formatNum(row.payoffs.cost ?? 0, 2, lang)}</td>
              <td className="num">{formatNum(row.payoffs.effect ?? 0, 3, lang)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PeriodCosts({ cycles }: { cycles: { stage: number; occupancy: Record<string, number>; occupancyNext: Record<string, number>; reward: { cost?: number; effect?: number }; discounted: { cost?: number; effect?: number }; discountFactor: number; cumulative: { cost?: number; effect?: number } }[] }) {
  const lang = useApp().lang
  const rows = costsByPeriod(cycles).slice(0, 12)
  return (
    <div className="section">
      <div className="view-head">
        <h3>{t(lang, 'periodCosts')}</h3>
        <button className="btn" onClick={() => downloadBlob('periodos.csv', new Blob([periodCsv(costsByPeriod(cycles))], { type: 'text/csv' }))}>{t(lang, 'exportCsv')}</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>{t(lang, 'stage')}</th><th className="num">{t(lang, 'cost')}</th><th className="num">{t(lang, 'effect')}</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.period}><td>{row.period}</td><td className="num">{formatNum(row.cost, 2, lang)}</td><td className="num">{formatNum(row.effect, 3, lang)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PartsaPanel() {
  const lang = useApp().lang
  const [pfs, setPfs] = useState(0.2)
  const [os, setOs] = useState(0.1)
  const result = runPartsa({
    pfs: { kind: 'exponential', a: pfs },
    os: { kind: 'exponential', a: os },
    cycles: 60,
    cycleLength: 1,
    rewards: { pf: { cost: 12000, effect: 0.8 }, progressed: { cost: 40000, effect: 0.5 }, dead: { cost: 0, effect: 0 } },
    discountRate: 0.03,
    payoffIds: ['cost', 'effect'],
  })
  return (
    <div className="section">
      <h3>{t(lang, 'partsa')}</h3>
      <p className="help">{t(lang, 'partsaHelp')}</p>
      <div className="btn-row">
        <label className="field"><span>PFS</span><input value={pfs} onChange={(event) => setPfs(Number(event.target.value))} /></label>
        <label className="field"><span>OS</span><input value={os} onChange={(event) => setOs(Number(event.target.value))} /></label>
      </div>
      <div className="kpi-row">
        <div className="kpi"><span className="kicker">{t(lang, 'cost')}</span><b>{formatNum(result.total.cost, 0, lang)}</b></div>
        <div className="kpi"><span className="kicker">{t(lang, 'effect')}</span><b>{formatNum(result.total.effect, 2, lang)}</b></div>
      </div>
      <LineChart series={[
        { name: 'PFS', color: '#1f6b4c', points: result.cycles.map((row) => ({ x: row.stage, y: row.pf })) },
        { name: 'OS', color: '#1e4d7b', points: result.cycles.map((row) => ({ x: row.stage, y: row.pf + row.progressed })) },
      ]} yFormat={(value) => formatNum(value, 2, lang)} />
    </div>
  )
}

export function SensitivityView() {
  const app = useApp()
  const lang = app.lang
  const variables = app.model.variables.filter((variable) => variable.low !== undefined && variable.high !== undefined)
  const [variable, setVariable] = useState(variables[0]?.name ?? '')
  const [outcome, setOutcome] = useState<'nmb' | 'cost' | 'effect' | 'icer'>('nmb')
  const strategies = app.analysis.ok ? app.analysis.cea.strategies : []
  const [strategyId, setStrategyId] = useState(strategies[0]?.id ?? '')
  const selected = variables.find((item) => item.name === variable) ?? variables[0]
  const line = useMemo(() => {
    if (!selected || selected.low === undefined || selected.high === undefined) return []
    try {
      return oneWay(app.model, selected.name, selected.low, selected.high, 9, outcome, strategyId || undefined)
    } catch {
      return []
    }
  }, [app.model, selected, outcome, strategyId])
  const bars = useMemo(() => {
    try {
      return tornado(app.model, outcome, strategyId || undefined).map((bar) => ({ label: bar.variable, low: bar.atLow, high: bar.atHigh }))
    } catch {
      return []
    }
  }, [app.model, outcome, strategyId])
  const second = variables.find((item) => item.name !== selected?.name)
  const heat = useMemo(() => {
    if (!selected || !second || selected.low === undefined || selected.high === undefined || second.low === undefined || second.high === undefined) return []
    try {
      return twoWay(app.model, selected.name, selected.low, selected.high, second.name, second.low, second.high, 6, outcome, strategyId || undefined)
    } catch {
      return []
    }
  }, [app.model, selected, second, outcome, strategyId])
  const cut = selected && strategies.length > 1 && selected.low !== undefined && selected.high !== undefined
    ? threshold(app.model, selected.name, selected.low, selected.high, strategies[0].id, strategies[1].id)
    : null
  return (
    <div className="solo-view">
      <div className="view-head"><div><p className="kicker">{t(lang, 'sensTitle')}</p><h2>{t(lang, 'oneWay')}</h2></div></div>
      <div className="btn-row">
        <label className="field"><span>{t(lang, 'variables')}</span>
          <select value={selected?.name ?? ''} onChange={(event) => setVariable(event.target.value)}>{variables.map((item) => <option key={item.name}>{item.name}</option>)}</select>
        </label>
        <label className="field"><span>{t(lang, 'outcome')}</span>
          <select value={outcome} onChange={(event) => setOutcome(event.target.value as typeof outcome)}>
            <option value="nmb">{t(lang, 'nmb')}</option>
            <option value="cost">{t(lang, 'cost')}</option>
            <option value="effect">{t(lang, 'effect')}</option>
            <option value="icer">{t(lang, 'icer')}</option>
          </select>
        </label>
        <label className="field"><span>{t(lang, 'strategy')}</span>
          <select value={strategyId} onChange={(event) => setStrategyId(event.target.value)}>{strategies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        </label>
      </div>
      <div className="chart-card">
        <LineChart
          series={strategies.map((strategy, index) => ({
            name: strategy.name,
            color: strategyColor(index),
            points: line.map((point) => ({ x: point.x, y: point.values[strategy.id] ?? 0 })),
          }))}
          yFormat={(value) => formatNum(value, 1, lang)}
        />
      </div>
      <div className="chart-card" style={{ marginTop: 12 }}>
        <h3>{t(lang, 'tornado')}</h3>
        {bars.length ? <TornadoChart bars={bars} format={(value) => formatNum(value, 1, lang)} /> : <p className="help">{t(lang, 'tornadoEmpty')}</p>}
      </div>
      {heat.length > 0 && second && (
        <div className="chart-card" style={{ marginTop: 12 }}>
          <h3>{t(lang, 'twoWay')}: {selected?.name} × {second.name}</h3>
          <HeatGrid cells={heat} colorOf={(id) => strategyColor(strategies.findIndex((item) => item.id === id))} />
          <p className="help">{strategies.map((item) => item.name).join(' · ')}</p>
        </div>
      )}
      <div className="panel-card" style={{ marginTop: 12 }}>
        <h3>{t(lang, 'threshold')}</h3>
        <p>{cut === null ? t(lang, 'thresholdNone') : t(lang, 'thresholdFound', { name: selected?.name ?? '', value: formatNum(cut, 3, lang) })}</p>
      </div>
    </div>
  )
}

export function PsaView() {
  const app = useApp()
  const lang = app.lang
  const job = useJob()
  const [summary, setSummary] = useState<PSASummary | null>(null)
  const [trials, setTrials] = useState<PSATrial[]>([])
  const [nested, setNested] = useState(false)
  const [evppi, setEvppi] = useState<number | null>(null)
  const prefs = app.model.preferences
  const names = Object.fromEntries((summary?.strategies ?? []).map((strategy) => [strategy.id, strategy.name]))
  const colors = Object.fromEntries((summary?.strategies ?? []).map((strategy, index) => [strategy.id, strategyColor(index)]))
  return (
    <div className="solo-view">
      <div className="view-head">
        <div><p className="kicker">{t(lang, 'psaTitle')}</p><h2>{t(lang, 'navPsa')}</h2></div>
        <button
          className="btn-gold"
          disabled={job.running}
          onClick={() => {
            void job
              .start({
                kind: 'psa',
                model: app.model,
                trials: prefs.psaTrials,
                seed: prefs.psaSeed,
                nested,
                inner: Math.min(80, prefs.microsimN),
              })
              .then((result) => {
                const done = result as { summary: PSASummary; trials: PSATrial[] }
                setSummary(done.summary)
                setTrials(done.trials)
              })
          }}
        >
          {job.running ? t(lang, 'running') : t(lang, 'run')}
        </button>
        {job.running && <button className="btn" onClick={job.cancel}>{t(lang, 'cancel')}</button>}
      </div>
      {job.running && <progress className="job" max={1} value={job.progress} aria-label={t(lang, 'progress')} />}
      <Wizard title={t(lang, 'guide')} lead={t(lang, 'wizardPsaLead')} startOpen={false}>
        <StepLabel lang={lang} n={1} />
        {app.model.variables.filter((variable) => !variable.distribution).map((variable) => (
          <div key={variable.name} className="btn-row">
            <strong>{variable.name}</strong>
            <button className="btn btn-tiny" onClick={() => app.edit((model) => ({ ...model, variables: model.variables.map((item) => item.name === variable.name ? { ...item, distribution: { type: 'beta' as const, args: ['20', '80'] }, sampleRate: 'trial' as const } : item) }))}>{t(lang, 'distAsProb')}</button>
            <button className="btn btn-tiny" onClick={() => app.edit((model) => ({ ...model, variables: model.variables.map((item) => item.name === variable.name ? { ...item, distribution: { type: 'gammaMeanSd' as const, args: [item.expression || '100', '20'] }, sampleRate: 'trial' as const } : item) }))}>{t(lang, 'distAsCost')}</button>
          </div>
        ))}
      </Wizard>
      <div className="btn-row">
        <label className="field"><span>{t(lang, 'trials')}</span><input value={prefs.psaTrials} onChange={(event) => app.edit((model) => ({ ...model, preferences: { ...model.preferences, psaTrials: Number(event.target.value) } }), false)} /></label>
        <label className="field"><span>{t(lang, 'seed')}</span><input value={prefs.psaSeed} onChange={(event) => app.edit((model) => ({ ...model, preferences: { ...model.preferences, psaSeed: Number(event.target.value) } }), false)} /></label>
        <label className="check"><input type="checkbox" checked={nested} onChange={(event) => setNested(event.target.checked)} />{t(lang, 'nested')}</label>
      </div>
      {summary && (
        <>
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t(lang, 'strategy')}</th><th className="num">{t(lang, 'mean')} {t(lang, 'cost')}</th><th className="num">{t(lang, 'sd')}</th><th className="num">{t(lang, 'mean')} {t(lang, 'effect')}</th><th className="num">{t(lang, 'nmb')}</th></tr></thead>
              <tbody>
                {summary.strategies.map((row) => (
                  <tr key={row.id}><td>{row.name}</td><td className="num">{formatNum(row.meanCost, 2, lang)}</td><td className="num">{formatNum(row.sdCost, 2, lang)}</td><td className="num">{formatNum(row.meanEffect, 3, lang)}</td><td className="num">{formatNum(row.meanNmb, 1, lang)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="chart-card" style={{ marginTop: 12 }}><h3>{t(lang, 'scatter')}</h3><ScatterPlane summary={summary} wtp={prefs.wtp} colors={colors} /></div>
          <div className="chart-card" style={{ marginTop: 12 }}><h3>{t(lang, 'ceac')} / {t(lang, 'ceaf')}</h3><CeacChart summary={summary} names={names} /></div>
          <div className="chart-card" style={{ marginTop: 12 }}><h3>{t(lang, 'evpi')}</h3><LineChart series={[{ name: 'EVPI', color: '#b5811a', points: summary.evpi.map((row) => ({ x: row.wtp, y: row.value })) }]} yFormat={(value) => formatNum(value, 0, lang)} /></div>
          <div className="chart-card" style={{ marginTop: 12 }}><h3>{t(lang, 'convergence')}</h3><LineChart series={[{ name: 'Δ effect', color: '#1f6b4c', points: summary.convergence.map((row) => ({ x: row.n, y: row.meanIncrementalEffect })) }]} yFormat={(value) => formatNum(value, 3, lang)} /></div>
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button className="btn" onClick={() => {
              const parameter = app.model.variables.find((variable) => variable.distribution)?.name
              if (!parameter) return
              const table = strategyNmbTable(trials, prefs.wtp)
              const column = trials.map((trial) => trial.parameters[parameter] ?? 0)
              setEvppi(evppiBinned(column, table))
            }}>{t(lang, 'evppi')}</button>
            {evppi !== null && <span>{t(lang, 'evppi')}: {formatNum(evppi, 2, lang)}</span>}
            <button className="btn" onClick={() => downloadBlob('psa.csv', new Blob([toCsv(trials.map((trial) => ({ trial: trial.index, ...trial.parameters, ...Object.fromEntries(trial.strategies.flatMap((strategy) => [[`${strategy.name} cost`, strategy.cost], [`${strategy.name} effect`, strategy.effect]])) })), lang)], { type: 'text/csv' }))}>{t(lang, 'exportRaw')}</button>
          </div>
        </>
      )}
    </div>
  )
}

export function BiaView() {
  const app = useApp()
  const lang = app.lang
  const bia = app.model.bia
  const result = app.analysis.ok ? app.analysis.bia : runBia(bia)
  const money = (value: number) => formatMoney(value, app.model.preferences.currencySymbol, 0, lang)
  const patch = (recipe: (current: typeof bia) => typeof bia) => app.edit((model) => ({ ...model, bia: recipe(model.bia) }))
  const [param, setParam] = useState('basePopulation')
  const sens = useMemo(() => {
    const item = bia.uncertain.find((entry) => entry.parameter === param)
    const low = item?.low ?? bia.basePopulation * 0.5
    const high = item?.high ?? bia.basePopulation * 1.5
    try {
      return biaOneWay(bia, param, low, high, 7)
    } catch {
      return []
    }
  }, [bia, param])
  return (
    <div className="solo-view">
      <div className="view-head">
        <div><p className="kicker">ISPOR</p><h2>{t(lang, 'biaTitle')}</h2></div>
        <div className="btn-row">
          <button className="btn" onClick={() => {
            if (!app.analysis.ok) return
            patch((current) => ({
              ...current,
              strategies: app.analysis.ok ? app.analysis.cea.strategies.map((strategy) => ({ id: strategy.id, name: strategy.name, annualCost: strategy.cost, linkedStrategyId: strategy.id })) : current.strategies,
            }))
          }}>{t(lang, 'fromTree')}</button>
          <button className="btn" onClick={() => {
            if (!app.analysis.ok) return
            patch((current) => ({
              ...current,
              strategies: current.strategies.map((strategy) => {
                const found = app.analysis.ok ? app.analysis.cea.strategies.find((item) => item.id === strategy.linkedStrategyId) : undefined
                return found ? { ...strategy, annualCost: found.cost } : strategy
              }),
            }))
          }}>{t(lang, 'pullCosts')}</button>
        </div>
      </div>
      <p className="help">{t(lang, 'biaNote')}</p>
      <Wizard title={t(lang, 'guide')} lead={t(lang, 'wizardBiaLead')} startOpen={bia.strategies.length === 0}>
        <StepLabel lang={lang} n={1} />
        <div className="choice-row">
          <button type="button" className={bia.populationMode === 'prevalence' ? 'choice active' : 'choice'} onClick={() => patch((current) => ({ ...current, populationMode: 'prevalence' }))}>{t(lang, 'prevalence')}</button>
          <button type="button" className={bia.populationMode === 'incidence' ? 'choice active' : 'choice'} onClick={() => patch((current) => ({ ...current, populationMode: 'incidence' }))}>{t(lang, 'incidence')}</button>
        </div>
        <StepLabel lang={lang} n={2} />
        <button className="btn" type="button" onClick={() => {
          if (!app.analysis.ok) return
          const strategies = app.analysis.cea.strategies
          patch((current) => ({
            ...current,
            horizonYears: current.horizonYears || 5,
            strategies: strategies.map((strategy) => ({ id: strategy.id, name: strategy.name, annualCost: strategy.cost, linkedStrategyId: strategy.id })),
            currentShares: Array.from({ length: current.horizonYears || 5 }, () => strategies.map((_, index) => (index === 0 ? 1 : 0))),
            newShares: Array.from({ length: current.horizonYears || 5 }, (_, year) => {
              const last = strategies.length - 1
              const share = strategies.length < 2 ? 1 : (0.1 + 0.5 * year / Math.max(1, (current.horizonYears || 5) - 1))
              return strategies.map((_, index) => (index === last ? share : index === 0 ? 1 - share : 0))
            }),
          }))
        }}>{t(lang, 'fromTree')}</button>
      </Wizard>
      <div className="split">
        <div className="panel-card">
          <label className="field"><span>{t(lang, 'population')}</span>
            <select value={bia.populationMode} onChange={(event) => patch((current) => ({ ...current, populationMode: event.target.value as typeof bia.populationMode }))}>
              <option value="prevalence">{t(lang, 'prevalence')}</option>
              <option value="incidence">{t(lang, 'incidence')}</option>
            </select>
          </label>
          <Num label={t(lang, 'horizon')} value={bia.horizonYears} onChange={(horizonYears) => patch((current) => ({ ...current, horizonYears }))} />
          <Num label={t(lang, 'basePop')} value={bia.basePopulation} onChange={(basePopulation) => patch((current) => ({ ...current, basePopulation }))} />
          <Num label={t(lang, 'growth')} value={bia.growthRate} onChange={(growthRate) => patch((current) => ({ ...current, growthRate }))} />
          <Num label={t(lang, 'eligible')} value={bia.eligibleFraction} onChange={(eligibleFraction) => patch((current) => ({ ...current, eligibleFraction }))} />
          <Num label={t(lang, 'duration')} value={bia.treatmentDuration} onChange={(treatmentDuration) => patch((current) => ({ ...current, treatmentDuration }))} />
          <Num label={t(lang, 'discount')} value={bia.discountRate} onChange={(discountRate) => patch((current) => ({ ...current, discountRate }))} />
          {bia.strategies.map((strategy, index) => (
            <Num key={strategy.id} label={`${strategy.name} · ${t(lang, 'annualCost')}`} value={strategy.annualCost} onChange={(annualCost) => patch((current) => ({ ...current, strategies: current.strategies.map((item, i) => (i === index ? { ...item, annualCost } : item)) }))} />
          ))}
        </div>
        <div>
          <div className="kpi-row">
            <div className="kpi"><span className="kicker">{t(lang, 'cumulative')}</span><b>{money(result.cumulativeImpact)}</b></div>
            <div className="kpi"><span className="kicker">{t(lang, 'currentWorld')}</span><b>{money(result.totalCurrent)}</b></div>
            <div className="kpi"><span className="kicker">{t(lang, 'newWorld')}</span><b>{money(result.totalNew)}</b></div>
          </div>
          <div className="chart-card">
            <h3>{t(lang, 'currentWorld')} / {t(lang, 'newWorld')}</h3>
            <GroupedBars categories={result.years.map((year) => String(year.year + 1))} a={result.years.map((year) => year.currentCost)} b={result.years.map((year) => year.newCost)} aLabel={t(lang, 'currentWorld')} bLabel={t(lang, 'newWorld')} />
          </div>
          <div className="chart-card" style={{ marginTop: 12 }}>
            <h3>{t(lang, 'impact')}</h3>
            <LineChart series={[{ name: t(lang, 'cumulative'), color: '#1f6b4c', points: result.years.map((year) => ({ x: year.year + 1, y: year.cumulative })) }]} yFormat={money} />
          </div>
        </div>
      </div>
      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table>
          <thead><tr><th>{t(lang, 'year')}</th><th className="num">{t(lang, 'population')}</th><th className="num">{t(lang, 'currentWorld')}</th><th className="num">{t(lang, 'newWorld')}</th><th className="num">{t(lang, 'impact')}</th><th className="num">{t(lang, 'cumulative')}</th></tr></thead>
          <tbody>
            {result.years.map((year) => (
              <tr key={year.year}><td>{year.year + 1}</td><td className="num">{formatNum(year.population, 0, lang)}</td><td className="num">{money(year.currentCost)}</td><td className="num">{money(year.newCost)}</td><td className="num">{money(year.impact)}</td><td className="num">{money(year.cumulative)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="section">
        <h3>{t(lang, 'shares')}</h3>
        {bia.newShares.map((row, year) => (
          <div key={year} className="btn-row">
            <span>{year + 1}</span>
            {row.map((share, index) => (
              <input key={index} className="grid-input" style={{ width: 80 }} value={share} onChange={(event) => {
                const value = Number(event.target.value)
                patch((current) => ({ ...current, newShares: current.newShares.map((line, y) => (y === year ? line.map((cell, i) => (i === index ? value : cell)) : line)) }))
              }} />
            ))}
          </div>
        ))}
      </div>
      <div className="chart-card">
        <h3>{t(lang, 'biaSens')}</h3>
        <label className="field">
          <span>{param}</span>
          <select value={param} onChange={(event) => setParam(event.target.value)}>
            <option value="basePopulation">{t(lang, 'basePop')}</option>
            <option value="growthRate">{t(lang, 'growth')}</option>
            <option value="eligibleFraction">{t(lang, 'eligible')}</option>
          </select>
        </label>
        <LineChart series={[{ name: param, color: '#1e4d7b', points: sens.map((point) => ({ x: point.x, y: point.cumulative })) }]} yFormat={money} />
        <BiaProbabilistic />
      </div>
    </div>
  )
}

function BiaProbabilistic() {
  const app = useApp()
  const lang = app.lang
  const job = useJob()
  const [mean, setMean] = useState<number | null>(null)
  const money = (value: number) => formatMoney(value, app.model.preferences.currencySymbol, 0, lang)
  return (
    <div className="btn-row">
      <button
        className="btn"
        disabled={job.running}
        onClick={() => {
          void job.start({ kind: 'bia', bia: app.model.bia, trials: 200, seed: app.model.preferences.psaSeed }).then((result) => {
            setMean((result as { mean: number }).mean)
          })
        }}
      >
        {job.running ? t(lang, 'running') : t(lang, 'biaPsa')}
      </button>
      {job.running && <button className="btn" onClick={job.cancel}>{t(lang, 'cancel')}</button>}
      {job.running && <progress className="job" max={1} value={job.progress} />}
      {mean !== null && <span>{t(lang, 'mean')} {money(mean)}</span>}
    </div>
  )
}

export function SettingsView() {
  const app = useApp()
  const lang = app.lang
  const prefs = app.model.preferences
  const graph = prefs.graph
  const patch = (partial: Partial<typeof prefs>) => app.edit((model) => ({ ...model, preferences: { ...model.preferences, ...partial } }))
  const patchGraph = (partial: Partial<typeof graph>) => patch({ graph: { ...graph, ...partial } })
  return (
    <div className="solo-view">
      <div className="view-head"><div><p className="kicker">{t(lang, 'settingsTitle')}</p><h2>{t(lang, 'navSettings')}</h2></div></div>
      <div className="split">
        <div className="panel-card">
          <label className="field"><span>{t(lang, 'rule')}</span>
            <select value={prefs.decisionRule} onChange={(event) => patch({ decisionRule: event.target.value as typeof prefs.decisionRule })}>
              <option value="nmb">{t(lang, 'ruleNmb')}</option>
              <option value="nhb">{t(lang, 'ruleNhb')}</option>
              <option value="effect">{t(lang, 'ruleEffect')}</option>
              <option value="cost">{t(lang, 'ruleCost')}</option>
            </select>
          </label>
          <label className="field"><span>{t(lang, 'currency')}</span><input value={prefs.currency} onChange={(event) => patch({ currency: event.target.value })} /></label>
          <label className="field"><span>{t(lang, 'symbol')}</span><input value={prefs.currencySymbol} onChange={(event) => patch({ currencySymbol: event.target.value })} /></label>
          <label className="field"><span>{t(lang, 'decimals')}</span><input value={prefs.decimals} onChange={(event) => patch({ decimals: Number(event.target.value) })} /></label>
          <label className="check"><input type="checkbox" checked={prefs.normalizeProbabilities} onChange={(event) => patch({ normalizeProbabilities: event.target.checked })} />{t(lang, 'normalize')}</label>
          <label className="field"><span>{t(lang, 'patients')}</span><input value={prefs.microsimN} onChange={(event) => patch({ microsimN: Number(event.target.value) })} /></label>
        </div>
        <div className="panel-card">
          <h3>{t(lang, 'graph')}</h3>
          <label className="field"><span>{t(lang, 'font')}</span><input value={graph.fontFamily} onChange={(event) => patchGraph({ fontFamily: event.target.value })} /></label>
          <label className="field"><span>{t(lang, 'fontSize')}</span><input value={graph.fontSize} onChange={(event) => patchGraph({ fontSize: Number(event.target.value) })} /></label>
          <label className="field"><span>{t(lang, 'nodeScale')}</span><input value={graph.nodeScale} onChange={(event) => patchGraph({ nodeScale: Number(event.target.value) })} /></label>
          <label className="field"><span>{t(lang, 'rankSpacing')}</span><input value={graph.rankSpacing} onChange={(event) => patchGraph({ rankSpacing: Number(event.target.value) })} /></label>
          <label className="field"><span>{t(lang, 'nodeSpacing')}</span><input value={graph.nodeSpacing} onChange={(event) => patchGraph({ nodeSpacing: Number(event.target.value) })} /></label>
          <label className="check"><input type="checkbox" checked={graph.alignTerminals} onChange={(event) => patchGraph({ alignTerminals: event.target.checked })} />{t(lang, 'align')}</label>
          {(['probability', 'payoffs', 'expectedValue', 'nodeNames', 'variables'] as const).map((key) => (
            <label key={key} className="check">
              <input type="checkbox" checked={graph.show[key]} onChange={(event) => patchGraph({ show: { ...graph.show, [key]: event.target.checked } })} />
              {key}
            </label>
          ))}
          {Object.entries(graph.colors).map(([key, value]) => (
            <label key={key} className="field"><span>{key}</span><input type="color" value={toColor(value)} onChange={(event) => patchGraph({ colors: { ...graph.colors, [key]: event.target.value } })} /></label>
          ))}
        </div>
      </div>
    </div>
  )
}

function Num({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label className="field"><span>{label}</span><input value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>
}

function ErrorNote() {
  const app = useApp()
  if (app.analysis.ok) return null
  return <div className="banner">{tError(app.lang, 'syntax', app.analysis.error instanceof Error ? app.analysis.error.message : '')}</div>
}

function collectMarkov(node: TreeNode, acc: TreeNode[] = []): TreeNode[] {
  if (node.markov) acc.push(node)
  for (const branch of node.branches) collectMarkov(branch.child, acc)
  return acc
}

function toColor(value: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#1f6b4c'
}
