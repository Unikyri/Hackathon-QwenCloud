import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import UniverseWorksTab from '../UniverseWorksTab'
import { UniverseContext } from '../../contexts/UniverseContext'

vi.mock('../UniverseWorksTab.module.css', () => ({ default: new Proxy({}, { get: (_, k) => k }) }))
vi.mock('../../components/shared/ImageUpload', () => ({ default: () => null }))

const mockPublish = vi.fn(() => 'feedback-id')
vi.mock('../../components/feedback', () => ({
  useFeedback: () => ({ publish: mockPublish }),
}))

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
    <MemoryRouter initialEntries={['/universe/uni-1/write']}>
      <UniverseContext.Provider value={{ universe, works, refetchWorks: mockRefetchWorks }}>
        <Routes>
          <Route path="/universe/:universeId/write" element={<UniverseWorksTab />} />
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

  it('does not delete a work when inline deletion is cancelled', async () => {
    renderTab()

    const user = userEvent.setup()
    await user.click(screen.getByLabelText('Delete First Work'))
    expect(screen.getByRole('alertdialog', { name: 'Confirm deletion' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(mockDeleteWork).not.toHaveBeenCalled()
    expect(mockRefetchWorks).not.toHaveBeenCalled()
  })

  it('deletes the work and refetches after explicit confirmation', async () => {
    mockDeleteWork.mockResolvedValue(undefined)
    renderTab()

    const user = userEvent.setup()
    await user.click(screen.getByLabelText('Delete First Work'))
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(mockDeleteWork).toHaveBeenCalledWith('work-1')
      expect(mockRefetchWorks).toHaveBeenCalled()
    })
  })

  it('does not open the work when clicking its delete button', async () => {
    renderTab()

    const user = userEvent.setup()
    await user.click(screen.getByLabelText('Delete First Work'))

    expect(screen.getByText('Write')).toBeInTheDocument()
    expect(mockGetWork).not.toHaveBeenCalled()
  })

  it('does not delete a chapter when inline deletion is cancelled', async () => {
    renderTab([twoWorks[0]])
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Open First Work' }))
    await screen.findByText('Chapter One')

    await user.click(screen.getByLabelText('Delete Chapter One'))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(mockDeleteChapter).not.toHaveBeenCalled()
  })

  it('deletes the chapter after explicit confirmation', async () => {
    mockDeleteChapter.mockResolvedValue(undefined)
    renderTab([twoWorks[0]])
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Open First Work' }))
    await screen.findByText('Chapter One')
    expect(mockListChapters).toHaveBeenCalledTimes(1)

    await user.click(screen.getByLabelText('Delete Chapter One'))
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(mockDeleteChapter).toHaveBeenCalledWith('ch-1')
    })
  })
})
