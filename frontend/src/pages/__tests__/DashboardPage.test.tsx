import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import DashboardPage from '../DashboardPage'

vi.mock('../DashboardPage.module.css', () => ({ default: new Proxy({}, { get: (_, key) => key }) }))

const mockListUniverses = vi.fn()
const mockCreateUniverse = vi.fn()
const mockDemoClone = vi.fn()
const mockDemoReset = vi.fn()
vi.mock('../../lib/api', () => ({
  api: {
    listUniverses: (...args: unknown[]) => mockListUniverses(...args),
    createUniverse: (...args: unknown[]) => mockCreateUniverse(...args),
    demoClone: (...args: unknown[]) => mockDemoClone(...args),
    demoReset: (...args: unknown[]) => mockDemoReset(...args),
  },
}))

const mockPublish = vi.fn(() => 'feedback-id')
const mockUpdate = vi.fn()
vi.mock('../../components/feedback', () => ({
  useFeedback: () => ({ publish: mockPublish, update: mockUpdate }),
}))

vi.mock('../../components/genres', () => ({
  GenreTagPicker: ({ value, onChange, label, disabled }: {
    value: string[]
    onChange: (nextValue: string[]) => void
    label?: string
    disabled?: boolean
  }) => (
    <div>
      <span>{label}</span>
      <span>{value.length === 0 ? 'No genres selected' : value.join(', ')}</span>
      <button type="button" disabled={disabled} onClick={() => onChange([...value, 'mystery'])}>Add mystery</button>
    </div>
  ),
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

function renderPage(route = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <DashboardPage />
    </MemoryRouter>
  )
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    mockListUniverses.mockResolvedValue({ universes: [] })
    mockCreateUniverse.mockResolvedValue({ universe: { id: 'uni-new', name: 'New World', genre_tags: [] } })
    mockDemoClone.mockResolvedValue({ status: 'success', universe_id: 'demo-1', message: 'Demo universe cloned successfully' })
    mockDemoReset.mockResolvedValue({ status: 'success', universe_id: 'demo-1', message: 'Demo data reset successfully' })
  })

  it('shows real universe details and sends the primary CTA to Write', async () => {
    mockListUniverses.mockResolvedValue({
      universes: [
        { id: 'uni-1', name: 'World One', description: 'A world built around a slow-burning mystery.', genre_tags: ['mystery', 'historical'] },
        { id: 'uni-2', name: 'World Two', genre_tags: [] },
      ],
    })
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByRole('heading', { name: 'World One', level: 3 })).toBeInTheDocument()
    expect(screen.getByText('A world built around a slow-burning mystery.')).toBeInTheDocument()
    expect(screen.getByText('Mystery')).toBeInTheDocument()
    expect(screen.getByText('Historical')).toBeInTheDocument()
    expect(screen.getByText('No genres tagged')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /continue writing/i }))
    expect(mockNavigate).toHaveBeenCalledWith('/universe/uni-1/write')
  })

  it('shows a loading skeleton while the library request is pending', () => {
    mockListUniverses.mockImplementation(() => new Promise(() => undefined))
    renderPage()

    expect(screen.getByLabelText('Loading your universe library')).toBeInTheDocument()
  })

  it('shows a retryable error when the library cannot be loaded', async () => {
    mockListUniverses.mockRejectedValueOnce(new Error('Library unavailable'))
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByText('We could not load your library')).toBeInTheDocument()
    expect(screen.getByText('Library unavailable')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(mockListUniverses).toHaveBeenCalledTimes(2))
  })

  it('creates an untagged universe without applying a default genre', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Create your first universe' }))
    expect(screen.getByText('No genres selected')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Name'), 'New World')
    await user.click(screen.getByRole('button', { name: 'Create universe' }))

    await waitFor(() => {
      expect(mockCreateUniverse).toHaveBeenCalledWith({
        name: 'New World',
        description: '',
        genre_tags: [],
      })
    })
    expect(await screen.findByText('New World is ready. Continue writing when you are.')).toBeInTheDocument()
    expect(mockUpdate).toHaveBeenCalledWith('feedback-id', expect.objectContaining({ status: 'completed' }))
  })

  it('opens the creation panel from the explicit new-universe link', async () => {
    renderPage('/dashboard?new=true')

    expect(await screen.findByRole('heading', { name: 'Start with the shape of your story' })).toBeInTheDocument()
  })

  it('shows the six honest demo steps, clones, enters, and resets through authenticated demo APIs', async () => {
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByText('Ask Memory a lore question.')).toBeInTheDocument()
    expect(screen.getByText('Inspect a real review issue.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clone demo universe' }))
    await waitFor(() => expect(mockDemoClone).toHaveBeenCalledTimes(1))
    const demoSessionId = mockDemoClone.mock.calls[0][0]
    expect(demoSessionId).toEqual(expect.any(String))
    expect(localStorage.getItem('quill-guided-demo-universe-id')).toBe('demo-1')
    expect(await screen.findByRole('button', { name: 'Start guided demo' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Start guided demo' }))
    expect(mockNavigate).toHaveBeenCalledWith('/universe/demo-1/write')

    await user.click(screen.getByRole('button', { name: 'Reset demo' }))
    await waitFor(() => expect(mockDemoReset).toHaveBeenCalledWith(demoSessionId))
    expect(mockUpdate).toHaveBeenCalledWith('feedback-id', expect.objectContaining({ status: 'completed' }))
  })

  it('surfaces authenticated demo failures inline and retries the same action', async () => {
    mockDemoClone.mockRejectedValueOnce(new Error('authentication required'))
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Clone demo universe' }))
    expect((await screen.findAllByText('authentication required')).length).toBeGreaterThan(0)
    expect(mockUpdate).toHaveBeenCalledWith('feedback-id', expect.objectContaining({
      status: 'failed',
      retry: expect.any(Function),
    }))

    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(mockDemoClone).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('button', { name: 'Start guided demo' })).toBeInTheDocument()
  })
})
