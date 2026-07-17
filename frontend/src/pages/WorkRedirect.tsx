import { useEffect, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { writePath } from '../lib/canonicalRoutes'
import PageStatus from '../components/shared/PageStatus'

// Legacy top-level work links resolve through the authenticated work endpoint,
// which verifies ownership before providing the canonical universe destination.
export default function WorkRedirect() {
  const { workId } = useParams<{ workId: string }>()
  const [target, setTarget] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryAttempt, setRetryAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    if (!workId) {
      setLoading(false)
      setError('This work link is missing a manuscript. Return to Write and choose a manuscript.')
      return () => { cancelled = true }
    }

    setLoading(true)
    setError(null)
    setTarget(null)
    api
      .getWork(workId)
      .then(({ work }) => {
        if (cancelled) return
        setTarget(writePath(work.universe_id))
      })
      .catch(() => {
        if (!cancelled) setError('Could not open this manuscript. It may no longer exist or you may not have access. Retry to try again.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [retryAttempt, workId])

  if (!target) {
    return <PageStatus loading={loading} error={error} onRetry={workId ? () => setRetryAttempt((attempt) => attempt + 1) : undefined} />
  }

  return <Navigate to={target} replace />
}
