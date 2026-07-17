import { lazy } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RouteLoadBoundary } from '../RouteLoadBoundary'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('RouteLoadBoundary', () => {
  it('keeps the suspense fallback visible while a route chunk is loading', () => {
    const PendingRoute = lazy(() => new Promise<never>(() => {}))
    render(
      <RouteLoadBoundary label="Loading editor…">
        <PendingRoute />
      </RouteLoadBoundary>,
    )

    expect(screen.getByRole('status')).toHaveTextContent('Loading editor…')
  })

  it('shows accessible reload guidance when a lazy route import rejects', async () => {
    const user = userEvent.setup()
    const onReload = vi.fn()
    const suppressError = (event: ErrorEvent) => event.preventDefault()
    window.addEventListener('error', suppressError)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const BrokenRoute = lazy(() => Promise.reject(new Error('Route chunk unavailable')))
    try {
      render(
        <RouteLoadBoundary onReload={onReload}>
          <BrokenRoute />
        </RouteLoadBoundary>,
      )

      expect(await screen.findByRole('alert')).toHaveTextContent('This page could not be loaded')
      expect(screen.getByRole('alert')).toHaveTextContent('reload this page')

      await user.click(screen.getByRole('button', { name: 'Reload page' }))
      expect(onReload).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener('error', suppressError)
    }
  })
})
