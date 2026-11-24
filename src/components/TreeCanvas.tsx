import { useEffect, useMemo, useRef, useState } from 'react'
import type { Branch, GraphStyle, PayoffMap, TreeNode } from '../engine/types'
import { formatMoney } from '../format'
import type { Lang } from '../format'
import { t } from '../i18n'

interface Edge {
  id: string
  branch: Branch
  parentType: TreeNode['type']
  x1: number
  y1: number
  x2: number
  y2: number
}

interface Placed {
  node: TreeNode
  x: number
  y: number
  leaf: boolean
}

export function TreeCanvas({
  tree,
  graph,
  nodePayoffs,
  optimal,
  selectedNode,
  selectedBranch,
  collapsed,
  onSelectNode,
  onSelectBranch,
  onToggle,
  lang,
  symbol,
  decimals,
}: {
  tree: TreeNode
  graph: GraphStyle
  nodePayoffs: Record<string, PayoffMap>
  optimal: Set<string>
  selectedNode?: string
  selectedBranch?: string
  collapsed: Set<string>
  onSelectNode: (id: string) => void
  onSelectBranch: (branchId: string, parentId: string) => void
  onToggle: (id: string) => void
  lang: Lang
  symbol: string
  decimals: number
}) {
  const host = useRef<HTMLDivElement>(null)
  const [cam, setCam] = useState({ x: 48, y: 48, k: 1 })
  const [size, setSize] = useState({ w: 1100, h: 720 })
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null)
  const layout = useMemo(() => place(tree, graph, collapsed), [tree, graph, collapsed])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => fit())
    return () => window.cancelAnimationFrame(frame)
    // Fit when the tree structure changes, not on every camera update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree.id, layout.width, layout.height])

  function fit() {
    const rect = host.current?.getBoundingClientRect()
    if (!rect || rect.width < 80 || rect.height < 80) return
    const k = Math.min((rect.width - 80) / layout.width, (rect.height - 80) / layout.height, 1.25)
    setCam({ k: Math.max(0.35, k), x: (rect.width - layout.width * k) / 2, y: (rect.height - layout.height * k) / 2 })
  }

  useEffect(() => {
    const el = host.current
    if (!el) return
    const watch = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    watch.observe(el)
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = el.getBoundingClientRect()
      const px = event.clientX - rect.left
      const py = event.clientY - rect.top
      setCam((current) => {
        const next = Math.min(2.5, Math.max(0.28, current.k * (event.deltaY < 0 ? 1.08 : 0.92)))
        const wx = (px - current.x) / current.k
        const wy = (py - current.y) / current.k
        return { k: next, x: px - wx * next, y: py - wy * next }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      watch.disconnect()
      el.removeEventListener('wheel', onWheel)
    }
  }, [])

  const pub = graph.theme === 'publication'
  return (
    <div
      className="stage"
      ref={host}
      onPointerDown={(event) => {
        if ((event.target as Element).closest('[data-hit]')) return
        drag.current = { px: event.clientX, py: event.clientY, x: cam.x, y: cam.y }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        if (!drag.current) return
        setCam((current) => ({
          ...current,
          x: drag.current!.x + event.clientX - drag.current!.px,
          y: drag.current!.y + event.clientY - drag.current!.py,
        }))
      }}
      onPointerUp={() => {
        drag.current = null
      }}
    >
      <div className="canvas-tools">
        <button className="btn btn-tiny" onClick={() => setCam((c) => ({ ...c, k: Math.min(2.5, c.k * 1.15) }))}>
          {t(lang, 'zoomIn')}
        </button>
        <button className="btn btn-tiny" onClick={() => setCam((c) => ({ ...c, k: Math.max(0.28, c.k / 1.15) }))}>
          {t(lang, 'zoomOut')}
        </button>
        <button className="btn btn-tiny" onClick={fit}>
          {t(lang, 'fit')}
        </button>
      </div>
      <svg id="tree-svg" className="tree-svg" viewBox={`0 0 ${size.w} ${size.h}`} width={size.w} height={size.h}>
        <defs>
          <filter id="node-shadow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="1.2" stdDeviation="1.4" floodOpacity={pub ? 0 : 0.22} />
          </filter>
        </defs>
        <rect width="100%" height="100%" fill={graph.colors.background} />
        <g transform={`translate(${cam.x} ${cam.y}) scale(${cam.k})`}>
          {layout.edges.map((edge) => {
            const chosen = optimal.has(edge.id)
            const path = curve(edge.x1, edge.y1, edge.x2, edge.y2)
            const mid = pointOn(edge.x1, edge.y1, edge.x2, edge.y2, 0.55)
            const selected = selectedBranch === edge.id
            return (
              <g key={edge.id}>
                {chosen && <path d={path} fill="none" stroke={graph.colors.optimal} strokeWidth={pub ? 7 : 9} opacity={pub ? 0.18 : 0.28} />}
                <path
                  d={path}
                  fill="none"
                  stroke={chosen ? graph.colors.optimal : graph.colors.line}
                  strokeWidth={chosen ? 2.6 : 1.6}
                />
                <path d={path} fill="none" stroke="transparent" strokeWidth="16" data-hit="1" style={{ cursor: 'pointer' }} onClick={() => onSelectBranch(edge.id, edgeParent(layout, edge))} />
                {graph.show.probability && edge.parentType === 'chance' && (
                  <g>
                    <rect x={mid.x - 28} y={mid.y - 12} width="56" height="20" rx="10" fill={graph.colors.background} stroke={selected ? graph.colors.optimal : graph.colors.line} />
                    <text x={mid.x} y={mid.y + 3} textAnchor="middle" fontSize={graph.fontSize - 2} fontFamily={graph.fontFamily} fill={graph.colors.text}>
                      {edge.branch.probability}
                    </text>
                  </g>
                )}
                {graph.show.nodeNames && edge.branch.label && (
                  <text x={mid.x} y={mid.y - 16} textAnchor="middle" fontSize={graph.fontSize - 1} fontFamily={graph.fontFamily} fill={graph.colors.muted}>
                    {edge.branch.label}
                  </text>
                )}
              </g>
            )
          })}
          {layout.nodes.map((item) => (
            <NodeGlyph
              key={item.node.id}
              item={item}
              graph={graph}
              selected={selectedNode === item.node.id}
              collapsed={collapsed.has(item.node.id)}
              pay={nodePayoffs[item.node.id]}
              lang={lang}
              symbol={symbol}
              decimals={decimals}
              onSelect={() => onSelectNode(item.node.id)}
              onToggle={() => onToggle(item.node.id)}
            />
          ))}
        </g>
      </svg>
      <Minimap layout={layout} cam={cam} host={host.current} onJump={(x, y) => setCam((current) => ({ ...current, x, y }))} />
      <div className="legend">
        <span><i style={{ background: graph.colors.decision }} />{t(lang, 'nodeDecision')}</span>
        <span><i style={{ background: graph.colors.chance, borderRadius: 99 }} />{t(lang, 'nodeChance')}</span>
        <span><i style={{ background: graph.colors.terminal }} />{t(lang, 'nodeTerminal')}</span>
        <span><i style={{ background: graph.colors.markov, borderRadius: 4 }} />{t(lang, 'nodeMarkov')}</span>
        <span><i style={{ background: graph.colors.optimal }} />{t(lang, 'optimal')}</span>
      </div>
    </div>
  )
}

function NodeGlyph({
  item,
  graph,
  selected,
  collapsed,
  pay,
  lang,
  symbol,
  decimals,
  onSelect,
  onToggle,
}: {
  item: Placed
  graph: GraphStyle
  selected: boolean
  collapsed: boolean
  pay?: PayoffMap
  lang: Lang
  symbol: string
  decimals: number
  onSelect: () => void
  onToggle: () => void
}) {
  const pub = graph.theme === 'publication'
  const scale = graph.nodeScale
  const s = 24 * scale
  const color = graph.colors[item.node.type]
  const fill = pub ? graph.colors.background : color
  const ink = pub ? graph.colors.text : '#fbfaf6'
  const stroke = selected ? graph.colors.optimal : pub ? graph.colors.text : 'transparent'
  const { x, y, node } = item
  return (
    <g data-hit="1" style={{ cursor: 'pointer' }} onClick={onSelect} filter={pub ? undefined : 'url(#node-shadow)'}>
      {node.type === 'decision' && <rect x={x - s} y={y - s} width={s * 2} height={s * 2} rx={8} fill={fill} stroke={stroke} strokeWidth={selected ? 3 : pub ? 1.6 : 0} />}
      {node.type === 'chance' && <circle cx={x} cy={y} r={s} fill={fill} stroke={stroke} strokeWidth={selected ? 3 : pub ? 1.6 : 0} />}
      {node.type === 'terminal' && (
        <polygon points={`${x - s},${y - s * 0.86} ${x - s},${y + s * 0.86} ${x + s * 1.05},${y}`} fill={fill} stroke={stroke} strokeWidth={selected ? 3 : pub ? 1.6 : 0} />
      )}
      {node.type === 'markov' && <rect x={x - s * 1.05} y={y - s * 0.82} width={s * 2.1} height={s * 1.64} rx={s} fill={fill} stroke={stroke} strokeWidth={selected ? 3 : pub ? 1.6 : 0} />}
      {node.type === 'logic' && (
        <polygon points={`${x},${y - s} ${x + s},${y} ${x},${y + s} ${x - s},${y}`} fill={fill} stroke={stroke} strokeWidth={selected ? 3 : pub ? 1.6 : 0} />
      )}
      {node.type === 'clone' && <rect x={x - s} y={y - s * 0.75} width={s * 2} height={s * 1.5} rx={6} fill={fill} stroke={pub ? graph.colors.text : ink} strokeDasharray="4 3" strokeWidth="1.4" />}
      <text x={x} y={y + 4} textAnchor="middle" fontSize={12 * scale} fontFamily={graph.fontFamily} fill={ink} fontWeight="700">
        {glyph(node.type)}
      </text>
      {graph.show.nodeNames && (
        <text x={x} y={y - s - 10} textAnchor="middle" fontSize={graph.fontSize} fontFamily={graph.fontFamily} fill={graph.colors.text} fontWeight="650">
          {node.name}
        </text>
      )}
      {graph.show.payoffs && node.type === 'terminal' && (
        <text x={x + s + 10} y={y + 4} fontSize={graph.fontSize - 1} fontFamily={graph.fontFamily} fill={graph.colors.muted}>
          {showFormula(node.payoffs.cost, symbol, decimals, lang)} · {showFormula(node.payoffs.effect, '', decimals, lang)}
        </text>
      )}
      {graph.show.expectedValue && pay && (
        <text x={x} y={y + s + 18} textAnchor="middle" fontSize={graph.fontSize - 2} fontFamily={graph.fontFamily} fill={graph.colors.optimal}>
          {t(lang, 'ev')} {formatMoney(pay.cost ?? 0, symbol, decimals, lang)} · {formatFixed(pay.effect ?? 0, decimals)}
        </text>
      )}
      {graph.show.variables && node.definitions?.length ? (
        <text x={x} y={y + s + 34} textAnchor="middle" fontSize="11" fontFamily={graph.fontFamily} fill={graph.colors.muted}>
          {node.definitions.map((def) => `${def.name}=${def.expression}`).join(', ')}
        </text>
      ) : null}
      {node.branches.length > 0 && (
        <g
          onClick={(event) => {
            event.stopPropagation()
            onToggle()
          }}
        >
          <circle cx={x + s + 12} cy={y} r="8" fill={graph.colors.background} stroke={graph.colors.line} />
          <text x={x + s + 12} y={y + 4} textAnchor="middle" fontSize="12" fill={graph.colors.text}>
            {collapsed ? '+' : '–'}
          </text>
        </g>
      )}
    </g>
  )
}

function Minimap({
  layout,
  cam,
  host,
  onJump,
}: {
  layout: Layout
  cam: { x: number; y: number; k: number }
  host: HTMLDivElement | null
  onJump: (x: number, y: number) => void
}) {
  const scale = Math.min(160 / layout.width, 90 / layout.height)
  const vx = host ? -cam.x / cam.k : 0
  const vy = host ? -cam.y / cam.k : 0
  const vw = host ? host.clientWidth / cam.k : 100
  const vh = host ? host.clientHeight / cam.k : 100
  return (
    <svg
      className="minimap"
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        const wx = ((event.clientX - rect.left) / rect.width) * layout.width
        const wy = ((event.clientY - rect.top) / rect.height) * layout.height
        if (!host) return
        onJump(host.clientWidth / 2 - wx * cam.k, host.clientHeight / 2 - wy * cam.k)
      }}
    >
      {layout.edges.map((edge) => (
        <path key={edge.id} d={curve(edge.x1, edge.y1, edge.x2, edge.y2)} fill="none" stroke="#8d8376" strokeWidth={1 / scale} />
      ))}
      <rect x={vx} y={vy} width={vw} height={vh} fill="rgba(181,129,26,0.12)" stroke="#b5811a" strokeWidth={1 / Math.max(scale, 0.2)} />
    </svg>
  )
}

interface Layout {
  nodes: Placed[]
  edges: Edge[]
  width: number
  height: number
}

function place(tree: TreeNode, graph: GraphStyle, collapsed: Set<string>): Layout {
  const gapX = graph.rankSpacing
  const gapY = graph.nodeSpacing
  const measure = (node: TreeNode): number => {
    if (collapsed.has(node.id) || node.branches.length === 0) return 1
    return Math.max(1, node.branches.reduce((sum, branch) => sum + measure(branch.child), 0))
  }
  const nodes: Placed[] = []
  const edges: Edge[] = []
  let maxDepth = 0
  const walk = (node: TreeNode, top: number, depth: number) => {
    const height = measure(node)
    const leaf = collapsed.has(node.id) || node.branches.length === 0
    maxDepth = Math.max(maxDepth, depth)
    nodes.push({ node, x: depth * gapX, y: (top + height / 2) * gapY, leaf })
    if (leaf) return
    let cursor = top
    for (const branch of node.branches) {
      const childHeight = measure(branch.child)
      walk(branch.child, cursor, depth + 1)
      cursor += childHeight
    }
  }
  walk(tree, 0, 0)
  if (graph.alignTerminals) {
    for (const item of nodes) if (item.leaf) item.x = maxDepth * gapX
  }
  const byId = new Map(nodes.map((item) => [item.node.id, item]))
  const link = (node: TreeNode) => {
    if (collapsed.has(node.id)) return
    const from = byId.get(node.id)
    if (!from) return
    for (const branch of node.branches) {
      const to = byId.get(branch.child.id)
      if (to) {
        edges.push({
          id: branch.id,
          branch,
          parentType: node.type,
          x1: from.x + 28 * graph.nodeScale,
          y1: from.y,
          x2: to.x - 28 * graph.nodeScale,
          y2: to.y,
        })
      }
      link(branch.child)
    }
  }
  link(tree)
  const minX = Math.min(...nodes.map((item) => item.x)) - 80
  const minY = Math.min(...nodes.map((item) => item.y)) - 56
  const maxX = Math.max(...nodes.map((item) => item.x)) + 180
  const maxY = Math.max(...nodes.map((item) => item.y)) + 72
  for (const item of nodes) {
    item.x -= minX
    item.y -= minY
  }
  for (const edge of edges) {
    edge.x1 -= minX
    edge.x2 -= minX
    edge.y1 -= minY
    edge.y2 -= minY
  }
  return { nodes, edges, width: Math.max(240, maxX - minX), height: Math.max(180, maxY - minY) }
}

function edgeParent(layout: Layout, edge: Edge): string {
  const parent = layout.nodes.find((item) => item.node.branches.some((branch) => branch.id === edge.id))
  return parent?.node.id ?? ''
}

function curve(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(36, (x2 - x1) * 0.46)
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
}

function pointOn(x1: number, y1: number, x2: number, y2: number, t: number): { x: number; y: number } {
  const dx = Math.max(36, (x2 - x1) * 0.46)
  const c1x = x1 + dx
  const c2x = x2 - dx
  const u = 1 - t
  return {
    x: u ** 3 * x1 + 3 * u ** 2 * t * c1x + 3 * u * t ** 2 * c2x + t ** 3 * x2,
    y: u ** 3 * y1 + 3 * u ** 2 * t * y1 + 3 * u * t ** 2 * y2 + t ** 3 * y2,
  }
}

function glyph(type: TreeNode['type']): string {
  switch (type) {
    case 'decision':
      return 'D'
    case 'chance':
      return 'C'
    case 'terminal':
      return ''
    case 'markov':
      return 'M'
    case 'logic':
      return '?'
    case 'clone':
      return '⧉'
  }
}

function showFormula(text: string | undefined, symbol: string, digits: number, lang: Lang): string {
  const value = (text ?? '0').trim()
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    const number = Number(value)
    return symbol ? formatMoney(number, symbol, digits, lang) : formatFixed(number, digits)
  }
  return value || '0'
}

function formatFixed(value: number, digits: number): string {
  if (!Number.isFinite(value)) return '—'
  return value.toFixed(digits)
}
