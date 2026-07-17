import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { GenreTagPicker } from '../components/genres'
import { useFeedback } from '../components/feedback'
import { api } from '../lib/api'
import { GENRE_OPTIONS } from '../lib/genres'
import { guidedDemoSessionId, rememberGuidedDemoUniverse } from './guidedDemo'
import styles from './DashboardPage.module.css'

type UniverseSummary = {
  id: string
  name: string
  description?: string
  genre_tags?: string[]
  genre?: string
}

type StatusTone = 'info' | 'success' | 'error'
type HomeStatus = { tone: StatusTone; message: string }
type DemoAction = 'clone' | 'reset'
type DemoState = 'idle' | 'setting-up' | 'ready' | 'resetting' | 'failed'

const genreLabels = new Map<string, string>(
  GENRE_OPTIONS.map(({ value, label }) => [value, label] as [string, string]),
)

function writePath(universeId: string) {
  return `/universe/${universeId}/write`
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

function tagsFor(universe: UniverseSummary) {
  if (universe.genre_tags) return universe.genre_tags.filter(Boolean)
  return universe.genre ? [universe.genre] : []
}

function genreName(tag: string) {
  return genreLabels.get(tag) ?? tag
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return count === 1 ? singular : plural
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { publish, update } = useFeedback()
  const isForcingNew = new URLSearchParams(location.search).get('new') === 'true'

  const [universes, setUniverses] = useState<UniverseSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(isForcingNew)
  const [newUniverseName, setNewUniverseName] = useState('')
  const [newUniverseDescription, setNewUniverseDescription] = useState('')
  const [newUniverseGenres, setNewUniverseGenres] = useState<string[]>([])
  const [createError, setCreateError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [status, setStatus] = useState<HomeStatus | null>(null)
  const [demoState, setDemoState] = useState<DemoState>('idle')
  const [demoUniverseId, setDemoUniverseId] = useState<string | null>(null)
  const [lastDemoAction, setLastDemoAction] = useState<DemoAction>('clone')
  const [demoError, setDemoError] = useState<string | null>(null)

  const loadUniverses = useCallback(async (showLoader = true) => {
    if (showLoader) setIsLoading(true)
    setLoadError(null)

    try {
      const { universes: result } = await api.listUniverses()
      setUniverses(Array.isArray(result) ? result : [])
      return true
    } catch (error) {
      setLoadError(errorMessage(error, 'We could not load your universe library.'))
      return false
    } finally {
      if (showLoader) setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadUniverses()
  }, [loadUniverses])

  useEffect(() => {
    if (isForcingNew) setShowCreate(true)
  }, [isForcingNew])

  const summary = useMemo(() => {
    const withBrief = universes.filter((universe) => Boolean(universe.description?.trim())).length
    const tagged = universes.filter((universe) => tagsFor(universe).length > 0).length

    return {
      count: universes.length,
      withBrief,
      tagged,
    }
  }, [universes])

  const primaryUniverse = universes[0]

  const closeCreate = () => {
    setShowCreate(false)
    setCreateError(null)
    if (isForcingNew) navigate('/dashboard', { replace: true })
  }

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = newUniverseName.trim()
    if (!name) {
      setCreateError('Give your universe a name before creating it.')
      return
    }

    const feedbackId = publish({
      scope: 'home',
      status: 'running',
      message: 'Creating your universe…',
    })
    setCreateError(null)
    setStatus({ tone: 'info', message: 'Creating your universe…' })
    setIsCreating(true)

    try {
      const { universe } = await api.createUniverse({
        name,
        description: newUniverseDescription.trim(),
        genre_tags: newUniverseGenres,
      })
      const createdUniverse = universe as UniverseSummary
      setUniverses((current) => [
        createdUniverse,
        ...current.filter((existing) => existing.id !== createdUniverse.id),
      ])
      setNewUniverseName('')
      setNewUniverseDescription('')
      setNewUniverseGenres([])
      setShowCreate(false)
      const message = `${createdUniverse.name} is ready. Continue writing when you are.`
      setStatus({ tone: 'success', message })
      update(feedbackId, { status: 'completed', message })
    } catch (error) {
      const message = errorMessage(error, 'We could not create that universe. Please try again.')
      setCreateError(message)
      setStatus({ tone: 'error', message })
      update(feedbackId, { status: 'failed', message })
    } finally {
      setIsCreating(false)
    }
  }

  const handleDemo = async (action: DemoAction): Promise<boolean> => {
    const isReset = action === 'reset'
    const sessionId = guidedDemoSessionId()
    const runningMessage = isReset ? 'Resetting the guided demo…' : 'Setting up the guided demo…'
    const feedbackId = publish({ scope: 'demo', status: 'running', message: runningMessage })
    setLastDemoAction(action)
    setDemoError(null)
    setDemoState(isReset ? 'resetting' : 'setting-up')
    setStatus({ tone: 'info', message: runningMessage })

    try {
      const result = isReset
        ? await api.demoReset(sessionId)
        : await api.demoClone(sessionId)
      setDemoUniverseId(result.universe_id)
      rememberGuidedDemoUniverse(result.universe_id)
      setDemoState('ready')
      const message = isReset
        ? 'The guided demo has been reset and is ready to explore again.'
        : 'Your guided demo is ready. Start writing to begin the journey.'
      setStatus({ tone: 'success', message })
      update(feedbackId, { status: 'completed', message })
      void loadUniverses(false)
      return true
    } catch (error) {
      const message = errorMessage(
        error,
        isReset
          ? 'We could not reset the guided demo. Please try again.'
          : 'We could not set up the guided demo. Please try again.'
      )
      setDemoState('failed')
      setDemoError(message)
      setStatus({ tone: 'error', message })
      update(feedbackId, { status: 'failed', message, retry: () => handleDemo(action) })
      return false
    }
  }

  return (
    <main className={styles.layout}>
      <section className={styles.hero} aria-labelledby="home-title">
        <div>
          <p className={styles.eyebrow}>Home</p>
          <h1 id="home-title" className={styles.title}>Your writing worlds</h1>
          <p className={styles.intro}>
            Pick up a story, make a new home for an idea, or enter the guided demo.
          </p>
        </div>
        <div className={styles.heroActions}>
          {primaryUniverse && (
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => navigate(writePath(primaryUniverse.id))}
            >
              Continue writing
              <span className={styles.buttonDetail}>{primaryUniverse.name}</span>
            </button>
          )}
          {!showCreate && (
            <button type="button" className={styles.secondaryButton} onClick={() => setShowCreate(true)}>
              Create universe
            </button>
          )}
        </div>
      </section>

      {status && (
        <p
          className={`${styles.status} ${styles[`status${status.tone[0].toUpperCase()}${status.tone.slice(1)}`]}`}
          role={status.tone === 'error' ? 'alert' : 'status'}
        >
          {status.message}
        </p>
      )}

      {showCreate && (
        <section className={styles.createPanel} aria-labelledby="create-universe-title">
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.eyebrow}>New universe</p>
              <h2 id="create-universe-title">Start with the shape of your story</h2>
              <p>A name is enough to begin. Add a brief or genres when they help.</p>
            </div>
            <button type="button" className={styles.textButton} onClick={closeCreate} disabled={isCreating}>
              Back to library
            </button>
          </div>

          <form className={styles.createForm} onSubmit={handleCreate}>
            <label className={styles.field} htmlFor="universe-name">
              <span>Name</span>
              <input
                id="universe-name"
                name="name"
                placeholder="e.g. The Farthest Shore"
                value={newUniverseName}
                onChange={(event) => setNewUniverseName(event.target.value)}
                autoFocus
                disabled={isCreating}
                required
              />
            </label>

            <label className={styles.field} htmlFor="universe-description">
              <span>Story brief <em>Optional</em></span>
              <textarea
                id="universe-description"
                name="description"
                placeholder="What makes this world worth returning to?"
                value={newUniverseDescription}
                onChange={(event) => setNewUniverseDescription(event.target.value)}
                disabled={isCreating}
                rows={3}
              />
            </label>

            <GenreTagPicker
              id="universe-genres"
              label="Genres"
              value={newUniverseGenres}
              onChange={setNewUniverseGenres}
              disabled={isCreating}
            />

            {createError && <p className={styles.formError} role="alert">{createError}</p>}

            <div className={styles.formActions}>
              <button type="submit" className={styles.primaryButton} disabled={isCreating || !newUniverseName.trim()}>
                {isCreating ? 'Creating universe…' : createError ? 'Try again' : 'Create universe'}
              </button>
              <button type="button" className={styles.secondaryButton} onClick={closeCreate} disabled={isCreating}>
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      <section className={styles.overview} aria-labelledby="library-title">
        <div className={styles.libraryHeading}>
          <div>
            <p className={styles.eyebrow}>Library</p>
            <h2 id="library-title">Your universes</h2>
          </div>
          {!isLoading && !loadError && summary.count > 0 && (
            <p className={styles.summary}>
              {summary.count} {pluralize(summary.count, 'universe')} · {summary.withBrief} {pluralize(summary.withBrief, 'story brief', 'story briefs')} · {summary.tagged} tagged
            </p>
          )}
        </div>

        {loadError && (
          <div className={styles.errorPanel} role="alert">
            <div>
              <h3>We could not load your library</h3>
              <p>{loadError}</p>
            </div>
            <button type="button" className={styles.secondaryButton} onClick={() => void loadUniverses()}>
              Retry
            </button>
          </div>
        )}

        {isLoading && universes.length === 0 && (
          <div className={styles.skeletonGrid} role="status" aria-label="Loading your universe library" aria-busy="true">
            <div className={styles.skeletonCard} />
            <div className={styles.skeletonCard} />
            <div className={styles.skeletonCard} />
          </div>
        )}

        {!isLoading && universes.length === 0 && !loadError && (
          <div className={styles.emptyState}>
            <p className={styles.eyebrow}>A blank shelf</p>
            <h3>No universes yet</h3>
            <p>Create one when you are ready, or use the guided demo to see Quill with a working story.</p>
            <button type="button" className={styles.primaryButton} onClick={() => setShowCreate(true)}>
              Create your first universe
            </button>
          </div>
        )}

        {universes.length > 0 && (
          <div className={styles.universeGrid}>
            {universes.map((universe) => {
              const tags = tagsFor(universe)
              return (
                <article className={styles.universeCard} key={universe.id}>
                  <div className={styles.cardHeading}>
                    <p className={styles.cardLabel}>Universe</p>
                    <h3>{universe.name}</h3>
                  </div>
                  <p className={styles.description}>
                    {universe.description?.trim() || 'No story brief yet — begin where the idea is clearest.'}
                  </p>
                  <div className={styles.genreList} aria-label={`Genres for ${universe.name}`}>
                    {tags.length > 0 ? tags.map((tag) => <span className={styles.genreTag} key={tag}>{genreName(tag)}</span>) : (
                      <span className={styles.noGenre}>No genres tagged</span>
                    )}
                  </div>
                  <div className={styles.cardFooter}>
                    <span className={styles.cardSignal}>
                      {universe.description?.trim() ? 'Story brief added' : 'Story brief open'}
                    </span>
                    <button type="button" className={styles.cardButton} onClick={() => navigate(writePath(universe.id))}>
                      Open writing
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>

      <aside className={styles.demoCard} aria-labelledby="guided-demo-title">
        <div>
          <p className={styles.eyebrow}>Guided demo</p>
          <h2 id="guided-demo-title">See a living story world</h2>
          <p>
            This uses a real universe owned by your signed-in account. Each step stays pending until Quill observes it.
          </p>
          <ol className={styles.demoSteps}>
            <li>Clone or reset your demo universe.</li>
            <li>Open a chapter in Write.</li>
            <li>Submit a paragraph and wait for real analysis.</li>
            <li>Open the relationship map.</li>
            <li>Ask Memory a lore question.</li>
            <li>Inspect a real review issue.</li>
          </ol>
        </div>
        <div className={styles.demoActions}>
          {demoState === 'idle' && (
            <button type="button" className={styles.primaryButton} onClick={() => void handleDemo('clone')}>
              Clone demo universe
            </button>
          )}
          {(demoState === 'setting-up' || demoState === 'resetting') && (
            <span className={styles.demoProgress} role="status">
              {demoState === 'resetting' ? 'Resetting demo…' : 'Setting up demo…'}
            </span>
          )}
          {demoState === 'ready' && demoUniverseId && (
            <>
              <button type="button" className={styles.primaryButton} onClick={() => navigate(writePath(demoUniverseId))}>
                Start guided demo
              </button>
              <button type="button" className={styles.secondaryButton} onClick={() => void handleDemo('reset')}>
                Reset demo
              </button>
            </>
          )}
          {demoState === 'failed' && (
            <>
              {demoError && <p className={styles.demoError} role="alert">{demoError}</p>}
              <button type="button" className={styles.secondaryButton} onClick={() => void handleDemo(lastDemoAction)}>
                Try again
              </button>
            </>
          )}
        </div>
      </aside>
    </main>
  )
}
