import { useState } from 'react'
import { tryParse } from '../engine/expr'
import { applyHalfCycleCorrection } from '../engine/markov'
import type { DistType, MarkovSpec, TreeNode, Variable } from '../engine/types'
import { freshId, makeNode, pay } from '../model/defaults'
import { useApp } from '../model/store'
import { findBranch, findNode, listMasters, readTree, writeTree, type Focus } from '../model/treeops'
import { t } from '../i18n'

const DIST: DistType[] = ['normal', 'beta', 'gamma', 'gammaMeanSd', 'lognormal', 'lognormalMeanSd', 'uniform', 'triangular', 'exponential', 'pert', 'poisson', 'weibull', 'table']

export function Outline() {
  const app = useApp()
  const tree = readTree(app.model, app.focus)
  return (
    <div>
      <OutlineNode node={tree} depth={0} />
    </div>
  )
}

function OutlineNode({ node, depth }: { node: TreeNode; depth: number }) {
  const app = useApp()
  const active = app.selection?.nodeId === node.id
  return (
    <div>
      <button className={`outline-btn${active ? ' active' : ''}`} style={{ paddingLeft: 8 + depth * 14 }} onClick={() => app.setSelection({ nodeId: node.id })}>
        <i className="tree-mark" style={{ background: app.model.preferences.graph.colors[node.type] }} />
        <span>{node.name}</span>
      </button>
      {node.branches.map((branch) => (
        <OutlineNode key={branch.id} node={branch.child} depth={depth + 1} />
      ))}
    </div>
  )
}

export function DataPanel() {
  const app = useApp()
  const lang = app.lang
  return (
    <div>
      <h3>{t(lang, 'variables')}</h3>
      {app.model.variables.map((variable, index) => (
        <VariableCard key={variable.name + index} variable={variable} index={index} />
      ))}
      <button className="btn btn-tiny" onClick={() => app.edit((model) => ({ ...model, variables: [...model.variables, { name: `v${model.variables.length + 1}`, expression: '0', low: 0, high: 1 }] }))}>
        {t(lang, 'addVariable')}
      </button>
      <div className="section">
        <h3>{t(lang, 'tables')}</h3>
        {app.model.tables.map((table, index) => (
          <div key={table.name + index} className="var-card">
            <Field label={t(lang, 'name')} value={table.name} onChange={(name) => app.edit((model) => ({ ...model, tables: model.tables.map((item, i) => (i === index ? { ...item, name } : item)) }))} />
            <label className="check">
              <input type="checkbox" checked={table.interpolate} onChange={(event) => app.edit((model) => ({ ...model, tables: model.tables.map((item, i) => (i === index ? { ...item, interpolate: event.target.checked } : item)) }))} />
              {t(lang, 'interpolate')}
            </label>
            {table.rows.map((row, rowIndex) => (
              <div key={rowIndex} className="btn-row">
                {row.map((value, column) => (
                  <input
                    key={column}
                    className="grid-input"
                    value={value}
                    onChange={(event) => {
                      const next = Number(event.target.value)
                      app.edit((model) => ({
                        ...model,
                        tables: model.tables.map((item, i) =>
                          i === index
                            ? { ...item, rows: item.rows.map((line, r) => (r === rowIndex ? line.map((cell, c) => (c === column ? next : cell)) : line)) }
                            : item,
                        ),
                      }))
                    }}
                  />
                ))}
              </div>
            ))}
            <button className="btn btn-tiny" onClick={() => app.edit((model) => ({ ...model, tables: model.tables.map((item, i) => (i === index ? { ...item, rows: [...item.rows, item.columns.map(() => 0)] } : item)) }))}>
              {t(lang, 'addRow')}
            </button>
          </div>
        ))}
        <button
          className="btn btn-tiny"
          onClick={() => app.edit((model) => ({ ...model, tables: [...model.tables, { name: `tabla${model.tables.length + 1}`, columns: ['indice', 'valor'], rows: [[0, 0]], interpolate: true }] }))}
        >
          {t(lang, 'addTable')}
        </button>
      </div>
      <div className="section">
        <h3>{t(lang, 'distributions')}</h3>
        <div className="btn-row">
          <button className="btn btn-tiny" onClick={() => app.edit((model) => ({ ...model, dirichlet: [...model.dirichlet, { name: 'dir', alphas: ['1', '1', '1'], targets: ['p1', 'p2', 'p3'], sampleRate: 'trial' }] }))}>
            {t(lang, 'addDirichlet')}
          </button>
          <button
            className="btn btn-tiny"
            onClick={() =>
              app.edit((model) => ({
                ...model,
                mvnormal: [...model.mvnormal, { name: 'mvn', targets: ['x', 'y'], means: ['0', '0'], sds: ['1', '1'], correlation: [[1, 0], [0, 1]], sampleRate: 'trial' }],
              }))
            }
          >
            {t(lang, 'addMvn')}
          </button>
        </div>
        {app.model.dirichlet.map((item, index) => (
          <p key={index} className="help">
            Dirichlet {item.name}: {item.targets.join(', ')}
          </p>
        ))}
        {app.model.mvnormal.map((item, index) => (
          <p key={index} className="help">
            MVN {item.name}: {item.targets.join(', ')}
          </p>
        ))}
      </div>
    </div>
  )
}

function VariableCard({ variable, index }: { variable: Variable; index: number }) {
  const app = useApp()
  const lang = app.lang
  const patch = (partial: Partial<Variable>) =>
    app.edit((model) => ({ ...model, variables: model.variables.map((item, i) => (i === index ? { ...item, ...partial } : item)) }))
  return (
    <div className="var-card">
      <Field label={t(lang, 'name')} value={variable.name} onChange={(name) => patch({ name })} />
      <FormulaField label={t(lang, 'expression')} value={variable.expression} onChange={(expression) => patch({ expression })} />
      <Field label={t(lang, 'description')} value={variable.description ?? ''} onChange={(description) => patch({ description })} />
      <div className="btn-row">
        <Field label={t(lang, 'low')} value={variable.low ?? ''} onChange={(value) => patch({ low: value === '' ? undefined : Number(value) })} />
        <Field label={t(lang, 'high')} value={variable.high ?? ''} onChange={(value) => patch({ high: value === '' ? undefined : Number(value) })} />
      </div>
      <label className="field">
        <span>{t(lang, 'distributions')}</span>
        <select
          value={variable.distribution?.type ?? ''}
          onChange={(event) => {
            const type = event.target.value as DistType | ''
            patch({ distribution: type ? { type, args: variable.distribution?.args ?? ['0', '1'] } : undefined })
          }}
        >
          <option value="">{t(lang, 'distNone')}</option>
          {DIST.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </label>
      {variable.distribution && (
        <Field
          label="args"
          value={variable.distribution.args.join(', ')}
          onChange={(value) => patch({ distribution: { ...variable.distribution!, args: value.split(',').map((item) => item.trim()) } })}
        />
      )}
      <label className="field">
        <span>{t(lang, 'sampleRate')}</span>
        <select value={variable.sampleRate ?? 'trial'} onChange={(event) => patch({ sampleRate: event.target.value as Variable['sampleRate'] })}>
          <option value="trial">{t(lang, 'rateTrial')}</option>
          <option value="individual">{t(lang, 'rateIndividual')}</option>
          <option value="stage">{t(lang, 'rateStage')}</option>
          <option value="once">{t(lang, 'rateOnce')}</option>
        </select>
      </label>
      <button className="btn btn-tiny" onClick={() => app.edit((model) => ({ ...model, variables: model.variables.filter((_, i) => i !== index) }))}>
        {t(lang, 'delete')}
      </button>
    </div>
  )
}

export function Inspector() {
  const app = useApp()
  const lang = app.lang
  const tree = readTree(app.model, app.focus)
  const selected = app.selection?.nodeId ? findNode(tree, app.selection.nodeId) : tree
  const branchHit = app.selection?.branchId ? findBranch(tree, app.selection.branchId) : undefined
  if (!selected && !branchHit) return <p className="help">{t(lang, 'helpBody')}</p>
  return (
    <div>
      {branchHit && <BranchEditor />}
      {selected && <NodeEditor node={selected} />}
    </div>
  )
}

function NodeEditor({ node }: { node: TreeNode }) {
  const app = useApp()
  const lang = app.lang
  const tree = readTree(app.model, app.focus)
  const patchTree = (next: TreeNode) => app.edit((model) => writeTree(model, app.focus, next))
  const patch = (partial: Partial<TreeNode>) => patchTree(update(tree, node.id, partial))
  const masters = listMasters(app.model.tree)
  return (
    <div>
      <Field label={t(lang, 'name')} value={node.name} onChange={(name) => patch({ name })} />
      <label className="field">
        <span>{t(lang, 'navTree')}</span>
        <select
          value={node.type}
          onChange={(event) => {
            const type = event.target.value as TreeNode['type']
            const created = makeNode(type, node.name)
            patch({ type, markov: created.markov, condition: created.condition, branches: node.branches.length ? node.branches : created.branches })
          }}
        >
          {(['decision', 'chance', 'terminal', 'markov', 'logic', 'clone'] as const).map((type) => (
            <option key={type} value={type}>
              {t(lang, nodeKey(type))}
            </option>
          ))}
        </select>
      </label>
      <p className="kicker">{t(lang, 'payoffEntry')}</p>
      <FormulaField label={t(lang, 'cost')} value={node.payoffs.cost ?? '0'} onChange={(cost) => patch({ payoffs: { ...node.payoffs, cost } })} />
      <FormulaField label={t(lang, 'effect')} value={node.payoffs.effect ?? '0'} onChange={(effect) => patch({ payoffs: { ...node.payoffs, effect } })} />
      {node.type === 'logic' && <FormulaField label={t(lang, 'condition')} value={node.condition ?? ''} onChange={(condition) => patch({ condition })} />}
      {node.type === 'clone' && (
        <label className="field">
          <span>{t(lang, 'cloneOf')}</span>
          <select value={node.cloneMasterId ?? ''} onChange={(event) => patch({ cloneMasterId: event.target.value })}>
            <option value="">{t(lang, 'none')}</option>
            {masters.map((master) => (
              <option key={master.masterId} value={master.masterId}>
                {master.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {node.type === 'terminal' && (
        <Field label="jumpTo" value={node.jumpTo ?? ''} onChange={(jumpTo) => patch({ jumpTo: jumpTo || undefined })} />
      )}
      <Field label={t(lang, 'notes')} value={node.notes ?? ''} onChange={(notes) => patch({ notes })} />
      <details className="disclosure">
        <summary>{t(lang, 'advanced')}</summary>
        <div className="section">
        <h3>{t(lang, 'definitions')}</h3>
        {(node.definitions ?? []).map((def, index) => (
          <div key={index} className="btn-row">
            <input className="grid-input" value={def.name} onChange={(event) => patch({ definitions: replaceDef(node, index, { ...def, name: event.target.value }) })} />
            <input className="grid-input formula" value={def.expression} onChange={(event) => patch({ definitions: replaceDef(node, index, { ...def, expression: event.target.value }) })} />
          </div>
        ))}
        <button className="btn btn-tiny" onClick={() => patch({ definitions: [...(node.definitions ?? []), { name: 'x', expression: '0' }] })}>
          {t(lang, 'addDefinition')}
        </button>
      </div>
      </details>
      {node.type !== 'terminal' && node.type !== 'clone' && (
        <div className="section">
          <label className="field">
            <span>{t(lang, 'addBranch')}</span>
            <select
              value=""
              onChange={(event) => {
                const type = event.target.value as TreeNode['type']
                if (!type) return
                patchTree(addTyped(tree, node.id, type))
              }}
            >
              <option value="">{t(lang, 'addBranch')}</option>
              {(['terminal', 'chance', 'decision', 'markov', 'logic', 'clone'] as const).map((type) => (
                <option key={type} value={type}>
                  {t(lang, nodeKey(type))}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <details className="disclosure">
        <summary>{t(lang, 'advanced')}</summary>
      <label className="check">
        <input
          type="checkbox"
          checked={Boolean(node.masterId)}
          onChange={(event) => patch({ masterId: event.target.checked ? node.masterId || freshId('m') : undefined })}
        />
        {t(lang, 'master')}
      </label>
      </details>
      {node.markov && <MarkovEditor nodeId={node.id} spec={node.markov} />}
      <p className="help">{t(lang, 'formulaHint')} <span className="hint" title={t(lang, 'hintProb')}>?</span></p>
      <p className="help">{t(lang, 'keywords')}</p>
    </div>
  )
}

function BranchEditor() {
  const app = useApp()
  const lang = app.lang
  const tree = readTree(app.model, app.focus)
  const hit = app.selection?.branchId ? findBranch(tree, app.selection.branchId) : undefined
  if (!hit) return null
  const { branch } = hit
  const patchTree = (next: TreeNode) => app.edit((model) => writeTree(model, app.focus, next))
  const patch = (partial: Partial<typeof branch>) => patchTree(updateBranchTree(tree, branch.id, partial))
  return (
    <div className="section">
      <h3>{branch.label}</h3>
      <Field label={t(lang, 'name')} value={branch.label} onChange={(label) => patch({ label })} />
      {hit.parent.type === 'chance' && <FormulaField label={t(lang, 'probability')} value={branch.probability} onChange={(probability) => patch({ probability })} />}
      <p className="kicker">{t(lang, 'branchPayoff')}</p>
      <FormulaField label={t(lang, 'cost')} value={branch.payoffs.cost ?? '0'} onChange={(cost) => patch({ payoffs: { ...branch.payoffs, cost } })} />
      <FormulaField label={t(lang, 'effect')} value={branch.payoffs.effect ?? '0'} onChange={(effect) => patch({ payoffs: { ...branch.payoffs, effect } })} />
      <div className="btn-row">
        <button className="btn btn-tiny" onClick={() => patchTree(move(tree, branch.id, -1))}>{t(lang, 'up')}</button>
        <button className="btn btn-tiny" onClick={() => patchTree(move(tree, branch.id, 1))}>{t(lang, 'down')}</button>
        <button className="btn btn-tiny" onClick={() => patchTree(dup(tree, branch.id))}>{t(lang, 'duplicate')}</button>
        <button className="btn btn-tiny" onClick={() => patchTree(drop(tree, branch.id))}>{t(lang, 'remove')}</button>
      </div>
    </div>
  )
}

function MarkovEditor({ nodeId, spec }: { nodeId: string; spec: MarkovSpec }) {
  const app = useApp()
  const lang = app.lang
  const [stateId, setStateId] = useState(spec.states[0]?.id ?? '')
  const current = spec.states.find((state) => state.id === stateId) ?? spec.states[0]
  const patchSpec = (recipe: (current: MarkovSpec) => MarkovSpec) => {
    app.edit((model) => ({
      ...model,
      tree: update(model.tree, nodeId, { markov: recipe(findNode(model.tree, nodeId)?.markov ?? spec) }),
    }))
  }
  return (
    <div className="section">
      <h3>Markov</h3>
      <Field label={t(lang, 'cycles')} value={spec.cycles} onChange={(value) => patchSpec((item) => ({ ...item, cycles: Number(value) }))} />
      <Field label={t(lang, 'cycleLength')} value={spec.cycleLength} onChange={(value) => patchSpec((item) => ({ ...item, cycleLength: Number(value) }))} />
      <label className="field">
        <span>{t(lang, 'method')}</span>
        <select value={spec.method} onChange={(event) => patchSpec((item) => ({ ...item, method: event.target.value as MarkovSpec['method'] }))}>
          <option value="traditional">{t(lang, 'methodTraditional')}</option>
          <option value="wcc">{t(lang, 'methodWcc')}</option>
          <option value="simpson">{t(lang, 'methodSimpson')}</option>
        </select>
      </label>
      <details className="disclosure">
        <summary>{t(lang, 'advanced')}</summary>
      <Field label={t(lang, 'discountCost')} value={spec.discountRates.cost ?? 0} onChange={(value) => patchSpec((item) => ({ ...item, discountRates: { ...item.discountRates, cost: Number(value) } }))} />
      <Field label={t(lang, 'discountEffect')} value={spec.discountRates.effect ?? 0} onChange={(value) => patchSpec((item) => ({ ...item, discountRates: { ...item.discountRates, effect: Number(value) } }))} />
      <label className="field">
        <span>{t(lang, 'timing')}</span>
        <select value={spec.discountTiming} onChange={(event) => patchSpec((item) => ({ ...item, discountTiming: event.target.value as MarkovSpec['discountTiming'] }))}>
          <option value="start">{t(lang, 'timingStart')}</option>
          <option value="mid">{t(lang, 'timingMid')}</option>
          <option value="end">{t(lang, 'timingEnd')}</option>
        </select>
      </label>
      <Field label={t(lang, 'startAge')} value={spec.startAge} onChange={(value) => patchSpec((item) => ({ ...item, startAge: Number(value) }))} />
      <FormulaField label={t(lang, 'termination')} value={spec.termination ?? ''} onChange={(termination) => patchSpec((item) => ({ ...item, termination }))} />
      <button className="btn btn-tiny" onClick={() => patchSpec((item) => applyHalfCycleCorrection(item, ['cost', 'effect']))}>
        {t(lang, 'applyHcc')}
      </button>
      <p className="help">{t(lang, 'hccHelp')}</p>
      </details>
      <h3>{t(lang, 'states')}</h3>
      {spec.states.map((state) => (
        <button key={state.id} className={`state-btn${state.id === current?.id ? ' active' : ''}`} onClick={() => setStateId(state.id)}>
          {state.name}
        </button>
      ))}
      <button
        className="btn btn-tiny"
        onClick={() => {
          const id = freshId('s')
          patchSpec((item) => ({
            ...item,
            states: [...item.states, { id, name: 'Estado', initial: pay(), incremental: pay(), final: pay(), startup: pay(), cycle: pay(), event: pay(), transitions: [{ to: id, probability: '1' }] }],
            initialProbabilities: [...item.initialProbabilities, { stateId: id, probability: '0' }],
          }))
          setStateId(id)
        }}
      >
        {t(lang, 'addState')}
      </button>
      {current && (
        <StateEditor
          spec={spec}
          stateId={current.id}
          onChange={(next) => patchSpec(() => next)}
          onEditTree={() => {
            const focus: Focus = { kind: 'transition', nodeId, stateId: current.id }
            if (!current.transitionTree) {
              patchSpec((item) => ({
                ...item,
                states: item.states.map((state) => (state.id === current.id ? { ...state, transitionTree: transitionSkeleton(item) } : state)),
              }))
            }
            app.setFocus(focus)
          }}
        />
      )}
    </div>
  )
}

function StateEditor({
  spec,
  stateId,
  onChange,
  onEditTree,
}: {
  spec: MarkovSpec
  stateId: string
  onChange: (spec: MarkovSpec) => void
  onEditTree: () => void
}) {
  const app = useApp()
  const lang = app.lang
  const state = spec.states.find((item) => item.id === stateId)
  if (!state) return null
  const patchState = (partial: Partial<typeof state>) =>
    onChange({ ...spec, states: spec.states.map((item) => (item.id === stateId ? { ...item, ...partial } : item)) })
  const fields = spec.method === 'traditional' ? (['initial', 'incremental', 'final'] as const) : (['startup', 'cycle', 'event'] as const)
  const labels = { initial: 'initial', incremental: 'incremental', final: 'final', startup: 'startup', cycle: 'cycleReward', event: 'eventReward' } as const
  return (
    <div>
      <Field label={t(lang, 'name')} value={state.name} onChange={(name) => patchState({ name })} />
      <label className="check">
        <input type="checkbox" checked={Boolean(state.absorbing)} onChange={(event) => patchState({ absorbing: event.target.checked })} />
        {t(lang, 'absorbing')}
      </label>
      <Field label={t(lang, 'tunnel')} value={state.tunnelCycles ?? 0} onChange={(value) => patchState({ tunnelCycles: Number(value) || undefined })} />
      <label className="field">
        <span>{t(lang, 'tunnel')}</span>
        <select value={state.tunnelMode ?? 'track'} onChange={(event) => patchState({ tunnelMode: event.target.value as 'track' | 'hold' })}>
          <option value="track">{t(lang, 'tunnelTrack')}</option>
          <option value="hold">{t(lang, 'tunnelHold')}</option>
        </select>
      </label>
      {fields.map((field) => (
        <div key={field}>
          <p className="kicker">{t(lang, labels[field])}</p>
          <FormulaField label={t(lang, 'cost')} value={state[field].cost ?? '0'} onChange={(cost) => patchState({ [field]: { ...state[field], cost } })} />
          <FormulaField label={t(lang, 'effect')} value={state[field].effect ?? '0'} onChange={(effect) => patchState({ [field]: { ...state[field], effect } })} />
        </div>
      ))}
      <h3>{t(lang, 'transitions')}</h3>
      {state.transitions.map((transition, index) => (
        <div key={index} className="var-card">
          <label className="field">
            <span>{t(lang, 'transitionTo')}</span>
            <select
              value={transition.to}
              onChange={(event) => patchState({ transitions: state.transitions.map((item, i) => (i === index ? { ...item, to: event.target.value } : item)) })}
            >
              {spec.states.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <FormulaField label={t(lang, 'probability')} value={transition.probability} onChange={(probability) => patchState({ transitions: state.transitions.map((item, i) => (i === index ? { ...item, probability } : item)) })} />
        </div>
      ))}
      <button
        className="btn btn-tiny"
        onClick={() => patchState({ transitions: [...state.transitions, { to: spec.states[0]?.id ?? state.id, probability: '0' }] })}
      >
        {t(lang, 'transitions')}
      </button>
      <div className="btn-row">
        <button className="btn btn-tiny" onClick={onEditTree}>
          {t(lang, 'useTree')}
        </button>
        {state.transitionTree && (
          <button className="btn btn-tiny" onClick={() => patchState({ transitionTree: undefined })}>
            {t(lang, 'clearTree')}
          </button>
        )}
      </div>
    </div>
  )
}

function Field({ label, value, onChange }: { label: string; value: string | number; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function FormulaField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const parsed = value.trim() === '' ? { ok: true as const } : tryParse(value)
  return (
    <label className="field">
      <span>{label}</span>
      <input className="formula" value={value} spellCheck={false} onChange={(event) => onChange(event.target.value)} />
      {!parsed.ok && <em className="err">{parsed.error}</em>}
    </label>
  )
}

function nodeKey(type: TreeNode['type']) {
  switch (type) {
    case 'decision':
      return 'nodeDecision' as const
    case 'chance':
      return 'nodeChance' as const
    case 'terminal':
      return 'nodeTerminal' as const
    case 'markov':
      return 'nodeMarkov' as const
    case 'logic':
      return 'nodeLogic' as const
    case 'clone':
      return 'nodeClone' as const
  }
}

function replaceDef(node: TreeNode, index: number, def: { name: string; expression: string }) {
  return (node.definitions ?? []).map((item, i) => (i === index ? def : item))
}

function update(tree: TreeNode, id: string, patch: Partial<TreeNode>): TreeNode {
  if (tree.id === id) return { ...tree, ...patch, id: tree.id }
  return { ...tree, branches: tree.branches.map((branch) => ({ ...branch, child: update(branch.child, id, patch) })) }
}

function updateBranchTree(tree: TreeNode, branchId: string, patch: Partial<TreeNode['branches'][number]>): TreeNode {
  return {
    ...tree,
    branches: tree.branches.map((branch) => (branch.id === branchId ? { ...branch, ...patch, id: branch.id } : { ...branch, child: updateBranchTree(branch.child, branchId, patch) })),
  }
}

function addTyped(tree: TreeNode, parentId: string, type: TreeNode['type']): TreeNode {
  if (tree.id === parentId) {
    const child = makeNode(type, '')
    const hasHash = tree.branches.some((branch) => branch.probability.trim() === '#')
    return {
      ...tree,
      type: tree.type === 'terminal' ? 'chance' : tree.type,
      branches: [
        ...tree.branches,
        { id: freshId('b'), label: child.name, probability: tree.branches.length === 0 ? '1' : hasHash ? '0' : '#', payoffs: pay(), child },
      ],
    }
  }
  return { ...tree, branches: tree.branches.map((branch) => ({ ...branch, child: addTyped(branch.child, parentId, type) })) }
}

function move(tree: TreeNode, branchId: string, direction: -1 | 1): TreeNode {
  const index = tree.branches.findIndex((branch) => branch.id === branchId)
  if (index >= 0) {
    const branches = tree.branches.slice()
    const target = index + direction
    if (target < 0 || target >= branches.length) return tree
    const [item] = branches.splice(index, 1)
    branches.splice(target, 0, item)
    return { ...tree, branches }
  }
  return { ...tree, branches: tree.branches.map((branch) => ({ ...branch, child: move(branch.child, branchId, direction) })) }
}

function dup(tree: TreeNode, branchId: string): TreeNode {
  const index = tree.branches.findIndex((branch) => branch.id === branchId)
  if (index >= 0) {
    const source = tree.branches[index]
    const copy = { ...structuredClone(source), id: freshId('b'), label: `${source.label} 2`, child: regenNode(source.child) }
    const branches = tree.branches.slice()
    branches.splice(index + 1, 0, copy)
    return { ...tree, branches }
  }
  return { ...tree, branches: tree.branches.map((branch) => ({ ...branch, child: dup(branch.child, branchId) })) }
}

function regenNode(node: TreeNode): TreeNode {
  return {
    ...structuredClone(node),
    id: freshId('n'),
    masterId: undefined,
    branches: node.branches.map((branch) => ({ ...branch, id: freshId('b'), child: regenNode(branch.child) })),
  }
}

function drop(tree: TreeNode, branchId: string): TreeNode {
  return {
    ...tree,
    branches: tree.branches.filter((branch) => branch.id !== branchId).map((branch) => ({ ...branch, child: drop(branch.child, branchId) })),
  }
}

function transitionSkeleton(spec: MarkovSpec): TreeNode {
  return {
    id: freshId('n'),
    type: 'chance',
    name: 'Transición',
    payoffs: pay(),
    branches: spec.states.map((state, index) => ({
      id: freshId('b'),
      label: state.name,
      probability: index === spec.states.length - 1 ? '#' : (1 / spec.states.length).toFixed(2),
      payoffs: pay(),
      child: { id: freshId('n'), type: 'terminal', name: state.name, payoffs: pay(), branches: [], jumpTo: state.id },
    })),
  }
}
