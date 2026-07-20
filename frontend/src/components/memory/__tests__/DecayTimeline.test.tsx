import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DecayTimeline from '../DecayTimeline'
import { api } from '../../../lib/api'

vi.mock('../../../lib/api', () => ({
  api: {
    getMemoryStatus: vi.fn(),
    runDecay: vi.fn(),
  },
}))

const getMemoryStatus = api.getMemoryStatus as ReturnType<typeof vi.fn>
const runDecay = api.runDecay as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
})

describe('DecayTimeline', () => {
  it('renders one sparkline row per entity', async () => {
    getMemoryStatus.mockResolvedValue({
      consolidated_count: 0,
      entities: [
        {
          id: 'e1', name: 'Alice', type: 'character', relevance_score: 0.6, status: 'active',
          consolidated: false, lifecycle: 'active',
          history: [
            { score: 0.9, recorded_at: '2026-07-01T00:00:00Z' },
            { score: 0.6, recorded_at: '2026-07-02T00:00:00Z' },
            { score: 0.3, recorded_at: '2026-07-03T00:00:00Z' },
          ],
        },
        {
          id: 'e2', name: 'Bob', type: 'character', relevance_score: 0.8, status: 'active',
          consolidated: false, lifecycle: 'decaying',
          history: [
            { score: 0.8, recorded_at: '2026-07-01T00:00:00Z' },
            { score: 0.7, recorded_at: '2026-07-02T00:00:00Z' },
          ],
        },
      ],
    })

    render(<DecayTimeline universeId="u1" />)

    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByTestId('decay-polyline-e1')).toBeInTheDocument()
    expect(screen.getByTestId('decay-polyline-e2')).toBeInTheDocument()
    expect(screen.getByTestId('decay-threshold-e1')).toBeInTheDocument()
  })

  it('renders empty state without crashing when there are no entities', async () => {
    getMemoryStatus.mockResolvedValue({ consolidated_count: 0, entities: [] })

    render(<DecayTimeline universeId="u1" />)

    await waitFor(() => expect(screen.getByText(/no entity lifecycle data yet/i)).toBeInTheDocument())
    expect(screen.queryByTestId(/decay-sparkline-/)).not.toBeInTheDocument()
  })

  it('renders a dot instead of a polyline for a single-point history', async () => {
    getMemoryStatus.mockResolvedValue({
      consolidated_count: 0,
      entities: [
        {
          id: 'e3', name: 'Carol', type: 'character', relevance_score: 0.5, status: 'active',
          consolidated: false, lifecycle: 'active',
          history: [{ score: 0.5, recorded_at: '2026-07-01T00:00:00Z' }],
        },
      ],
    })

    render(<DecayTimeline universeId="u1" />)

    await waitFor(() => expect(screen.getByTestId('decay-sparkline-e3')).toBeInTheDocument())
    expect(screen.queryByTestId('decay-polyline-e3')).not.toBeInTheDocument()
    expect(screen.getByTestId('decay-dot-e3')).toBeInTheDocument()
  })

  it('does not render a crossing marker when the entity never crosses the threshold', async () => {
    getMemoryStatus.mockResolvedValue({
      consolidated_count: 0,
      entities: [
        {
          id: 'e4', name: 'Dave', type: 'character', relevance_score: 0.9, status: 'active',
          consolidated: false, lifecycle: 'active',
          history: [
            { score: 0.9, recorded_at: '2026-07-01T00:00:00Z' },
            { score: 0.8, recorded_at: '2026-07-02T00:00:00Z' },
          ],
        },
      ],
    })

    render(<DecayTimeline universeId="u1" />)

    await waitFor(() => expect(screen.getByTestId('decay-sparkline-e4')).toBeInTheDocument())
    expect(screen.queryByTestId(/decay-marker-e4-/)).not.toBeInTheDocument()
  })

  it('renders a crossing marker where an entity drops below the threshold', async () => {
    getMemoryStatus.mockResolvedValue({
      consolidated_count: 0,
      entities: [
        {
          id: 'e5', name: 'Eve', type: 'character', relevance_score: 0.1, status: 'archived',
          consolidated: false, lifecycle: 'archived',
          history: [
            { score: 0.2, recorded_at: '2026-07-01T00:00:00Z' },
            { score: 0.1, recorded_at: '2026-07-02T00:00:00Z' },
          ],
        },
      ],
    })

    render(<DecayTimeline universeId="u1" />)

    await waitFor(() => expect(screen.getByTestId('decay-marker-e5-archive')).toBeInTheDocument())
  })

  it('runs a decay sweep and refetches memory-status when requested', async () => {
    getMemoryStatus.mockResolvedValue({
      consolidated_count: 0,
      entities: [
        {
          id: 'e1', name: 'Alice', type: 'character', relevance_score: 0.6, status: 'active',
          consolidated: false, lifecycle: 'active',
          history: [
            { score: 0.9, recorded_at: '2026-07-01T00:00:00Z' },
            { score: 0.6, recorded_at: '2026-07-02T00:00:00Z' },
          ],
        },
      ],
    })
    runDecay.mockResolvedValue({ ok: true })

    render(<DecayTimeline universeId="u1" />)
    await waitFor(() => expect(getMemoryStatus).toHaveBeenCalledTimes(1))

    screen.getByRole('button', { name: /run a decay sweep/i }).click()

    await waitFor(() => expect(runDecay).toHaveBeenCalledWith('u1'))
    await waitFor(() => expect(getMemoryStatus).toHaveBeenCalledTimes(2))
  })

  it('puts the sweep button on cooldown after it runs, so spam-clicking cannot compound decay', async () => {
    getMemoryStatus.mockResolvedValue({
      consolidated_count: 0,
      entities: [
        {
          id: 'e1', name: 'Alice', type: 'character', relevance_score: 0.6, status: 'active',
          consolidated: false, lifecycle: 'active',
          history: [{ score: 0.6, recorded_at: '2026-07-01T00:00:00Z' }],
        },
      ],
    })
    runDecay.mockResolvedValue({ ok: true })

    render(<DecayTimeline universeId="u1" />)
    await waitFor(() => expect(getMemoryStatus).toHaveBeenCalledTimes(1))

    const button = screen.getByRole('button', { name: /run a decay sweep/i })
    button.click()
    await waitFor(() => expect(runDecay).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(getMemoryStatus).toHaveBeenCalledTimes(2))

    // Spam-clicking right after a sweep must not fire a second one — this is
    // the exact behavior that let relevance get hammered to near-zero by
    // repeated clicks during a demo.
    const cooldownButton = await screen.findByRole('button', { name: /sweep again shortly/i })
    expect(cooldownButton).toBeDisabled()
    cooldownButton.click()
    expect(runDecay).toHaveBeenCalledTimes(1)
  })

  it('shows a retryable error when lifecycle data cannot be loaded', async () => {
    getMemoryStatus
      .mockRejectedValueOnce(new Error('Memory status unavailable'))
      .mockResolvedValueOnce({ consolidated_count: 0, entities: [] })

    render(<DecayTimeline universeId="u1" />)

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/memory status unavailable/i))

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(getMemoryStatus).toHaveBeenCalledTimes(2))
    expect(screen.getByText(/no entity lifecycle data yet/i)).toBeInTheDocument()
  })

  it('does not let an older universe response overwrite newer lifecycle data', async () => {
    let resolveFirstRequest: (value: { consolidated_count: number; entities: object[] }) => void
    const firstRequest = new Promise<{ consolidated_count: number; entities: object[] }>((resolve) => {
      resolveFirstRequest = resolve
    })
    getMemoryStatus
      .mockReturnValueOnce(firstRequest)
      .mockResolvedValueOnce({
        consolidated_count: 1,
        entities: [{
          id: 'new-entity', name: 'New universe entity', type: 'character', relevance_score: 0.8, status: 'active',
          consolidated: true, lifecycle: 'active', history: [{ score: 0.8, recorded_at: '2026-07-02T00:00:00Z' }],
        }],
      })

    const view = render(<DecayTimeline universeId="u1" />)
    await waitFor(() => expect(getMemoryStatus).toHaveBeenCalledWith('u1'))

    view.rerender(<DecayTimeline universeId="u2" />)
    await waitFor(() => expect(getMemoryStatus).toHaveBeenCalledWith('u2'))
    await waitFor(() => expect(screen.getByText('New universe entity')).toBeInTheDocument())

    resolveFirstRequest!({
      consolidated_count: 0,
      entities: [{
        id: 'old-entity', name: 'Old universe entity', type: 'character', relevance_score: 0.2, status: 'archived',
        consolidated: false, lifecycle: 'archived', history: [{ score: 0.2, recorded_at: '2026-07-01T00:00:00Z' }],
      }],
    })

    await Promise.resolve()
    expect(screen.getByText('New universe entity')).toBeInTheDocument()
    expect(screen.queryByText(/old universe entity/i)).not.toBeInTheDocument()
  })
})
