import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import EditorRedirect from '../EditorRedirect'

const mockGetChapter = vi.fn()
vi.mock('../../lib/api', () => ({
  api: { getChapter: (...args: unknown[]) => mockGetChapter(...args) },
}))

function Target() {
  return <div>Canonical write screen</div>
}

function Dashboard() {
  return <div>Dashboard screen</div>
}

function renderRedirect(chapterId = 'ch-1') {
  return render(
    <MemoryRouter initialEntries={[`/editor/${chapterId}`]}>
      <Routes>
        <Route path="/editor/:chapterId" element={<EditorRedirect />} />
        <Route path="/universe/:universeId/write/:chapterId" element={<Target />} />
        <Route path="/dashboard" element={<Dashboard />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('EditorRedirect', () => {
  beforeEach(() => vi.clearAllMocks())

  it('redirects to the canonical universe-scoped Write route once the chapter resolves', async () => {
    mockGetChapter.mockResolvedValue({ chapter: { id: 'ch-1', universe_id: 'uni-1' } })
    renderRedirect('ch-1')

    await waitFor(() => {
      expect(screen.getByText('Canonical write screen')).toBeInTheDocument()
    })
  })

  it('keeps the legacy link visible with an accessible retry when the chapter fetch fails', async () => {
    mockGetChapter
      .mockRejectedValueOnce(new Error('not found'))
      .mockResolvedValueOnce({ chapter: { id: 'ch-1', universe_id: 'uni-1' } })
    renderRedirect('ch-1')

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not open this chapter.')
    expect(screen.queryByText('Dashboard screen')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(screen.getByText('Canonical write screen')).toBeInTheDocument())
  })
})
