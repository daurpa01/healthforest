import { useCallback, useRef, useState } from 'react'

export interface JobProgress {
  running: boolean
  progress: number
  start: (job: Record<string, unknown>) => Promise<unknown>
  cancel: () => void
}

export function useJob(): JobProgress {
  const worker = useRef<Worker | null>(null)
  const seq = useRef(0)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)

  const cancel = useCallback(() => {
    worker.current?.terminate()
    worker.current = null
    setRunning(false)
  }, [])

  const start = useCallback((job: Record<string, unknown>) => {
    worker.current?.terminate()
    const next = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' })
    worker.current = next
    const id = ++seq.current
    setRunning(true)
    setProgress(0.02)
    return new Promise((resolve, reject) => {
      next.onmessage = (event: MessageEvent) => {
        if (event.data.id !== id) return
        if (event.data.type === 'progress') setProgress(event.data.value)
        if (event.data.type === 'done') {
          setRunning(false)
          setProgress(1)
          resolve(event.data.result)
        }
        if (event.data.type === 'error') {
          setRunning(false)
          reject(new Error(event.data.message))
        }
      }
      next.onerror = () => {
        setRunning(false)
        reject(new Error('worker'))
      }
      next.postMessage({ ...job, id })
    })
  }, [])

  return { running, progress, start, cancel }
}
