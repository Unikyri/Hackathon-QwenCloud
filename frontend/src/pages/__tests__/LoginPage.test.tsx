import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import LoginPage from '../LoginPage'

// CSS module mock
vi.mock('../LoginPage.module.css', () => ({ default: new Proxy({}, { get: (_, k) => k }) }))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

const mockLogin = vi.fn()
const mockRegister = vi.fn()
const mockDemoLogin = vi.fn()

const authStoreState = {
  login: mockLogin,
  register: mockRegister,
  demoLogin: mockDemoLogin,
  isAuthenticated: false,
}

vi.mock('../../stores/authStore', () => ({
  useAuthStore: vi.fn((selector?: (state: typeof authStoreState) => unknown) =>
    selector ? selector(authStoreState) : authStoreState
  ),
}))

// A: useDemoProvisioning now calls api.createUniverse for the scratch flow.
const mockCreateUniverse = vi.fn()
vi.mock('../../lib/api', () => ({
  api: { createUniverse: (...args: unknown[]) => mockCreateUniverse(...args) },
}))

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('LoginPage', () => {
  it('renders login form by default', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: /quill/i })).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/email/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/password/i)).toBeInTheDocument()
    // Both tab and submit button say "Sign In" — at least one must be present
    expect(screen.getAllByRole('button', { name: /sign in/i }).length).toBeGreaterThanOrEqual(1)
  })

  it('A: renders both demo buttons with the correct labels', () => {
    renderPage()
    // Primary CTA — starts from scratch
    expect(screen.getByRole('button', { name: /see it build/i })).toBeInTheDocument()
    // Secondary CTA — clones a finished universe
    expect(screen.getByRole('button', { name: /skip ahead/i })).toBeInTheDocument()
  })

  it('submits login and navigates to dashboard', async () => {
    mockLogin.mockResolvedValueOnce(undefined)
    renderPage()

    fireEvent.change(screen.getByPlaceholderText(/email/i), { target: { value: 'test@example.com' } })
    fireEvent.change(screen.getByPlaceholderText(/password/i), { target: { value: 'password123' } })
    // Target the submit button inside the form, not the tab
    const form = document.querySelector('form')!
    const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('test@example.com', 'password123')
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard')
    })
  })

  it('switches to register form', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /register/i }))
    expect(screen.getByPlaceholderText(/author name/i)).toBeInTheDocument()
  })

  it('handles demo flow: login → clone → navigate', async () => {
    mockDemoLogin.mockResolvedValueOnce('demo-universe-42')
    renderPage()

    // A: "Skip ahead" button triggers the clone path (old startDemo)
    fireEvent.click(screen.getByRole('button', { name: /skip ahead/i }))

    await waitFor(() => {
      expect(mockDemoLogin).toHaveBeenCalled()
      // useDemoProvisioning navigates straight to the Write screen (writePath);
      // /universe/:id's index route redirects there too, so this is the same
      // destination the visitor previously reached in one extra hop.
      expect(mockNavigate).toHaveBeenCalledWith('/universe/demo-universe-42/write')
    })
  })

  it('shows error when demo flow fails', async () => {
    mockDemoLogin.mockRejectedValueOnce(new Error('Demo unavailable'))
    renderPage()

    // A: "Skip ahead" button triggers the clone path; error must surface inline.
    fireEvent.click(screen.getByRole('button', { name: /skip ahead/i }))

    await waitFor(() => {
      expect(screen.getByText('Demo unavailable')).toBeInTheDocument()
    })
  })
})

