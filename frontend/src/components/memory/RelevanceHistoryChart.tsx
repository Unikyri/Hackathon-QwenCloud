import { useState } from 'react'
import type { MemoryHistoryPoint, MemoryStatusEntity } from '../../lib/types'
import styles from './RelevanceHistoryChart.module.css'

// Extracted from DecayTimeline so the same chart can render either the
// multi-entity Memory Lab view (DecayTimeline, unchanged) or a future
// single-entity Story Graph Relevance-history tab (`compact`).
const ARCHIVE_THRESHOLD = 0.15
const VIEW_W = 800
const VIEW_H = 300
const PAD = 30
const INNER_W = VIEW_W - PAD * 2
const INNER_H = VIEW_H - PAD * 2

// E: per-entity categorical palette — colors drawn exclusively from the existing
// Quiet Studio token system so no new hex values are introduced. Color is now
// the *identity* encoding (which line belongs to which entity); lifecycle is the
// secondary encoding via strokeDasharray + opacity (see entityLineStyle below).
const ENTITY_PALETTE = [
  'var(--node-character)',  // #155e58 teal-pine
  'var(--node-event)',      // #8a5d00 amber
  'var(--node-plotarc)',    // #a23d33 coral
  'var(--node-place)',      // #4d8069 medium-teal
  'var(--node-worldrule)',  // #337c73 teal-mid
  'var(--node-faction)',    // #52605b slate
  'var(--accent-live)',     // #605198 violet
  'var(--gold-ink)',        // #8a5d00 alias (different from event token in practice)
]

// Lifecycle stays as a *secondary* encoding: solid=active/reactivated (the
// "healthy" states), dashed=decaying, lower opacity=archived. This way each
// entity keeps its own color regardless of lifecycle state.
function entityLineStyle(lifecycle: string): { strokeDasharray?: string; opacity?: number } {
  switch (lifecycle) {
    case 'decaying': return { strokeDasharray: '6 3' }
    case 'archived': return { opacity: 0.4 }
    case 'consolidated': return { strokeDasharray: '2 4' }
    default: return {} // active, reactivated — solid full opacity
  }
}

// Legacy lifecycle meta kept for the human-readable label in the legend.
const LIFECYCLE_META: Record<string, { label: string }> = {
  active: { label: 'active' },
  decaying: { label: 'decaying' },
  archived: { label: 'archived' },
  consolidated: { label: 'consolidated' },
  reactivated: { label: 'reactivated' },
}

function scoreY(score: number) {
  return PAD + (1 - score) * INNER_H
}

function pointX(index: number, length: number) {
  if (length <= 1) return PAD
  return PAD + (index / (length - 1)) * INNER_W
}

interface Crossing {
  index: number
  kind: 'archive' | 'reactivate'
}

function findCrossings(history: MemoryHistoryPoint[]): Crossing[] {
  const crossings: Crossing[] = []
  for (let index = 1; index < history.length; index++) {
    const previous = history[index - 1].score
    const current = history[index].score
    if (previous > ARCHIVE_THRESHOLD && current <= ARCHIVE_THRESHOLD) crossings.push({ index, kind: 'archive' })
    if (previous <= ARCHIVE_THRESHOLD && current > ARCHIVE_THRESHOLD) crossings.push({ index, kind: 'reactivate' })
  }
  return crossings
}

interface EntityLineProps {
  entity: MemoryStatusEntity
  /** Stable per-entity color drawn from ENTITY_PALETTE by caller index. */
  color: string
  /** Whether this line is highlighted (hovered from legend). */
  highlighted: boolean | null
}

// E: EntityLine now uses `color` (per-entity identity) for stroke rather than
// the lifecycle-based color. Lifecycle is expressed via strokeDasharray/opacity.
function EntityLine({ entity, color, highlighted }: EntityLineProps) {
  const lineStyle = entityLineStyle(entity.lifecycle)
  const label = LIFECYCLE_META[entity.lifecycle]?.label ?? entity.lifecycle

  // When something else is highlighted, dim this line.
  const dimmed = highlighted === false

  if (entity.history.length === 0) return null
  if (entity.history.length === 1) {
    return (
      <circle
        data-testid={`decay-dot-${entity.id}`}
        cx={pointX(0, 1)}
        cy={scoreY(entity.history[0].score)}
        r={4}
        fill={color}
        opacity={lineStyle.opacity ?? (dimmed ? 0.2 : 1)}
      >
        <title>{`${entity.name} — ${entity.history[0].score.toFixed(2)} (${label})`}</title>
      </circle>
    )
  }
  const points = entity.history
    .map((point, index) => `${pointX(index, entity.history.length)},${scoreY(point.score)}`)
    .join(' ')
  return (
    <g opacity={lineStyle.opacity ?? (dimmed ? 0.2 : 1)}>
      <polyline
        data-testid={`decay-polyline-${entity.id}`}
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={highlighted === true ? 3 : 2}
        strokeDasharray={lineStyle.strokeDasharray}
      >
        <title>{`${entity.name} (${label})`}</title>
      </polyline>
      {findCrossings(entity.history).map((crossing) => (
        <text
          key={`${crossing.kind}-${crossing.index}`}
          data-testid={`decay-marker-${entity.id}-${crossing.kind}-${crossing.index}`}
          x={pointX(crossing.index, entity.history.length)}
          y={scoreY(entity.history[crossing.index].score) + (crossing.kind === 'archive' ? 14 : -8)}
          textAnchor="middle"
          fontSize={12}
          fill={color}
          aria-hidden="true"
        >
          {crossing.kind === 'archive' ? '▼' : '▲'}
        </text>
      ))}
    </g>
  )
}

interface RelevanceHistoryChartProps {
  entities: MemoryStatusEntity[]
  /** Hides the per-entity legend — the caller already shows the entity's name (e.g. a single-entity tab). */
  compact?: boolean
  emptyMessage?: string
}

export default function RelevanceHistoryChart({
  entities,
  compact = false,
  emptyMessage = 'No entity lifecycle data yet. Quill shows this after it has tracked story entities.',
}: RelevanceHistoryChartProps) {
  // E3 (interaction nice-to-have): hoveredId tracks which legend row is hovered so
  // we can highlight the matching line and dim the rest.
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  if (entities.length === 0) return <p className={styles.emptyPlaceholder}>{emptyMessage}</p>

  const thresholdY = scoreY(ARCHIVE_THRESHOLD)

  return (
    <>
      <svg
        data-testid="decay-timeline-svg"
        className={styles.svg}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid meet"
        aria-label="Entity relevance over time"
      >
        <line
          data-testid="decay-threshold-line"
          x1={PAD}
          y1={thresholdY}
          x2={VIEW_W - PAD}
          y2={thresholdY}
          stroke="var(--muted-3)"
          strokeWidth={1}
          strokeDasharray="4 3"
        />
        {entities.map((entity, index) => {
          const color = ENTITY_PALETTE[index % ENTITY_PALETTE.length]
          // highlighted=true → hovered, highlighted=false → dimmed (another is hovered),
          // highlighted=null → no hover in progress, render normally.
          const highlighted = hoveredId === null ? null : hoveredId === entity.id
          return <EntityLine key={entity.id} entity={entity} color={color} highlighted={highlighted} />
        })}
      </svg>
      {!compact && (
        <ul className={styles.legend} aria-label="Entity lifecycle summary">
          {entities.map((entity, index) => {
            const color = ENTITY_PALETTE[index % ENTITY_PALETTE.length]
            const label = LIFECYCLE_META[entity.lifecycle]?.label ?? entity.lifecycle
            return (
              <li
                key={entity.id}
                className={styles.legendItem}
                // E3: hovering a legend row highlights that entity's line in the SVG.
                onMouseEnter={() => setHoveredId(entity.id)}
                onMouseLeave={() => setHoveredId(null)}
                style={{ opacity: hoveredId && hoveredId !== entity.id ? 0.4 : 1, cursor: 'default' }}
              >
                {/* E2: legend dot uses same per-entity color as the chart line */}
                <span className={styles.legendDot} style={{ background: color }} />
                {entity.name}: {label},{' '}
                <span className={styles.relevanceFigure}>{Math.round(entity.relevance_score * 100)}% relevance</span>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
