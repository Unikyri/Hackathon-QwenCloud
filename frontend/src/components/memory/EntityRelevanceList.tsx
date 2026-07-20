import { useMemo, useState } from 'react'
import type { MemoryHistoryPoint, MemoryStatusEntity } from '../../lib/types'
import styles from './EntityRelevanceList.module.css'

// Replaces the old shared-canvas line chart for the Memory Lab's multi-entity
// view: N overlapping polylines on one SVG becomes illegible past a handful
// of entities (every "active" entity shared one color; even after giving
// each entity its own color from an 8-color cyclic palette, 20+ entities
// still repeat colors and read as a tangle at a glance). One row per entity,
// each with its own small sparkline, scales to any entity count and needs no
// hover-to-disambiguate step.

const ARCHIVE_THRESHOLD = 0.15
const SPARK_W = 160
const SPARK_H = 36
const SPARK_PAD = 4
const DEFAULT_VISIBLE = 8

const LIFECYCLE_META: Record<string, { color: string; label: string }> = {
  active: { color: 'var(--success-2)', label: 'active' },
  decaying: { color: 'var(--gold-ink)', label: 'decaying' },
  archived: { color: 'var(--muted-3)', label: 'archived' },
  consolidated: { color: 'var(--node-event)', label: 'consolidated' },
  reactivated: { color: 'var(--teal)', label: 'reactivated' },
}

const LIFECYCLE_FILTERS = ['all', 'active', 'decaying', 'archived', 'consolidated', 'reactivated'] as const
type LifecycleFilter = (typeof LIFECYCLE_FILTERS)[number]

function sparkY(score: number) {
  return SPARK_PAD + (1 - score) * (SPARK_H - SPARK_PAD * 2)
}

function sparkX(index: number, length: number) {
  if (length <= 1) return SPARK_PAD
  return SPARK_PAD + (index / (length - 1)) * (SPARK_W - SPARK_PAD * 2)
}

function lastCrossingKind(history: MemoryHistoryPoint[]): 'archive' | 'reactivate' | null {
  for (let index = history.length - 1; index > 0; index--) {
    const previous = history[index - 1].score
    const current = history[index].score
    if (previous > ARCHIVE_THRESHOLD && current <= ARCHIVE_THRESHOLD) return 'archive'
    if (previous <= ARCHIVE_THRESHOLD && current > ARCHIVE_THRESHOLD) return 'reactivate'
  }
  return null
}

function Sparkline({ entity }: { entity: MemoryStatusEntity }) {
  const meta = LIFECYCLE_META[entity.lifecycle] || LIFECYCLE_META.active
  const thresholdY = sparkY(ARCHIVE_THRESHOLD)
  const crossing = lastCrossingKind(entity.history)

  return (
    <svg data-testid={`decay-sparkline-${entity.id}`} className={styles.spark} viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} preserveAspectRatio="none" aria-hidden="true">
      <line data-testid={`decay-threshold-${entity.id}`} x1={0} y1={thresholdY} x2={SPARK_W} y2={thresholdY} stroke="var(--muted-3)" strokeWidth={1} strokeDasharray="3 2" />
      {entity.history.length === 1 ? (
        <circle data-testid={`decay-dot-${entity.id}`} cx={sparkX(0, 1)} cy={sparkY(entity.history[0].score)} r={2.5} fill={meta.color} />
      ) : (
        <polyline
          data-testid={`decay-polyline-${entity.id}`}
          points={entity.history.map((point, index) => `${sparkX(index, entity.history.length)},${sparkY(point.score)}`).join(' ')}
          fill="none"
          stroke={meta.color}
          strokeWidth={2}
        />
      )}
      {crossing && (
        <text data-testid={`decay-marker-${entity.id}-${crossing}`} x={SPARK_W - 2} y={8} textAnchor="end" fontSize={10} fill={meta.color}>{crossing === 'archive' ? '▼' : '▲'}</text>
      )}
    </svg>
  )
}

interface EntityRelevanceListProps {
  entities: MemoryStatusEntity[]
  emptyMessage?: string
}

export default function EntityRelevanceList({
  entities,
  emptyMessage = 'No entity lifecycle data yet. Quill shows this after it has tracked story entities.',
}: EntityRelevanceListProps) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<LifecycleFilter>('all')
  const [showAll, setShowAll] = useState(false)

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return entities
      .filter((entity) => filter === 'all' || entity.lifecycle === filter)
      .filter((entity) => !normalizedQuery || entity.name.toLowerCase().includes(normalizedQuery))
      .sort((a, b) => b.relevance_score - a.relevance_score)
  }, [entities, filter, query])

  if (entities.length === 0) return <p className={styles.emptyPlaceholder}>{emptyMessage}</p>

  const visible = showAll ? filtered : filtered.slice(0, DEFAULT_VISIBLE)
  const hiddenCount = filtered.length - visible.length

  return (
    <div className={styles.wrap}>
      <div className={styles.controls}>
        <input
          type="search"
          className={styles.search}
          placeholder="Filter by name…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Filter entities by name"
        />
        <div className={styles.filterChips} role="group" aria-label="Filter by lifecycle">
          {LIFECYCLE_FILTERS.map((lifecycleFilter) => (
            <button
              key={lifecycleFilter}
              type="button"
              className={filter === lifecycleFilter ? styles.chipActive : styles.chip}
              onClick={() => setFilter(lifecycleFilter)}
            >
              {lifecycleFilter === 'all' ? 'All' : LIFECYCLE_META[lifecycleFilter]?.label ?? lifecycleFilter}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className={styles.emptyPlaceholder}>No entity matches this filter.</p>
      ) : (
        <ul className={styles.list} aria-label="Entity relevance, one row per entity">
          {visible.map((entity) => {
            const meta = LIFECYCLE_META[entity.lifecycle] || LIFECYCLE_META.active
            return (
              <li key={entity.id} className={styles.row}>
                <div className={styles.rowName}>
                  <span className={styles.dot} style={{ background: meta.color }} />
                  {entity.name}
                  <span className={styles.lifecycleLabel}>{meta.label}</span>
                </div>
                <Sparkline entity={entity} />
                <span className={styles.relevanceFigure}>{Math.round(entity.relevance_score * 100)}%</span>
              </li>
            )
          })}
        </ul>
      )}

      {hiddenCount > 0 && (
        <button type="button" className={styles.showAllBtn} onClick={() => setShowAll(true)}>
          Show all {filtered.length} ({hiddenCount} more)
        </button>
      )}
      {showAll && filtered.length > DEFAULT_VISIBLE && (
        <button type="button" className={styles.showAllBtn} onClick={() => setShowAll(false)}>
          Show top {DEFAULT_VISIBLE} only
        </button>
      )}
    </div>
  )
}
