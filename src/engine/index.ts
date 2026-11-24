export { EngineError, isEngineError } from './errors'
export type { ModelWarning } from './errors'
export { parseExpr, tryParse, evaluate, containsHash } from './expr'
export { mulberry32 } from './prng'
export {
  distributionMean,
  sampleDistribution,
  sampleDirichlet,
  sampleMultivariateNormal,
  correlationToCovariance,
  sampleGaussianCopula,
  gammaFromMeanSd,
  lognormalFromMeanSd,
} from './distributions'
export { netMonetaryBenefit, netHealthBenefit, decisionScore } from './payoffs'
export { compileScope, drawForRates, withOverrides, withKeywords, withLocals } from './scope'
export { rollback, findMaster } from './tree'
export type { RollbackResult, StrategyValue, RollbackOptions } from './tree'
export { analyzeCea } from './cea'
export type { CeaResult, CeaStrategy } from './cea'
export {
  runMarkovCohort,
  applyHalfCycleCorrection,
  convertMarkovMethod,
  simpsonWeights,
  payoffDiscount,
  markovSlots,
  startingWeights,
} from './markov'
export type { MarkovCohortResult, CohortCycleRow } from './markov'
export { runMicrosimulation } from './microsim'
export type { MicroResult } from './microsim'
export { runPSA, summarizePSA, evppiBinned, evppiNested, acceptability, expectedValueOfPerfectInformation, strategyNmbTable } from './psa'
export type { PSATrial, PSASummary } from './psa'
export { oneWay, tornado, twoWay, threshold } from './sensitivity'
export { runBia, biaOneWay, biaPsa, mixOverTime, displace, applyBiaOverride } from './bia'
export type { BiaResult } from './bia'
export type {
  HealthModel,
  TreeNode,
  Branch,
  MarkovSpec,
  MarkovState,
  Variable,
  Preferences,
  BiaModel,
  GraphStyle,
  PayoffDef,
  DataTable,
  DistributionSpec,
} from './types'
