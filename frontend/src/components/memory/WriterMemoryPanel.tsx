import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import type { WriterObservationDTO, WriterPreferenceDTO, WriterPreferenceEvidenceDTO } from '../../lib/types'
import styles from './WriterMemoryPanel.module.css'

interface Props { universeId: string }

export default function WriterMemoryPanel({ universeId }: Props) {
  const [preferences, setPreferences] = useState<WriterPreferenceDTO[]>([])
  const [observations, setObservations] = useState<WriterObservationDTO[]>([])
  const [universeGenres, setUniverseGenres] = useState<string[]>([])
  const [evidence, setEvidence] = useState<Record<string, WriterPreferenceEvidenceDTO>>({})
  const [expanded, setExpanded] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [result, universeResult] = await Promise.all([
        api.getWriterPreferences(),
        api.getUniverse(universeId),
      ])
      setPreferences(result.preferences || [])
      setObservations(result.observations || [])
      setUniverseGenres(universeResult.universe?.genre_tags || [])
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [universeId])

  const toggleEvidence = async (id: string) => {
    if (expanded === id) { setExpanded(null); return }
    try {
      const result = await api.getWriterPreferenceEvidence(id)
      setEvidence((current) => ({ ...current, [id]: result }))
      setExpanded(id)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const correctScope = async (preference: WriterPreferenceDTO) => {
    const nextScope = preference.scope === 'universal' ? 'genre_bound' : 'universal'
    const tags = nextScope === 'genre_bound' ? universeGenres : []
    if (nextScope === 'genre_bound' && tags.length === 0) {
      setError('This universe has no genre tags; add one before making the preference genre-bound.')
      return
    }
    try {
      const result = await api.correctWriterPreference(preference.id, { scope: nextScope, genre_tags: tags })
      setPreferences((current) => current.map((item) => item.id === preference.id ? result.preference : item))
    } catch (err) { setError((err as Error).message) }
  }

  const scopedObservations = observations.filter((item) => !item.universe_id || item.universe_id === universeId)

  const deactivate = async (id: string) => {
    try {
      await api.deactivateWriterPreference(id)
      setPreferences((current) => current.filter((item) => item.id !== id))
      setExpanded((current) => current === id ? null : current)
    } catch (err) { setError((err as Error).message) }
  }

  return (
    <section className={styles.panel} aria-labelledby="writer-memory-title">
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>Act IV · Writer Memory</p>
          <h2 id="writer-memory-title" className={styles.title}>What Quill believes about you</h2>
        </div>
        <span className={styles.eyebrow}>{preferences.length} active</span>
      </div>
      <p className={styles.intro}>
        Quill starts with observations about your prose, then promotes a preference only after your explicit accept, reject, or bounded revision behaviour. Silence is never treated as a rejection.
      </p>
      {loading && <p className={styles.state}>Reading your evidence trail…</p>}
      {error && <p className={`${styles.state} ${styles.error}`}>{error}</p>}
      {!loading && !error && (
        <section className={styles.observations} aria-labelledby="writer-observations-title">
          <div className={styles.subheading}>
            <h3 id="writer-observations-title">Measured observations</h3>
            <span className={styles.eyebrow}>{scopedObservations.length} facts</span>
          </div>
          {scopedObservations.length === 0 ? (
            <p className={styles.state}>No observations yet. Save a chapter or import a manuscript and Quill will measure sentence length, dialogue, adverbs, and vocabulary without inferring intent.</p>
          ) : (
            <div className={styles.observationList}>
              {scopedObservations.map((observation) => (
                <div className={styles.observation} key={observation.id}>
                  <span>{observation.metric.replace(/_/g, ' ')}</span>
                  <strong>{observation.value.toFixed(2)}</strong>
                  <small>sample {observation.sample_size}</small>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
      {!loading && !error && preferences.length === 0 && (
        <p className={styles.state}>No preferences yet. Keep writing and respond to craft notes when you want Quill to learn an intention; measurable observations can exist without inventing a belief.</p>
      )}
      <div className={styles.list}>
        {preferences.map((preference) => {
          const confidence = Math.round(Math.max(0, Math.min(1, preference.confidence)) * 100)
          const itemEvidence = evidence[preference.id]
          return (
            <article className={styles.card} key={preference.id}>
              <p className={styles.statement}>{preference.statement}</p>
              <div className={styles.meta}>
                <span>confidence {confidence}%</span>
                <span className={styles.badge}>{preference.scope === 'universal' ? 'universal' : 'genre-bound'}</span>
                {preference.genre_tags.map((tag) => <span className={styles.genre} key={tag}>{tag}</span>)}
              </div>
              <div className={styles.bar} aria-label={`Confidence ${confidence}%`}><div className={styles.fill} style={{ width: `${confidence}%` }} /></div>
              <div className={styles.actions}>
                <button className={styles.button} onClick={() => void toggleEvidence(preference.id)}>{expanded === preference.id ? 'Hide evidence' : 'Why? Show evidence'}</button>
                <button className={styles.button} onClick={() => void correctScope(preference)}>Make {preference.scope === 'universal' ? 'genre-bound' : 'universal'}</button>
                <button className={`${styles.button} ${styles.danger}`} onClick={() => void deactivate(preference.id)}>Deactivate</button>
              </div>
              {expanded === preference.id && itemEvidence && (
                <div className={styles.evidence}>
                  <h4>Observations</h4>
                  <ul>{itemEvidence.observations.map((item) => <li key={item.id}>{item.metric}: {item.value.toFixed(2)} · sample {item.sample_size}</li>)}</ul>
                  <h4>Writer signals</h4>
                  <ul>{itemEvidence.feedback_events.map((item) => <li key={item.id}>{item.signal} · {new Date(item.created_at).toLocaleDateString()}</li>)}</ul>
                  <h4>Decay history</h4>
                  <ul>{itemEvidence.history.map((item) => <li key={item.id}>{Math.round(item.relevance_score * 100)}% relevance · {item.lifecycle}</li>)}</ul>
                </div>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}
