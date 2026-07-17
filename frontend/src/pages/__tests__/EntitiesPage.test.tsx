import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import EntitiesPage from '../EntitiesPage'

vi.mock('../EntitiesPage.module.css', () => ({ default: new Proxy({}, { get: (_, key) => key }) }))

const mockListEntities = vi.fn()
vi.mock('../../lib/api', () => ({
  api: {
    listEntities: (...args: unknown[]) => mockListEntities(...args),
    getEntity: vi.fn(),
    getEntityNeighbors: vi.fn(),
  },
}))

const counts = { character: 2, place: 0, object: 1, faction: 0, event: 0, world_rule: 0, plot_arc: 0 }

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/universe/uni-1/entities']}>
      <Routes>
        <Route path="/universe/:universeId/entities" element={<EntitiesPage />} />
        <Route path="/universe/:universeId/entities/:entityId" element={<EntitiesPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('EntitiesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requests the selected type on every paginated page', async () => {
    mockListEntities
      .mockResolvedValueOnce({ entities: [], counts_by_type: counts, pagination: { total: 3 } })
      .mockResolvedValueOnce({
        entities: Array.from({ length: 100 }, (_, index) => ({ id: `object-${index}`, name: `Object ${index}`, type: 'object' })),
        counts_by_type: counts,
        pagination: { total: 101 },
      })
      .mockResolvedValueOnce({
        entities: [{ id: 'object-100', name: 'Object 100', type: 'object' }],
        counts_by_type: counts,
        pagination: { total: 101 },
      })

    renderPage()
    await screen.findByText('No entities found.')
    expect(mockListEntities).toHaveBeenLastCalledWith('uni-1', { limit: '100', page: '1' })

    fireEvent.click(screen.getByRole('button', { name: 'Objects (1)' }))
    const loadMore = await screen.findByText('Load more (100 of 101)')
    expect(mockListEntities).toHaveBeenLastCalledWith('uni-1', { limit: '100', page: '1', type: 'object' })

    fireEvent.click(loadMore)
    expect(await screen.findByText('Object 100')).toBeInTheDocument()
    expect(mockListEntities).toHaveBeenLastCalledWith('uni-1', { limit: '100', page: '2', type: 'object' })
  })

  it('requests search terms from the server instead of filtering the loaded page locally', async () => {
    mockListEntities
      .mockResolvedValueOnce({ entities: [], counts_by_type: counts, pagination: { total: 3 } })
      .mockResolvedValueOnce({
        entities: [{ id: 'character-1', name: 'Filip', type: 'character' }],
        counts_by_type: counts,
        pagination: { total: 1 },
      })

    renderPage()
    await screen.findByText('No entities found.')
    expect(mockListEntities).toHaveBeenLastCalledWith('uni-1', { limit: '100', page: '1' })

    fireEvent.change(screen.getByPlaceholderText('Search entity or alias…'), { target: { value: 'Fil' } })
    expect(await screen.findByText('Filip')).toBeInTheDocument()
    expect(mockListEntities).toHaveBeenLastCalledWith('uni-1', { limit: '100', page: '1', search: 'Fil' })
  })

  it('discards an older pagination response after the query changes', async () => {
    let resolveStalePage: (value: unknown) => void = () => {}
    mockListEntities
      .mockResolvedValueOnce({ entities: [], counts_by_type: counts, pagination: { total: 3 } })
      .mockResolvedValueOnce({
        entities: Array.from({ length: 100 }, (_, index) => ({ id: `object-${index}`, name: `Object ${index}`, type: 'object' })),
        counts_by_type: counts,
        pagination: { total: 101 },
      })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveStalePage = resolve }))
      .mockResolvedValueOnce({
        entities: [{ id: 'character-1', name: 'Character result', type: 'character' }],
        counts_by_type: counts,
        pagination: { total: 2 },
      })

    renderPage()
    await screen.findByText('No entities found.')
    expect(mockListEntities).toHaveBeenLastCalledWith('uni-1', { limit: '100', page: '1' })

    fireEvent.click(screen.getByRole('button', { name: 'Objects (1)' }))
    const loadMore = await screen.findByText('Load more (100 of 101)')
    expect(mockListEntities).toHaveBeenLastCalledWith('uni-1', { limit: '100', page: '1', type: 'object' })
    fireEvent.click(loadMore)
    await screen.findByText('Loading…')
    expect(mockListEntities).toHaveBeenLastCalledWith('uni-1', { limit: '100', page: '2', type: 'object' })

    fireEvent.click(screen.getByRole('button', { name: 'Characters (2)' }))
    await screen.findByText('Character result')

    resolveStalePage({
      entities: [{ id: 'object-100', name: 'Stale object', type: 'object' }],
      counts_by_type: counts,
      pagination: { total: 101 },
    })

    await waitFor(() => {
      expect(screen.queryByText('Stale object')).not.toBeInTheDocument()
      expect(screen.getByText('Character result')).toBeInTheDocument()
    })
  })

  it('shows a retryable error instead of an empty state when the entity list fails', async () => {
    mockListEntities
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ entities: [], counts_by_type: counts, pagination: { total: 0 } })

    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load entities for this universe.')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('No entities found.')).toBeInTheDocument()
  })

  it('keeps loaded entities visible and retries a failed pagination request', async () => {
    mockListEntities
      .mockResolvedValueOnce({
        entities: Array.from({ length: 100 }, (_, index) => ({ id: `object-${index}`, name: `Object ${index}`, type: 'object' })),
        counts_by_type: counts,
        pagination: { total: 101 },
      })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        entities: [{ id: 'object-100', name: 'Object 100', type: 'object' }],
        counts_by_type: counts,
        pagination: { total: 101 },
      })

    renderPage()
    const loadMore = await screen.findByRole('button', { name: 'Load more (100 of 101)' })
    fireEvent.click(loadMore)

    expect(await screen.findByText('Could not load more entities. Showing the results already loaded.')).toBeInTheDocument()
    expect(screen.getByText('Object 0')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('Object 100')).toBeInTheDocument()
  })
})
