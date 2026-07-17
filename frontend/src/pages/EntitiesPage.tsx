import { useEffect, useState, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { parseVertexRaw } from '../lib/graphParse'
import { ENTITY_TYPES, ENTITY_TYPE_META, type EntityType } from '../lib/entityTypes'
import PageStatus from '../components/shared/PageStatus'
import styles from './EntitiesPage.module.css'

interface EntitySummary {
  id: string; name: string; type: string; aliases?: string[]
}

interface Entity {
  id: string; universe_id: string; type: string; name: string
  aliases?: string[]; description?: string; properties?: Record<string, unknown>
  status: string; relevance_score: number
}

interface RelatedEntity {
  id: string; name: string; type: string; relation?: string
}

function getInitial(name: string) { return (name || '?').charAt(0).toUpperCase() }

const ENTITY_PAGE_SIZE = 100
const TYPE_FILTERS = ['All', ...ENTITY_TYPES] as const

function emptyTypeCounts(): Record<EntityType, number> {
  return Object.fromEntries(ENTITY_TYPES.map((type) => [type, 0])) as Record<EntityType, number>
}

// ── Entity detail panel ──────────────────────────────────────────────────────
function EntityDetail({ entityId, universeId }: { entityId: string; universeId: string }) {
  const navigate = useNavigate()
  const [entity, setEntity] = useState<Entity | null>(null)
  const [related, setRelated] = useState<RelatedEntity[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [relatedError, setRelatedError] = useState<string | null>(null)
  const [entityRetry, setEntityRetry] = useState(0)
  const [relatedRetry, setRelatedRetry] = useState(0)

  useEffect(() => {
    if (!entityId) {
      setLoading(false)
      setEntity(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    setEntity(null)
    setRelated([])
    setRelatedError(null)
    api.getEntity(entityId)
      .then((res: { entity: Entity }) => {
        if (cancelled) return
        setEntity(res.entity)
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setError('Could not load this entity. Retry to try again.')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [entityId, entityRetry])

  useEffect(() => {
    if (!entity) return
    let cancelled = false
    setRelatedError(null)
    api.getEntityNeighbors(entity.id, entity.universe_id)
      .then((graph) => {
        if (cancelled) return
        const others = graph.nodes
          .map((node) => parseVertexRaw(String(node.properties?.raw || '')))
          .filter((vertex) => vertex.entityId && vertex.entityId !== entity.id)
        setRelated(others.map((vertex) => ({ id: vertex.entityId, name: vertex.name, type: vertex.type })))
      })
      .catch(() => {
        if (!cancelled) setRelatedError('Could not load direct relations. Retry to try again.')
      })
    return () => { cancelled = true }
  }, [entity?.id, entity?.universe_id, relatedRetry])

  if (loading) return <PageStatus loading />
  if (error) return <PageStatus error={error} onRetry={() => setEntityRetry((attempt) => attempt + 1)} />
  if (!entity) return null

  const meta = ENTITY_TYPE_META[entity.type as keyof typeof ENTITY_TYPE_META] || ENTITY_TYPE_META.character
  const relevancePct = Math.min(100, Math.round((entity.relevance_score ?? 0) * 100))
  const properties = entity.properties || {}
  const propEntries = Object.entries(properties).filter(([, v]) => v !== null && v !== undefined)

  return (
    <>
      {/* Main detail card */}
      <div className={styles.detailCard}>
        <div className={styles.detailHeaderRow}>
          <div className={styles.portraitBox}>
            <span className={styles.portraitGlyph}>⊕</span>
            <span>Add portrait</span>
          </div>
          <div className={styles.detailHeaderInfo}>
            <div className={styles.detailNameRow}>
              <h2 className={styles.detailName}>{entity.name}</h2>
              <span className={`glyph ${styles.editIcon}`} title="Edit name">✎</span>
            </div>
            {entity.aliases && entity.aliases.length > 0 && (
              <div className={styles.aliasTags}>
                {entity.aliases.map((a) => (
                  <span key={a} className={styles.aliasTag}>{a}</span>
                ))}
              </div>
            )}
            <span
              className={styles.typeBadge}
              style={{ background: `${meta.color}18`, color: meta.color, border: `1px solid ${meta.color}30` }}
            >
              {meta.label.toUpperCase()}
            </span>
          </div>
        </div>

        {entity.description && (
          <p className={styles.detailDescription}>{entity.description}</p>
        )}

        {propEntries.length > 0 && (
          <div className={styles.propertiesGrid}>
            {propEntries.slice(0, 6).map(([key, val]) => (
              <div key={key} className={styles.propertyTile}>
                <div className={styles.propertyLabel}>{key}</div>
                <div className={styles.propertyValue}>{String(val)}</div>
              </div>
            ))}
            <button className={styles.addPropertyBtn} title="Add property">+</button>
          </div>
        )}
      </div>

      {/* Relevance */}
      <div className={styles.relevanceCard}>
        <div className={styles.relevanceHeader}>
          <span className={styles.relevanceTitle}>Relevance</span>
          <span className={styles.relevanceScore}>{relevancePct}</span>
        </div>
        <div className={styles.relevanceBar}>
          <div className={styles.relevanceFill} style={{ width: `${relevancePct}%`, background: meta.color }} />
        </div>
        <p className={styles.relevanceNote}>How central this entity is to the universe, according to AI.</p>
      </div>

      {/* Relations */}
      {related.length > 0 && (
        <div className={styles.relationsCard}>
          <div className={styles.relationsHeader}>
            <span className={styles.relationsTitle}>Direct Relations</span>
            <span
              className={styles.relationsLink}
              role="button" tabIndex={0}
              onClick={() => navigate(`/universe/${universeId}/graph`)}
            >
              View graph →
            </span>
          </div>
          <div className={styles.relationChips}>
            {related.map((r) => (
              <span
                key={r.id}
                className={styles.relationChip}
                role="button" tabIndex={0}
                onClick={() => navigate(`/universe/${universeId}/entities/${r.id}`)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate(`/universe/${universeId}/entities/${r.id}`) }}
              >
                {r.name}
                <span style={{ color: 'var(--muted-3)', marginLeft: 4, fontSize: 10 }}>
                  ({ENTITY_TYPE_META[r.type as keyof typeof ENTITY_TYPE_META]?.label || r.type})
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
      {relatedError && (
        <div className={`${styles.relationsCard} ${styles.relationError}`} role="alert">
          <p>
            {relatedError}{' '}
            <button className={styles.relationRetry} type="button" onClick={() => setRelatedRetry((attempt) => attempt + 1)}>Retry</button>
          </p>
        </div>
      )}
    </>
  )
}

// ── Main split-pane component ────────────────────────────────────────────────
export default function EntitiesPage() {
  const { universeId, entityId: paramEntityId } = useParams<{ universeId: string; entityId?: string }>()
  const navigate = useNavigate()

  const [entities, setEntities] = useState<EntitySummary[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)
  const [listRetry, setListRetry] = useState(0)
  const [filteredTotal, setFilteredTotal] = useState(0)
  const [countsByType, setCountsByType] = useState<Record<EntityType, number>>(emptyTypeCounts)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('All')
  const [selectedId, setSelectedId] = useState<string | null>(paramEntityId || null)
  const queryKey = `${universeId ?? ''}\u0000${filter}\u0000${search.trim()}`
  const activeQueryKey = useRef(queryKey)
  activeQueryKey.current = queryKey

  useEffect(() => {
    if (!universeId) return
    let cancelled = false
    setEntities([])
    setFilteredTotal(0)
    setCountsByType(emptyTypeCounts())
    setLoading(true)
    setLoadingMore(false)
    setListError(null)
    setLoadMoreError(null)

    const params: Record<string, string> = { limit: String(ENTITY_PAGE_SIZE), page: '1' }
    if (filter !== 'All') params.type = filter
    if (search.trim()) params.search = search.trim()

    void api.listEntities(universeId, params)
      .then((res) => {
        if (cancelled) return
        const nextEntities = res.entities || []
        setEntities(nextEntities)
        setFilteredTotal(res.pagination?.total ?? nextEntities.length)
        setCountsByType({ ...emptyTypeCounts(), ...(res.counts_by_type || {}) })
      })
      .catch(() => {
        if (!cancelled) setListError('Could not load entities for this universe. Retry to try again.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [universeId, filter, search, listRetry])

  const loadMore = async () => {
    if (!universeId || loadingMore) return
    const requestQueryKey = queryKey
    setLoadingMore(true)
    setLoadMoreError(null)

    const params: Record<string, string> = {
      limit: String(ENTITY_PAGE_SIZE),
      page: String(Math.floor(entities.length / ENTITY_PAGE_SIZE) + 1),
    }
    if (filter !== 'All') params.type = filter
    if (search.trim()) params.search = search.trim()

    try {
      const res = await api.listEntities(universeId, params)
      if (activeQueryKey.current !== requestQueryKey) return
      setEntities((current) => [...current, ...(res.entities || [])])
      setFilteredTotal(res.pagination?.total ?? filteredTotal)
    } catch {
      if (activeQueryKey.current === requestQueryKey) {
        setLoadMoreError('Could not load more entities. Showing the results already loaded.')
      }
    } finally {
      if (activeQueryKey.current === requestQueryKey) setLoadingMore(false)
    }
  }

  // Sync URL param
  useEffect(() => {
    if (paramEntityId && paramEntityId !== selectedId) setSelectedId(paramEntityId)
  }, [paramEntityId]) // eslint-disable-line react-hooks/exhaustive-deps

  const allEntityCount = useMemo(
    () => Object.values(countsByType).reduce((sum, count) => sum + count, 0),
    [countsByType],
  )

  const handleSelect = (id: string) => {
    setSelectedId(id)
    navigate(`/universe/${universeId}/entities/${id}`, { replace: true })
  }

  return (
    <div className={styles.wrap}>
      {/* List rail */}
      <div className={`${styles.listRail} q-scroll`}>
        <div className={styles.searchBar}>
          <input
            className={styles.searchInput}
            placeholder="Search entity or alias…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className={styles.filterChips}>
          {TYPE_FILTERS.map((f) => (
            <button
              key={f}
              className={`${styles.filterChip} ${filter === f ? styles.filterChipActive : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'All'
                ? `All (${allEntityCount})`
                : `${ENTITY_TYPE_META[f].label}s (${countsByType[f]})`}
            </button>
          ))}
        </div>

        <div className={styles.entityList}>
          {listError ? (
            <PageStatus error={listError} onRetry={() => setListRetry((attempt) => attempt + 1)} />
          ) : loading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className={styles.entityListItem}>
                <div className={`skeleton ${styles.entityAvatar}`} style={{ background: 'var(--surface-sunken)' }} />
                <div style={{ flex: 1 }}>
                  <div className={`skeleton`} style={{ height: 11, width: '65%', borderRadius: 4, marginBottom: 4 }} />
                  <div className={`skeleton`} style={{ height: 8, width: '40%', borderRadius: 4 }} />
                </div>
              </div>
            ))
          ) : entities.length === 0 ? (
            <p style={{ padding: 16, fontSize: 12.5, color: 'var(--muted)', textAlign: 'center', fontStyle: 'italic' }}>
              No entities found.
            </p>
          ) : (
            <>
              {entities.map((e) => {
                const meta = ENTITY_TYPE_META[e.type as keyof typeof ENTITY_TYPE_META] || ENTITY_TYPE_META.character
                return (
                <div
                  key={e.id}
                  className={`${styles.entityListItem} ${selectedId === e.id ? styles.entityListItemActive : ''}`}
                  role="button" tabIndex={0}
                  onClick={() => handleSelect(e.id)}
                  onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') handleSelect(e.id) }}
                >
                  <div className={styles.entityAvatar} style={{ background: meta.color }}>
                    {getInitial(e.name)}
                  </div>
                  <div className={styles.entityItemInfo}>
                    <div className={styles.entityItemName}>{e.name}</div>
                    <div className={styles.entityItemType} style={{ color: meta.color }}>
                      {meta.label.toUpperCase()}
                    </div>
                  </div>
                </div>
                )
              })}
              {entities.length < filteredTotal && (
                <button className={styles.loadMoreButton} onClick={() => void loadMore()} disabled={loadingMore}>
                  {loadingMore ? 'Loading…' : `Load more (${entities.length} of ${filteredTotal})`}
                </button>
              )}
              {loadMoreError && (
                <p className={styles.loadMoreError} role="status">
                  {loadMoreError}{' '}
                  <button type="button" onClick={() => void loadMore()}>Retry</button>
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Detail panel */}
      <div className={`${styles.detailPanel} q-scroll`}>
        {selectedId && universeId ? (
          <EntityDetail entityId={selectedId} universeId={universeId} />
        ) : (
          <div className={styles.emptyDetail}>
            <span className={`glyph ${styles.emptyGlyph}`}>○</span>
            <p className={styles.emptyText}>Select an entity to view its details</p>
          </div>
        )}
      </div>
    </div>
  )
}
