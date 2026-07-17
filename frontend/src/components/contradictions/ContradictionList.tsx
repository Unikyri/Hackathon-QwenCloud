import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { api } from '../../lib/api'
import styles from './ContradictionList.module.css'

export interface Contradiction {
  id: string
  entity_id?: string
  severity: string
  description: string
  suggestion?: string
  evidence_a?: string
  evidence_a_chapter_id?: string
  evidence_b?: string
  evidence_b_chapter_id?: string
  status: string
}

interface ContradictionListProps {
  universeId: string
  contradictions: Contradiction[]
}

const SEVERITY_CLASS: Record<string, string> = {
  low: styles.severityLow,
  medium: styles.severityMedium,
  high: styles.severityHigh,
}

type LocalStatus = 'open' | 'resolved' | 'dismissed'

interface ActionError {
  id: string
  message: string
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return 'The request could not be completed. Please try again.'
}

export default function ContradictionList({ universeId, contradictions }: ContradictionListProps) {
  const [filter, setFilter] = useState<string>('all')
  const [statusOverride, setStatusOverride] = useState<Record<string, LocalStatus>>({})
  const [pendingResolveId, setPendingResolveId] = useState<string | null>(null)
  const [actingId, setActingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<ActionError | null>(null)
  const confirmResolveRef = useRef<HTMLButtonElement>(null)

  const filtered = useMemo(() => {
    return contradictions.filter((c) => {
      if (filter !== 'all' && c.severity !== filter) return false
      return true
    })
  }, [contradictions, filter])

  const performAction = async (id: string, action: 'resolve' | 'dismiss') => {
    if (actingId) return

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

  useEffect(() => {
    if (pendingResolveId) confirmResolveRef.current?.focus()
  }, [pendingResolveId])

  const severities = ['all', 'low', 'medium', 'high']

  return (
    <div>
      <div className={styles.filterBar}>
        {severities.map((s) => (
          <button
            key={s}
            className={`${styles.filterBtn} ${filter === s ? styles.filterBtnActive : ''}`}
            onClick={() => setFilter(s)}
            type="button"
            aria-pressed={filter === s}
          >
            {s === 'all' ? 'All' : s}
          </button>
        ))}
      </div>

      <div className={styles.listWrap}>
        {filtered.map((c) => {
          const status: LocalStatus = statusOverride[c.id] ?? (c.status as LocalStatus) ?? 'open'
          const isSettled = status !== 'open'
          const isActing = actingId === c.id
          return (
            <div key={c.id} className={`${styles.card} ${isSettled ? styles.cardResolved : ''}`}>
              <div className={styles.cardHeader}>
                <span className={`${styles.severity} ${SEVERITY_CLASS[c.severity] || styles.severityLow}`}>
                  {c.severity}
                </span>
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
