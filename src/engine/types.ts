export type PayoffId = string

export interface PayoffDef {
  id: PayoffId
  label: string
  role: 'cost' | 'effect' | 'other'
}

export type NodeType = 'decision' | 'chance' | 'terminal' | 'markov' | 'logic' | 'clone'

export interface Definition {
  name: string
  expression: string
}

export interface TreeNode {
  id: string
  type: NodeType
  name: string
  /** Payoffs incurred on entering the node (once). */
  payoffs: Record<PayoffId, string>
  branches: Branch[]
  definitions?: Definition[]
  /** Logic nodes: nonzero is true. First branch is true, second is false. */
  condition?: string
  /** Clone nodes reference a masterId somewhere in the model. */
  cloneMasterId?: string
  /** If set, other clone nodes can point at this node. */
  masterId?: string
  /** Terminals inside a Markov transition tree jump to this state id. */
  jumpTo?: string
  markov?: MarkovSpec
  notes?: string
}

export interface Branch {
  id: string
  label: string
  /** Probability expression. "#" is the complement. Ignored on decision branches. */
  probability: string
  /** Incremental payoffs incurred if this branch is taken. */
  payoffs: Record<PayoffId, string>
  child: TreeNode
}

export type MarkovMethod = 'traditional' | 'wcc' | 'simpson'
export type DiscountTiming = 'start' | 'mid' | 'end'
export type TunnelMode = 'track' | 'hold'

export interface MarkovState {
  id: string
  name: string
  absorbing?: boolean
  /** Number of temporary states. Omit or 0 for an ordinary state. */
  tunnelCycles?: number
  /** track = TreeAge tunnel (_tunnel advances while the patient stays). hold = forced sojourn. */
  tunnelMode?: TunnelMode
  /** If true, the initial-probability expression is re-evaluated for every temporary state. */
  distributeInitial?: boolean
  /** Traditional Markov: stage 0 only. */
  initial: Record<PayoffId, string>
  /** Traditional Markov: stages after the first. */
  incremental: Record<PayoffId, string>
  /** Traditional Markov: after the last cycle, on the ending distribution. */
  final: Record<PayoffId, string>
  /** Within-cycle correction: one-time reward at stage 0. */
  startup: Record<PayoffId, string>
  /** Within-cycle / Simpson per-cycle reward. */
  cycle: Record<PayoffId, string>
  /** Within-cycle correction: event reward each cycle, not averaged. */
  event: Record<PayoffId, string>
  transitions: Transition[]
  /** If set, replaces the transition matrix. Terminals carry jumpTo. */
  transitionTree?: TreeNode
}

export interface Transition {
  to: string
  probability: string
  payoffs?: Record<PayoffId, string>
}

export interface TrackerDef {
  name: string
  initial: string
  /** Evaluated at the end of each cycle. The name refers to the value at the start of the cycle. */
  update: string
  description?: string
}

export interface MarkovSpec {
  cycles: number
  /** Cycle length in years. Rewards are already per cycle; this scales discounting and _age. */
  cycleLength: number
  startAge: number
  method: MarkovMethod
  discountTiming: DiscountTiming
  discountRates: Record<PayoffId, number>
  termination?: string
  /** Stop a microsimulation patient on entering an absorbing state. */
  stopWhenAbsorbing?: boolean
  initialProbabilities: { stateId: string; probability: string }[]
  states: MarkovState[]
  trackers: TrackerDef[]
}

export type SampleRate = 'trial' | 'individual' | 'stage' | 'once'

export type DistType =
  | 'normal'
  | 'uniform'
  | 'triangular'
  | 'beta'
  | 'gamma'
  | 'gammaMeanSd'
  | 'lognormal'
  | 'lognormalMeanSd'
  | 'exponential'
  | 'pert'
  | 'poisson'
  | 'weibull'
  | 'table'

export interface DistributionSpec {
  type: DistType
  /** Parameter expressions, evaluated before sampling. */
  args: string[]
  /** Empirical / custom distribution. args are ignored when table is set. */
  table?: { value: number; p?: number }[]
}

export interface Variable {
  name: string
  expression: string
  description?: string
  low?: number
  high?: number
  sampleRate?: SampleRate
  distribution?: DistributionSpec
}

export interface DirichletDist {
  name: string
  alphas: string[]
  targets: string[]
  sampleRate?: SampleRate
}

export interface MvNormalDist {
  name: string
  targets: string[]
  means: string[]
  sds: string[]
  correlation: number[][]
  sampleRate?: SampleRate
}

export interface CorrelationGroup {
  names: string[]
  matrix: number[][]
}

export interface DataTable {
  name: string
  /** Column 0 is the index. */
  columns: string[]
  rows: number[][]
  interpolate: boolean
}

export interface GraphShow {
  probability: boolean
  payoffs: boolean
  expectedValue: boolean
  variables: boolean
  nodeNames: boolean
}

export interface GraphColors {
  decision: string
  chance: string
  terminal: string
  markov: string
  logic: string
  clone: string
  background: string
  line: string
  optimal: string
  text: string
  muted: string
}

export type GraphTheme = 'light' | 'dark' | 'publication'

export interface GraphStyle {
  theme: GraphTheme
  fontFamily: string
  fontSize: number
  nodeScale: number
  rankSpacing: number
  nodeSpacing: number
  alignTerminals: boolean
  show: GraphShow
  colors: GraphColors
}

export type DecisionRule = 'nmb' | 'nhb' | 'effect' | 'cost'

export interface Preferences {
  wtp: number
  currency: string
  currencySymbol: string
  decimals: number
  probabilityDecimals: number
  decisionRule: DecisionRule
  /** Scale chance-node probabilities that do not use "#". Markov models keep their own rules. */
  normalizeProbabilities: boolean
  /** Branch id of the reference strategy. Empty = first root branch. */
  referenceStrategyId?: string
  psaTrials: number
  psaSeed: number
  microsimN: number
  microsimSeed: number
  wtpMin: number
  wtpMax: number
  graph: GraphStyle
}

export interface BiaStrategy {
  id: string
  name: string
  /** Per patient per year on treatment. */
  annualCost: number
  linkedStrategyId?: string
}

export type UptakeShape = 'manual' | 'linear' | 'exponential' | 'logistic'

export interface BiaModel {
  horizonYears: number
  discountRate: number
  populationMode: 'prevalence' | 'incidence'
  basePopulation: number
  growthRate: number
  eligibleFraction: number
  /** Incidence mode: years a patient continues to incur cost. */
  treatmentDuration: number
  forceSharesToOne: boolean
  strategies: BiaStrategy[]
  /** [year][strategy] */
  currentShares: number[][]
  newShares: number[][]
  uncertain: BiaUncertain[]
}

export interface BiaUncertain {
  /** basePopulation | growthRate | eligibleFraction | discountRate | cost:<id> */
  parameter: string
  distribution: DistributionSpec
  low?: number
  high?: number
}

export interface CloneMaster {
  id: string
  name: string
  node: TreeNode
}

export interface HealthModel {
  version: 1
  name: string
  description: string
  payoffs: PayoffDef[]
  preferences: Preferences
  variables: Variable[]
  dirichlet: DirichletDist[]
  mvnormal: MvNormalDist[]
  correlations: CorrelationGroup[]
  tables: DataTable[]
  clones: CloneMaster[]
  tree: TreeNode
  bia: BiaModel
}

export type PayoffMap = Record<PayoffId, number>
