import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import ContradictionsPage from '../ContradictionsPage'
import { UniverseContext } from '../../contexts/UniverseContext'

// CSS module mock
vi.mock('../ContradictionsPage.module.css', () => ({ default: new Proxy({}, { get: (_, k) => k }) }))

// Mock api
const mockGetContradictions = vi.fn()
const mockResolveContradiction = vi.fn()
const mockDismissContradiction = vi.fn()

vi.mock('../../lib/api', () => ({
  api: {
    getContradictions: (...args: unknown[]) => mockGetContradictions(...args),
    resolveContradiction: (...args: unknown[]) => mockResolveContradiction(...args),
    dismissContradiction: (...args: unknown[]) => mockDismissContradiction(...args),
  },
}))

const defaultContext = {
  universe: { id: 'uni-1', name: 'Test Universe', genre: 'Fantasy', format: 'Novel' },
  works: [],
  refetchWorks: vi.fn(),
}

function renderPage() {
  return render(
    <UniverseContext.Provider value={defaultContext}>
      <MemoryRouter initialEntries={['/universe/uni-1/contradictions']}>
        <Routes>
          <Route path="/universe/:universeId/contradictions" element={<ContradictionsPage />} />
        </Routes>
      </MemoryRouter>
    </UniverseContext.Provider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ContradictionsPage', () => {
  it('shows loading state initially', () => {
    mockGetContradictions.mockReturnValue(new Promise(() => {}))
    const { container } = renderPage()
    expect(container.querySelector('.skeleton')).toBeInTheDocument()
  })

  it('renders contradiction cards on load', async () => {
    mockGetContradictions.mockResolvedValue({
      contradictions: [
        { id: 'c1', description: 'Character age mismatch', severity: 'high', status: 'open' },
        { id: 'c2', description: 'Timeline conflict', severity: 'low', status: 'open' },
      ],
    })
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Character age mismatch')).toBeInTheDocument()
      expect(screen.getByText('Timeline conflict')).toBeInTheDocument()
    })
    // Filter buttons render capitalized ("High"/"Low"); severity badges render full uppercase ("HIGH"/"LOW")
    expect(screen.getByRole('button', { name: 'High' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Low' })).toBeInTheDocument()
    expect(screen.getByText('HIGH')).toBeInTheDocument()
    expect(screen.getByText('LOW')).toBeInTheDocument()
  })

  it('shows empty state when no contradictions', async () => {
    mockGetContradictions.mockResolvedValue({ contradictions: [] })
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('No Contradictions')).toBeInTheDocument()
    })
  })

  it('shows an accessible retry after a load failure', async () => {
    mockGetContradictions
      .mockRejectedValueOnce(new Error('Server down'))
      .mockResolvedValueOnce({ contradictions: [{ id: 'c1', description: 'Recovered issue', severity: 'high', status: 'open' }] })
    renderPage()

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Could not load')
      expect(screen.getByText('Server down')).toBeInTheDocument()
    })

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /retry loading contradictions/i }))

    await waitFor(() => expect(mockGetContradictions).toHaveBeenCalledTimes(2))
    expect(screen.getByText('Recovered issue')).toBeInTheDocument()
  })

  it('filters contradictions by severity', async () => {
    mockGetContradictions.mockResolvedValue({
      contradictions: [
        { id: 'c1', description: 'High issue', severity: 'high', status: 'open' },
        { id: 'c2', description: 'Low issue', severity: 'low', status: 'open' },
      ],
    })
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('High issue')).toBeInTheDocument()
      expect(screen.getByText('Low issue')).toBeInTheDocument()
    })

    const user = userEvent.setup()
    // Click the "High" filter button (capitalized; distinct from the "HIGH" severity badge)
    await user.click(screen.getByRole('button', { name: 'High' }))

    // "High issue" still visible, "Low issue" filtered out
    expect(screen.getByText('High issue')).toBeInTheDocument()
    expect(screen.queryByText('Low issue')).not.toBeInTheDocument()
  })

  it('requires inline confirmation before resolving a contradiction and moves focus to the confirmation', async () => {
    mockGetContradictions.mockResolvedValue({
      contradictions: [
        { id: 'c1', description: 'Fix me', severity: 'medium', status: 'open' },
      ],
    })
    mockResolveContradiction.mockResolvedValue(true)
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Fix me')).toBeInTheDocument()
    })

    const user = userEvent.setup()
    await user.click(screen.getByText('Resolve'))

    expect(screen.getByRole('group', { name: 'Resolve contradiction: Fix me' })).toBeInTheDocument()
    expect(mockResolveContradiction).not.toHaveBeenCalled()

    const confirmButton = screen.getByRole('button', { name: 'Confirm resolve' })
    expect(confirmButton).toHaveFocus()
    await user.click(confirmButton)

    await waitFor(() => {
      expect(screen.getByText('Resolved')).toBeInTheDocument()
      expect(mockResolveContradiction).toHaveBeenCalledWith('uni-1', 'c1')
    })
  })

  it('keeps a contradiction open and explains recovery when resolution fails', async () => {
    mockGetContradictions.mockResolvedValue({
      contradictions: [{ id: 'c1', description: 'Fix me', severity: 'medium', status: 'open' }],
    })
    mockResolveContradiction.mockRejectedValue(new Error('Service unavailable'))
    renderPage()

    await waitFor(() => expect(screen.getByText('Fix me')).toBeInTheDocument())

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Resolve' }))
    await user.click(screen.getByRole('button', { name: 'Confirm resolve' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/service unavailable/i))
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeInTheDocument()
    expect(screen.queryByText('Resolved')).not.toBeInTheDocument()
  })
})
