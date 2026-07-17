import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import EntityCandidateTray from '../EntityCandidateTray'

vi.mock('../EntityCandidateTray.module.css', () => ({ default: new Proxy({}, { get: (_, key) => key }) }))

const mockListEntities = vi.fn()
const mockAcceptCandidate = vi.fn()

vi.mock('../../../lib/api', () => ({
  api: {
    listEntities: (...args: unknown[]) => mockListEntities(...args),
    acceptEntityCandidate: (...args: unknown[]) => mockAcceptCandidate(...args),
    dismissEntityCandidate: vi.fn(),
    mergeEntityCandidate: vi.fn(),
  },
}))

const candidate = {
  entity_id: 'candidate-1',
  universe_id: 'universe-1',
  name: 'Mira',
  type: 'character',
  confidence: 0.72,
  status: 'candidate',
}

function renderTray(onChanged = vi.fn()) {
  return render(
    <EntityCandidateTray
      candidates={[candidate]}
      universeId="universe-1"
      onChanged={onChanged}
    />,
  )
}

describe('EntityCandidateTray failure feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListEntities.mockResolvedValue({ entities: [] })
    mockAcceptCandidate.mockResolvedValue({})
  })

  it('surfaces a retry when active merge options cannot be loaded', async () => {
    mockListEntities
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ entities: [] })

    renderTray()

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load active entities.')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(mockListEntities).toHaveBeenCalledTimes(2))
  })

  it('retries only the list refresh when a saved decision cannot refresh the tray', async () => {
    const onChanged = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined)
    renderTray(onChanged)
    await waitFor(() => expect(mockListEntities).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('The decision was saved, but the candidate list could not be refreshed.')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2))
    expect(mockAcceptCandidate).toHaveBeenCalledTimes(1)
  })
})
