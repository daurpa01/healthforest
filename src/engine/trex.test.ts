import { describe, expect, it } from 'vitest'
import arbol from '../../examples/arbol.trex?raw'
import arbol2 from '../../examples/arbol2.trex?raw'
import { analyzeCea } from './cea'
import { evaluate } from './expr'
import { tornado } from './sensitivity'
import { importTrex, translateTreeAgeFormula, trexNotes } from './trex'
import { rollback } from './tree'

const markovTrex = `<?xml version="1.0"?>
<tree:Tree>
  <Node NodeType="DecisionNode" NameID="Root">
    <Node Label="estrategia" NodeType="MarkovNode">
      <Node Label="vivo" NodeType="ChanceNode">
        <Prob Value="1"/>
        <MarkovData xsi:type="tree:MarkovNonAbsorbingStateData">
          <StateReward Set="1"><Init Value="10"/><Incr Value="10"/><Final Value="0"/></StateReward>
          <StateReward Set="2"><Init Value="1"/><Incr Value="1"/><Final Value="0"/></StateReward>
        </MarkovData>
        <Node Label="sigue" NodeType="TerminalNode"><Prob Value="#"/><MarkovData MarkovJumpState="vivo"/></Node>
        <Node Label="muere" NodeType="TerminalNode"><Prob Value="tabla[0]"/><MarkovData MarkovJumpState="muerto"/></Node>
      </Node>
      <Node Label="muerto" NodeType="TerminalNode"><Prob Value="0"/><MarkovData xsi:type="tree:MarkovStateData"/></Node>
      <Termination Value="_STAGE = 2"/>
    </Node>
  </Node>
  <Table NameID="tabla" LookupMethod="Exact">
    <Row Index="0" Values="0.25"/>
  </Table>
  <Distribution NameID="costo_dist" Type="Gamma">
    <Parameter Name="alpha" Value="100"/>
    <Parameter Name="lambda" Value="0.01"/>
  </Distribution>
</tree:Tree>`

describe('importador TreeAge', () => {
  it('importa un Markov con _stage, tabla y distribución', () => {
    const model = importTrex(markovTrex)
    const result = rollback(model)
    expect(result.strategies[0].cost).toBeCloseTo(17.5, 6)
    expect(result.strategies[0].effect).toBeCloseTo(1.75, 6)
    expect(model.tables[0].rows[0]).toEqual([0, 0.25])
    expect(model.variables.find((item) => item.name === 'costo_dist')?.distribution?.type).toBe('gamma')
    expect(model.tree.branches[0].child.markov?.termination).toBe('_stage = 2')
  })

  it('traduce el punto y coma de los argumentos', () => {
    expect(translateTreeAgeFormula('annuity(desc;78)*1')).toBe('annuity(desc,78)*1')
    expect(translateTreeAgeFormula('discount(350;desc;30)')).toBe('discount(350,desc,30)')
  })

  it('annuity es el valor presente de un pago de 1 por periodo', () => {
    const scope = { tables: new Map(), get: () => 0 }
    const rate = 0.03
    const periods = 10
    const expected = (1 - Math.pow(1 + rate, -periods)) / rate
    expect(evaluate(`annuity(${rate},${periods})`, scope)).toBeCloseTo(expected, 10)
    expect(evaluate('annuity(0,78)', scope)).toBeCloseTo(78, 10)
  })

  it('Arbol.trex (fórmulas sin descontar) coincide con la cuenta hecha a mano', () => {
    const model = importTrex(arbol)
    const byName = Object.fromEntries(rollback(model).strategies.map((strategy) => [strategy.name, strategy]))
    expect(byName.Nada.cost).toBeCloseTo(105.755, 5)
    expect(byName.Nada.effect).toBeCloseTo(77.816371, 5)
    expect(byName['Vacuna N1'].cost).toBeCloseTo(42.66895, 5)
    expect(byName['Vacuna N1'].effect).toBeCloseTo(77.946748, 5)
    expect(byName['Vacuna N2'].cost).toBeCloseTo(81.151, 5)
    expect(byName['Vacuna N2'].effect).toBeCloseTo(77.963274, 5)
    const cea = analyzeCea(rollback(model).strategies, { ...model.preferences, wtp: 5000 })
    expect(cea.strategies.find((row) => row.name === 'Nada')!.status).toBe('strong')
    const n2 = cea.strategies.find((row) => row.name === 'Vacuna N2')!
    expect(n2.icer).toBeCloseTo(2328.489636, 3)
  })

  it('Arbol2.trex aplica annuity y discount, y no repite la cuenta que los ignoró', () => {
    const model = importTrex(arbol2)
    expect(model.name.length).toBeGreaterThan(0)
    expect(model.variables.map((item) => item.name).sort()).toEqual(['costo_vacuna_N1', 'costo_vacuna_N2', 'desc', 'rr_vacuna_N1', 'rr_vacuna_N2'])
    expect(model.variables.find((item) => item.name === 'costo_vacuna_N1')).toMatchObject({ expression: '12', low: 8, high: 16 })
    expect(trexNotes(arbol2).distributions).toBe(0)
    expect(trexNotes(arbol2).monteCarlo).toMatchObject({ trials: 1000, runTrials: false, samples: 0 })
    const byName = Object.fromEntries(rollback(model).strategies.map((strategy) => [strategy.name, strategy]))
    // Independent evaluation of Annuity(r;n) = (1-(1+r)^-n)/r and Discount(v;r;t) = v/(1+r)^t.
    expect(byName.Nada.cost).toBeCloseTo(40.6594263942, 6)
    expect(byName.Nada.effect).toBeCloseTo(29.9705458371, 6)
    expect(byName['Vacuna N1'].cost).toBeCloseTo(42.66895, 6)
    expect(byName['Vacuna N1'].effect).toBeCloseTo(29.9985511499, 6)
    expect(byName['Vacuna N2'].cost).toBeCloseTo(81.151, 6)
    expect(byName['Vacuna N2'].effect).toBeCloseTo(30.0021011192, 6)
    const cea = analyzeCea(rollback(model).strategies, model.preferences)
    const n2 = cea.strategies.find((row) => row.name === 'Vacuna N2')!
    const n1 = cea.strategies.find((row) => row.name === 'Vacuna N1')!
    expect(n1.status).not.toBe('strong')
    expect(n2.icer).toBeCloseTo(10840.108024, 3)
    const bars = tornado(model, 'cost', n1.id)
    const price = bars.find((bar) => bar.variable === 'costo_vacuna_N1')
    expect(price?.swing).toBeCloseTo(8, 4)
    expect(bars.map((bar) => bar.variable)).toContain('rr_vacuna_N1')
  })
})
