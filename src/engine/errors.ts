export class EngineError extends Error {
  readonly code: string
  readonly detail?: string

  constructor(code: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'EngineError'
    this.code = code
    this.detail = detail
  }
}

export interface ModelWarning {
  code: string
  detail?: string
  nodeId?: string
}

export function isEngineError(error: unknown): error is EngineError {
  return error instanceof EngineError
}
