import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, TriangleAlert } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { type Contradiction } from '../components/contradictions/ContradictionList'
import styles from './ContradictionsPage.module.css'

const SEVERITIES = ['all', 'high', 'medium', 'low']

type LocalStatus = 'open' | 'resolved' | 'dismissed'

interface ActionError {
  id: string
  message: string
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return 'The request could not be completed. Please try again.'
}

export default function ContradictionsPage() {
  const { universeId } = useParams<{ universeId: string }>()
  const [contradictions, setContradictions] = useState<Contradiction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('all')
  const [statusOverride, setStatusOverride] = useState<Record<string, LocalStatus>>({})
  const [pendingResolveId, setPendingResolveId] = useState<string | null>(null)
  const [actingId, setActingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<ActionError | null>(null)
  const loadRequestId = useRef(0)
  const confirmResolveRef = useRef<HTMLButtonElement>(null)

  const loadContradictions = useCallback(async () => {
    if (!universeId) {
      setLoading(false)
      return
    }

    const requestId = ++loadRequestId.current
    setLoading(true)
    setError(null)
    setContradictions([])
    setStatusOverride({})
    setPendingResolveId(null)
    setActingId(null)
    setActionError(null)

    try {
      const { contradictions: raw } = await api.getContradictions(universeId)
      if (requestId !== loadRequestId.current) return
      setContradictions(raw || [])
    } catch (requestError) {
      if (requestId !== loadRequestId.current) return
      setError(errorMessage(requestError))
    } finally {
      if (requestId === loadRequestId.current) setLoading(false)
    }
  }, [universeId])

  useEffect(() => {
    void loadContradictions()
    return () => {
      loadRequestId.current += 1
    }
  }, [loadContradictions])

  useEffect(() => {
    if (pendingResolveId) confirmResolveRef.current?.focus()
  }, [pendingResolveId])

  const filtered = useMemo(() =>
    contradictions.filter((c) => filter === 'all' || c.severity === filter),
    [contradictions, filter]
  )

  const performAction = async (id: string, action: 'resolve' | 'dismiss') => {
    if (!universeId || actingId) return

    setActingId(id)
    setActionError(null)
    try {
      if (action === 'resolve') {
        await api.resolveContradiction(universeId, id)
      } else {
        await api.dismissContradiction(universeId, id)
      }
      setStatusOverride((current) => ({ ...current, [id]: action === 'resolve' ? 'resolved' : 'dismissed' }))
    } catch (requestError) {
      setActionError({
        id,
        message: `Could not ${action} this contradiction: ${errorMessage(requestError)} It is still open.`,
      })
    } finally {
      setActingId(null)
    }
  }

  const handleResolve = (id: string) => {
    setPendingResolveId(id)
    setActionError(null)
  }

  const handleDismiss = (id: string) => {
    void performAction(id, 'dismiss')
  }

  const confirmResolve = (id: string) => {
    setPendingResolveId(null)
    void performAction(id, 'resolve')
  }

  if (loading) return (
    <div className={styles.wrap} role="status" aria-live="polite" aria-label="Loading contradictions">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className={styles.card} style={{ marginBottom: 10 }}>
          <div className={`skeleton`} style={{ height: 10, width: '20%', borderRadius: 4, marginBottom: 10 }} />
          <div className={`skeleton`} style={{ height: 13, width: '85%', borderRadius: 4, marginBottom: 5 }} />
          <div className={`skeleton`} style={{ height: 13, width: '60%', borderRadius: 4 }} />
        </div>
      ))}
    </div>
  )

  if (error) return (
    <div className={styles.wrap}>
      <div className={styles.emptyState} role="alert">
        <TriangleAlert className={styles.emptyGlyph} aria-hidden="true" />
        <p className={styles.emptyTitle}>Could not load</p>
        <p className={styles.emptyText}>{error}</p>
        <button className={styles.retryBtn} type="button" onClick={() => void loadContradictions()}>
          Retry loading contradictions
        </button>
      </div>
    </div>
  )

  if (contradictions.length === 0) return (
    <div className={styles.wrap}>
      <div className={styles.emptyState}>
        <TriangleAlert className={styles.emptyGlyph} aria-hidden="true" />
        <p className={styles.emptyTitle}>No Contradictions</p>
        <p className={styles.emptyText}>
          No contradictions detected yet. AI analysis checks your entities and plot events for inconsistencies as you write.
        </p>
      </div>
    </div>
  )

  return (
    <div className={styles.wrap}>
      <div className={styles.filterBar}>
        {SEVERITIES.map((s) => (
          <button
            key={s}
            className={`${styles.filterBtn} ${filter === s ? styles.filterBtnActive : ''}`}
            onClick={() => setFilter(s)}
            type="button"
            aria-pressed={filter === s}
          >
            {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      <div className={styles.listWrap}>
        {filtered.map((c) => {
          const status: LocalStatus = statusOverride[c.id] ?? (c.status as LocalStatus) ?? 'open'
          const isSettled = status !== 'open'
          const isActing = actingId === c.id
          const sevClass = styles[`severity${c.severity.charAt(0).toUpperCase() + c.severity.slice(1)}` as keyof typeof styles] || styles.severityLow
          return (
            <div key={c.id} className={`${styles.card} ${isSettled ? styles.cardResolved : ''}`}>
              <div className={styles.cardHeader}>
                <span className={`${styles.severity} ${sevClass}`}>{c.severity.toUpperCase()}</span>
                {status === 'resolved' && <span className={styles.resolvedLabel}><CheckCircle2 aria-hidden="true" size={15} />Resolved</span>}
                {status === 'dismissed' && <span className={styles.dismissedLabel}>Dismissed — marked intentional.</span>}
                {status === 'open' && (
                  pendingResolveId === c.id ? (
                    <div className={styles.confirmation} role="group" aria-label={`Resolve contradiction: ${c.description}`}>
                      <span>Mark as resolved?</span>
                      <button ref={confirmResolveRef} className={styles.resolveBtn} type="button" onClick={() => confirmResolve(c.id)}>Confirm resolve</button>
                      <button className={styles.dismissBtn} type="button" onClick={() => setPendingResolveId(null)}>Cancel</button>
                    </div>
                  ) : (
                    <div className={styles.actions}>
                      <button className={styles.resolveBtn} type="button" disabled={isActing} onClick={() => handleResolve(c.id)}>{isActing ? 'Saving…' : 'Resolve'}</button>
                      <button className={styles.dismissBtn} type="button" disabled={isActing} onClick={() => handleDismiss(c.id)}>{isActing ? 'Saving…' : 'Dismiss'}</button>
                    </div>
                  )
                )}
              </div>

              {actionError?.id === c.id && <p className={styles.resolveError} role="alert">{actionError.message} Try again when you are ready.</p>}

              <p className={styles.cardMessage}>{c.description}</p>

              {(c.evidence_a || c.evidence_b) && (
                <div className={styles.evidenceGrid}>
                  {c.evidence_a && (
                    <div className={styles.evidencePanel}>
                      <p className={styles.evidenceQuote}>&ldquo;{c.evidence_a}&rdquo;</p>
                      {c.evidence_a_chapter_id && <span className={styles.evidenceTag}>Ch. {c.evidence_a_chapter_id.slice(0, 8)}</span>}
                    </div>
                  )}
                  {c.evidence_b && (
                    <div className={styles.evidencePanel}>
                      <p className={styles.evidenceQuote}>&ldquo;{c.evidence_b}&rdquo;</p>
                      {c.evidence_b_chapter_id && <span className={styles.evidenceTag}>Ch. {c.evidence_b_chapter_id.slice(0, 8)}</span>}
                    </div>
                  )}
                </div>
              )}

              {c.suggestion && (
                <div className={styles.suggestionBox}>
                  <div className={styles.suggestionKicker}>Suggestion</div>
                  <div className={styles.suggestionText}>{c.suggestion}</div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
