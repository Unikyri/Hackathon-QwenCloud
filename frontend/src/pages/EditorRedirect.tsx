import { useEffect, useState } from 'react'
import { useParams, Navigate } from 'react-router-dom'
import { api } from '../lib/api'
import { writePath } from '../lib/canonicalRoutes'
import PageStatus from '../components/shared/PageStatus'

// Legacy top-level deep link (`/editor/:chapterId`) → nested universe-scoped
// Write route. Fetches the chapter to learn its universe_id, then
// redirects; keeps old bookmarks/links working without duplicating EditorPage.
export default function EditorRedirect() {
  const { chapterId } = useParams<{ chapterId: string }>()
  const [target, setTarget] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryAttempt, setRetryAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    if (!chapterId) {
      setLoading(false)
      setError('This editor link is missing a chapter. Return to your workspace and choose a chapter.')
      return () => { cancelled = true }
    }
    setLoading(true)
    setError(null)
    setTarget(null)
    api
      .getChapter(chapterId)
      .then(({ chapter }) => {
        if (cancelled) return
        setTarget(writePath(chapter.universe_id, chapterId))
      })
      .catch(() => {
        if (!cancelled) setError('Could not open this chapter. It may no longer exist. Retry to try again.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [chapterId, retryAttempt])

  if (!target) {
    return <PageStatus loading={loading} error={error} onRetry={chapterId ? () => setRetryAttempt((attempt) => attempt + 1) : undefined} />
  }
  return <Navigate to={target} replace />
}
