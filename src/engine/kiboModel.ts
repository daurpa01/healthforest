import { blankModel, pay } from '../model/defaults'
import type { HealthModel, MarkovState, TreeNode } from './types'

/** Rebuilt from the published Kibo Hut structure and the age schedules in the workbook. Not a copy of the .trex. */
export function kiboModel(options: { startAge?: number; cycles?: number } = {}): HealthModel {
  const startAge = options.startAge ?? 60
  const cycles = options.cycles ?? 120
  const model = blankModel()
  model.name = 'Kibo Hut (reconstruido)'
  model.description = 'Fármaco nuevo frente a fármaco viejo. Las cifras del Excel corresponden a edad inicial 40 y horizonte hasta los 110 años.'
  model.preferences.currencySymbol = 'SEK '
  model.preferences.wtp = 500000
  model.variables = [
    { name: 'start_age', expression: String(startAge) },
    { name: 'c_new_drug', expression: '30000', low: 20000, high: 50000 },
    { name: 'c_old_drug', expression: '5000' },
    { name: 'c_hosp', expression: '70000', low: 30000, high: 100000 },
    { name: 'HR_die_new_drug', expression: '0.9', low: 0.5, high: 1 },
    { name: 'HR_disease_new_drug', expression: '0.9', low: 0.5, high: 1 },
    { name: 'HR_hosp_new_drug', expression: '0.5' },
    { name: 'u_healthy', expression: '0.8' },
    { name: 'u_disease', expression: '0.65' },
    { name: 'u_decr_hosp', expression: '0.1' },
    { name: 'discount_rate', expression: '0.03' },
    { name: 'c_old_drug_disc', expression: 'discount(c_old_drug,discount_rate,_stage)' },
    { name: 'c_new_drug_disc', expression: 'discount(c_new_drug,discount_rate,_stage)' },
    { name: 'c_hosp_disc', expression: 'discount(c_hosp,discount_rate,_stage)' },
    { name: 'u_healthy_disc', expression: 'discount(u_healthy,discount_rate,_stage)' },
    { name: 'u_disease_disc', expression: 'discount(u_disease,discount_rate,_stage)' },
    { name: 'u_decr_hosp_disc', expression: 'discount(u_decr_hosp,discount_rate,_stage)' },
  ]
  model.tables = [
    table('p_die_healthy', (age) => (age < 60 ? 0.0001 + (age - 40) * 0.00002 : 0.01 + (age - 60) * 0.005)),
    table('p_die_disease', (age) => (age < 60 ? 0.01 + (age - 40) * 0.002 : 0.05 + (age - 60) * 0.005)),
    table('p_disease', (age) => 0.1 + (age - 40) * 0.01),
    table('p_hosp', hosp),
  ]
  const oldDrug = arm('old', 'Fármaco viejo', 'c_old_drug_disc', '1', '1', cycles, startAge)
  const newDrug = arm('new', 'Fármaco nuevo', 'c_new_drug_disc', 'HR_die_new_drug', 'HR_disease_new_drug', cycles, startAge, 'HR_hosp_new_drug')
  model.tree = {
    id: 'root',
    type: 'decision',
    name: 'Tratamiento',
    payoffs: pay(),
    branches: [
      { id: 'b_old', label: 'Fármaco viejo', probability: '1', payoffs: pay(), child: oldDrug },
      { id: 'b_new', label: 'Fármaco nuevo', probability: '1', payoffs: pay(), child: newDrug },
    ],
  }
  model.preferences.referenceStrategyId = 'b_old'
  return model
}

function table(name: string, at: (age: number) => number) {
  const rows = []
  for (let age = 40; age <= 110; age++) rows.push([age, at(age)])
  return { name, columns: ['index', 'value'], rows, interpolate: true }
}

function hosp(age: number): number {
  if (age < 46) return 0.1
  if (age < 56) return 0.2
  if (age < 60) return 0.3
  if (age < 80) return 0.8
  return 0.9
}

function arm(id: string, name: string, drug: string, dieHr: string, diseaseHr: string, cycles: number, startAge: number, hospHr = '1'): TreeNode {
  const reward = (cost: string, effect: string) => ({ cost, effect })
  const healthy: MarkovState = {
    id: 'healthy',
    name: 'healthy',
    initial: reward(drug, 'u_healthy_disc'),
    incremental: reward(drug, 'u_healthy_disc'),
    final: reward(drug, 'u_healthy_disc'),
    startup: pay(),
    cycle: pay(),
    event: pay(),
    transitions: [],
    transitionTree: chance(`${id}_h`, [
      jump('stay healthy', '#', 'healthy'),
      jump('get disease', `${diseaseHr}*p_disease[start_age+_stage]`, 'disease'),
      jump('die', `${dieHr}*p_die_healthy[start_age+_stage]`, 'dead'),
    ]),
  }
  const disease: MarkovState = {
    id: 'disease',
    name: 'disease',
    initial: reward(drug, 'u_disease_disc'),
    incremental: reward(drug, 'u_disease_disc'),
    final: reward(drug, 'u_disease_disc'),
    startup: pay(),
    cycle: pay(),
    event: pay(),
    transitions: [],
    transitionTree: chance(`${id}_d`, [
      {
        id: `${id}_hosp`,
        label: 'hospitalized',
        probability: `${hospHr}*p_hosp[start_age+_stage]`,
        payoffs: reward('c_hosp_disc', '-u_decr_hosp_disc'),
        child: chance(`${id}_hosp_in`, [
          jump('stay', '#', 'disease'),
          jump('die', `${dieHr}*p_die_disease[start_age+_stage]`, 'dead'),
        ]),
      },
      {
        id: `${id}_noth`,
        label: 'not hospitalized',
        probability: '#',
        payoffs: pay(),
        child: chance(`${id}_noth_in`, [
          jump('stay', '#', 'disease'),
          jump('die', `${dieHr}*p_die_disease[start_age+_stage]`, 'dead'),
        ]),
      },
    ]),
  }
  const dead: MarkovState = {
    id: 'dead',
    name: 'dead',
    absorbing: true,
    initial: pay(),
    incremental: pay(),
    final: pay(),
    startup: pay(),
    cycle: pay(),
    event: pay(),
    transitions: [],
  }
  return {
    id: `m_${id}`,
    type: 'markov',
    name,
    payoffs: pay(),
    branches: [],
    markov: {
      cycles,
      cycleLength: 1,
      startAge,
      method: 'traditional',
      discountTiming: 'start',
      discountRates: { cost: 0, effect: 0 },
      termination: `_stage = ${cycles}`,
      initialProbabilities: [
        { stateId: 'healthy', probability: '1' },
        { stateId: 'disease', probability: '0' },
        { stateId: 'dead', probability: '0' },
      ],
      states: [healthy, disease, dead],
      trackers: [],
    },
  }
}

function chance(id: string, branches: TreeNode['branches']): TreeNode {
  return { id, type: 'chance', name: id, payoffs: pay(), branches }
}

function jump(label: string, probability: string, to: string): TreeNode['branches'][number] {
  return {
    id: `${label}_${to}_${probability}`,
    label,
    probability,
    payoffs: pay(),
    child: { id: `${label}_${to}_t`, type: 'terminal', name: label, payoffs: pay(), branches: [], jumpTo: to },
  }
}
