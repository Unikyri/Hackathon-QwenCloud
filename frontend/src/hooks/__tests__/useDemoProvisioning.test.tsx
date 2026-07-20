import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useDemoProvisioning } from '../useDemoProvisioning'

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
// A: authStore mock now includes isAuthenticated and register for startDemoFromScratch.
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

const mockCreateUniverse = vi.fn()
vi.mock('../../lib/api', () => ({
  api: { createUniverse: (...args: unknown[]) => mockCreateUniverse(...args) },
}))

function wrapper({ children }: { children: React.ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>
}

describe('useDemoProvisioning', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('provisions a demo and navigates into the cloned universe write screen', async () => {
    mockDemoLogin.mockResolvedValueOnce('demo-universe-42')
    const { result } = renderHook(() => useDemoProvisioning(), { wrapper })

    expect(result.current.pending).toBe(false)
    expect(result.current.error).toBe('')

    await act(async () => {
      await result.current.startDemo()
    })

    await waitFor(() => {
      expect(mockDemoLogin).toHaveBeenCalledTimes(1)
      expect(mockNavigate).toHaveBeenCalledWith('/universe/demo-universe-42/write')
    })
    expect(result.current.pending).toBe(false)
    expect(result.current.error).toBe('')
  })

  it('surfaces the error message and does not navigate when provisioning fails', async () => {
    mockDemoLogin.mockRejectedValueOnce(new Error('Demo unavailable'))
    const { result } = renderHook(() => useDemoProvisioning(), { wrapper })

    await act(async () => {
      await result.current.startDemo()
    })

    await waitFor(() => {
      expect(result.current.error).toBe('Demo unavailable')
    })
    expect(result.current.pending).toBe(false)
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('A: creates an empty universe and navigates to the import drawer for startDemoFromScratch', async () => {
    mockRegister.mockResolvedValueOnce(undefined)
    mockCreateUniverse.mockResolvedValueOnce({ universe: { id: 'scratch-uni-99' } })
    const { result } = renderHook(() => useDemoProvisioning(), { wrapper })

    await act(async () => {
      await result.current.startDemoFromScratch()
    })

    await waitFor(() => {
      expect(mockCreateUniverse).toHaveBeenCalledWith(expect.objectContaining({ name: 'The Shattered Compact' }))
      // writeImportPath navigates to write?panel=import
      expect(mockNavigate).toHaveBeenCalledWith('/universe/scratch-uni-99/write?panel=import')
    })
    expect(result.current.pendingScratch).toBe(false)
    expect(result.current.error).toBe('')
  })

  it('A: surfaces the error and does not navigate when startDemoFromScratch fails', async () => {
    mockRegister.mockResolvedValueOnce(undefined)
    mockCreateUniverse.mockRejectedValueOnce(new Error('Create failed'))
    const { result } = renderHook(() => useDemoProvisioning(), { wrapper })

    await act(async () => {
      await result.current.startDemoFromScratch()
    })

    await waitFor(() => {
      expect(result.current.error).toBe('Create failed')
    })
    expect(mockNavigate).not.toHaveBeenCalled()
  })
})

