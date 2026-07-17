import { useContext, useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { UniverseContext } from '../contexts/UniverseContext'
import { api } from '../lib/api'
import { ENTITY_TYPE_META } from '../lib/entityTypes'
import PageStatus from '../components/shared/PageStatus'
import styles from './PanoramaPage.module.css'

interface EntitySummary { id: string; name: string; type: string }
interface TimelineEvent { id: string; label: string; timestamp: string; description: string }
interface Contradiction { id: string; description: string; severity: string; status: string }
interface PlotHole { id: string; description: string }
interface LatestChapter { id: string; title: string; word_count: number; work_title?: string; updated_at?: string }

export default function PanoramaPage() {
  const { universeId } = useParams<{ universeId: string }>()
  const navigate = useNavigate()
  const { works } = useContext(UniverseContext)

  const [entityCount, setEntityCount] = useState(0)
  const [recentEntities, setRecentEntities] = useState<EntitySummary[]>([])
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [contradictionCount, setContradictionCount] = useState(0)
  const [topContradictions, setTopContradictions] = useState<Contradiction[]>([])
  const [plotHoleCount, setPlotHoleCount] = useState(0)
  const [topPlotHoles, setTopPlotHoles] = useState<PlotHole[]>([])
  const [latestChapter, setLatestChapter] = useState<LatestChapter | null>(null)
  const [loading, setLoading] = useState(true)
  const [overviewError, setOverviewError] = useState<string | null>(null)
  const [overviewRetry, setOverviewRetry] = useState(0)
  const [overviewUniverse, setOverviewUniverse] = useState<string | null>(null)
  const overviewUniverseRef = useRef<string | null>(null)
  const [latestChapterError, setLatestChapterError] = useState<string | null>(null)
  const [latestChapterRetry, setLatestChapterRetry] = useState(0)
  const [latestChapterWork, setLatestChapterWork] = useState<string | null>(null)
  const latestChapterWorkRef = useRef<string | null>(null)
  const firstWork = works[0]

  useEffect(() => {
    if (!universeId) {
      setLoading(false)
      setOverviewError('This panorama link is missing a universe.')
      return
    }
    let cancelled = false
    const hasCurrentOverview = overviewUniverseRef.current === universeId
    setLoading(true)
    setOverviewError(null)

    Promise.all([
      api.listEntities(universeId, { limit: '4' }),
      api.getTimeline(universeId),
      api.getContradictions(universeId),
      api.getPlotHoles(universeId),
    ])
      .then(([entRes, tlRes, contraRes, phRes]) => {
        if (cancelled) return
        setEntityCount(entRes.pagination?.total ?? entRes.entities.length)
        setRecentEntities(entRes.entities)
        setEvents(tlRes.events || [])
        const contras = contraRes.contradictions || []
        setContradictionCount(contras.length)
        setTopContradictions(contras.slice(0, 2))
        const holes = phRes.plot_holes || []
        setPlotHoleCount(holes.length)
        setTopPlotHoles((holes as Array<{ id: string; description: string }>).slice(0, 1))
        overviewUniverseRef.current = universeId
        setOverviewUniverse(universeId)
      })
      .catch(() => {
        if (cancelled) return
        setOverviewError(
          hasCurrentOverview
            ? 'Could not refresh the panorama. Showing last-known data.'
            : 'Could not load the panorama. Retry to try again.',
        )
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [universeId, overviewRetry])

  useEffect(() => {
    if (!firstWork) {
      latestChapterWorkRef.current = null
      setLatestChapterWork(null)
      setLatestChapter(null)
      setLatestChapterError(null)
      return
    }
    let cancelled = false
    const hasCurrentChapter = latestChapterWorkRef.current === firstWork.id
    if (!hasCurrentChapter) setLatestChapter(null)
    setLatestChapterError(null)
    api.listChapters(firstWork.id)
      .then((res) => {
        if (cancelled) return
        const chapters = res.chapters || []
        const sorted = [...chapters].sort((a, b) =>
          new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()
        )
        const last = sorted[0]
        setLatestChapter(
          last
            ? { id: last.id, title: last.title, word_count: last.word_count, work_title: firstWork.title, updated_at: last.updated_at }
            : null
        )
        latestChapterWorkRef.current = firstWork.id
        setLatestChapterWork(firstWork.id)
      })
      .catch(() => {
        if (cancelled) return
        setLatestChapterError(
          hasCurrentChapter
            ? 'Could not refresh the latest chapter. Showing the last-known result.'
            : 'Could not load the latest chapter. Retry to continue writing.',
        )
      })
    return () => { cancelled = true }
  }, [works, latestChapterRetry])

  const totalFindings = topContradictions.length + topPlotHoles.length
  const hasCurrentOverview = overviewUniverse === universeId
  const hasCurrentLatestChapter = latestChapterWork === firstWork?.id

  if (overviewError && !hasCurrentOverview) {
    return <PageStatus error={overviewError} onRetry={universeId ? () => setOverviewRetry((attempt) => attempt + 1) : undefined} />
  }

  return (
    <div className={styles.wrap}>
      {overviewError && hasCurrentOverview && (
        <div className={styles.degradedNotice} role="status">
          <span>{overviewError}</span>
          <button className={styles.degradedRetry} type="button" onClick={() => setOverviewRetry((attempt) => attempt + 1)}>Retry</button>
        </div>
      )}
      {/* Stat row */}
      <div className={styles.statGrid}>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{loading ? '—' : entityCount}</div>
          <div className={styles.statLabel}>Entities</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{loading ? '—' : events.length}</div>
          <div className={styles.statLabel}>Events</div>
        </div>
        <div className={styles.statCard}>
          <div className={loading ? styles.statValue : styles.statValueDanger}>{loading ? '—' : contradictionCount}</div>
          <div className={loading ? styles.statLabel : styles.statLabelDanger}>Contradictions</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{loading ? '—' : plotHoleCount}</div>
          <div className={styles.statLabel}>Plot Holes</div>
        </div>
      </div>

      {/* Continue / empty banner */}
      {latestChapterError && hasCurrentLatestChapter && (
        <div className={styles.degradedNotice} role="status">
          <span>{latestChapterError}</span>
          <button className={styles.degradedRetry} type="button" onClick={() => setLatestChapterRetry((attempt) => attempt + 1)}>Retry</button>
        </div>
      )}
      {latestChapterError && !hasCurrentLatestChapter ? (
        <div className={styles.ingestCard} role="alert">
          <p className={styles.ingestText}>
            {latestChapterError}{' '}
            <button className={styles.degradedRetry} type="button" onClick={() => setLatestChapterRetry((attempt) => attempt + 1)}>Retry</button>
          </p>
        </div>
      ) : latestChapter ? (
        <div className={styles.continueBanner}>
          <div>
            <div className={styles.continueKicker}>Continue where you left off</div>
            <div className={styles.continueTitle}>
              {latestChapter.work_title ? `${latestChapter.work_title} — ` : ''}{latestChapter.title}
            </div>
            <div className={styles.continueMeta}>{latestChapter.word_count.toLocaleString()} words</div>
          </div>
          <button
            className={styles.continueBtn}
            onClick={() => navigate(`/universe/${universeId}/editor/${latestChapter.id}`)}
          >
            Continue writing →
          </button>
        </div>
      ) : (
        <div className={styles.ingestCard}>
          <p className={styles.ingestText}>
            {firstWork
              ? 'No chapters yet. Create or import a chapter to begin writing.'
              : <><span>No active work. </span><strong>Import a manuscript</strong> to get started or create a new work.</>}
          </p>
        </div>
      )}

      {/* Two-column grid */}
      <div className={styles.columns}>
        {/* Left: entities + timeline */}
        <div className={styles.mainCol}>
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <span className={styles.cardTitle}>Recent Entities</span>
              <span
                role="button"
                tabIndex={0}
                className={styles.cardLink}
                onClick={() => navigate(`/universe/${universeId}/entities`)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate(`/universe/${universeId}/entities`) }}
              >
                View the encyclopedia →
              </span>
            </div>
            {loading ? (
              <div className={styles.entityGrid}>
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className={styles.entityRow}>
                    <div className={`${styles.entitySwatch} skeleton`} />
                    <div style={{ flex: 1 }}>
                      <div className={`skeleton ${styles.skRow}`} style={{ width: '70%' }} />
                      <div className={`skeleton ${styles.skRow}`} style={{ width: '40%', height: '9px' }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : recentEntities.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', padding: '12px 0' }}>
                No entities yet. Ingest a manuscript to populate the encyclopedia.
              </p>
            ) : (
              <div className={styles.entityGrid}>
                {recentEntities.map((entity) => {
                  const meta = ENTITY_TYPE_META[entity.type as keyof typeof ENTITY_TYPE_META] || ENTITY_TYPE_META.character
                  return (
                    <div
                      key={entity.id}
                      className={styles.entityRow}
                      role="button"
                      tabIndex={0}
                      style={{ cursor: 'pointer' }}
                      onClick={() => navigate(`/universe/${universeId}/entities/${entity.id}`)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate(`/universe/${universeId}/entities/${entity.id}`) }}
                    >
                      <span className={styles.entitySwatch} style={{ background: meta.color }} />
                      <div>
                        <div className={styles.entityName}>{entity.name}</div>
                        <div className={styles.entityType} style={{ color: meta.color }}>{meta.label.toUpperCase()}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <span className={styles.cardTitle}>Timeline</span>
              <span
                role="button"
                tabIndex={0}
                className={styles.cardLink}
                onClick={() => navigate(`/universe/${universeId}/timeline`)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate(`/universe/${universeId}/timeline`) }}
              >
                View full timeline →
              </span>
            </div>
            {loading ? (
              <div className={styles.timelineList}>
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className={styles.timelineItem}>
                    <div className={styles.timelineDot} style={{ background: 'var(--muted-3)' }} />
                    <div style={{ flex: 1 }}>
                      <div className={`skeleton ${styles.skRow}`} style={{ width: '35%', height: '9px' }} />
                      <div className={`skeleton ${styles.skRow}`} style={{ width: '80%' }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : events.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', padding: '12px 0' }}>
                No timeline events detected yet.
              </p>
            ) : (
              <div className={styles.timelineList}>
                {events.slice(0, 3).map((event, i) => (
                  <div key={event.id || i} className={styles.timelineItem}>
                    <div className={styles.timelineDot} />
                    <div className={styles.timelineContent}>
                      <div className={styles.timelineEra}>{event.timestamp}</div>
                      <div className={styles.timelineLabel}>{event.label}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: AI panel (always visible) + ingestion */}
        <div className={styles.sideCol}>
          <div className={styles.aiCard}>
            <div className={styles.aiCardHeader}>
              <span className="glyph" style={{ color: 'var(--warning)', fontSize: 14 }}>△</span>
              <span className={styles.aiTitle}>Detected by AI</span>
            </div>
            <div className={styles.aiSubtitle}>Quill analyzed your latest chapters.</div>

            {loading ? (
              <>
                <div className={`skeleton ${styles.skRow}`} style={{ height: 64, marginBottom: 8 }} />
                <div className={`skeleton ${styles.skRow}`} style={{ height: 48 }} />
              </>
            ) : topContradictions.length === 0 && topPlotHoles.length === 0 ? (
              <p style={{ fontSize: 12.5, color: 'var(--muted)', fontStyle: 'italic', padding: '8px 0' }}>
                No contradictions or loose threads detected yet. Write more chapters for AI to analyze.
              </p>
            ) : (
              <>
                {topContradictions.map((c) => (
                  <div key={c.id} className={styles.aiItem}>
                    <div className={styles.aiItemKicker}>Contradiction · {c.severity}</div>
                    <div className={styles.aiItemText}>{c.description}</div>
                  </div>
                ))}
                {topPlotHoles.map((p) => (
                  <div key={p.id} className={styles.looseItem}>
                    <div className={styles.looseItemKicker}>Plot Hole</div>
                    <div className={styles.looseItemText}>{p.description}</div>
                  </div>
                ))}
                {totalFindings > 0 && (
                  <span
                    role="button"
                    tabIndex={0}
                    className={styles.aiLink}
                    onClick={() => navigate(`/universe/${universeId}/contradictions`)}
                  >
                    Review all {totalFindings} findings →
                  </span>
                )}
              </>
            )}
          </div>

          {/* Ingestion card — always shown */}
          <div className={styles.ingestJobCard}>
            <div className={styles.ingestJobHeader}>
              <span className={styles.ingestJobTitle}>Ingestion</span>
              <span
                role="button"
                tabIndex={0}
                className={styles.ingestJobLink}
                onClick={() => navigate(`/universe/${universeId}/ingest`)}
              >
                View →
              </span>
            </div>
            {loading ? (
              <>
                <div className={`skeleton ${styles.skRow}`} style={{ height: 10, width: '60%', marginBottom: 8 }} />
                <div className={styles.ingestProgressTrack}>
                  <div className={`skeleton`} style={{ height: '100%', borderRadius: 'var(--r-pill)' }} />
                </div>
              </>
            ) : (
              <p style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic', padding: '4px 0' }}>
                No active ingestion. Upload a manuscript to extract entities and events.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
