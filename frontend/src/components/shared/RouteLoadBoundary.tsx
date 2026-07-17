import { Component, Suspense, type ReactNode } from 'react'

interface RouteErrorBoundaryProps {
  children: ReactNode
  onReload?: () => void
}

interface RouteErrorBoundaryState {
  failed: boolean
}

/**
 * Dynamic imports stay rejected for the lifetime of the current JavaScript
 * bundle. A browser reload is therefore the only honest retry for a failed
 * route chunk.
 */
export class RouteErrorBoundary extends Component<RouteErrorBoundaryProps, RouteErrorBoundaryState> {
  state: RouteErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): RouteErrorBoundaryState {
    return { failed: true }
  }

  private reloadPage = () => {
    window.location.reload()
  }

  render() {
    if (this.state.failed) {
      return (
        <section role="alert" aria-labelledby="route-load-error-title">
          <h1 id="route-load-error-title">This page could not be loaded</h1>
          <p>Quill could not download the code for this screen.</p>
          <p>Check your connection, then reload this page. Reloading asks the browser to fetch the missing screen again.</p>
          <button type="button" onClick={this.props.onReload ?? this.reloadPage}>Reload page</button>
        </section>
      )
    }

    return this.props.children
  }
}

export function RouteLoadingFallback({ label = 'Loading page…' }: { label?: string }) {
  return <div role="status" aria-live="polite" aria-busy="true">{label}</div>
}

interface RouteLoadBoundaryProps {
  children: ReactNode
  label?: string
  onReload?: () => void
}

export function RouteLoadBoundary({ children, label, onReload }: RouteLoadBoundaryProps) {
  return (
    <RouteErrorBoundary onReload={onReload}>
      <Suspense fallback={<RouteLoadingFallback label={label} />}>{children}</Suspense>
    </RouteErrorBoundary>
  )
}
