import styles from './PageStatus.module.css'

interface PageStatusProps {
  loading?: boolean
  error?: string | null
  onRetry?: () => void
}

export default function PageStatus({ loading, error, onRetry }: PageStatusProps) {
  if (loading) {
    return (
      <div className={styles.statusWrap} data-testid="loading-state" role="status" aria-live="polite">
        <div className={styles.spinner} aria-hidden="true" />
        <p className={styles.loadingText}>Loading…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className={styles.statusWrap} data-testid="error-state" role="alert">
        <p className={styles.errorText}>{error}</p>
        {onRetry && (
          <button className={styles.retryBtn} type="button" onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
    )
  }

  return null
}
