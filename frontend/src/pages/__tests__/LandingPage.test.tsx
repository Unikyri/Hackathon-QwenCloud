import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import LandingPage from '../LandingPage'

vi.mock('../LandingPage.module.css', () => ({ default: new Proxy({}, { get: (_, k) => k }) }))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

const mockDemoLogin = vi.fn()
const mockRegister = vi.fn()
// A: authStore mock expanded with isAuthenticated + register for startDemoFromScratch.
vi.mock('../../stores/authStore', () => ({
  useAuthStore: vi.fn((selector?: (state: {
    demoLogin: typeof mockDemoLogin
    isAuthenticated: boolean
    register: typeof mockRegister
  }) => unknown) => {
    const state = { demoLogin: mockDemoLogin, isAuthenticated: false, register: mockRegister }
    return selector ? selector(state) : state
  }),
}))

// A: useDemoProvisioning calls api.createUniverse for the scratch flow.
const mockCreateUniverse = vi.fn()
vi.mock('../../lib/api', () => ({
  api: { createUniverse: (...args: unknown[]) => mockCreateUniverse(...args) },
}))

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('LandingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('A: "Jump into a finished universe" clones the demo and redirects to its Write screen', async () => {
    mockDemoLogin.mockResolvedValueOnce('demo-universe-7')
    renderPage()

    // A: secondary CTA triggers the clone (startDemo) path
    fireEvent.click(screen.getByRole('button', { name: /jump into a finished universe/i }))

    await waitFor(() => {
      expect(mockDemoLogin).toHaveBeenCalledTimes(1)
      expect(mockNavigate).toHaveBeenCalledWith('/universe/demo-universe-7/write')
    })
  })

  it('A: "Start from scratch" creates an empty universe and opens the import drawer', async () => {
    mockRegister.mockResolvedValueOnce(undefined)
    mockCreateUniverse.mockResolvedValueOnce({ universe: { id: 'scratch-uni-1' } })
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /start from scratch/i }))

    await waitFor(() => {
      expect(mockCreateUniverse).toHaveBeenCalledWith(expect.objectContaining({ name: 'The Shattered Compact' }))
      expect(mockNavigate).toHaveBeenCalledWith('/universe/scratch-uni-1/write?panel=import')
    })
  })

  it('still offers a plain login link for visitors who do not want the demo', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /^log in$/i }))
    expect(mockNavigate).toHaveBeenCalledWith('/login')
  })
})

