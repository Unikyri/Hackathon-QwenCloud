import { useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'
import type { EntityCandidateDTO } from '../../lib/types'
import styles from './EntityCandidateTray.module.css'

interface EntityCandidateTrayProps {
  candidates: EntityCandidateDTO[]
  universeId: string
  error?: string | null
  onChanged: () => Promise<void> | void
  onDecision?: (candidateId: string) => void
}

interface ActiveEntity {
  id: string
  name: string
  type?: string
}

type CandidateAction = 'accept' | 'dismiss' | 'merge'

type RetryAction =
  | { kind: 'decision'; candidate: EntityCandidateDTO; action: CandidateAction }
  | { kind: 'refresh'; candidateId: string }

interface TrayFeedback {
  message: string
  tone: 'success' | 'error'
  retry?: RetryAction
}

export default function EntityCandidateTray({ candidates, universeId, error, onChanged, onDecision }: EntityCandidateTrayProps) {
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<TrayFeedback | null>(null)
  const [activeEntities, setActiveEntities] = useState<ActiveEntity[]>([])
  const [activeEntitiesError, setActiveEntitiesError] = useState<string | null>(null)
  const [activeEntitiesRetry, setActiveEntitiesRetry] = useState(0)
  const [mergeTargets, setMergeTargets] = useState<Record<string, string>>({})
  const activeEntitiesRef = useRef<ActiveEntity[]>([])
  const activeEntitiesUniverseRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!universeId || typeof api.listEntities !== 'function') {
      activeEntitiesUniverseRef.current = universeId || null
      activeEntitiesRef.current = []
      setActiveEntities([])
      setActiveEntitiesError(null)
      return () => { cancelled = true }
    }
    if (activeEntitiesUniverseRef.current !== universeId) {
      activeEntitiesUniverseRef.current = universeId
      activeEntitiesRef.current = []
      setActiveEntities([])
    }
    setActiveEntitiesError(null)
    api.listEntities(universeId, { status: 'active', limit: '500', page: '1' })
      .then(({ entities }) => {
        if (cancelled) return
        const nextActiveEntities = (entities || []).map((entity: ActiveEntity) => ({ id: entity.id, name: entity.name, type: entity.type }))
        activeEntitiesRef.current = nextActiveEntities
        setActiveEntities(nextActiveEntities)
      })
      .catch(() => {
        if (cancelled) return
        setActiveEntitiesError(
          activeEntitiesRef.current.length > 0
            ? 'Could not refresh active entities. Showing last-known merge options.'
            : 'Could not load active entities. Merge is unavailable until this succeeds.',
        )
      })
    return () => { cancelled = true }
  }, [universeId, activeEntitiesRetry])

  const refreshCandidates = async (candidateId: string) => {
    setPendingId(candidateId)
    setFeedback(null)
    try {
      await onChanged()
      onDecision?.(candidateId)
      setFeedback({ message: 'Candidate list refreshed.', tone: 'success' })
    } catch {
      setFeedback({
        message: 'The decision was saved, but the candidate list could not be refreshed. Showing the previous list.',
        tone: 'error',
        retry: { kind: 'refresh', candidateId },
      })
    } finally {
      setPendingId(null)
    }
  }

  const decide = async (candidate: EntityCandidateDTO, action: CandidateAction) => {
    if (!candidate.entity_id || pendingId) return
    const targetEntityId = mergeTargets[candidate.entity_id]
    if (action === 'merge' && !targetEntityId) {
      setFeedback({ message: 'Choose an active entity before merging.', tone: 'error' })
      return
    }
    setPendingId(candidate.entity_id)
    setFeedback(null)
    try {
      if (action === 'accept') await api.acceptEntityCandidate(candidate.entity_id)
      else if (action === 'dismiss') await api.dismissEntityCandidate(candidate.entity_id)
      else await api.mergeEntityCandidate(candidate.entity_id, targetEntityId)
    } catch {
      setFeedback({
        message: 'Could not save this candidate decision. Retry to try again.',
        tone: 'error',
        retry: { kind: 'decision', candidate, action },
      })
      setPendingId(null)
      return
    }

    try {
      await onChanged()
    } catch {
      setFeedback({
        message: 'The decision was saved, but the candidate list could not be refreshed. Showing the previous list.',
        tone: 'error',
        retry: { kind: 'refresh', candidateId: candidate.entity_id },
      })
      setPendingId(null)
      return
    }

    setPendingId(null)
    onDecision?.(candidate.entity_id)
    setFeedback({
      message: action === 'accept' ? 'Candidate accepted.' : action === 'merge' ? 'Candidate merged.' : 'Candidate dismissed.',
      tone: 'success',
    })
  }

  const retryFeedback = () => {
    if (!feedback?.retry) return
    if (feedback.retry.kind === 'decision') {
      void decide(feedback.retry.candidate, feedback.retry.action)
      return
    }
    void refreshCandidates(feedback.retry.candidateId)
  }

  return (
    <section className={styles.tray} aria-label="Entity candidate review tray">
      <div className={styles.header}>
        <div>
          <span className={styles.kicker}>Human confirmation</span>
          <h3 className={styles.title}>Entity candidates</h3>
        </div>
        <span className={styles.count}>{candidates.length}</span>
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {activeEntitiesError && (
        <p className={styles.error} role="alert">
          {activeEntitiesError}{' '}
          <button className={styles.retryButton} type="button" onClick={() => setActiveEntitiesRetry((attempt) => attempt + 1)}>
            Retry
          </button>
        </p>
      )}
      {feedback && (
        <p className={feedback.tone === 'error' ? styles.error : styles.message} role={feedback.tone === 'error' ? 'alert' : 'status'}>
          {feedback.message}
          {feedback.retry && (
            <>
              {' '}
              <button className={styles.retryButton} type="button" onClick={retryFeedback}>Retry</button>
            </>
          )}
        </p>
      )}
      {candidates.length === 0 ? (
        <p className={styles.empty}>No low-confidence candidates are waiting.</p>
      ) : (
        <div className={styles.list}>
          {candidates.map((candidate) => {
            const id = candidate.entity_id
            return (
              <article className={styles.candidate} key={id}>
                <div className={styles.candidateHeader}>
                  <strong>{candidate.name}</strong>
                  <span className={styles.type}>{candidate.type}</span>
                  <span className={styles.confidence}>{Math.round(candidate.confidence * 100)}%</span>
                </div>
                {candidate.evidence_quote && <blockquote>{candidate.evidence_quote}</blockquote>}
                {candidate.description && <p className={styles.description}>{candidate.description}</p>}
                <div className={styles.actions}>
                  <button type="button" onClick={() => void decide(candidate, 'accept')} disabled={pendingId !== null}>
                    {pendingId === id ? 'Saving…' : 'Accept'}
                  </button>
                  <button type="button" className={styles.dismiss} onClick={() => void decide(candidate, 'dismiss')} disabled={pendingId !== null}>
                    Dismiss
                  </button>
                  <select
                    aria-label={`Merge ${candidate.name} into active entity`}
                    value={mergeTargets[id] || ''}
                    onChange={(event) => setMergeTargets((current) => ({ ...current, [id]: event.target.value }))}
                    disabled={pendingId !== null || activeEntities.length === 0}
                  >
                    <option value="">Merge into…</option>
                    {activeEntities.filter((entity) => entity.id !== id).map((entity) => (
                      <option key={entity.id} value={entity.id}>{entity.name}</option>
                    ))}
                  </select>
                  <button type="button" onClick={() => void decide(candidate, 'merge')} disabled={pendingId !== null || !mergeTargets[id]}>
                    Merge
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}
      {universeId && <span className={styles.srOnly}>Universe {universeId}</span>}
    </section>
  )
}
