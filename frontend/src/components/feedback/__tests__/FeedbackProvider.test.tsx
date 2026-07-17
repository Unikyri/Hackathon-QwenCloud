import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import styles from '../FeedbackProvider.module.css'
import { FeedbackProvider, useFeedback } from '../FeedbackProvider'
import type { FeedbackRetryAction } from '../types'

const feedbackStylesheetPath = '../FeedbackProvider.module.css'
const { readFileSync } = await import('node:fs' as string) as {
  readFileSync: (path: URL, encoding: 'utf8') => string
}
const feedbackProviderCss = readFileSync(new URL(feedbackStylesheetPath, import.meta.url), 'utf8')

vi.mock('sonner', () => ({
  Toaster: () => null,
  toast: {
    dismiss: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
    message: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}))

function FeedbackControls({ retryAction }: { retryAction?: FeedbackRetryAction }) {
  const { events, publish, retry, update } = useFeedback()
  const eventId = useRef<string>()

  return (
    <>
      <button onClick={() => {
        eventId.current = publish({
          scope: 'home',
          status: 'failed',
          message: 'Demo setup failed.',
          retry: retryAction,
        })
      }} type="button">
        Report failure
      </button>
      <button onClick={() => {
        publish({
          scope: 'home',
          status: 'completed',
          message: 'Demo is ready.',
        })
      }} type="button">
        Report success
      </button>
      <button onClick={() => void retry(eventId.current!)} type="button">Retry</button>
      <button onClick={() => update(eventId.current!, { status: 'offline', message: 'Connection is offline.' })} type="button">
        Report offline
      </button>
      <output>{events[0]?.status}</output>
    </>
  )
}

function expectSemanticTextRule(type: string, color: string) {
  const toastSelector = `[data-sonner-toaster] [data-sonner-toast][data-styled='true'][data-type='${type}']`
  const titleSelector = `:global(${toastSelector} [data-title])`
  const descriptionSelector = `:global(${toastSelector} [data-description])`
  const titleStart = feedbackProviderCss.indexOf(titleSelector)

  expect(titleStart).toBeGreaterThan(-1)
  expect(feedbackProviderCss).toContain(descriptionSelector)

  const rule = feedbackProviderCss.slice(titleStart, feedbackProviderCss.indexOf('}', titleStart) + 1)
  expect(rule).toContain(`color: ${color};`)
  expect(rule).not.toContain('opacity:')
}

describe('FeedbackProvider', () => {
  it('pins rendered semantic toast title and description colors without opacity overrides', () => {
    expectSemanticTextRule('success', 'var(--color-pine-deep)')
    expectSemanticTextRule('error', '#6b2822')
    expectSemanticTextRule('warning', '#5a3b00')
    expectSemanticTextRule('loading', 'var(--color-pine-deep)')
    expectSemanticTextRule('info', 'var(--color-pine-deep)')
  })

  it('announces events and retains a retry failure as visible feedback', async () => {
    const user = userEvent.setup()
    render(
      <FeedbackProvider>
        <FeedbackControls retryAction={async () => { throw new Error('Service unavailable') }} />
      </FeedbackProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Report failure' }))
    expect(screen.getByRole('status', { name: 'Feedback announcements' })).toHaveTextContent('home: Demo setup failed.')

    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => {
      expect(screen.getByRole('status', { name: 'Feedback announcements' })).toHaveTextContent('home: Service unavailable')
    })
    expect(screen.getByText('failed')).toBeInTheDocument()
  })

  it('keeps the original event failed when a retry catches its own error and reports failure', async () => {
    const user = userEvent.setup()
    const retryAction = vi.fn(async () => {
      try {
        throw new Error('The retry handled its own request error.')
      } catch {
        return false
      }
    })
    render(
      <FeedbackProvider>
        <FeedbackControls retryAction={retryAction} />
      </FeedbackProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Report failure' }))
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => {
      expect(screen.getByRole('status', { name: 'Feedback announcements' })).toHaveTextContent('home: Retry did not complete. Please try again.')
    })
    expect(retryAction).toHaveBeenCalledTimes(1)
    expect(screen.getByText('failed')).toBeInTheDocument()
  })

  it('treats an explicit false retry result as a failed retry', async () => {
    const user = userEvent.setup()
    render(
      <FeedbackProvider>
        <FeedbackControls retryAction={() => false} />
      </FeedbackProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Report failure' }))
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => {
      expect(screen.getByText('failed')).toBeInTheDocument()
    })
    expect(screen.getByRole('status', { name: 'Feedback announcements' })).toHaveTextContent('home: Retry did not complete. Please try again.')
  })

  it('shows retrying state and completes only after an explicit true result', async () => {
    const user = userEvent.setup()
    let resolveRetry: (value: boolean) => void = () => {}
    const retryAction = vi.fn(() => new Promise<boolean>((resolve) => {
      resolveRetry = resolve
    }))
    render(
      <FeedbackProvider>
        <FeedbackControls retryAction={retryAction} />
      </FeedbackProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Report failure' }))
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(screen.getByText('running')).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Feedback announcements' })).toHaveTextContent('home: Retrying: Demo setup failed.')

    resolveRetry(true)
    await waitFor(() => {
      expect(screen.getByText('completed')).toBeInTheDocument()
    })
    expect(screen.getByRole('status', { name: 'Feedback announcements' })).toHaveTextContent('home: Retry completed.')
  })

  it('allows callers to transition a published event to offline', async () => {
    const user = userEvent.setup()
    render(
      <FeedbackProvider>
        <FeedbackControls />
      </FeedbackProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Report failure' }))
    await user.click(screen.getByRole('button', { name: 'Report offline' }))

    expect(screen.getByRole('status', { name: 'Feedback announcements' })).toHaveTextContent('home: Connection is offline.')
    expect(screen.getByText('offline')).toBeInTheDocument()
  })

  it('keeps informational toasts touch-transparent on mobile while preserving retry actions', async () => {
    const user = userEvent.setup()
    render(
      <FeedbackProvider>
        <FeedbackControls retryAction={async () => true} />
      </FeedbackProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Report success' }))
    expect(toast.success).toHaveBeenLastCalledWith('Demo is ready.', expect.objectContaining({
      className: styles.nonBlockingToast,
    }))

    await user.click(screen.getByRole('button', { name: 'Report failure' }))
    expect(toast.error).toHaveBeenLastCalledWith('Demo setup failed.', expect.objectContaining({
      action: expect.objectContaining({
        label: 'Retry',
        onClick: expect.any(Function),
      }),
    }))
    expect(toast.error).toHaveBeenLastCalledWith('Demo setup failed.', expect.not.objectContaining({
      className: styles.nonBlockingToast,
    }))
  })
})
