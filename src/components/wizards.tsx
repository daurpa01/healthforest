import { useState, type ReactNode } from 'react'
import type { HealthModel, MarkovSpec } from '../engine/types'
import { freshId, pay } from '../model/defaults'
import { t } from '../i18n'
import type { Lang } from '../format'

export function Wizard({
  title,
  lead,
  children,
  startOpen = true,
}: {
  title: string
  lead: string
  children: ReactNode
  startOpen?: boolean
}) {
  const [open, setOpen] = useState(startOpen)
  if (!open) {
    return (
      <button className="btn" type="button" onClick={() => setOpen(true)}>
        {title}
      </button>
    )
  }
  return (
    <section className="wizard">
      <div className="wizard-head">
        <div>
          <p className="kicker">{title}</p>
          <p>{lead}</p>
        </div>
        <button className="btn btn-tiny" onClick={() => setOpen(false)} type="button">
          ×
        </button>
      </div>
      {children}
    </section>
  )
}

export function markovFromPreset(preset: 'simple' | 'chronic', cycles: number, discount: number): MarkovSpec {
  const dead = {
    id: 'muerto',
    name: 'Muerto',
    absorbing: true,
    initial: pay(),
    incremental: pay(),
    final: pay(),
    startup: pay(),
    cycle: pay(),
    event: pay(),
    transitions: [{ to: 'muerto', probability: '1' }],
  }
  const vivo = {
    id: 'vivo',
    name: 'Vivo',
    initial: pay('0', '0'),
    incremental: pay('100', '0.8'),
    final: pay(),
    startup: pay(),
    cycle: pay('100', '0.8'),
    event: pay(),
    transitions: [
      { to: 'vivo', probability: '#' },
      { to: 'muerto', probability: '0.1' },
    ],
  }
  const estable = {
    ...vivo,
    id: 'estable',
    name: 'Estable',
    transitions: [
      { to: 'progresion', probability: '0.1' },
      { to: 'muerto', probability: '0.02' },
      { to: 'estable', probability: '#' },
    ],
  }
  const progresion = {
    ...vivo,
    id: 'progresion',
    name: 'Progresión',
    cycle: pay('500', '0.5'),
    incremental: pay('500', '0.5'),
    transitions: [
      { to: 'muerto', probability: '0.2' },
      { to: 'progresion', probability: '#' },
    ],
  }
  const states = preset === 'simple' ? [vivo, dead] : [estable, progresion, dead]
  return {
    cycles,
    cycleLength: 1,
    startAge: 55,
    method: 'wcc',
    discountTiming: 'start',
    discountRates: { cost: discount, effect: discount },
    initialProbabilities: states.map((state, index) => ({ stateId: state.id, probability: index === 0 ? '1' : '0' })),
    states,
    trackers: [],
  }
}

export function attachMarkov(model: HealthModel, spec: MarkovSpec): HealthModel {
  const node = {
    id: freshId('n'),
    type: 'markov' as const,
    name: 'Cohorte',
    payoffs: pay(),
    branches: [],
    markov: spec,
  }
  if (model.tree.type === 'decision') {
    return {
      ...model,
      tree: {
        ...model.tree,
        branches: [...model.tree.branches, { id: freshId('b'), label: 'Cohorte', probability: '1', payoffs: pay(), child: node }],
      },
    }
  }
  return { ...model, tree: node }
}

export function StepLabel({ lang, n }: { lang: Lang; n: number }) {
  return <p className="kicker">{t(lang, 'steps', { n })}</p>
}
