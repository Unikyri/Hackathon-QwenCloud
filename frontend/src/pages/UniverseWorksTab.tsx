import { useContext, useState, useEffect, useCallback, type KeyboardEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { UniverseContext } from '../contexts/UniverseContext'
import { api } from '../lib/api'
import ImageUpload from '../components/shared/ImageUpload'
import styles from './UniverseWorksTab.module.css'

function onActivateKey(fn: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn() }
  }
}

interface Work {
  id: string; title: string; type: string; synopsis?: string; universe_id: string
}

interface Chapter {
  id: string; title: string; order_index: number; word_count: number; status: string; updated_at?: string
}

function relativeTime(iso?: string) {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const h = Math.floor(diff / 3_600_000)
  if (h < 1) return `${Math.max(1, Math.floor(diff / 60_000))} min ago`
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function StatusChip({ status }: { status: string }) {
  const s = status.toLowerCase()
  let label = status
  let key = ''
  if (s === 'analyzed') { label = '✓ Analyzed'; key = 'analyzed' }
  else if (s === 'analyzing' || s === 'pending') { label = '— Analyzing'; key = 'analyzing' }
  else if (s === 'contradiction') { label = '⚠ Contradiction'; key = 'contradiction' }
  else if (s === 'error') { label = '✕ Error'; key = 'error' }
  else if (!s || s === 'draft') { label = '— (draft)'; key = '' }
  return <span className={styles.statusChip} data-s={key}>{label}</span>
}

// ── Work detail view ──────────────────────────────────────────────────────────
function WorkDetail({ workId, universeId, onBack }: { workId: string; universeId: string; onBack: () => void }) {
  const navigate = useNavigate()
  const [work, setWork] = useState<Work | null>(null)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cover, setCover] = useState<string | null>(null)
  const [showNewForm, setShowNewForm] = useState(false)
  const [chapterTitle, setChapterTitle] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [creatingChapter, setCreatingChapter] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [editingSynopsis, setEditingSynopsis] = useState(false)
  const [synopsisDraft, setSynopsisDraft] = useState('')
  const [renamingChapterId, setRenamingChapterId] = useState<string | null>(null)
  const [chapterTitleDraft, setChapterTitleDraft] = useState('')

  const fetchData = useCallback(() => {
    if (!workId) return
    setLoading(true); setError(null)
    Promise.all([api.getWork(workId), api.listChapters(workId)])
      .then(([{ work }, { chapters }]) => { setWork(work); setChapters(chapters || []) })
      .catch((err) => setError(err.message || 'Failed to load work'))
      .finally(() => setLoading(false))
  }, [workId])

  useEffect(() => { fetchData(); setCover(null) }, [workId, fetchData])

  const handleCreateChapter = async () => {
    if (!workId || creatingChapter) return
    if (!chapterTitle.trim()) { setSubmitError('Title is required'); return }
    setSubmitError(null); setCreatingChapter(true)
    try {
      const { chapter } = await api.createChapter(workId, { title: chapterTitle.trim() })
      setShowNewForm(false); setChapterTitle('')
      navigate(`/universe/${universeId}/editor/${chapter.id}`)
    } catch (err) {
      setSubmitError((err as Error).message || 'Failed to create chapter')
    } finally { setCreatingChapter(false) }
  }

  const saveTitle = async () => {
    if (!work || !titleDraft.trim()) { setEditingTitle(false); return }
    const title = titleDraft.trim()
    setEditingTitle(false); setWork({ ...work, title })
    try { await api.updateWork(work.id, { title }) } catch { fetchData() }
  }

  const saveSynopsis = async () => {
    if (!work) { setEditingSynopsis(false); return }
    const synopsis = synopsisDraft.trim()
    setEditingSynopsis(false); setWork({ ...work, synopsis })
    try { await api.updateWork(work.id, { synopsis }) } catch { fetchData() }
  }

  const saveChapterTitle = async (chId: string) => {
    const title = chapterTitleDraft.trim()
    setRenamingChapterId(null)
    if (!title) return
    setChapters((prev) => prev.map((c) => c.id === chId ? { ...c, title } : c))
    try { await api.updateChapter(chId, { title }) } catch { fetchData() }
  }

  const handleDeleteChapter = async (ch: Chapter) => {
    if (!window.confirm(`Delete chapter "${ch.title}"? This cannot be undone.`)) return
    try {
      await api.deleteChapter(ch.id)
      fetchData()
    } catch (err) {
      alert((err as Error).message)
    }
  }

  if (loading) return <div className={styles.loading}>Loading…</div>
  if (error) return <div className={styles.error}>Error: {error}</div>

  const sorted = [...chapters].sort((a, b) => a.order_index - b.order_index)
  const totalWords = chapters.reduce((sum, ch) => sum + ch.word_count, 0)

  return (
    <div className={styles.wrap}>
      <button className={styles.backBtn} onClick={onBack}>← Works</button>

      {/* Header card */}
      <div className={styles.workHeaderCard}>
        <div className={styles.coverCol}>
          <ImageUpload value={cover} onChange={setCover} shape="rounded" radius={8} width={104} height={140} placeholder="Upload Cover" />
        </div>
        <div className={styles.headerInfo}>
          <div className={styles.metaRow}>
            <span className={styles.typePill}>{work?.type || 'Work'}</span>
            <span className={styles.metaText}>
              {chapters.length} chapter{chapters.length !== 1 ? 's' : ''} · {totalWords.toLocaleString()} words
            </span>
          </div>

          {editingTitle ? (
            <input
              className={styles.titleInput}
              value={titleDraft}
              autoFocus
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => e.key === 'Enter' && saveTitle()}
            />
          ) : (
            <div className={styles.titleRow}>
              <h1 className={styles.heading}>{work?.title || 'Untitled'}</h1>
              <span
                role="button" tabIndex={0} aria-label="Edit title"
                className={`glyph ${styles.editIcon}`}
                onClick={() => { setTitleDraft(work?.title || ''); setEditingTitle(true) }}
                onKeyDown={onActivateKey(() => { setTitleDraft(work?.title || ''); setEditingTitle(true) })}
              >✎</span>
            </div>
          )}

          {editingSynopsis ? (
            <textarea
              className={styles.synopsisInput}
              value={synopsisDraft} autoFocus
              onChange={(e) => setSynopsisDraft(e.target.value)}
              onBlur={saveSynopsis}
            />
          ) : (
            <div className={styles.synopsisRow}>
              <p className={styles.synopsis}>{work?.synopsis || 'No synopsis yet.'}</p>
              <span
                role="button" tabIndex={0} aria-label="Edit synopsis"
                className={`glyph ${styles.editIcon}`}
                onClick={() => { setSynopsisDraft(work?.synopsis || ''); setEditingSynopsis(true) }}
                onKeyDown={onActivateKey(() => { setSynopsisDraft(work?.synopsis || ''); setEditingSynopsis(true) })}
              >✎</span>
            </div>
          )}

          {sorted.length > 0 && (
            <button
              className={styles.openEditorBtn}
              onClick={() => navigate(`/universe/${universeId}/editor/${sorted[0].id}`)}
            >
              Open in editor
            </button>
          )}
        </div>
      </div>

      {/* Chapters */}
      <div className={styles.chaptersSection}>
        <div className={styles.chaptersSectionHeader}>
          <h2 className={styles.sectionHeading}>Chapters</h2>
          {!showNewForm && (
            <button className={styles.newBtn} onClick={() => setShowNewForm(true)}>+ New Chapter</button>
          )}
        </div>

        {showNewForm && (
          <div className={styles.inlineFormRow}>
            <input
              className={styles.formInput}
              placeholder="Chapter title"
              value={chapterTitle}
              disabled={creatingChapter}
              autoFocus
              onChange={(e) => setChapterTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateChapter()}
            />
            <button className={styles.formSubmit} onClick={handleCreateChapter} disabled={creatingChapter}>Create</button>
            <button className={styles.formCancel} onClick={() => { setShowNewForm(false); setSubmitError(null) }}>Cancel</button>
          </div>
        )}
        {submitError && <p className={styles.formError}>{submitError}</p>}

        {sorted.length === 0 ? (
          <p className={styles.empty}>No chapters yet.</p>
        ) : (
          <>
            <div className={styles.tableHeaderRow}>
              <span className={styles.tableHeaderCell}>#</span>
              <span className={styles.tableHeaderCell}>Chapter</span>
              <span className={styles.tableHeaderCell}>Words</span>
              <span className={styles.tableHeaderCell}>Analysis</span>
              <span className={styles.tableHeaderCell}>Edited</span>
              <span />
            </div>
            {sorted.map((ch, i) => (
              <div key={ch.id} className={styles.tableRow}>
                <span className={styles.colIndex}>{String(i + 1).padStart(2, '0')}</span>

                {renamingChapterId === ch.id ? (
                  <input
                    className={styles.colTitleInput}
                    value={chapterTitleDraft} autoFocus
                    onChange={(e) => setChapterTitleDraft(e.target.value)}
                    onBlur={() => saveChapterTitle(ch.id)}
                    onKeyDown={(e) => e.key === 'Enter' && saveChapterTitle(ch.id)}
                  />
                ) : (
                  <span
                    role="button" tabIndex={0}
                    className={styles.colTitle}
                    onClick={() => navigate(`/universe/${universeId}/editor/${ch.id}`)}
                    onKeyDown={onActivateKey(() => navigate(`/universe/${universeId}/editor/${ch.id}`))}
                  >
                    {ch.title}
                  </span>
                )}

                <span className={styles.colWords}>
                  {ch.word_count > 0 ? ch.word_count.toLocaleString() : '—'}
                </span>
                <span className={styles.colStatus}>
                  <StatusChip status={ch.status} />
                </span>
                <span className={styles.colEdited}>{relativeTime(ch.updated_at)}</span>
                <span>
                  <button
                    className={styles.colRenameBtn}
                    aria-label="Rename chapter"
                    onClick={() => { setRenamingChapterId(ch.id); setChapterTitleDraft(ch.title) }}
                  >
                    <span className="glyph">✎</span>
                  </button>
                  <button
                    className={styles.colRenameBtn}
                    aria-label="Delete chapter"
                    onClick={() => handleDeleteChapter(ch)}
                  >
                    <span className="glyph">🗑</span>
                  </button>
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

// ── Works list view ───────────────────────────────────────────────────────────
export default function UniverseWorksTab() {
  const { universeId } = useParams<{ universeId: string }>()
  const { works, universe, refetchWorks } = useContext(UniverseContext)
  const [selectedWorkId, setSelectedWorkId] = useState<string | null>(null)

  // If only one work exists, go straight to it
  useEffect(() => {
    if (works.length === 1 && !selectedWorkId) setSelectedWorkId(works[0].id)
  }, [works]) // eslint-disable-line react-hooks/exhaustive-deps

  const [showNewForm, setShowNewForm] = useState(false)
  const [title, setTitle] = useState('')
  const [type, setType] = useState('novel')
  const [synopsis, setSynopsis] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)

  const handleCreate = async () => {
    if (!universe) return
    if (!title.trim()) { setSubmitError('Title is required'); return }
    setSubmitError(null)
    try {
      const { work } = await api.createWork(universe.id, { title: title.trim(), type, synopsis: synopsis.trim() })
      await refetchWorks()
      setShowNewForm(false); setTitle(''); setType('novel'); setSynopsis('')
      setSelectedWorkId(work.id)
    } catch (err) {
      setSubmitError((err as Error).message || 'Failed to create work')
    }
  }

  const handleDeleteWork = async (w: { id: string; title: string }) => {
    if (!window.confirm(`Delete "${w.title}" and all its chapters? This cannot be undone.`)) return
    try {
      await api.deleteWork(w.id)
      await refetchWorks()
      if (selectedWorkId === w.id) setSelectedWorkId(null)
    } catch (err) {
      alert((err as Error).message)
    }
  }

  if (selectedWorkId && universeId) {
    return (
      <WorkDetail
        workId={selectedWorkId}
        universeId={universeId}
        onBack={() => setSelectedWorkId(null)}
      />
    )
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.sectionHeaderRow}>
        <h1 className={styles.sectionTitle}>Works & Chapters</h1>
        {!showNewForm && (
          <button className={styles.newBtn} onClick={() => setShowNewForm(true)}>+ New Work</button>
        )}
      </div>

      {showNewForm && (
        <div className={styles.newWorkForm}>
          <div className={styles.newWorkFormRow}>
            <input
              className={styles.formInput}
              placeholder="Work title"
              value={title}
              autoFocus
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
            <select className={styles.formSelect} value={type} onChange={(e) => setType(e.target.value)}>
              <option value="novel">Novel</option>
              <option value="short-story">Short Story</option>
              <option value="screenplay">Screenplay</option>
              <option value="comic">Comic</option>
              <option value="interactive">Interactive</option>
            </select>
          </div>
          <input
            className={styles.formInput}
            placeholder="Synopsis (optional)"
            value={synopsis}
            onChange={(e) => setSynopsis(e.target.value)}
          />
          <div className={styles.newWorkFormRow}>
            <button className={styles.formSubmit} onClick={handleCreate}>Create</button>
            <button className={styles.formCancel} onClick={() => { setShowNewForm(false); setSubmitError(null) }}>Cancel</button>
          </div>
          {submitError && <p style={{ color: 'var(--danger)', fontSize: 12 }}>{submitError}</p>}
        </div>
      )}

      {works.length === 0 ? (
        <div className={styles.empty}>No works yet. Create your first work to get started.</div>
      ) : (
        <div className={styles.worksGrid}>
          {works.map((w) => (
            <div
              key={w.id}
              role="button" tabIndex={0}
              className={styles.workCard}
              onClick={() => setSelectedWorkId(w.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedWorkId(w.id) } }}
            >
              <div className={styles.workCardType}>{w.type}</div>
              <h3 className={styles.workCardTitle}>{w.title}</h3>
              <button
                aria-label="Delete work"
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, alignSelf: 'flex-end' }}
                onClick={(e) => { e.stopPropagation(); handleDeleteWork(w) }}
              >
                <span className="glyph">🗑</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
