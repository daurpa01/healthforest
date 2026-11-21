import type { CeaResult } from '../engine/cea'
import type { PSASummary } from '../engine/psa'

const palette = ['#1f6b4c', '#1e4d7b', '#b5811a', '#8d3b2c', '#3c4f8a', '#6d4c7d', '#2f6f62', '#8a5a2a']

export function strategyColor(index: number): string {
  return palette[index % palette.length]
}

export function FrontierChart({
  cea,
  wtp,
  formatX,
  formatY,
}: {
  cea: CeaResult
  wtp: number
  formatX: (n: number) => string
  formatY: (n: number) => string
}) {
  const rows = cea.strategies
  if (!rows.length) return null
  const pad = { l: 56, r: 16, t: 16, b: 36 }
  const w = 560
  const h = 320
  const xs = rows.map((row) => row.effect)
  const ys = rows.map((row) => row.cost)
  const x0 = Math.min(...xs, 0)
  const x1 = Math.max(...xs) * 1.08 + 0.01
  const y0 = Math.min(...ys, 0)
  const y1 = Math.max(...ys) * 1.12 + 1
  const X = (x: number) => pad.l + ((x - x0) / (x1 - x0)) * (w - pad.l - pad.r)
  const Y = (y: number) => h - pad.b - ((y - y0) / (y1 - y0)) * (h - pad.t - pad.b)
  const frontier = cea.frontierIds
    .map((id) => rows.find((row) => row.id === id))
    .filter((row): row is (typeof rows)[number] => Boolean(row))
  const optimal = rows.find((row) => row.id === cea.optimalId)
  const line = optimal
    ? [
        [x0, optimal.cost - wtp * (optimal.effect - x0)],
        [x1, optimal.cost + wtp * (x1 - optimal.effect)],
      ]
    : []
  return (
    <svg viewBox={`0 0 ${w} ${h}`} role="img" className="plot">
      <line x1={pad.l} y1={Y(y0)} x2={pad.l} y2={Y(y1)} stroke="currentColor" opacity="0.35" />
      <line x1={X(x0)} y1={h - pad.b} x2={X(x1)} y2={h - pad.b} stroke="currentColor" opacity="0.35" />
      {line.length === 2 && (
        <line x1={X(line[0][0])} y1={Y(line[0][1])} x2={X(line[1][0])} y2={Y(line[1][1])} stroke="#b5811a" strokeDasharray="5 4" />
      )}
      <polyline fill="none" stroke="#1f6b4c" strokeWidth="2.2" points={frontier.map((row) => `${X(row.effect)},${Y(row.cost)}`).join(' ')} />
      {rows.map((row, index) => (
        <g key={row.id}>
          <circle
            cx={X(row.effect)}
            cy={Y(row.cost)}
            r={row.id === cea.optimalId ? 7 : 5.5}
            fill={row.onFrontier ? strategyColor(index) : 'transparent'}
            stroke={strategyColor(index)}
            strokeWidth="2"
          />
          <text x={X(row.effect) + 8} y={Y(row.cost) - 8} fontSize="12">
            {row.name}
          </text>
        </g>
      ))}
      <text x={w / 2} y={h - 8} textAnchor="middle" fontSize="12" opacity="0.7">
        {formatX(x0)} → {formatX(x1)}
      </text>
      <text x={14} y={20} fontSize="12" opacity="0.7">
        {formatY(y1)}
      </text>
    </svg>
  )
}

export function LineChart({
  series,
  yFormat,
}: {
  series: { name: string; color: string; points: { x: number; y: number }[] }[]
  yFormat: (n: number) => string
}) {
  const all = series.flatMap((item) => item.points)
  if (!all.length) return null
  const w = 560
  const h = 280
  const pad = { l: 52, r: 12, t: 16, b: 28 }
  const xs = all.map((point) => point.x)
  const ys = all.map((point) => point.y)
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys)
  const X = (x: number) => pad.l + ((x - x0) / (x1 - x0 || 1)) * (w - pad.l - pad.r)
  const Y = (y: number) => h - pad.b - ((y - y0) / (y1 - y0 || 1)) * (h - pad.t - pad.b)
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="plot">
      {series.map((item) => (
        <polyline key={item.name} fill="none" stroke={item.color} strokeWidth="2" points={item.points.map((point) => `${X(point.x)},${Y(point.y)}`).join(' ')} />
      ))}
      <text x={8} y={18} fontSize="11">
        {yFormat(y1)}
      </text>
      <text x={8} y={h - 32} fontSize="11">
        {yFormat(y0)}
      </text>
    </svg>
  )
}

export function TornadoChart({ bars, format }: { bars: { label: string; low: number; high: number }[]; format: (n: number) => string }) {
  if (!bars.length) return null
  const base = 0
  const extent = Math.max(...bars.flatMap((bar) => [Math.abs(bar.low - base), Math.abs(bar.high - base)]), 1)
  const w = 560
  const rowH = 28
  const h = bars.length * rowH + 16
  const mid = w / 2
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="plot">
      {bars.map((bar, index) => {
        const y = 12 + index * rowH
        const x1 = mid + ((Math.min(bar.low, bar.high) - base) / (2 * extent)) * (w - 160)
        const x2 = mid + ((Math.max(bar.low, bar.high) - base) / (2 * extent)) * (w - 160)
        return (
          <g key={bar.label}>
            <text x={8} y={y + 12} fontSize="12">
              {bar.label}
            </text>
            <rect x={Math.min(x1, x2)} y={y} width={Math.max(4, Math.abs(x2 - x1))} height={16} rx="4" fill={bar.low < bar.high ? '#1e4d7b' : '#a33b24'} opacity="0.85" />
            <title>
              {format(bar.low)} → {format(bar.high)}
            </title>
          </g>
        )
      })}
    </svg>
  )
}

export function HeatGrid({
  cells,
  colorOf,
}: {
  cells: { x: number; y: number; bestId: string }[]
  colorOf: (id: string) => string
}) {
  const size = 280
  const xs = [...new Set(cells.map((item) => item.x))].sort((a, b) => a - b)
  const ys = [...new Set(cells.map((item) => item.y))].sort((a, b) => a - b)
  const cellW = size / Math.max(1, xs.length)
  const cellH = size / Math.max(1, ys.length)
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="plot">
      {cells.map((item) => (
        <rect
          key={`${item.x}-${item.y}`}
          x={xs.indexOf(item.x) * cellW}
          y={(ys.length - 1 - ys.indexOf(item.y)) * cellH}
          width={cellW - 1}
          height={cellH - 1}
          fill={colorOf(item.bestId)}
        />
      ))}
    </svg>
  )
}

export function StackedArea({
  stages,
  series,
}: {
  stages: number[]
  series: { id: string; name: string; color: string; values: number[] }[]
}) {
  if (!stages.length) return null
  const w = 560
  const h = 260
  const pad = { l: 36, r: 12, t: 12, b: 28 }
  const X = (i: number) => pad.l + (i / Math.max(1, stages.length - 1)) * (w - pad.l - pad.r)
  const totals = stages.map((_, index) => series.reduce((sum, item) => sum + (item.values[index] ?? 0), 0))
  const max = Math.max(...totals, 1)
  const Y = (v: number) => h - pad.b - (v / max) * (h - pad.t - pad.b)
  let base = stages.map(() => 0)
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="plot">
      {series.map((item) => {
        const top = base.map((value, index) => value + (item.values[index] ?? 0))
        const d = [
          ...top.map((value, index) => `${index === 0 ? 'M' : 'L'} ${X(index)} ${Y(value)}`),
          ...base
            .map((value, index) => `L ${X(index)} ${Y(value)}`)
            .reverse(),
          'Z',
        ].join(' ')
        base = top
        return <path key={item.id} d={d} fill={item.color} opacity="0.9" />
      })}
    </svg>
  )
}

export function ScatterPlane({
  summary,
  wtp,
  colors,
}: {
  summary: PSASummary
  wtp: number
  colors: Record<string, string>
}) {
  const points = summary.scatter
  if (!points.length) return null
  const w = 560
  const h = 320
  const pad = 36
  const xs = points.map((point) => point.incrementalEffect)
  const ys = points.map((point) => point.incrementalCost)
  const span = Math.max(...xs.map(Math.abs), ...ys.map(Math.abs), 1) * 1.15
  const X = (x: number) => w / 2 + (x / span) * (w / 2 - pad)
  const Y = (y: number) => h / 2 - (y / span) * (h / 2 - pad)
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="plot">
      <line x1={pad} y1={h / 2} x2={w - pad} y2={h / 2} stroke="currentColor" opacity="0.3" />
      <line x1={w / 2} y1={pad} x2={w / 2} y2={h - pad} stroke="currentColor" opacity="0.3" />
      <line x1={X(-span)} y1={Y(-wtp * span)} x2={X(span)} y2={Y(wtp * span)} stroke="#b5811a" strokeDasharray="4 4" />
      {points.map((point, index) => (
        <circle key={index} cx={X(point.incrementalEffect)} cy={Y(point.incrementalCost)} r="2.2" fill={colors[point.strategyId] ?? '#1f6b4c'} opacity="0.55" />
      ))}
    </svg>
  )
}

export function CeacChart({ summary, names }: { summary: PSASummary; names: Record<string, string> }) {
  const series = Object.keys(summary.ceac[0]?.probability ?? {}).map((id, index) => ({
    name: names[id] ?? id,
    color: strategyColor(index),
    points: summary.ceac.map((row) => ({ x: row.wtp, y: row.probability[id] ?? 0 })),
  }))
  series.push({
    name: 'CEAF',
    color: '#111111',
    points: summary.ceaf.map((row) => ({ x: row.wtp, y: row.probability })),
  })
  return <LineChart series={series} yFormat={(value) => `${Math.round(value * 100)}%`} />
}

export function GroupedBars({
  categories,
  a,
  b,
  aLabel,
  bLabel,
}: {
  categories: string[]
  a: number[]
  b: number[]
  aLabel: string
  bLabel: string
}) {
  const max = Math.max(...a, ...b, 1)
  const w = 560
  const h = 240
  const slot = (w - 40) / Math.max(1, categories.length)
  const H = (value: number) => (value / max) * (h - 40)
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="plot">
      {categories.map((category, index) => (
        <g key={category}>
          <rect x={28 + index * slot} y={h - 24 - H(a[index] ?? 0)} width={slot * 0.32} height={H(a[index] ?? 0)} fill="#1e4d7b" rx="3" />
          <rect x={28 + index * slot + slot * 0.34} y={h - 24 - H(b[index] ?? 0)} width={slot * 0.32} height={H(b[index] ?? 0)} fill="#1f6b4c" rx="3" />
          <text x={28 + index * slot} y={h - 8} fontSize="11">
            {category}
          </text>
        </g>
      ))}
      <text x={8} y={14} fontSize="11" fill="#1e4d7b">
        {aLabel}
      </text>
      <text x={120} y={14} fontSize="11" fill="#1f6b4c">
        {bLabel}
      </text>
    </svg>
  )
}
