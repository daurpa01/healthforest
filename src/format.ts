import { isEngineError } from './engine/errors'

export type Lang = 'es' | 'en'

export function formatNum(value: number, digits: number, lang: Lang): string {
  if (!Number.isFinite(value)) return '—'
  return new Intl.NumberFormat(lang === 'es' ? 'es-CO' : 'en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)
}

export function formatMoney(value: number, symbol: string, digits: number, lang: Lang): string {
  if (!Number.isFinite(value)) return '—'
  const sign = value < 0 ? '−' : ''
  return `${sign}${symbol}${formatNum(Math.abs(value), digits, lang)}`
}

export function formatIcer(value: number | null, symbol: string, digits: number, lang: Lang): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return formatMoney(value, symbol, digits, lang)
}

export function errorText(error: unknown, translate: (code: string, detail: string) => string): string {
  if (isEngineError(error)) return translate(error.code, error.detail ?? '')
  if (error instanceof Error) return error.message
  return String(error)
}
