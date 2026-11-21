import { biaPsa } from '../engine/bia'
import { runMicrosimulation } from '../engine/microsim'
import { runPSA } from '../engine/psa'
import { compileScope } from '../engine/scope'
import type { HealthModel, MarkovSpec } from '../engine/types'

type Job =
  | { id: number; kind: 'psa'; model: HealthModel; trials: number; seed: number; nested: boolean; inner: number }
  | { id: number; kind: 'micro'; model: HealthModel; spec: MarkovSpec; n: number; seed: number }
  | { id: number; kind: 'bia'; bia: HealthModel['bia']; trials: number; seed: number }

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<Job>) => void) | null
  postMessage: (message: unknown) => void
}

scope.onmessage = (event: MessageEvent<Job>) => {
  const job = event.data
  try {
    if (job.kind === 'psa') {
      const result = runPSA(job.model, {
        trials: job.trials,
        seed: job.seed,
        markovMode: job.nested ? 'microsim' : 'cohort',
        microsimN: job.inner,
        onTrial: (index) => {
          if (index % 20 === 0) scope.postMessage({ id: job.id, type: 'progress', value: (index + 1) / job.trials })
        },
      })
      scope.postMessage({ id: job.id, type: 'done', result })
      return
    }
    if (job.kind === 'micro') {
      const result = runMicrosimulation(job.spec, job.model, compileScope(job.model), {
        n: job.n,
        seed: job.seed,
        onPatient: (index, total) => {
          if (index % 20 === 0) scope.postMessage({ id: job.id, type: 'progress', value: (index + 1) / total })
        },
      })
      scope.postMessage({ id: job.id, type: 'done', result })
      return
    }
    const result = biaPsa(job.bia, job.trials, job.seed, (index, total) => {
      if (index % 10 === 0) scope.postMessage({ id: job.id, type: 'progress', value: (index + 1) / total })
    })
    scope.postMessage({ id: job.id, type: 'done', result })
  } catch (error) {
    scope.postMessage({ id: job.id, type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
