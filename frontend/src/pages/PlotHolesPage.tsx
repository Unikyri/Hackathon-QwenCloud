import { useCallback, useEffect, useRef, useState } from 'react'
import { FileQuestion } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { api } from '../lib/api'
import PlotHoleList, { type PlotHole } from '../components/plot-holes/PlotHoleList'
import PageStatus from '../components/shared/PageStatus'
import styles from './PlotHolesPage.module.css'

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return 'The request could not be completed. Please try again.'
}

export default function PlotHolesPage() {
  const { universeId } = useParams<{ universeId: string }>()
  const [plotHoles, setPlotHoles] = useState<PlotHole[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const loadRequestId = useRef(0)

  const fetchPlotHoles = useCallback(async (id: string) => {
    const requestId = ++loadRequestId.current
    setLoading(true)
    setError(null)
    setPlotHoles([])

    try {
      const { plot_holes } = await api.getPlotHoles(id)
      if (requestId !== loadRequestId.current) return
      setPlotHoles(plot_holes || [])
    } catch (requestError) {
      if (requestId !== loadRequestId.current) return
      setError(errorMessage(requestError))
    } finally {
      if (requestId === loadRequestId.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!universeId) {
      setLoading(false)
      return
    }

    void fetchPlotHoles(universeId)
    return () => {
      loadRequestId.current += 1
    }
  }, [fetchPlotHoles, universeId])

  if (loading || error) return (
    <PageStatus
      loading={loading}
      error={error}
      onRetry={() => universeId && void fetchPlotHoles(universeId)}
    />
  )

  if (plotHoles.length === 0) return (
    <div className={styles.wrap}>
      <div className={styles.emptyState}>
        <FileQuestion className={styles.emptyGlyph} aria-hidden="true" />
        <p className={styles.emptyTitle}>No Plot Holes</p>
        <p className={styles.emptyText}>
          No plot holes detected. AI analysis scans your works for narrative gaps, inconsistencies, and unresolved threads.
        </p>
      </div>
    </div>
  )

  return (
    <div className={styles.wrap}>
      <PlotHoleList plotHoles={plotHoles} universeId={universeId!} />
    </div>
  )
}
