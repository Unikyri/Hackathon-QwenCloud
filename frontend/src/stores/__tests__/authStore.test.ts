import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useAuthStore } from '../authStore'

const mockMe = vi.fn()
const mockRegister = vi.fn()
const mockDemoClone = vi.fn()
vi.mock('../../lib/api', () => ({
  api: {
    me: (...args: unknown[]) => mockMe(...args),
    register: (...args: unknown[]) => mockRegister(...args),
    demoClone: (...args: unknown[]) => mockDemoClone(...args),
  },
}))

describe('authStore.init', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    useAuthStore.setState({ user: null, token: null, isAuthenticated: false })
  })

  it('does nothing when there is no stored token', async () => {
    await useAuthStore.getState().init()
    expect(mockMe).not.toHaveBeenCalled()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })

  it('hydrates the user when a stored token resolves via api.me', async () => {
    localStorage.setItem('token', 'valid-token')
    const user = { id: 'u1', email: 'a@b.com', display_name: 'Alice' }
    mockMe.mockResolvedValue({ user })

    await useAuthStore.getState().init()

    expect(mockMe).toHaveBeenCalled()
    expect(useAuthStore.getState().user).toEqual(user)
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })

  it('clears the token when api.me rejects (expired/invalid token)', async () => {
    localStorage.setItem('token', 'stale-token')
    mockMe.mockRejectedValue(new Error('401 unauthorized'))

    await useAuthStore.getState().init()

    expect(localStorage.getItem('token')).toBeNull()
    expect(useAuthStore.getState().user).toBeNull()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })

  it('creates an isolated demo identity and sends an opaque session ID, never a bearer token', async () => {
    const user = { id: 'demo-user', email: 'demo-visitor@example.invalid', display_name: 'Demo Visitor' }
    const token = 'bearer-token-that-must-not-be-a-session-id'
    mockRegister.mockResolvedValue({ user, token })
    mockDemoClone.mockResolvedValue({ universe_id: 'demo-universe' })

    const universeID = await useAuthStore.getState().demoLogin()

    expect(universeID).toBe('demo-universe')
    expect(mockRegister).toHaveBeenCalledTimes(1)
    const [registration] = mockRegister.mock.calls[0] as [{ email: string; password: string; display_name: string }]
    expect(registration.email).toMatch(/^demo-[0-9a-f-]+@example\.invalid$/)
    expect(registration.email).not.toBe('demo@quill.ai')
    expect(registration.password).not.toBe('demo1234')
    expect(registration.display_name).toBe('Demo Visitor')

    expect(mockDemoClone).toHaveBeenCalledWith(expect.any(String))
    const [sessionID] = mockDemoClone.mock.calls[0] as [string]
    expect(sessionID).toMatch(/^[0-9a-f-]{36}$/)
    expect(sessionID).not.toBe(token)
    expect(localStorage.getItem('quill-guided-demo-session-id')).toBe(sessionID)
    expect(localStorage.getItem('token')).toBe(token)
    expect(useAuthStore.getState().user).toEqual(user)
  })
})
