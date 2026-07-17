import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import WorkRedirect from '../WorkRedirect'

const mockGetWork = vi.fn()
vi.mock('../../lib/api', () => ({
  api: { getWork: (...args: unknown[]) => mockGetWork(...args) },
}))

function Target() {
  return <div>Canonical write screen</div>
}

function Dashboard() {
  return <div>Dashboard screen</div>
}

function renderRedirect(workId = 'work-1') {
  return render(
    <MemoryRouter initialEntries={[`/work/${workId}`]}>
      <Routes>
        <Route path="/work/:workId" element={<WorkRedirect />} />
        <Route path="/universe/:universeId/write" element={<Target />} />
        <Route path="/dashboard" element={<Dashboard />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('WorkRedirect', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses the owner-authorized work lookup before redirecting to canonical Write', async () => {
    mockGetWork.mockResolvedValue({ work: { id: 'work-1', universe_id: 'uni-1' } })
    renderRedirect('work-1')

    await waitFor(() => {
      expect(screen.getByText('Canonical write screen')).toBeInTheDocument()
    })
    expect(mockGetWork).toHaveBeenCalledWith('work-1')
  })

  it('keeps the legacy link visible with an accessible retry when the lookup fails', async () => {
    mockGetWork
      .mockRejectedValueOnce(new Error('forbidden'))
      .mockResolvedValueOnce({ work: { id: 'work-1', universe_id: 'uni-1' } })
    renderRedirect('work-1')

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not open this manuscript.')
    expect(screen.queryByText('Dashboard screen')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(screen.getByText('Canonical write screen')).toBeInTheDocument())
  })
})
