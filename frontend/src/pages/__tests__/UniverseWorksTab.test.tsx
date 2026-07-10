import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import UniverseWorksTab from '../UniverseWorksTab'
import { UniverseContext } from '../../contexts/UniverseContext'

vi.mock('../UniverseWorksTab.module.css', () => ({ default: new Proxy({}, { get: (_, k) => k }) }))
vi.mock('../../components/shared/ImageUpload', () => ({ default: () => null }))

const mockDeleteWork = vi.fn()
const mockDeleteChapter = vi.fn()
const mockGetWork = vi.fn()
const mockListChapters = vi.fn()
vi.mock('../../lib/api', () => ({
  api: {
    deleteWork: (...args: unknown[]) => mockDeleteWork(...args),
    deleteChapter: (...args: unknown[]) => mockDeleteChapter(...args),
    getWork: (...args: unknown[]) => mockGetWork(...args),
    listChapters: (...args: unknown[]) => mockListChapters(...args),
  },
}))

const universe = { id: 'uni-1', name: 'Universe', genre: 'fantasy', format: 'novel' }
const twoWorks = [
  { id: 'work-1', title: 'First Work', type: 'novel', order_index: 0 },
  { id: 'work-2', title: 'Second Work', type: 'novel', order_index: 1 },
]
const mockRefetchWorks = vi.fn().mockResolvedValue(undefined)

function renderTab(works = twoWorks) {
  return render(
    <MemoryRouter initialEntries={['/universe/uni-1/works']}>
      <UniverseContext.Provider value={{ universe, works, refetchWorks: mockRefetchWorks }}>
        <Routes>
          <Route path="/universe/:universeId/works" element={<UniverseWorksTab />} />
        </Routes>
      </UniverseContext.Provider>
    </MemoryRouter>
  )
}

describe('UniverseWorksTab deletes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetWork.mockResolvedValue({ work: { id: 'work-1', title: 'First Work', type: 'novel', universe_id: 'uni-1' } })
    mockListChapters.mockResolvedValue({
      chapters: [{ id: 'ch-1', title: 'Chapter One', order_index: 1, word_count: 100, status: 'draft' }],
    })
  })

  it('does not delete a work when the confirm dialog is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderTab()

    const user = userEvent.setup()
    await user.click(screen.getAllByLabelText('Delete work')[0])

    expect(window.confirm).toHaveBeenCalled()
    expect(mockDeleteWork).not.toHaveBeenCalled()
    expect(mockRefetchWorks).not.toHaveBeenCalled()
  })

  it('deletes the work and refetches on confirm', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mockDeleteWork.mockResolvedValue(undefined)
    renderTab()

    const user = userEvent.setup()
    await user.click(screen.getAllByLabelText('Delete work')[0])

    await waitFor(() => {
      expect(mockDeleteWork).toHaveBeenCalledWith('work-1')
      expect(mockRefetchWorks).toHaveBeenCalled()
    })
  })

  it('does not open the work when clicking its delete button', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderTab()

    const user = userEvent.setup()
    await user.click(screen.getAllByLabelText('Delete work')[0])

    // Still on the works grid — the card click (which opens WorkDetail) must
    // not fire from the delete button.
    expect(screen.getByText('Works & Chapters')).toBeInTheDocument()
    expect(mockGetWork).not.toHaveBeenCalled()
  })

  it('does not delete a chapter when the confirm dialog is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    // Single work auto-selects into WorkDetail.
    renderTab([twoWorks[0]])
    await screen.findByText('Chapter One')

    const user = userEvent.setup()
    await user.click(screen.getByLabelText('Delete chapter'))

    expect(window.confirm).toHaveBeenCalled()
    expect(mockDeleteChapter).not.toHaveBeenCalled()
  })

  it('deletes the chapter and refetches on confirm', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mockDeleteChapter.mockResolvedValue(undefined)
    renderTab([twoWorks[0]])
    await screen.findByText('Chapter One')
    expect(mockListChapters).toHaveBeenCalledTimes(1)

    const user = userEvent.setup()
    await user.click(screen.getByLabelText('Delete chapter'))

    await waitFor(() => {
      expect(mockDeleteChapter).toHaveBeenCalledWith('ch-1')
      expect(mockListChapters).toHaveBeenCalledTimes(2)
    })
  })
})
