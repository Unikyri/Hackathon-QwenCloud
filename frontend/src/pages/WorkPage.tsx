import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import styles from './WorkPage.module.css'

interface Work {
  id: string
  title: string
  type: string
  universe_id: string
}

interface Chapter {
  id: string
  title: string
  order_index: number
  word_count: number
  status: string
}

export default function WorkPage() {
  const { workId } = useParams<{ workId: string }>()
  const navigate = useNavigate()
  const [work, setWork] = useState<Work | null>(null)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showNewForm, setShowNewForm] = useState(false)
  const [chapterTitle, setChapterTitle] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)

  const fetchData = useCallback(() => {
    if (!workId) return
    setLoading(true)
    setError(null)
    Promise.all([api.getWork(workId), api.listChapters(workId)])
      .then(([{ work }, { chapters }]) => {
        setWork(work)
        setChapters(chapters)
      })
      .catch((err) => setError(err.message || 'Failed to load work'))
      .finally(() => setLoading(false))
  }, [workId])

  useEffect(() => { fetchData() }, [fetchData])

  const handleCreateChapter = async () => {
    if (!workId) return; if (!chapterTitle.trim()) { setSubmitError('Title is required'); return }
    setSubmitError(null)
    try {
      const { chapter } = await api.createChapter(workId, { title: chapterTitle.trim() })
      setShowNewForm(false)
      setChapterTitle('')
      navigate(`/editor/${chapter.id}`)
    } catch (err) {
      setSubmitError((err as Error).message || 'Failed to create chapter')
    }
  }

  if (loading) {
    return <p className={styles.loading}>Loading…</p>
  }

  if (error) {
    return <p className={styles.error}>Error: {error}</p>
  }

  const totalWords = chapters.reduce((sum, ch) => sum + ch.word_count, 0)
  const analyzedCount = chapters.filter((ch) => ch.status === 'analyzed').length

  return (
    <div className={styles.layout}>
      <aside className={styles.statsBox}>
        <h2 className={styles.statsHeading}>Project Stats</h2>
        <div className={styles.statItem}>
          <p className={styles.statLabel}>Chapters</p>
          <p className={styles.statValue}>{chapters.length}</p>
        </div>
        <div className={styles.statItem}>
          <p className={styles.statLabel}>Total Words</p>
          <p className={styles.statValue}>{totalWords.toLocaleString()}</p>
        </div>
        <div className={styles.statItem}>
          <p className={styles.statLabel}>Analyzed</p>
          <p className={styles.statValue}>{analyzedCount} / {chapters.length}</p>
        </div>
      </aside>

      <div className={styles.wrap}>
        <button
          className={styles.backBtn}
          onClick={() => work?.universe_id ? navigate(`/universe/${work.universe_id}`) : navigate(-1)}
        >
          ← Back
        </button>

        <h1 className={styles.heading}>{work?.title || 'Untitled Work'}</h1>
        {work?.type && <p className={styles.type}>{work.type}</p>}

        <div className={styles.headerRow}>
          <h2 className={styles.sectionHeading}>Chapters</h2>
          {!showNewForm ? (
            <button className={styles.newBtn} onClick={() => setShowNewForm(true)}>
              + New Chapter
            </button>
          ) : (
            <div className={styles.inlineForm}>
              <input
                className={styles.formInput}
                placeholder="Chapter title"
                value={chapterTitle}
                onChange={(e) => setChapterTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateChapter()}
              />
              <button className={styles.formSubmit} onClick={handleCreateChapter}>Create</button>
              <button className={styles.formCancel} onClick={() => { setShowNewForm(false); setSubmitError(null) }}>Cancel</button>
            </div>
          )}
          {submitError && <p className={styles.formError}>{submitError}</p>}
        </div>
        {chapters.length === 0 ? (
          <p className={styles.empty}>No chapters yet.</p>
        ) : (
          <div className={styles.chapterGrid}>
            {chapters
              .sort((a, b) => a.order_index - b.order_index)
              .map((ch) => (
                <div
                  key={ch.id}
                  className={styles.chapterCard}
                  onClick={() => navigate(`/editor/${ch.id}`)}
                >
                  <div className={styles.chapterCardHeader}>
                    <h3 className={styles.chapterTitle}>{ch.title}</h3>
                    <span className={styles.chapterStatus} data-status={ch.status}>
                      {ch.status}
                    </span>
                  </div>
                  <p className={styles.chapterMeta}>
                    {ch.word_count > 0 ? `${ch.word_count} words` : 'Empty'}
                  </p>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  )
}
